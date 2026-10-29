const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { metres, immediate, createPolicy, createPlayer } = require('../src/common/vibration');
const protocol = require('../src/common/protocol');
const { project, lines } = require('../src/common/presentation');

function packet(seq, distance, options) {
  return Object.assign({ v: 1, type: 'navigation', session: 'phone-process-a', seq,
    status: 'active', title: '高德地图', maneuver: 'right', instruction: '右转',
    distance, rawText: '前方' + distance + '右转', keepScreenOn: true }, options || {});
}
function clock() {
  let now = 1000, id = 0;
  const jobs = new Map();
  return {
    now: () => now,
    set(fn, ms) { const n = ++id; jobs.set(n, { at: now + ms, fn }); return n; },
    clear(n) { jobs.delete(n); },
    size: () => jobs.size,
    advance(ms) {
      const end = now + ms;
      for (let limit = 0; limit < 1000; limit++) {
        const pending = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) { now = end; return; }
        now = pending[1].at; jobs.delete(pending[0]); pending[1].fn();
      }
      throw new Error('Timer loop');
    }
  };
}
function policyRun() {
  const policy = createPolicy(); let seq = 0, time = 0;
  return { policy, next(distance, options, gap) {
    time += gap === undefined ? 1000 : gap;
    return policy.observe(packet(++seq, distance, options), time, true);
  } };
}
function kind(value) { return value ? value.kind : null; }

