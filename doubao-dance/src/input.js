// 输入：键盘、触屏/鼠标（点 HUD 画布上的按键）、手柄，统一成 arrow / beat / pause 三种事件。
import { clamp } from './util.js';

const KEY_ARROW = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
const KEY_WASD = { KeyA: 0, KeyS: 1, KeyW: 2, KeyD: 3 };
const KEY_DFJK = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };

export function createInput({ hud, canvas, onArrow, onBeat, onPause, onFirstGesture }) {
  const input = { playing: false };
  let gestured = false;
  const gesture = () => {
    if (gestured) return;
    gestured = true;
    onFirstGesture && onFirstGesture();
  };

  window.addEventListener('keydown', (e) => {
    gesture();
    if (e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const code = e.code;
    if (code === 'Escape' || (code === 'KeyP' && input.playing)) {
      onPause();
      return;
    }
    if (!input.playing) return;
    if (code in KEY_ARROW) {
      e.preventDefault();
      onArrow(KEY_ARROW[code], e.timeStamp);
      return;
    }
    if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
      e.preventDefault();
      onBeat(e.timeStamp);
      return;
    }
    // 节拍模式下用 D F J K 四键，舞步模式下 WASD 等同方向键
    const map = hud.phase === 'notes' ? KEY_DFJK : KEY_WASD;
    if (code in map) onArrow(map[code], e.timeStamp);
  });

  const setTouch = (on) => {
    if (hud.touch === on) return;
    hud.touch = on;
    hud.resize();
  };
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setTouch(true);

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      gesture();
      if (e.pointerType === 'touch') setTouch(true);
      if (!input.playing) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const L = hud.layout;
      if (hud.phase === 'notes') {
        const hw = L.hw;
        if (py > hw.topY + (hw.hitY - hw.topY) * 0.3) {
          const lane = clamp(Math.floor((px - (hw.cx - hw.w / 2)) / hw.laneW), 0, 3);
          onArrow(lane, e.timeStamp);
          e.preventDefault();
        }
        return;
      }
      if (L.dpad) {
        const D = L.dpad;
        const offs = [
          [-D.gap, 0],
          [0, D.gap],
          [0, -D.gap],
          [D.gap, 0],
        ];
        let best = -1;
        let bestD = D.r * 1.25;
        for (let i = 0; i < 4; i++) {
          const d = Math.hypot(px - D.cx - offs[i][0], py - D.cy - offs[i][1]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best >= 0) {
          onArrow(best, e.timeStamp);
          e.preventDefault();
          return;
        }
      }
      const R = L.ring;
      if (R && Math.hypot(px - R.cx, py - R.cy) < R.r * 1.4) {
        onBeat(e.timeStamp);
        e.preventDefault();
      }
    },
    { passive: false },
  );
  window.addEventListener('pointerdown', gesture, { passive: true });

  // 手柄：十字键 = 方向，A/B = 踩拍，Start = 暂停
  const padPrev = {};
  const PAD = { 14: 0, 13: 1, 12: 2, 15: 3 };
  input.update = () => {
    if (!navigator.getGamepads) return;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch (e) {
      return;
    }
    const gp = pads && [...pads].find((p) => p && p.connected && p.mapping === 'standard');
    if (!gp) return;
    const now = performance.now();
    const edge = (i) => {
      const down = !!(gp.buttons[i] && gp.buttons[i].pressed);
      const was = !!padPrev[i];
      padPrev[i] = down;
      return down && !was;
    };
    for (const b of [12, 13, 14, 15]) {
      if (edge(b) && input.playing) onArrow(PAD[b], now);
    }
    for (const b of [0, 1, 2, 3]) {
      if (edge(b)) {
        gesture();
        if (input.playing) onBeat(now);
      }
    }
    if (edge(9)) onPause();
  };
  return input;
}
