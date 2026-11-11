// 招牌图集：官方豆包头像 + 用系统字体现画的文字招牌（店招、广告牌、路牌）
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",system-ui,sans-serif';
export const AS = 1024; // 图集边长

// 把官方图标画成圆形头像（图标本身是白底 + 浅蓝圆，头发略微探出圆外，所以裁剪圆取得比蓝圆稍大）
export function drawAvatar(c, img, x, y, s) {
  c.save(); c.beginPath(); c.arc(x + s / 2, y + s / 2, s / 2, 0, 7); c.clip();
  c.fillStyle = '#fff'; c.fillRect(x, y, s, s);
  const k = 1.09; c.drawImage(img, x - (s * (k - 1)) / 2, y - (s * (k - 1)) / 2 + s * 0.015, s * k, s * k);
  c.restore();
}
// 图集布局（像素矩形 [x,y,w,h]）
export const R = {
  avatar: [0, 0, 256, 256], word: [256, 0, 512, 256], bike: [768, 0, 256, 256], hello: [0, 256, 768, 128], lane: [768, 256, 256, 128], ask: [0, 384, 512, 128], bug: [512, 384, 512, 128],
  shop0: [0, 512, 384, 96], shop1: [384, 512, 384, 96], shop2: [0, 608, 384, 96], shop3: [384, 608, 384, 96], shop4: [0, 704, 384, 96], shop5: [384, 704, 384, 96], shop6: [0, 800, 384, 96], shop7: [384, 800, 384, 96],
  go: [768, 512, 256, 96], fix: [768, 608, 256, 96], shop: [768, 704, 256, 96], zero: [0, 896, 448, 128], think: [448, 896, 320, 128], en: [768, 896, 256, 128],
};
export function makeAtlas(img) {
  const cv = document.createElement('canvas'); cv.width = cv.height = AS;
  const c = cv.getContext('2d');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const panel = ([x, y, w, h], bg, fg, text, size, sub, rad = 22) => {
    c.fillStyle = bg; c.beginPath(); c.roundRect(x + 4, y + 4, w - 8, h - 8, rad); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 3; c.stroke();
    c.fillStyle = fg; c.font = `800 ${size}px ${FONT}`; c.fillText(text, x + w / 2, y + h / 2 - (sub ? size * 0.2 : 0) + size * 0.04, w - 24);
    if (sub) { c.font = `600 ${size * 0.26}px ${FONT}`; c.globalAlpha = 0.85; c.fillText(sub, x + w / 2, y + h / 2 + size * 0.52); c.globalAlpha = 1; }
  };
  drawAvatar(c, img, 0, 0, 256);
  panel(R.word, '#ffffff', '#1f6bff', '豆包', 150, 'DOUBAO · AI 助手');
  panel(R.hello, '#1f6bff', '#ffffff', '你好，我是豆包', 84);
  panel(R.ask, '#ffffff', '#16233b', '有问题，尽管问', 62);
  panel(R.bug, '#ff3d6e', '#ffffff', 'BUG 退散！', 72);
  panel(R.lane, '#1f55c9', '#ffffff', '骑行优先', 50, 0, 8);
  panel(R.go, '#18c08a', '#ffffff', '冲冲冲！', 54);
  panel(R.fix, '#ffffff', '#ff3d6e', '修 Bug 中', 50);
  panel(R.shop, '#ffd24a', '#3a2a00', '豆包小卖部', 44);
  panel(R.zero, '#0e1730', '#7fd0ff', '全程序化生成', 60);
  panel(R.think, '#7a5cff', '#ffffff', '深度思考中…', 48);
  panel(R.en, '#0e1730', '#ffffff', 'DOUBAO', 52);
  // 街边店招
  [['便利店 24H', '#1a7f5a', '#fff'], ['兰州拉面', '#b3261e', '#ffe9a8'], ['鲜果茶 · 奶茶', '#f6e7c8', '#7a3b12'], ['豆包包子铺', '#fff7e6', '#b3261e'], ['单车修理', '#20242c', '#ffd24a'], ['新华书店', '#a8231c', '#fff'], ['花店 FLOWER', '#fde4ec', '#b23a6b'], ['咖啡 COFFEE', '#3b2a20', '#f3e3cf']]
    .forEach(([t, bg, fg], i) => panel(R['shop' + i], bg, fg, t, 54, 0, 6));
  // 自行车图标牌
  const [x, y, w, h] = R.bike;
  c.fillStyle = '#1f55c9'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 122, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 12; c.lineCap = c.lineJoin = 'round';
  c.beginPath(); c.arc(x + 78, y + 158, 40, 0, 7); c.stroke(); c.beginPath(); c.arc(x + 178, y + 158, 40, 0, 7); c.stroke();
  c.beginPath(); c.moveTo(x + 78, y + 158); c.lineTo(x + 112, y + 96); c.lineTo(x + 162, y + 96); c.lineTo(x + 178, y + 158); c.moveTo(x + 112, y + 96); c.lineTo(x + 132, y + 158); c.lineTo(x + 162, y + 96);
  c.moveTo(x + 100, y + 84); c.lineTo(x + 124, y + 84); c.moveTo(x + 156, y + 78); c.lineTo(x + 176, y + 74); c.stroke();
  return cv;
}
// HUD / 菜单 / favicon 用的头像位图
export function avatarURL(img, s = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  drawAvatar(cv.getContext('2d'), img, 0, 0, s);
  return cv.toDataURL();
}
