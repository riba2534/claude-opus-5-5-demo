// 招牌图集与头像：全部用 Canvas 2D 路径和系统字体现画，不含任何图片文件
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",system-ui,sans-serif';
export const AS = 1024; // 图集边长

// 豆包头像：浅蓝圆底、深棕侧分波波头、大眼睛、黑色圆领 T 恤（按官方头像的特征自行绘制）
export function drawAvatar(c, x, y, s, bg = 1) {
  c.save(); c.translate(x, y); c.scale(s / 100, s / 100);
  c.beginPath(); c.arc(50, 50, 50, 0, 7); c.clip();
  if (bg) { c.fillStyle = '#bfe0fb'; c.fillRect(0, 0, 100, 100); }
  const E = (cx, cy, rx, ry, col, rot = 0) => { c.fillStyle = col; c.beginPath(); c.ellipse(cx, cy, rx, ry, rot, 0, 7); c.fill(); };
  // 后层头发
  c.fillStyle = '#4a3029';
  c.beginPath(); c.moveTo(19, 48); c.bezierCurveTo(14, 14, 86, 10, 82, 46); c.bezierCurveTo(84, 62, 80, 72, 76, 76); c.lineTo(22, 78); c.bezierCurveTo(16, 70, 17, 58, 19, 48); c.fill();
  // 上衣与脖子
  E(50, 104, 40, 22, '#1d1d22'); E(50, 80, 9, 9, '#f1c9b6');
  c.strokeStyle = '#34343c'; c.lineWidth = 2; c.beginPath(); c.arc(50, 78, 12, 0.5, 2.64); c.stroke();
  // 耳朵（她的左耳露出）与脸
  E(77.5, 53, 5, 7, '#f6d3c0'); E(50, 51, 27, 28, '#f9dccb');
  E(34, 62, 6.5, 4, 'rgba(244,150,140,.42)'); E(66, 62, 6.5, 4, 'rgba(244,150,140,.42)');
  // 侧分刘海：从她的左上分线扫向右侧
  c.fillStyle = '#4f342c';
  c.beginPath(); c.moveTo(63, 22); c.bezierCurveTo(50, 20, 30, 24, 22, 52); c.bezierCurveTo(20, 60, 21, 70, 24, 78); c.bezierCurveTo(14, 64, 12, 34, 30, 20); c.bezierCurveTo(44, 10, 62, 14, 63, 22); c.fill();
  c.beginPath(); c.moveTo(63, 22); c.bezierCurveTo(70, 24, 76, 34, 77, 46); c.bezierCurveTo(82, 40, 82, 22, 66, 16); c.bezierCurveTo(60, 14, 60, 20, 63, 22); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(56, 19); c.bezierCurveTo(40, 20, 28, 30, 23, 50); c.stroke();
  // 眉眼
  c.strokeStyle = '#3b2620'; c.lineWidth = 1.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(32, 43.5); c.quadraticCurveTo(38, 40.5, 44, 43); c.stroke();
  c.beginPath(); c.moveTo(57, 43); c.quadraticCurveTo(63, 40.5, 69, 43.5); c.stroke();
  for (const ex of [38.5, 62.5]) {
    E(ex, 52.5, 5.4, 6.6, '#2a1916'); E(ex, 53.5, 3.6, 4.4, '#5b3a2a'); E(ex, 53, 2, 2.6, '#150c0a');
    E(ex + 1.8, 50, 1.7, 1.9, '#fff'); E(ex - 1.8, 55.5, 0.8, 0.9, 'rgba(255,255,255,.8)');
    c.strokeStyle = '#1c100e'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(ex - 6, 50); c.quadraticCurveTo(ex, 44.5, ex + 6, 49.5); c.stroke();
  }
  E(50, 60.5, 1.2, 0.8, 'rgba(226,160,140,.8)');
  c.strokeStyle = '#d9707a'; c.lineWidth = 2; c.beginPath(); c.moveTo(45.5, 67); c.quadraticCurveTo(50, 70.5, 54.5, 67); c.stroke();
  c.restore();
}