for (const [input, expected] of [['150米', 150], ['50 m', 50], ['1公里', 1000],
  ['0.02 km', 20], ['0.03千米', 30], ['0米', 0], ['2 KM', 2000], [' 18.5 米 ', 18.5],
  ['', null], ['剩余150米', null], ['-1m', null], ['1e3m', null], ['NaN', null], ['1公里后右转', null],
  ['150', null], ['Infinity m', null]]) {
  test('strict distance: ' + JSON.stringify(input), () => assert.equal(metres(input), expected));
}
test('new guidance, 150, 50, 20: only one highest event per packet', () => {
  const s = policyRun();
  const got = ['1km', '300m', '170m', '130m', '60m', '48m', '32m', '18m', '12m', '0m']
    .map(d => kind(s.next(d)));
  assert.deepEqual(got, ['instruction', null, null, 'approach', null, 'near', null, 'turn', null, null]);
});
test('jumping over all tiers produces only the final alert', () => {
  const s = policyRun(); s.next('1km');
  assert.equal(kind(s.next('12m')), 'turn');
  assert.equal(s.next('10m'), null);
});
for (const [distance, event] of [['140m', 'approach'], ['45m', 'near'], ['12m', 'turn'], ['0m', 'turn']]) {
  test('initial snapshot inside ' + distance + ' coalesces new instruction', () => {
    const s = policyRun(); assert.equal(kind(s.next(distance)), event);
    assert.equal(s.next(distance), null);
  });
}
test('U-turn final threshold is 30m', () => {
  const s = policyRun(); const p = { maneuver: 'uturn', instruction: '掉头' };
  s.next('1km', p);
  assert.equal(kind(s.next('48m', p)), 'near');
  assert.equal(kind(s.next('29m', p)), 'turn');
  assert.equal(s.next('19m', p), null);
});
test('new turn resets thresholds; kilometers are supported', () => {
  const s = policyRun(); s.next('0.01km');
  assert.equal(kind(s.next('1km', { maneuver: 'left', instruction: '左转' })), 'instruction');
  assert.equal(kind(s.next('0.049km', { maneuver: 'left', instruction: '左转' })), 'near');
});
test('jitter around each threshold never repeats', () => {
  const s = policyRun(); s.next('300m');
  assert.deepEqual(['151m', '149m', '152m', '147m', '51m', '49m', '55m', '45m', '21m', '19m', '24m', '15m']
    .map(d => kind(s.next(d))), [null, 'approach', null, null, null, 'near', null, null, null, 'turn', null, null]);
});
test('8-second heartbeats are silent, seq is not a turn ID', () => {
  const s = policyRun(); s.next('1km');
  for (let i = 0; i < 20; i++) assert.equal(s.next('1km', {}, 8000), null);
});
test('duplicate and older packets do not reset state', () => {
  const p = createPolicy(); p.observe(packet(8, '50m'), 0);
  assert.equal(p.observe(packet(8, '15m'), 1000), null);
  assert.equal(p.observe(packet(2, '15m'), 2000), null);
  assert.equal(kind(p.observe(packet(9, '15m'), 3000)), 'turn');
});
test('same-direction next road: rebound + different guidance resets step', () => {
  const s = policyRun(); s.next('18m', { rawText: '前方18米右转，进入甲路' });
  assert.equal(kind(s.next('200m', { rawText: '前方200米右转，进入乙路' })), 'instruction');
  assert.equal(kind(s.next('48m', { rawText: '前方48米右转，进入乙路' })), 'near');
});
test('same-direction distance rebound needs another distinct decreasing sample', () => {
  const s = policyRun(); s.next('18m');
  assert.equal(s.next('200m'), null);
  assert.equal(s.next('200m', {}, 8000), null);
  assert.equal(kind(s.next('190m')), 'instruction');
  assert.equal(kind(s.next('145m')), 'approach');
});
test('isolated GPS jump does not create a new turn', () => {
  const s = policyRun(); s.next('18m');
  assert.equal(s.next('200m'), null);
  assert.equal(s.next('15m'), null);
});
test('summary / road wording changes without rebound do not reset thresholds', () => {
  const s = policyRun(); s.next('140m', { rawText: '前方140米右转\n剩余1公里 5分钟' });
  assert.equal(s.next('130m', { rawText: '前方130米右转，进入甲路\n剩余0.9公里 4分钟' }), null);
});
test('transport session change is not a route change', () => {
  const s = policyRun(); s.next('140m');
  assert.equal(s.next('130m', { session: 'new-phone-process' }), null);
  assert.equal(kind(s.next('45m', { session: 'new-phone-process' })), 'near');
});
test('disconnect resumes silently and establishes a new baseline', () => {
  const s = policyRun(); s.next('140m'); s.policy.suspend();
  assert.equal(s.next('120m'), null);
  assert.equal(kind(s.next('45m')), 'near');
});
test('no overdue threshold replay after reconnect', () => {
  const s = policyRun(); s.next('200m'); s.policy.suspend();
  assert.equal(s.next('12m'), null);
  assert.equal(s.next('10m'), null);
});
test('stale gap / backwards clock suppress first resumed snapshot', () => {
  const p = createPolicy(); p.observe(packet(1, '200m'), 1000);
  assert.equal(p.observe(packet(2, '40m'), 22000), null);
  assert.equal(kind(p.observe(packet(3, '18m'), 23000)), 'turn');
  assert.equal(p.observe(packet(4, '1km', { maneuver: 'left', instruction: '左转' }), 500), null);
});
test('suspending before first real instruction must not suppress startup', () => {
  const p = createPolicy(); p.suspend();
  assert.equal(kind(p.observe(packet(1, '1km'), 1000, true)), 'instruction');
});
test('hidden messages update baseline without producing alerts', () => {
  const p = createPolicy(); p.observe(packet(1, '200m'), 1000, true);
  assert.equal(p.observe(packet(2, '45m'), 2000, false), null);
  assert.equal(p.observe(packet(3, '40m'), 3000, true), null);
  assert.equal(kind(p.observe(packet(4, '18m'), 4000, true)), 'turn');
});
test('demo is always silent', () => {
  const p = createPolicy();
  for (let seq = 1; seq <= 4; seq++) assert.equal(p.observe(packet(seq, '12m', { status: 'demo' }), seq * 1000), null);
});
test('pause/unavailable/idle do not clear route identity or replay alerts', () => {
  for (const status of ['paused', 'unavailable', 'idle']) {
    const s = policyRun(); s.next('140m');
    assert.equal(s.next('', { status }), null);
    assert.equal(s.next('130m'), null);
    assert.equal(kind(s.next('45m')), 'near');
  }
});
test('end only once after real navigation, then new route can alert', () => {
  const s = policyRun(); assert.equal(s.next('', { status: 'ended' }), null);
  s.next('1km');
  assert.equal(kind(s.next('', { status: 'ended' })), 'ended');
  assert.equal(s.next('', { status: 'ended' }), null);
  assert.equal(kind(s.next('1km')), 'instruction');
});
test('straight/unknown/arrive never pretend a small distance is a turn', () => {
  for (const maneuver of ['straight', 'unknown', 'arrive']) {
    const s = policyRun(); s.next('200m', { maneuver });
    assert.equal(s.next('18m', { maneuver }), null);
  }
});
test('unparsed distance is never guessed from total-trip rawText', () => {
  const s = policyRun(); s.next('', { rawText: '右转\n剩余15米' });
  assert.equal(s.next('', { rawText: '右转\n剩余10米' }), null);
});
test('explicit now/right alert is deduplicated with distance-based final alert', () => {
  const s = policyRun(); s.next('1km');
  assert.equal(kind(s.next('', { rawText: '现在右转' })), 'turn');
  assert.equal(s.next('18m', { rawText: '前方18米右转' }), null);
});
test('future or negated wording must not be mistaken for immediate turn', () => {
  for (const rawText of ['现在直行1公里，再右转', '不要立即右转', '无需立即右转', '前方1公里后右转', '现在左转']) {
    assert.equal(immediate(packet(1, '', { rawText }), null), false, rawText);
  }
  assert.equal(immediate(packet(1, '1km', { rawText: '立即右转' }), 1000), false);
});

