// 游戏内 HUD：方向键序列、节拍环、音符轨道、判定字、触屏按键，全部画在一张 2D Canvas 上。
import { TAU, clamp, damp, ease, lerp } from './util.js';

export const LANE_COLORS = ['#ff6fae', '#5aa9ff', '#5fe3b0', '#ffb85a'];
const ROT = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];
const KIND_STYLE = {
  perfect: { text: 'PERFECT', a: '#fff3a0', b: '#ff8fd0' },
  great: { text: 'GREAT', a: '#a8f6ff', b: '#5aa9ff' },
  cool: { text: 'COOL', a: '#c8ffb0', b: '#4fd69a' },
  bad: { text: 'BAD', a: '#d8c8ff', b: '#8a78c8' },
  miss: { text: 'MISS', a: '#ffb0b0', b: '#c05070' },
  nice: { text: 'NICE!', a: '#fff3a0', b: '#ffb85a' },
  ok: { text: 'OK', a: '#c8ffb0', b: '#4fd69a' },
};
const FONT = '"Arial Black","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const FONT_CN = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

function arrowPath(x, cx, cy, s, dir) {
  x.save();
  x.translate(cx, cy);
  x.rotate(ROT[dir]);
  x.beginPath();
  x.moveTo(0, -s);
  x.lineTo(s * 0.94, -s * 0.04);
  x.lineTo(s * 0.38, -s * 0.04);
  x.lineTo(s * 0.38, s * 0.9);
  x.lineTo(-s * 0.38, s * 0.9);
  x.lineTo(-s * 0.38, -s * 0.04);
  x.lineTo(-s * 0.94, -s * 0.04);
  x.closePath();
  x.restore();
}
function rr(x, px, py, w, h, r) {
  x.beginPath();
  x.roundRect(px, py, w, h, r);
}

// 预渲染四种颜色的音符，避免每帧对每个音符做阴影模糊
function makeNoteSprites() {
  return LANE_COLORS.map((col, lane) => {
    const c = document.createElement('canvas');
    c.width = c.height = 144;
    const x = c.getContext('2d');
    x.shadowColor = col;
    x.shadowBlur = 18;
    const g = x.createLinearGradient(0, 22, 0, 122);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, col);
    g.addColorStop(1, col);
    x.fillStyle = g;
    rr(x, 24, 24, 96, 96, 26);
    x.fill();
    x.shadowBlur = 0;
    x.lineWidth = 5;
    x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.stroke();
    x.fillStyle = 'rgba(30,16,60,0.9)';
    arrowPath(x, 72, 72, 30, lane);
    x.fill();
    return c;
  });
}