// 图集布局（像素矩形 [x,y,w,h]），世界里的广告牌、店招、纪念碑都从这里取
export const R = {
  avatar: [0, 0, 256, 256], word: [256, 0, 512, 256], hello: [0, 256, 768, 128], ask: [0, 384, 512, 128], bug: [512, 384, 512, 128],
  shop: [0, 512, 512, 128], think: [512, 512, 512, 128], zero: [0, 640, 768, 128], bike: [768, 0, 256, 256], lane: [768, 256, 256, 128],
  go: [0, 768, 384, 128], fix: [384, 768, 384, 128], en: [0, 896, 640, 128], heart: [768, 640, 256, 256],
};
export function makeAtlas() {
  const cv = document.createElement('canvas'); cv.width = cv.height = AS;
  const c = cv.getContext('2d');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const panel = ([x, y, w, h], bg, fg, text, size, sub) => {
    c.fillStyle = bg; c.beginPath(); c.roundRect(x + 4, y + 4, w - 8, h - 8, 22); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 4; c.stroke();
    c.fillStyle = fg; c.font = `800 ${size}px ${FONT}`; c.fillText(text, x + w / 2, y + h / 2 - (sub ? size * 0.2 : 0) + size * 0.04);
    if (sub) { c.font = `600 ${size * 0.26}px ${FONT}`; c.globalAlpha = 0.85; c.fillText(sub, x + w / 2, y + h / 2 + size * 0.52); c.globalAlpha = 1; }
  };
  drawAvatar(c, 0, 0, 256);
  panel(R.word, '#ffffff', '#1f6bff', '豆包', 150, 'DOUBAO · AI 助手');
  panel(R.hello, '#1f6bff', '#ffffff', '你好，我是豆包', 84);
  panel(R.ask, '#ffffff', '#16233b', '有问题，尽管问', 62);
  panel(R.bug, '#ff3d6e', '#ffffff', 'BUG 退散！', 72);
  panel(R.shop, '#ffd24a', '#3a2a00', '豆包小卖部', 70);
  panel(R.think, '#7a5cff', '#ffffff', '深度思考中…', 66);
  panel(R.zero, '#0e1730', '#7fd0ff', '零素材 · 全程序化生成', 60);
  panel(R.lane, '#1f6bff', '#ffffff', '骑行优先', 50);
  panel(R.go, '#18c08a', '#ffffff', '冲冲冲！', 74);
  panel(R.fix, '#ffffff', '#ff3d6e', '修 Bug 中', 66);
  panel(R.en, '#0e1730', '#ffffff', 'DOUBAO BIKE BLASTER', 50);
  // 自行车图标牌
  let [x, y, w, h] = R.bike;
  c.fillStyle = '#1f6bff'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 120, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 12; c.lineCap = c.lineJoin = 'round';
  c.beginPath(); c.arc(x + 78, y + 158, 40, 0, 7); c.stroke(); c.beginPath(); c.arc(x + 178, y + 158, 40, 0, 7); c.stroke();
  c.beginPath(); c.moveTo(x + 78, y + 158); c.lineTo(x + 112, y + 96); c.lineTo(x + 162, y + 96); c.lineTo(x + 178, y + 158); c.moveTo(x + 112, y + 96); c.lineTo(x + 132, y + 158); c.lineTo(x + 162, y + 96);
  c.moveTo(x + 100, y + 84); c.lineTo(x + 124, y + 84); c.moveTo(x + 156, y + 78); c.lineTo(x + 176, y + 74); c.stroke();
  // 爱心牌
  [x, y, w, h] = R.heart;
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 120, 0, 7); c.fill();
  c.fillStyle = '#ff3d6e'; c.font = `170px ${FONT}`; c.fillText('♥', x + w / 2, y + h / 2 + 12);
  return cv;
}
// HUD / 菜单 / favicon 用的头像位图
export function avatarURL(s = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  drawAvatar(cv.getContext('2d'), 0, 0, s);
  return cv.toDataURL();
}
