// Pure notification-driven policy. No positioning, route calculation or new phone parser.
const { EXPIRY_MS } = require('./protocol');
const TURNS = ['left', 'right', 'slight_left', 'slight_right', 'sharp_left', 'sharp_right', 'uturn', 'roundabout'];
const MODES = { instruction: 'short', approach: 'short', near: 'double', turn: 'long', ended: 'short' };

function metres(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(米|公里|千米|m|km)$/i);
  if (!match) return null;
  const amount = Number(match[1]) * (/^(公里|千米|km)$/i.test(match[2]) ? 1000 : 1);
  return isFinite(amount) && amount >= 0 ? amount : null;
}
function key(packet) {
  // The upstream instruction is normally a direction word. Distance-only wording
  // changes must not start a new action when a future parser includes a distance.
  return packet.maneuver + '|' + String(packet.instruction || '')
    .replace(/\d+(?:\.\d+)?\s*(?:公里|千米|米|km|m)/gi, '#').replace(/\s/g, '');
}
function context(packet) {
  // Only a guidance line is used as corroborating evidence for a distance reset.
  // This is NOT road extraction; remaining-trip/time summaries are never step IDs.
  const word = String(packet.instruction || '').trim();
  if (!word || packet.maneuver === 'unknown') return '';
  const line = String(packet.rawText || '').split(/\r?\n/).filter(item => item.indexOf(word) >= 0)[0] || '';
  return line.split(/剩余|预计|全程|还需/)[0]
    .replace(/\d+(?:\.\d+)?\s*(?:公里|千米|米|km|m)/gi, '#').replace(/\s/g, '')
    .replace(/^(?:前方|还有|再)/, '').replace(/^#(?:后|处)/, '#');
}
function immediate(packet, distance) {
  // A conservative optional hint: only explicit NOW wording for the current turn.
  // Do not read a later turn out of "现在直行1公里，再右转" or a future instruction.
  if (distance !== null && distance > 50) return false;
  const expressions = {
    left: '(?:向左转|左转)', right: '(?:向右转|右转)',
    slight_left: '(?:向)?左前方', slight_right: '(?:向)?右前方',
    sharp_left: '(?:向)?左后方', sharp_right: '(?:向)?右后方',
    uturn: '(?:掉头|调头)', roundabout: '(?:进入环岛|驶出环岛)'
  };
  if (!expressions[packet.maneuver]) return false;
  return new RegExp('(?:^|[，,。；;\\n])\\s*(?:现在|立即|马上)\\s*(?:请)?\\s*' + expressions[packet.maneuver])
    .test(String(packet.rawText || ''));
}

function createPolicy() {
  let step = null, serial = 0, lastPacket = null, lastAt = null, suspended = false;
  function makeStep(packet, distance) {
    return { id: ++serial, key: key(packet), context: context(packet), min: distance,
      last: distance, rebound: null, approach: false, near: false, turn: false };
  }
  function event(kind) { return { kind, pattern: MODES[kind], actionId: step ? step.id : serial }; }
  return {
    // Transport loss / hidden page / stale data must not queue overdue alerts.
    suspend() { if (step) suspended = true; },
    observe(packet, now, visible) {
      if (!packet || !isFinite(now)) return null;
      if (lastPacket && lastPacket.session === packet.session && packet.seq <= lastPacket.seq) return null;
      const recovering = suspended || (lastAt !== null && (now < lastAt || now - lastAt >= EXPIRY_MS)) ||
        !!(step && lastPacket && lastPacket.session !== packet.session);
      lastPacket = packet;
      lastAt = now;
      if (packet.status === 'ended') {
        const result = step && !recovering && visible !== false ? event('ended') : null;
        step = null; suspended = false;
        return result;
      }
      if (packet.status !== 'active') {
        // Idle can be a temporary remove/repost. Never infer a new trip from it.
        if (step) suspended = true;
        return null;
      }
      const distance = metres(packet.distance);
      const nextKey = key(packet);
      let changed = !step || nextKey !== step.key;
      if (!changed && !recovering && distance !== null && step.min !== null && step.min <= 50) {
        const nextContext = context(packet);
        const contextChanged = !!(nextContext && step.context && nextContext !== step.context);
        const largeRebound = distance >= 80 && distance - step.min >= 60;
        const closeTurn = step.min <= 20 && distance >= 35 && distance - step.min >= 30 && contextChanged;
        // Without a step ID, a small rebound alone cannot prove an adjacent turn.
        // For larger rebounds require changed guidance or another DISTINCT decrease;
        // an identical heartbeat is never evidence for a new action.
        const corroborated = largeRebound && step.rebound !== null && distance < step.rebound;
        changed = closeTurn || (largeRebound && (contextChanged || corroborated));
        step.rebound = largeRebound ? distance : null;
      } else if (step) { step.rebound = null; }
      if (changed || recovering) step = makeStep(packet, distance);
      else {
        if (distance !== null) step.min = step.min === null ? distance : Math.min(step.min, distance);
        step.last = distance;
      }
      let result = changed ? event('instruction') : null;
      if (TURNS.indexOf(packet.maneuver) >= 0) {
        // Record all crossed tiers, emit only the highest one. First arrival at
        // 12m must be ONE long pulse, not a burst of four late reminders.
        if (distance !== null && distance <= 150 && !step.approach) {
          step.approach = true; result = event('approach');
        }
        if (distance !== null && distance <= 50 && !step.near) {
          step.near = true; result = event('near');
        }
        const finalDistance = packet.maneuver === 'uturn' ? 30 : 20;
        if (!step.turn && ((distance !== null && distance <= finalDistance) || immediate(packet, distance))) {
          step.approach = step.near = step.turn = true;
          result = event('turn');
        }
      }
      suspended = false;
      // A resumed snapshot establishes today's baseline; never replay milestones
      // passed while hidden, disconnected, expired or after a phone process restart.
      return recovering || visible === false ? null : result;
    }
  };
}

// Vela Band 9 exposes vibrate(short/long), not start/stop/custom durations.
// A double pulse is two short calls; timing and motor feel still need real hardware.
function createPlayer(emit, schedule, clear, canPlay) {
  let timer = null, alive = true, generation = 0;
  function cancel() {
    generation++;
    if (timer !== null) clear(timer);
    timer = null;
  }
  function pulse(mode) {
    if (!alive || !canPlay()) return false;
    try { emit(mode); return true; } catch (error) { return false; }
  }
  return {
    play(alert) {
      if (!alert || ['short', 'double', 'long'].indexOf(alert.pattern) < 0) return false;
      cancel();
      if (!pulse(alert.pattern === 'long' ? 'long' : 'short')) return false;
      if (alert.pattern === 'double') {
        const current = generation;
        timer = schedule(() => {
          timer = null;
          if (generation === current) pulse('short');
        }, 600);
      }
      return true;
    },
    cancel,
    dispose() { alive = false; cancel(); }
  };
}
module.exports = { metres, immediate, createPolicy, createPlayer };