export function createHud(canvas) {
  const x = canvas.getContext('2d');
  if (!x.roundRect) {
    // 旧浏览器没有 roundRect，退回直角矩形
    CanvasRenderingContext2D.prototype.roundRect = function (px, py, w, h) {
      this.rect(px, py, w, h);
    };
  }
  let W = 1;
  let H = 1;
  let dpr = 1;
  const sprites = makeNoteSprites();
  const hud = {
    touch: false,
    phase: 'none',
    layout: {},
    approachSec: 1.25,
    seqA: 0,
    noteA: 0,
    freeA: 0,
  };
  const laneFlash = [0, 0, 0, 0];
  const padFlash = [0, 0, 0, 0];
  let ringFlash = 0;
  let ringFlashColor = '#ffffff';
  let judge = null;
  let comboPop = 0;
  const banners = [];
  const bursts = [];
  let lastRound = null;
  let roundIn = 0;
  let time = 0;

  // 刘海屏的安全区：画布上的按键要避开，CSS 的 env() 只能借一个隐藏元素读出来
  let probe = null;
  function safeInsets() {
    try {
      if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText =
          'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.appendChild(probe);
      }
      const cs = getComputedStyle(probe);
      return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    } catch (e) {
      return { t: 0, r: 0, b: 0, l: 0 };
    }
  }

  hud.resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const L = hud.layout;
    L.W = W;
    L.H = H;
    const small = Math.min(W, H);
    const inset = safeInsets();
    const bottom = H - inset.b;
    L.tilesCx = W / 2;
    L.tilesW = W - 28;
    if (hud.touch) {
      const pr = clamp(small * 0.105, 32, 50);
      const gap = pr * 1.55;
      L.dpad = { cx: inset.l + gap + pr + 14, cy: bottom - gap - pr - 18, r: pr, gap };
      L.ring = { cx: W - inset.r - pr * 1.75 - 16, cy: bottom - gap - pr - 18, r: pr * 1.4 };
      if (W > H * 1.25) {
        // 横屏：屏幕矮，序列放到方向键和踩拍圆环之间，不往上挤
        const left = L.dpad.cx + gap + pr + 14;
        const right = L.ring.cx - L.ring.r * 1.35 - 14;
        L.tilesCx = (left + right) / 2;
        L.tilesW = Math.max(160, right - left);
        L.tilesY = bottom - clamp(H * 0.4, 128, 190);
        L.tileMax = 46;
      } else {
        L.tilesY = Math.max(H * 0.36, L.dpad.cy - gap - pr - 58);
        L.tileMax = 50;
      }
    } else {
      L.dpad = null;
      L.ring = { cx: W / 2, cy: H - 88, r: 44 };
      // 序列放高一些，下面的踩拍环和四个拍点才不会压到方块
      L.tilesY = H - 246;
      L.tileMax = 60;
    }
    // narrow：手机竖屏或竖屏平板；short：手机横屏这种很矮的屏幕
    L.narrow = W <= 760 || W / H < 0.85;
    L.short = H < 480;
    const hitY = bottom - (hud.touch ? Math.max(92, H * 0.14) : 108);
    // 矮屏上轨道要占更大比例的高度，否则音符一出现就到线了
    const topY = Math.max(inset.t + 84, hitY - Math.min(H * (L.short ? 0.58 : 0.36), 300));
    // 轨道宽度跟着长度走：又短又宽的轨道上音符会大到互相叠住
    const hwW = Math.min(W - 16, hud.touch ? 560 : 430, (hitY - topY) * 1.7);
    L.hw = { cx: W / 2, w: hwW, laneW: hwW / 4, hitY, topY };
    // 段落横幅放在顶部信息栏的正下方，不挡主角的脸
    L.bannerY = inset.t + (L.narrow ? 178 : L.short ? 100 : 108);
    L.bannerSize = clamp(W * 0.036, 26, 44) * (L.short ? 0.9 : 1);
    // 判定字不能顶到顶部信息栏下面去
    L.judgeY = Math.max(L.tilesY - (L.short ? 68 : clamp(H * 0.14, 74, 104)), inset.t + 118);
    // 音符的判定字放在接收框下面：放在上面会盖住马上要到线的音符
    L.noteJudgeY = Math.min(H - 18, hitY + hwW / 8 + 24);
  };

  // ------------------------------------------------------------ 对外的反馈接口
  hud.popJudge = (kind, info = {}) => {
    judge = { kind, t: 0, chain: info.chain || 0, combo: info.combo || 0, pts: info.pts || 0, small: info.src === 'note', finish: info.finish };
    if (info.combo) comboPop = 1;
    ringFlash = 1;
    ringFlashColor = (KIND_STYLE[kind] || KIND_STYLE.cool).a;
    if (info.src === 'note' && info.lane != null && kind !== 'miss') {
      bursts.push({ lane: info.lane, t: 0, color: LANE_COLORS[info.lane], big: kind === 'perfect' });
    }
  };
  hud.lanePress = (lane) => {
    laneFlash[lane] = 1;
    padFlash[lane] = 1;
  };
  hud.banner = (text, o = {}) => {
    // 倒数这类连续横幅：新的一条直接顶掉上一条
    if (o.replace) banners.length = 0;
    banners.push({ text, t: 0, dur: o.dur || 1.4, color: o.color || '#ffffff', color2: o.color2 || '#ffd36b', size: o.size || 1, sub: o.sub || '' });
    if (banners.length > 3) banners.shift();
  };
  hud.bannerActive = () => banners.length > 0;
  hud.clear = () => {
    judge = null;
    banners.length = 0;
    bursts.length = 0;
    lastRound = null;
    hud.seqA = hud.noteA = hud.freeA = 0;
  };

  // ------------------------------------------------------------ 绘制：舞步序列
  function drawTiles(g, beat, alpha) {
    const r = g.round || lastRound;
    if (!r) return;
    const L = hud.layout;
    const n = r.arrows.length;
    const gapK = 0.14;
    let size = L.tilesW / (n + (n - 1) * gapK);
    size = clamp(size, 22, L.tileMax);
    const gap = size * gapK;
    const total = n * size + (n - 1) * gap;
    const wrongAge = (beat - r.wrongAt) * g.secPerBeat;
    const shake = wrongAge >= 0 && wrongAge < 0.35 ? Math.sin(wrongAge * 60) * 7 * (1 - wrongAge / 0.35) : 0;
    const x0 = L.tilesCx - total / 2 + shake;
    const y = L.tilesY + (1 - ease.out(clamp(roundIn, 0, 1))) * 16;
    const done = r.progress === n && !r.judged;
    x.save();
    x.globalAlpha = alpha;
    // 底板
    rr(x, x0 - 14, y - 12, total + 28, size + 24, 20);
    x.fillStyle = r.finish ? 'rgba(60,30,10,0.62)' : 'rgba(16,10,44,0.6)';
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = done ? 'rgba(255,230,140,0.95)' : r.finish ? 'rgba(255,200,110,0.6)' : 'rgba(160,170,255,0.35)';
    x.stroke();
    if (wrongAge >= 0 && wrongAge < 0.3) {
      x.fillStyle = `rgba(255,70,90,${0.35 * (1 - wrongAge / 0.3)})`;
      x.fill();
    }
    for (let i = 0; i < n; i++) {
      const a = r.arrows[i];
      const tx = x0 + i * (size + gap);
      const isDone = i < r.progress;
      const isCur = i === r.progress && !r.judged;
      const col = a.rev ? '#ff5577' : LANE_COLORS[a.dir];
      rr(x, tx, y, size, size, size * 0.26);
      if (isDone) {
        x.fillStyle = col;
        x.shadowColor = col;
        x.shadowBlur = 14;
        x.fill();
        x.shadowBlur = 0;
      } else {
        x.fillStyle = a.rev ? 'rgba(255,60,90,0.24)' : 'rgba(255,255,255,0.1)';
        x.fill();
        if (isCur) {
          x.lineWidth = 3;
          x.strokeStyle = `rgba(255,255,255,${0.65 + 0.35 * Math.sin(time * 10)})`;
          x.stroke();
        }
      }
      arrowPath(x, tx + size / 2, y + size / 2, size * 0.3, a.dir);
      x.fillStyle = isDone ? '#ffffff' : a.rev ? '#ff8fa5' : `rgba(255,255,255,${isCur ? 0.98 : 0.72})`;
      x.fill();
      if (a.rev) {
        // 反键标记：要按相反的方向
        x.fillStyle = '#ff3f66';
        x.beginPath();
        x.arc(tx + size - 4, y + 4, Math.max(7, size * 0.17), 0, TAU);
        x.fill();
        x.fillStyle = '#ffffff';
        x.font = `900 ${Math.max(9, size * 0.2)}px ${FONT_CN}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('反', tx + size - 4, y + 4.5);
      }
    }
    // 等级 / 终结技标签
    // 亮色地板上纯填充的小字看不清，统一加深色描边
    const label = (txt, lx, ly, font, fill, align) => {
      x.font = font;
      x.textAlign = align;
      x.textBaseline = 'alphabetic';
      x.lineJoin = 'round';
      x.lineWidth = 4;
      x.strokeStyle = 'rgba(20,10,50,0.9)';
      x.strokeText(txt, lx, ly);
      x.fillStyle = fill;
      x.fillText(txt, lx, ly);
      return x.measureText(txt).width;
    };
    let leftW;
    if (r.finish) {
      const gr = x.createLinearGradient(x0, 0, x0 + 200, 0);
      gr.addColorStop(0, '#fff3a0');
      gr.addColorStop(1, '#ff9a5a');
      leftW = label(L.narrow ? 'FINISH ×3' : 'FINISH MOVE  ×3', x0 - 8, y - 22, `900 italic ${L.narrow ? 18 : 22}px ${FONT}`, gr, 'left');
    } else {
      leftW = label(`LV ${r.level}`, x0 - 8, y - 20, `900 italic 18px ${FONT}`, 'rgba(225,232,255,1)', 'left');
    }
    if (done) {
      const when = r.finish ? '最后一拍' : '第 4 拍';
      const txt = hud.touch ? `${when}点圆环！` : `等${when}，按空格！`;
      const font = `900 16px ${FONT_CN}`;
      x.font = font;
      const w = x.measureText(txt).width;
      const fill = `rgba(255,236,150,${0.8 + 0.2 * Math.sin(time * 12)})`;
      // 序列很短、和左边的标签挤不下时：提示语放到方块右侧；右侧也放不下才换到上面一行
      if (leftW + w + 24 <= total + 16) label(txt, x0 + total + 8, y - 20, font, fill, 'right');
      else if (x0 + total + 26 + w <= W - 8) label(txt, x0 + total + 26, y + size / 2 + 6, font, fill, 'left');
      else label(txt, x0 + total / 2, y - 46, font, fill, 'center');
    }
    x.restore();
  }

  function drawRing(g, beat, alpha) {
    const r = g.round;
    const L = hud.layout.ring;
    const cx = L.cx;
    const cy = L.cy;
    const r0 = L.r;
    x.save();
    x.globalAlpha = alpha;
    // 底盘
    x.beginPath();
    x.arc(cx, cy, r0 + 10, 0, TAU);
    x.fillStyle = 'rgba(16,10,44,0.62)';
    x.fill();
    const ready = r && r.progress === r.arrows.length;
    // 四个拍点：最后一个是要踩的重拍
    if (r) {
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.52;
        const px = cx + Math.cos(a) * (r0 + 26);
        const py = cy + Math.sin(a) * (r0 + 26);
        const lit = beat >= r.hitBeat - 3 + i - 0.02;
        const age = beat - (r.hitBeat - 3 + i);
        const pop = lit ? 1 + 0.6 * Math.max(0, 1 - age * 2.5) : 1;
        x.beginPath();
        x.arc(px, py, (i === 3 ? 7 : 5) * pop, 0, TAU);
        x.fillStyle = lit ? (i === 3 ? '#ffe27a' : '#ffffff') : 'rgba(255,255,255,0.22)';
        x.fill();
      }
    }
    // 目标圈
    x.beginPath();
    x.arc(cx, cy, r0, 0, TAU);
    x.lineWidth = 5;
    x.strokeStyle = ready ? '#ffe27a' : 'rgba(255,255,255,0.85)';
    if (ready) {
      x.shadowColor = '#ffd36b';
      x.shadowBlur = 16;
    }
    x.stroke();
    x.shadowBlur = 0;
    // 收缩的节拍圈：缩到与目标圈重合的瞬间就是重拍
    if (r) {
      const tt = r.hitBeat - beat;
      if (tt < 3.2 && tt > -0.4) {
        const rad = r0 * (1 + 0.34 * clamp(tt, -0.4, 3));
        const near = Math.abs(tt) * g.secPerBeat < 0.06;
        x.beginPath();
        x.arc(cx, cy, Math.max(2, rad), 0, TAU);
        x.lineWidth = near ? 7 : 4;
        x.strokeStyle = near ? '#fff3a0' : `rgba(120,220,255,${clamp(1.2 - tt / 3, 0.25, 1)})`;
        x.stroke();
      }
    }
    if (ringFlash > 0) {
      x.beginPath();
      x.arc(cx, cy, r0 * (1 + (1 - ringFlash) * 0.9), 0, TAU);
      x.lineWidth = 6 * ringFlash;
      x.strokeStyle = ringFlashColor;
      x.globalAlpha = alpha * ringFlash;
      x.stroke();
      x.globalAlpha = alpha;
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = ready ? '#fff3a0' : 'rgba(255,255,255,0.9)';
    x.font = `900 ${hud.touch ? r0 * 0.36 : 15}px ${FONT}`;
    x.fillText(hud.touch ? '踩拍' : 'SPACE', cx, cy + 1);
    x.restore();
  }

  function drawDpad(alpha) {
    const D = hud.layout.dpad;
    if (!D) return;
    const offs = [
      [-D.gap, 0],
      [0, D.gap],
      [0, -D.gap],
      [D.gap, 0],
    ];
    x.save();
    for (let i = 0; i < 4; i++) {
      const cx = D.cx + offs[i][0];
      const cy = D.cy + offs[i][1];
      x.globalAlpha = alpha;
      x.beginPath();
      x.arc(cx, cy, D.r, 0, TAU);
      x.fillStyle = padFlash[i] > 0.05 ? LANE_COLORS[i] : 'rgba(16,10,44,0.62)';
      x.fill();
      x.lineWidth = 2.5;
      x.strokeStyle = LANE_COLORS[i];
      x.stroke();
      arrowPath(x, cx, cy, D.r * 0.5, i);
      x.fillStyle = '#ffffff';
      x.fill();
    }
    x.restore();
  }

  // ------------------------------------------------------------ 绘制：节拍轨道
  function drawHighway(g, beat, alpha) {
    const L = hud.layout.hw;
    const { cx, hitY, topY, laneW } = L;
    const topK = 0.42;
    x.save();
    x.globalAlpha = alpha;
    // 轨道底
    const wb = L.w / 2 + 8;
    const wt = (L.w / 2) * topK + 4;
    const bottom = Math.min(H, hitY + laneW * 0.62);
    const kb = (bottom - topY) / (hitY - topY);
    const wbb = lerp(wt, wb, kb);
    x.beginPath();
    x.moveTo(cx - wt, topY);
    x.lineTo(cx + wt, topY);
    x.lineTo(cx + wbb, bottom);
    x.lineTo(cx - wbb, bottom);
    x.closePath();
    const bg = x.createLinearGradient(0, topY, 0, bottom);
    bg.addColorStop(0, 'rgba(16,10,44,0)');
    bg.addColorStop(0.35, 'rgba(16,10,44,0.42)');
    bg.addColorStop(1, 'rgba(16,10,44,0.72)');
    x.fillStyle = bg;
    x.fill();
    // 轨道分隔线
    x.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) {
      const k = i - 2;
      x.beginPath();
      x.moveTo(cx + k * laneW * topK, topY);
      x.lineTo(cx + k * laneW * lerp(topK, 1, kb), bottom);
      x.strokeStyle = `rgba(170,180,255,${i === 0 || i === 4 ? 0.5 : 0.2})`;
      x.stroke();
    }
    // 判定线上的四个接收框
    const rs = laneW * 0.8;
    for (let i = 0; i < 4; i++) {
      const lx = cx + (i - 1.5) * laneW;
      rr(x, lx - rs / 2, hitY - rs / 2, rs, rs, rs * 0.26);
      x.fillStyle = laneFlash[i] > 0.02 ? `rgba(255,255,255,${0.12 + laneFlash[i] * 0.5})` : 'rgba(255,255,255,0.07)';
      x.fill();
      x.lineWidth = 3;
      x.strokeStyle = LANE_COLORS[i];
      x.stroke();
      arrowPath(x, lx, hitY, rs * 0.3, i);
      x.strokeStyle = `rgba(255,255,255,${0.45 + laneFlash[i] * 0.5})`;
      x.lineWidth = 2;
      x.stroke();
    }
    // 音符
    const ab = hud.approachSec / g.secPerBeat;
    const notes = g.chart.notes;
    for (let i = g.noteHead; i < notes.length; i++) {
      const n = notes[i];
      if (n.beat > beat + ab) break;
      if (n.judged && n.judged !== 'miss') continue;
      const u = 1 - (n.beat - beat) / ab;
      if (u < 0) continue;
      const p = Math.pow(u, 1.75);
      const sc = lerp(topK, 1, p);
      const ny = topY + (hitY - topY) * p;
      const nx = cx + (n.lane - 1.5) * laneW * sc;
      const s = laneW * 0.98 * sc * (n.final ? 1.15 : 1);
      x.globalAlpha = alpha * clamp(u * 5, 0, 1);
      x.drawImage(sprites[n.lane], nx - s / 2, ny - s / 2, s, s);
    }
    // 刚漏掉的音符：变暗滑出去
    for (let i = Math.max(0, g.noteHead - 6); i < g.noteHead; i++) {
      const n = notes[i];
      if (n.judged !== 'miss') continue;
      const u = 1 - (n.beat - beat) / ab;
      if (u > 1.25) continue;
      const p = Math.pow(u, 1.75);
      const sc = lerp(topK, 1, p);
      const s = laneW * 0.98 * sc;
      x.globalAlpha = alpha * 0.35 * clamp((1.25 - u) * 6, 0, 1);
      x.drawImage(sprites[n.lane], cx + (n.lane - 1.5) * laneW * sc - s / 2, topY + (hitY - topY) * p - s / 2, s, s);
    }
    // 击中时的扩散圈
    for (const b of bursts) {
      const lx = cx + (b.lane - 1.5) * laneW;
      const k = b.t / 0.28;
      x.globalAlpha = alpha * (1 - k);
      x.beginPath();
      x.arc(lx, hitY, rs * (0.5 + k * (b.big ? 0.95 : 0.6)), 0, TAU);
      x.lineWidth = (b.big ? 7 : 4) * (1 - k);
      x.strokeStyle = b.big ? '#fff3a0' : b.color;
      x.stroke();
    }
    x.restore();
  }

  // ------------------------------------------------------------ 绘制：自由发挥
  function drawFree(g, beat, alpha) {
    const L = hud.layout;
    const cx = hud.touch ? L.ring.cx : W / 2;
    const cy = hud.touch ? L.ring.cy : H - 96;
    const r0 = hud.touch ? L.ring.r * 0.8 : 40;
    const frac = beat - Math.floor(beat);
    x.save();
    x.globalAlpha = alpha;
    x.beginPath();
    x.arc(cx, cy, r0 + 8, 0, TAU);
    x.fillStyle = 'rgba(16,10,44,0.6)';
    x.fill();
    x.beginPath();
    x.arc(cx, cy, r0, 0, TAU);
    x.lineWidth = 4;
    x.strokeStyle = '#ffe27a';
    x.stroke();
    x.beginPath();
    x.arc(cx, cy, r0 * (1 + (1 - frac) * 1.1), 0, TAU);
    x.lineWidth = 3;
    x.strokeStyle = `rgba(120,220,255,${0.3 + frac * 0.7})`;
    x.stroke();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#ffffff';
    x.font = `900 ${Math.round(r0 * 0.5)}px ${FONT_CN}`;
    x.fillText('拍', cx, cy + 1);
    x.lineJoin = 'round';
    x.lineWidth = 4;
    x.strokeStyle = 'rgba(20,10,50,0.9)';
    x.fillStyle = 'rgba(255,240,170,1)';
    if (!hud.touch) {
      x.font = `800 17px ${FONT_CN}`;
      x.strokeText('自由发挥：踩着节拍按任意方向键摆造型', W / 2, cy - r0 - 34);
      x.fillText('自由发挥：踩着节拍按任意方向键摆造型', W / 2, cy - r0 - 34);
    } else {
      x.font = `800 15px ${FONT_CN}`;
      x.strokeText('自由发挥：踩着节拍点方向键', W / 2, L.tilesY + 20);
      x.fillText('自由发挥：踩着节拍点方向键', W / 2, L.tilesY + 20);
    }
    x.restore();
  }

  // ------------------------------------------------------------ 绘制：判定字与横幅
  function gradText(text, cx, cy, size, a, b, italic = true) {
    x.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineWidth = Math.max(4, size * 0.16);
    x.strokeStyle = 'rgba(24,12,58,0.9)';
    x.strokeText(text, cx, cy);
    const g = x.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    x.fillStyle = g;
    x.fillText(text, cx, cy);
  }

  function drawJudge(dt) {
    if (!judge) return;
    judge.t += dt;
    const t = judge.t;
    const life = judge.small ? 0.5 : 0.85;
    if (t > life) {
      judge = null;
      return;
    }
    const st = KIND_STYLE[judge.kind] || KIND_STYLE.cool;
    const base = clamp(W * 0.065, 32, 62) * (judge.small ? 0.6 : 1) * (judge.finish ? 1.2 : 1);
    const s = base * (0.6 + 0.4 * ease.outBack(clamp(t / 0.13, 0, 1)));
    const alpha = clamp((life - t) / 0.22, 0, 1);
    const cy = judge.small ? hud.layout.noteJudgeY : hud.layout.judgeY - t * 18;
    x.save();
    x.globalAlpha = alpha;
    if (judge.kind === 'perfect') {
      x.shadowColor = '#ffd36b';
      x.shadowBlur = 22;
    }
    gradText(st.text, W / 2, cy, s, st.a, st.b);
    x.shadowBlur = 0;
    if (judge.kind === 'perfect' && judge.chain >= 2 && !judge.small) {
      gradText(`×${judge.chain}`, W / 2 + x.measureText(st.text).width / 2 + s * 0.45, cy - s * 0.3, s * 0.5, '#ffffff', '#ffd36b');
    }
    if (judge.pts > 0 && !judge.small && !hud.layout.short) {
      x.font = `900 ${Math.round(base * 0.34)}px ${FONT}`;
      x.fillStyle = 'rgba(255,255,255,0.95)';
      x.strokeStyle = 'rgba(24,12,58,0.85)';
      x.lineWidth = 4;
      const txt = '+' + judge.pts.toLocaleString('en-US');
      x.strokeText(txt, W / 2, cy + s * 0.78);
      x.fillText(txt, W / 2, cy + s * 0.78);
    }
    x.restore();
  }

  function drawCombo(g, dt) {
    const c = g.me.combo;
    comboPop = Math.max(0, comboPop - dt * 5);
    if (c < 3) return;
    const big = clamp(W * 0.05, 30, 58) * (1 + comboPop * 0.22);
    const L = hud.layout;
    let cx = Math.min(W - 110, W / 2 + Math.max(L.hw.w / 2 + 110, W * 0.3));
    let cy = H * 0.52;
    if (hud.touch) {
      // 触屏：放在判定字的上一行靠右，两者不会撞在同一高度
      cx = W - 66;
      cy = L.short ? 132 : L.judgeY - 92;
    }
    x.save();
    x.globalAlpha = 0.96;
    gradText(String(c), cx, cy, big, '#ffffff', '#a8c8ff');
    gradText('COMBO', cx, cy + big * 0.72, big * 0.36, '#ffffff', '#ffd36b');
    x.restore();
  }

  function drawBanners(dt) {
    for (let i = banners.length - 1; i >= 0; i--) {
      const b = banners[i];
      b.t += dt;
      if (b.t > b.dur) {
        banners.splice(i, 1);
        continue;
      }
      const inK = ease.outBack(clamp(b.t / 0.22, 0, 1));
      const out = clamp((b.dur - b.t) / 0.3, 0, 1);
      const L = hud.layout;
      const size = L.bannerSize * b.size * (0.5 + 0.5 * inK);
      const by = L.bannerY;
      x.save();
      x.globalAlpha = out;
      x.shadowColor = b.color2;
      x.shadowBlur = 18;
      gradText(b.text, W / 2, by, size, b.color, b.color2, false);
      x.shadowBlur = 0;
      // 矮屏上放不下副标题
      if (b.sub && !L.short) {
        x.font = `800 ${Math.round(clamp(W * 0.016, 12, 17))}px ${FONT_CN}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.lineJoin = 'round';
        x.fillStyle = 'rgba(255,255,255,0.96)';
        x.strokeStyle = 'rgba(24,12,58,0.9)';
        x.lineWidth = 4;
        x.strokeText(b.sub, W / 2, by + L.bannerSize * b.size * 0.86);
        x.fillText(b.sub, W / 2, by + L.bannerSize * b.size * 0.86);
      }
      x.restore();
    }
  }

  function drawFever(g) {
    if (!g.me.fever) return;
    const hue = (time * 160) % 360;
    x.save();
    const w = Math.max(18, Math.min(W, H) * 0.045);
    for (const [gx0, gy0, gx1, gy1, rx0, ry0, rw, rh] of [
      [0, 0, 0, w, 0, 0, W, w],
      [0, H, 0, H - w, 0, H - w, W, w],
      [0, 0, w, 0, 0, 0, w, H],
      [W, 0, W - w, 0, W - w, 0, w, H],
    ]) {
      const gr = x.createLinearGradient(gx0, gy0, gx1, gy1);
      gr.addColorStop(0, `hsla(${hue},100%,65%,0.55)`);
      gr.addColorStop(1, `hsla(${(hue + 60) % 360},100%,65%,0)`);
      x.fillStyle = gr;
      x.fillRect(rx0, ry0, rw, rh);
    }
    x.restore();
  }

  // ------------------------------------------------------------ 每帧
  hud.draw = (g, beat, dt, active) => {
    time += dt;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      laneFlash[i] = Math.max(0, laneFlash[i] - dt * 6);
      padFlash[i] = Math.max(0, padFlash[i] - dt * 7);
    }
    ringFlash = Math.max(0, ringFlash - dt * 3.5);
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].t += dt;
      if (bursts[i].t > 0.28) bursts.splice(i, 1);
    }
    if (active && g.chart) {
      const seg = g.seg;
      const ab = hud.approachSec / g.secPerBeat;
      const next = g.chart.notes[g.noteHead];
      const notesOn = !!(next && beat >= next.beat - ab - 0.5) || (seg && (seg.type === 'notes' || seg.type === 'notesEnd') && !!next);
      const seqOn = !!g.round;
      const freeOn = !!seg && seg.type === 'free' && !seqOn;
      hud.phase = seqOn ? 'seq' : notesOn ? 'notes' : freeOn ? 'free' : 'none';
      if (g.round && g.round !== lastRound) {
        lastRound = g.round;
        roundIn = 0;
      }
      roundIn += dt * 6;
      hud.seqA = damp(hud.seqA, seqOn ? 1 : 0, seqOn ? 14 : 12, dt);
      // 序列淡出得差不多了，轨道才开始出现：两者占的是同一块位置
      hud.noteA = damp(hud.noteA, notesOn && !seqOn && hud.seqA < 0.25 ? 1 : 0, 9, dt);
      hud.freeA = damp(hud.freeA, freeOn ? 1 : 0, 9, dt);
      if (hud.noteA > 0.01) drawHighway(g, beat, hud.noteA);
      if (hud.freeA > 0.01) drawFree(g, beat, hud.freeA);
      if (hud.seqA > 0.01) {
        drawTiles(g, beat, hud.seqA);
        drawRing(g, beat, hud.seqA);
      }
      if (hud.touch && (hud.seqA > 0.01 || hud.freeA > 0.01)) drawDpad(Math.max(hud.seqA, hud.freeA));
      drawFever(g);
      drawCombo(g, dt);
    } else {
      hud.phase = 'none';
    }
    drawJudge(dt);
    drawBanners(dt);
  };

  hud.resize();
  return hud;
}