test('player emits double pulse using only short/long modes', () => {
  const c = clock(), pulses = [];
  const p = createPlayer(m => pulses.push(m), c.set, c.clear, () => true);
  assert.equal(p.play({ pattern: 'double' }), true);
  assert.deepEqual(pulses, ['short']); c.advance(599); assert.equal(pulses.length, 1);
  c.advance(1); assert.deepEqual(pulses, ['short', 'short']);
});
test('urgent turn cancels pending second short pulse', () => {
  const c = clock(), pulses = [];
  const p = createPlayer(m => pulses.push(m), c.set, c.clear, () => true);
  p.play({ pattern: 'double' }); c.advance(100); p.play({ pattern: 'long' }); c.advance(1000);
  assert.deepEqual(pulses, ['short', 'long']);
});
test('hide, dispose and cancellation release pending vibration timer', () => {
  const c = clock(), pulses = []; let visible = true;
  const p = createPlayer(m => pulses.push(m), c.set, c.clear, () => visible);
  p.play({ pattern: 'double' }); visible = false; c.advance(600); assert.deepEqual(pulses, ['short']);
  visible = true; p.play({ pattern: 'double' }); p.cancel(); assert.equal(c.size(), 0);
  p.dispose(); assert.equal(p.play({ pattern: 'long' }), false);
});
test('vibrator errors are contained; no retry storm', () => {
  const c = clock(); let count = 0;
  const p = createPlayer(() => { count++; throw Error('unsupported'); }, c.set, c.clear, () => true);
  assert.equal(p.play({ pattern: 'double' }), false); c.advance(1000);
  assert.equal(count, 1); assert.equal(c.size(), 0);
});

test('protocol bytes remain identical to upstream', () => {
  const b = fs.readFileSync(path.join(__dirname, '../src/common/protocol.js'));
  const sha = createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
  assert.equal(sha, 'b8718a71fff42ed9a34531f81fed69ee32e514cb');
});
test('unknown distances retain original wording in fallback, no fake 0m', () => {
  const view = { live: true, status: '高德导航', distance: '约一公里', instruction: '右转', rawText: '约一公里后右转', icon: 'right' };
  const p = project(view, ''); assert.equal(p.distance, '—'); assert.equal(p.unit, '');
  assert.equal(p.detailLines.join(''), view.rawText);
});
test('valid units stay exactly as sent; astral characters are not split', () => {
  const p = project({ live: true, status: '高德导航', distance: '1.2 公里', instruction: '右转', rawText: '高德地图\n前方1.2公里右转', icon: 'right' }, '');
  assert.equal(p.distance, '1.2'); assert.equal(p.unit, '公里');
  assert.deepEqual(lines('甲😀乙丙', 2), ['甲😀', '乙丙']);
});
test('manifest: Band9-sized, independent identity, no custom font or storage feature', () => {
  const manifest = require('../src/manifest.json');
  assert.equal(manifest.config.designWidth, 192);
  assert.equal(manifest.package, 'com.bewoodw.band9.navigation');
  assert.deepEqual(manifest.features.map(x => x.name).sort(), ['system.brightness', 'system.interconnect', 'system.vibrator']);
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/index/index.ux'), 'utf8');
  assert.match(page, /height: 490px/); assert.doesNotMatch(page, /@font-face|system\.storage|fontPicker|settingsOpen/);
});

