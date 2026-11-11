// 输入：键鼠（Pointer Lock）、触屏虚拟摇杆、标准手柄，统一成一份状态
import { G } from './state.js';
import { clamp, hypot, abs } from './math.js';

// mx/mz 移动轴；lx/ly 本帧视角增量（像素）；fire/ads/sprint 为按住；其余为一次性触发
export const I = { mx: 0, mz: 0, lx: 0, ly: 0, fire: 0, ads: 0, sprint: 0, jump: 0, reload: 0, bell: 0, skill: 0, wsel: -1, wnext: 0, pause: 0, music: 0, locked: false };
const K = {}, T = {}, pad = { fire: 0, ads: 0, sprint: 0, b: [] };
let mouseF = 0, mouseA = 0, touchF = 0, touchS = 0, joy = null, stick, knob, noLock = 0, lockFail = 0;
export const endFrame = () => { I.lx = I.ly = 0; I.jump = I.reload = I.bell = I.skill = I.wnext = I.pause = I.music = 0; I.wsel = -1; };

export function initInput(cv, onGesture) {
  const act = { Space: 'jump', KeyR: 'reload', KeyF: 'bell', KeyQ: 'skill', Escape: 'pause', KeyP: 'pause', KeyM: 'music' };
  addEventListener('keydown', e => {
    if (e.repeat) return;
    K[e.code] = 1; onGesture();
    if (act[e.code]) I[act[e.code]] = 1;
    if (/^Digit[1-4]$/.test(e.code)) I.wsel = +e.code[5] - 1;
    if (e.code == 'KeyE') I.wnext = 1;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => (K[e.code] = 0));
  addEventListener('blur', () => { for (const k in K) K[k] = 0; mouseF = mouseA = 0; });
  cv.addEventListener('mousedown', e => {
    onGesture();
    if (G.state == 'play' && !I.locked && !G.touch && !noLock) { requestLock(cv); return; }
    if (e.button == 0) mouseF = 1; if (e.button == 2) mouseA = 1;
  });
  addEventListener('mouseup', e => { if (e.button == 0) mouseF = 0; if (e.button == 2) mouseA = 0; });
  addEventListener('mousemove', e => { if (I.locked || (noLock && G.state == 'play')) { I.lx += e.movementX; I.ly += e.movementY; } });
  addEventListener('wheel', e => { if (I.locked) I.wnext = e.deltaY > 0 ? 1 : -1; }, { passive: true });
  addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    I.locked = document.pointerLockElement == cv;
    if (I.locked) lockFail = 0;
    if (!I.locked) { mouseF = mouseA = 0; if (G.state == 'play' && !G.touch && !G.debug) I.pause = 1; }
  });
  // ---- 触屏 ----
  const tz = document.getElementById('touch');
  stick = document.getElementById('stick'); knob = document.getElementById('knob');
  const start = e => {
    onGesture(); G.touch = true;
    for (const t of e.changedTouches) {
      const el = t.target.closest ? t.target.closest('[data-a]') : null, a = el && el.dataset.a;
      if (a) {
        T[t.identifier] = { a, x: t.clientX, y: t.clientY };
        if (a == 'fire') touchF = 1; else if (a == 'sprint') { touchS = !touchS; el.classList.toggle('on', touchS); } else if (a == 'wnext') I.wnext = 1; else I[a] = 1;
      } else if (t.clientX < innerWidth * 0.42 && !joy) {
        joy = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
        stick.style.display = 'block'; stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; knob.style.transform = '';
      } else T[t.identifier] = { a: 'look', x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  };
  const move = e => {
    for (const t of e.changedTouches) {
      if (joy && t.identifier == joy.id) {
        let dx = t.clientX - joy.x, dy = t.clientY - joy.y; const l = hypot(dx, dy), m = 56;
        if (l > m) { dx *= m / l; dy *= m / l; }
        joy.dx = dx / m; joy.dy = dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else {
        const s = T[t.identifier];
        if (s && (s.a == 'look' || s.a == 'fire')) { I.lx += (t.clientX - s.x) * 2.2; I.ly += (t.clientY - s.y) * 2.2; s.x = t.clientX; s.y = t.clientY; }
      }
    }
    e.preventDefault();
  };
  const end = e => {
    for (const t of e.changedTouches) {
      if (joy && t.identifier == joy.id) { joy = null; stick.style.display = 'none'; }
      const s = T[t.identifier]; if (s && s.a == 'fire') touchF = 0;
      delete T[t.identifier];
    }
  };
  tz.addEventListener('touchstart', start, { passive: false }); tz.addEventListener('touchmove', move, { passive: false });
  tz.addEventListener('touchend', end); tz.addEventListener('touchcancel', end);
}

export function pollInput(dt) {
  let mx = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0), mz = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
  if (joy) { mx = joy.dx; mz = -joy.dy; }
  // 手柄：左摇杆移动，右摇杆视角，RT 开火，LT 瞄准，A 跳，B 车铃，X 换弹，Y 技能，LB 冲刺，RB 换枪
  pad.fire = pad.ads = pad.sprint = 0;
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected && g.axes.length >= 4) : null;
  if (gp) {
    const dz = v => (abs(v) < 0.16 ? 0 : v), b = i => (gp.buttons[i] ? gp.buttons[i].value > 0.4 : false), hit = i => { const v = b(i), r = v && !pad.b[i]; pad.b[i] = v; return r; };
    if (dz(gp.axes[0]) || dz(gp.axes[1])) { mx = dz(gp.axes[0]); mz = -dz(gp.axes[1]); }
    I.lx += dz(gp.axes[2]) * 1100 * dt; I.ly += dz(gp.axes[3]) * 800 * dt;
    pad.fire = b(7); pad.ads = b(6); pad.sprint = b(4) || b(10);
    if (hit(0)) I.jump = 1; if (hit(1)) I.bell = 1; if (hit(2)) I.reload = 1; if (hit(3)) I.skill = 1; if (hit(5)) I.wnext = 1; if (hit(9)) I.pause = 1;
  }
  const l = hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  I.mx = mx; I.mz = mz;
  I.fire = mouseF || touchF || pad.fire ? 1 : 0; I.ads = mouseA || pad.ads ? 1 : 0;
  I.sprint = K.ShiftLeft || K.ShiftRight || touchS || pad.sprint ? 1 : 0;
}
export const releaseLock = () => document.exitPointerLock && document.pointerLockElement && document.exitPointerLock();
// 指针锁定不可用（部分内嵌浏览器）时退化为直接读取鼠标位移
export const requestLock = cv => {
  if (G.touch) return;
  if (!cv.requestPointerLock) { noLock = 1; return; }
  try { const r = cv.requestPointerLock(); r && r.catch && r.catch(() => { if (++lockFail > 2) noLock = 1; }); } catch (e) { noLock = 1; }
};
