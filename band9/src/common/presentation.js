// Band 9 / 9 NFC: 192 x 490. Only rendering, never navigation interpretation.
const ICONS = ['left', 'right', 'straight', 'slight_left', 'slight_right', 'sharp_left', 'sharp_right', 'uturn', 'roundabout', 'arrive', 'unknown'];
function lines(text, limit) {
  const out = [];
  for (const paragraph of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    let row = '', count = 0;
    for (const ch of paragraph) {
      row += ch;
      if (++count === limit) { out.push(row); row = ''; count = 0; }
    }
    if (row) out.push(row);
  }
  return out;
}
function project(view, warning) {
  const guidance = view.live || view.status === '演示 · 非真实导航';
  const raw = String(view.rawText || '').split(/\r?\n/)
    .filter(line => !/^(高德地图|高德导航中)$/.test(line.trim())).join('\n').trim();
  const distance = String(view.distance || '').trim();
  const numeric = distance.match(/^(\d+(?:\.\d+)?)\s*(米|公里|千米|m|km)$/i);
  const value = guidance ? (numeric ? numeric[1] : '—') : '';
  const hint = guidance ? raw || view.instruction : {
    '等待连接': '请连接小米运动健康', '等待导航': '请在高德开始导航',
    '导航结束': '本次导航已结束', '同步已暂停': '请在手机开启同步',
    '连接已断开': '请重新连接手环', '导航已过期': '等待手机更新，请查看手机',
    '通知读取不可用': '请检查手机通知使用权', '连接不可用': '请重新连接手环'
  }[view.status] || '';
  return {
    guidance, demo: view.status === '演示 · 非真实导航', statusLines: lines(view.status, 7),
    arrow: '/common/arrows/' + (ICONS.indexOf(view.icon) >= 0 ? view.icon : 'unknown') + '.png',
    distance: value, unit: guidance && numeric ? numeric[2] : '',
    distanceSize: value.length <= 4 ? 42 : value.length <= 6 ? 30 : 20,
    instructionLines: guidance ? lines(view.instruction || '请查看原文', 7).slice(0, 2) : [],
    detailLines: lines([hint, warning].filter(Boolean).join('\n'), 9)
  };
}
module.exports = { project, lines, ICONS };