function harness(options) {
  const opts = options || {}, c = clock(), pulses = [], sent = [], brightness = [];
  let stateCallback = null;
  const conn = { send(data) { sent.push(JSON.parse(data.data)); if (opts.sendFails) data.fail(); },
    getReadyState(data) { if (opts.deferredState) stateCallback = data; else data.success({ status: 1 }); } };
  const filename = path.resolve(__dirname, '../src/pages/index/index.ux');
  const source = fs.readFileSync(filename, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('export default', 'module.exports =');
  const normalRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, setTimeout: c.set, clearTimeout: c.clear,
    Date: class extends Date { static now() { return c.now(); } },
    require(name) {
      if (name === '@system.interconnect') { if (opts.interconnectFails) throw Error('no interconnect'); return { instance: () => conn }; }
      if (name === '@system.vibrator') { if (opts.vibratorFails) throw Error('no vibrator'); return { vibrate(arg) { pulses.push(arg.mode); } }; }
      if (name === '@system.brightness') return { setKeepScreenOn(arg) { brightness.push(arg.keepScreenOn); if (opts.brightnessFails) arg.fail(); } };
      return normalRequire(name);
    }
  };
  vm.runInNewContext(source, sandbox, { filename });
  const page = sandbox.module.exports;
  Object.assign(page, page.private);
  page.onInit(); page.onShow(); page.onReady();
  return { page, conn, pulses, sent, brightness, c, state: () => stateCallback,
    receive(p) { conn.onmessage({ data: JSON.stringify(p) }); } };
}
test('real UX integration: new guidance, near, urgent, ACK and display', () => {
  const h = harness(); h.receive(packet(1, '1km'));
  assert.deepEqual(h.pulses, ['short']); assert.equal(h.page.distance, '1');
  h.receive(packet(2, '48m')); h.c.advance(100); h.receive(packet(3, '18m')); h.c.advance(1000);
  assert.deepEqual(h.pulses, ['short', 'short', 'long']);
  assert.equal(h.page.distance, '18'); assert.equal(h.page.unit, 'm');
  assert.equal(h.sent.filter(m => m.type === 'ack').length, 3);
});
test('real UX: unchanged heartbeat renews expiry without buzzing', () => {
  const h = harness(); h.receive(packet(1, '1km'));
  for (let i = 2; i < 7; i++) { h.c.advance(8000); h.receive(packet(i, '1km')); }
  assert.equal(h.pulses.length, 1); assert.equal(h.page.guidance, true);
});
test('real UX: malformed/duplicate/out-of-order packets are rejected before alerts and ACK', () => {
  const h = harness(); h.receive(packet(3, '1km')); const n = h.sent.length;
  h.receive(packet(3, '10m')); h.receive(packet(2, '10m'));
  h.conn.onmessage({ data: '{' }); h.conn.onmessage({ data: '{}' });
  assert.equal(h.sent.length, n); assert.deepEqual(h.pulses, ['short']); assert.equal(h.page.distance, '1');
});
test('real UX: vibrator failure cannot prevent display or ACK', () => {
  const h = harness({ vibratorFails: true }); h.receive(packet(1, '18m'));
  assert.equal(h.page.distance, '18'); assert.equal(h.sent.at(-1).type, 'ack');
});
test('real UX: ending vibrates once and releases screen hold', () => {
  const h = harness(); h.receive(packet(1, '1km')); h.receive(packet(2, '', { status: 'ended' }));
  h.receive(packet(3, '', { status: 'ended' }));
  assert.deepEqual(h.pulses, ['short', 'short']); assert.equal(h.brightness.at(-1), false);
});
test('real UX: hidden page, destruction cancel delayed pulses and hold', () => {
  const h = harness(); h.receive(packet(1, '48m')); h.page.onHide(); h.c.advance(1000);
  assert.deepEqual(h.pulses, ['short']); assert.equal(h.brightness.at(-1), false);
  h.receive(packet(2, '18m')); h.page.onShow(); assert.deepEqual(h.pulses, ['short']);
  h.page.onDestroy(); h.c.advance(30000); assert.equal(h.c.size(), 0);
});
test('real UX: connection loss hides old directions and cancels double pulse', () => {
  const h = harness(); h.receive(packet(1, '48m')); h.conn.onclose(); h.c.advance(1000);
  assert.deepEqual(h.pulses, ['short']); assert.equal(h.page.guidance, false);
  h.receive(packet(2, '40m')); assert.deepEqual(h.pulses, ['short']);
  h.receive(packet(3, '18m')); assert.deepEqual(h.pulses, ['short', 'long']);
});
test('real UX: expired directions clear and first resumed snapshot is silent', () => {
  const h = harness(); h.receive(packet(1, '150m')); h.c.advance(20000);
  assert.equal(h.page.guidance, false); assert.equal(h.page.distance, ''); assert.equal(h.brightness.at(-1), false);
  h.receive(packet(2, '18m')); assert.deepEqual(h.pulses, ['short']);
});
test('real UX: demo never vibrates or holds screen on', () => {
  const h = harness(); h.receive(packet(1, '18m', { status: 'demo' }));
  assert.equal(h.page.demo, true); assert.equal(h.pulses.length, 0); assert.equal(h.brightness.includes(true), false);
});
test('real UX: missing interconnect/brightness degrade without throwing', () => {
  assert.doesNotThrow(() => harness({ interconnectFails: true }));
  const h = harness({ brightnessFails: true }); h.receive(packet(1, '18m'));
  assert.equal(h.page.distance, '18'); assert.equal(h.sent.at(-1).type, 'ack');
});
test('real UX: callbacks from destroyed lifecycle cannot affect new page instance', () => {
  const h = harness({ deferredState: true }); const old = h.state(); const receive = h.conn.onmessage;
  h.page.onDestroy(); h.page.onInit(); h.page.onShow(); h.page.onReady();
  old.success({ status: 0 }); receive({ data: JSON.stringify(packet(99, '18m')) });
  assert.equal(h.pulses.length, 0); assert.equal(h.page.distance, '');
  h.state().success({ status: 1 }); h.receive(packet(1, '1km'));
  assert.deepEqual(h.pulses, ['short']);
});


test('adjacent same-direction turn can reset with explicit changed guidance and rebound', () => {
  const s = policyRun(); s.next('8m', { rawText: '前方8米右转，进入甲路' });
  assert.equal(kind(s.next('45m', { rawText: '前方45米右转，进入乙路' })), 'near');
  assert.equal(kind(s.next('18m', { rawText: '前方18米右转，进入乙路' })), 'turn');
});
test('cosmetic preamble changes do not corroborate a distance jump', () => {
  const s = policyRun(); s.next('18m', { rawText: '前方18米后右转' });
  assert.equal(s.next('200m', { rawText: '还有200米右转' }), null);
  assert.equal(s.next('15m'), null);
});
test('100 deterministic decreasing routes alert at most once per tier', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = policyRun(), events = []; let distance = 1000, x = seed;
    events.push(kind(s.next(distance + 'm')));
    while (distance > 0) {
      x = (x * 1664525 + 1013904223) >>> 0;
      distance = Math.max(0, distance - (x % 90 + 1));
      const e = kind(s.next(distance + 'm')); if (e) events.push(e);
    }
    assert.equal(events.filter(e => e === 'turn').length, 1);
    assert.equal(new Set(events).size, events.length);
    assert.ok(events.length <= 4);
  }
});
test('signing guard refuses missing keys rather than using a shared default', () => {
  const { check } = require('../../tools/check-band9-signing.cjs');
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'band9-sign-test-'));
  try { assert.throws(() => check(temp, false), /identity missing/); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('Android build identity is opt-in; source namespace stays unchanged', () => {
  const gradle = fs.readFileSync(path.join(__dirname, '../../android/app/build.gradle'), 'utf8');
  assert.match(gradle, /def band9Target = project.hasProperty\('band9'\)/);
  assert.match(gradle, /namespace 'io.github.mi9pro.navigation'/);
  assert.match(gradle, /applicationId band9Target \? 'com.bewoodw.band9.navigation' : 'io.github.mi9pro.navigation'/);
  assert.match(gradle, /signing\/band9\/development.p12/);
});
test('real UX: ACK failure stops haptics instead of hiding a broken connection', () => {
  const h = harness({ sendFails: true }); h.receive(packet(1, '18m'));
  assert.equal(h.pulses.length, 0); assert.equal(h.page.guidance, false);
});
