// 音频：纯 Web Audio 合成。无任何音频文件——音效、混响脉冲、背景音乐都是代码算出来的波形
import { G } from './state.js';
import { clamp, random, exp, pow, sin, min, max, hypot, floor } from './math.js';

let ac, master, sfx, mus, rev, dist, nbuf, wind, windF, windG, tire, tireG, ok = 0;
const cam = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };

export function initAudio() {
  if (ok) { ac.state == 'suspended' && ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC(); ok = 1;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ac.createGain(); master.connect(comp); comp.connect(ac.destination);
  sfx = ac.createGain(); sfx.connect(master); mus = ac.createGain(); mus.connect(master);
  // 白噪声源
  nbuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1;
  // 卷积混响：指数衰减的噪声脉冲 + 几次早期反射，模拟开阔街区
  const L = (ac.sampleRate * 1.9) | 0, ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const b = ir.getChannelData(c);
    for (let i = 0; i < L; i++) { const t = i / ac.sampleRate; b[i] = (random() * 2 - 1) * exp(-t * 3.4) * (t < 0.012 ? t / 0.012 : 1); }
    for (const [t, a] of [[0.031, 0.5], [0.057, 0.36], [0.083, 0.25], [0.127, 0.18]]) b[((t + c * 0.004) * ac.sampleRate) | 0] += a;
  }
  rev = ac.createConvolver(); rev.buffer = ir;
  const rg = ac.createGain(); rg.gain.value = 0.3; rev.connect(rg); rg.connect(sfx);
  // 枪声用的波形失真
  dist = ac.createWaveShaper(); const cv = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3.2); }
  dist.curve = cv; dist.connect(sfx); dist.connect(rev);
  // 持续音：风噪 + 轮胎滚动
  const loop = (type, f, q) => { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nbuf; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(sfx); s.start(); return [fl, g]; };
  [windF, windG] = loop('bandpass', 500, 0.6); [tire, tireG] = loop('lowpass', 300, 0.5);
  setVol();
}
export function setVol() { if (!ok) return; master.gain.value = G.opt.vol; mus.gain.value = G.opt.mus * 0.6; }
export const audioOn = () => ok;
export function setListener(x, y, z, rx, rz) { cam.x = x; cam.y = y; cam.z = z; cam.rx = rx; cam.rz = rz; }
// 3D 声像：按相机右向量做立体声平移，距离越远越小声并压低高频
function at(x, y, z, ref = 14) {
  if (x === undefined) return [sfx, 1, 1];
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = hypot(dx, dy, dz), p = ac.createStereoPanner(), lp = ac.createBiquadFilter();
  p.pan.value = clamp((dx * cam.rx + dz * cam.rz) / (d + 4), -1, 1) * 0.85;
  lp.type = 'lowpass'; lp.frequency.value = clamp(15000 / (1 + d / 30), 900, 15000);
  lp.connect(p); p.connect(sfx); p.connect(rev);
  return [lp, ref / (ref + d), 1];
}
function env(g, t, v, a, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(max(v, 0.0002), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function tone(type, f0, f1, dur, vol, o = {}) {
  if (!ok) return;
  const t = ac.currentTime + (o.d || 0), os = ac.createOscillator(), g = ac.createGain();
  os.type = type; os.frequency.setValueAtTime(f0, t); os.frequency.exponentialRampToValueAtTime(max(f1, 1), t + dur);
  env(g, t, vol, o.a || 0.004, dur); os.connect(g); g.connect(o.to || sfx); os.start(t); os.stop(t + dur + 0.02);
}
function nz(dur, vol, type, f0, f1, q = 1, o = {}) {
  if (!ok) return;
  const t = ac.currentTime + (o.d || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = nbuf; s.playbackRate.value = o.rate || 1; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(max(f1, 20), t + dur);
  env(g, t, vol, o.a || 0.003, dur); s.connect(f); f.connect(g); g.connect(o.to || sfx); s.start(t, random() * 1.5, dur + 0.05);
}
const pv = (a = 0.06) => 1 + (random() * 2 - 1) * a;

export const S = {
  shoot(w) {
    if (!ok) return; const p = pv();
    if (w == 0) { nz(0.09, 0.5, 'bandpass', 2400 * p, 700, 0.8, { to: dist }); tone('square', 420 * p, 90, 0.07, 0.22, { to: dist }); tone('sine', 150, 60, 0.08, 0.3); }
    else if (w == 1) { nz(0.28, 0.9, 'lowpass', 3200, 300, 0.6, { to: dist }); tone('sine', 120 * p, 38, 0.24, 0.8); nz(0.5, 0.2, 'bandpass', 900, 300, 0.5, { to: rev, d: 0.02 }); }
    else if (w == 2) { tone('sawtooth', 1900 * p, 110, 0.36, 0.34, { to: dist }); tone('sine', 3200, 400, 0.22, 0.2); nz(0.3, 0.45, 'highpass', 1800, 6000, 0.8, { to: dist }); tone('sine', 90, 40, 0.3, 0.6); }
    else { nz(0.5, 0.6, 'bandpass', 500, 2400, 0.9); tone('sine', 110, 50, 0.25, 0.7); nz(0.14, 0.6, 'lowpass', 1500, 200, 0.7, { to: dist }); }
  },
  dry() { tone('square', 900, 700, 0.03, 0.12); },
  reload() { tone('square', 300, 520, 0.05, 0.12); nz(0.06, 0.2, 'highpass', 3000, 5000, 1, { d: 0.09 }); },
  reloaded() { tone('square', 620, 940, 0.05, 0.14); tone('square', 940, 1300, 0.06, 0.12, { d: 0.06 }); nz(0.04, 0.25, 'highpass', 4000, 6000, 1); },
  hit(c) { tone('square', c ? 1500 : 1050, c ? 2200 : 1300, 0.045, c ? 0.22 : 0.14); if (c) tone('sine', 2600, 3400, 0.08, 0.14, { d: 0.02 }); },
  kill(big) { tone('triangle', 660, 1320, 0.09, 0.26); tone('triangle', 990, 1980, 0.14, 0.22, { d: 0.07 }); if (big) tone('triangle', 1320, 2640, 0.22, 0.2, { d: 0.15 }); },
  hurt() { nz(0.16, 0.6, 'lowpass', 900, 200, 1); tone('sawtooth', 220, 70, 0.22, 0.4); },
  bell() { for (const d of [0, 0.16]) { tone('sine', 2093, 2080, 0.7, 0.3, { d, to: rev }); tone('sine', 2093, 2080, 0.5, 0.3, { d }); tone('sine', 5270, 5240, 0.3, 0.12, { d }); tone('sine', 3136, 3120, 0.5, 0.1, { d }); } },
  jump() { tone('sine', 260, 620, 0.14, 0.25); nz(0.1, 0.15, 'bandpass', 800, 2400, 1); },
  land(k) { tone('sine', 110, 45, 0.16, 0.5 * k); nz(0.12, 0.4 * k, 'lowpass', 700, 150, 0.7); },
  bonk() { tone('sine', 190, 70, 0.14, 0.55); nz(0.08, 0.4, 'bandpass', 1200, 500, 2); },
  ram() { nz(0.14, 0.7, 'bandpass', 1600, 400, 1.2, { to: dist }); tone('sine', 150, 50, 0.2, 0.7); },
  pick(k) { const f = [784, 988, 1175, 1568]; for (let i = 0; i < 3; i++) tone('triangle', f[i + (k ? 1 : 0)], f[i + (k ? 1 : 0)] * 1.01, 0.12, 0.2, { d: i * 0.055 }); },
  ui() { tone('sine', 880, 1240, 0.06, 0.16); },
  perk() { for (let i = 0; i < 5; i++) tone('triangle', [523, 659, 784, 1047, 1319][i], [523, 659, 784, 1047, 1319][i], 0.18, 0.2, { d: i * 0.06, to: i > 2 ? rev : sfx }); },
  wave() { for (let i = 0; i < 3; i++) tone('sawtooth', [220, 277, 330][i], [220, 277, 330][i] * 2, 0.22, 0.14, { d: i * 0.11 }); nz(0.6, 0.12, 'bandpass', 300, 3000, 1.5); },
  clear() { for (let i = 0; i < 4; i++) tone('triangle', [659, 784, 988, 1319][i], [659, 784, 988, 1319][i], 0.25, 0.22, { d: i * 0.09, to: rev }); },
  skill(on) { on ? (tone('sine', 900, 120, 0.7, 0.4, { to: rev }), nz(0.7, 0.3, 'lowpass', 6000, 200, 2)) : tone('sine', 150, 800, 0.4, 0.3); },
  over() { for (let i = 0; i < 4; i++) tone('sawtooth', [392, 330, 262, 196][i], [392, 330, 262, 196][i] * 0.97, 0.4, 0.2, { d: i * 0.22, to: rev }); },
  boom(x, y, z, k = 1) {
    if (!ok) return; const [to, v] = at(x, y, z, 30);
    nz(0.9 * k, min(1.2 * v * k, 1.2), 'lowpass', 1800, 60, 0.6, { to }); tone('sine', 85, 28, 0.6 * k, min(1.3 * v, 1.2), { to }); nz(0.25, 0.7 * v, 'bandpass', 2600, 500, 0.7, { to: dist });
  },
  ebolt(x, y, z) { if (!ok) return; const [to, v] = at(x, y, z); tone('sawtooth', 900 * pv(0.1), 180, 0.16, 0.3 * v, { to }); nz(0.08, 0.2 * v, 'highpass', 2500, 5000, 1, { to }); },
  spawn(x, y, z) { if (!ok) return; const [to, v] = at(x, y, z, 20); tone('sawtooth', 80, 640, 0.45, 0.2 * v, { to }); nz(0.4, 0.2 * v, 'bandpass', 400, 4000, 3, { to }); },
  die(x, y, z, k = 1) { if (!ok) return; const [to, v] = at(x, y, z, 18); nz(0.22 * k, 0.6 * v, 'bandpass', 1400, 300, 0.9, { to }); tone('square', 520 * pv(0.15), 60, 0.2 * k, 0.3 * v, { to }); tone('sine', 140, 40, 0.25 * k, 0.5 * v, { to }); },
  mortar(x, y, z) { if (!ok) return; const [to, v] = at(x, y, z, 24); tone('sine', 220, 70, 0.3, 0.6 * v, { to }); nz(0.2, 0.4 * v, 'lowpass', 900, 200, 1, { to }); },
  laser(x, y, z) { if (!ok) return; const [to, v] = at(x, y, z, 40); tone('sawtooth', 110, 420, 1.2, 0.3 * v, { to }); tone('sawtooth', 113, 424, 1.2, 0.3 * v, { to }); },
  roar(x, y, z) { if (!ok) return; const [to, v] = at(x, y, z, 60); tone('sawtooth', 70, 38, 1.4, 0.7 * v, { to: dist }); tone('sawtooth', 106, 52, 1.4, 0.5 * v, { to }); nz(1.2, 0.4 * v, 'bandpass', 300, 120, 2, { to: rev }); },
  tick() { nz(0.012, 0.09, 'highpass', 5200, 7000, 2); },
};

// 持续音随车速变化；空转滑行时发出飞轮“哒哒”声
let tickAcc = 0;
export function updateAudio(dt, spd, coast, air) {
  if (!ok) return;
  const k = clamp(spd / 20, 0, 1), t = ac.currentTime;
  windG.gain.setTargetAtTime(0.02 + k * k * 0.3, t, 0.1); windF.frequency.setTargetAtTime(350 + k * 1300, t, 0.1);
  tireG.gain.setTargetAtTime(air ? 0 : k * 0.3, t, 0.05); tire.frequency.setTargetAtTime(160 + k * 500, t, 0.1);
  if (coast && spd > 2 && !air) { tickAcc += dt * spd * 2.4; if (tickAcc > 1) { tickAcc = 0; S.tick(); } }
}

// ---------- 程序化配乐：16 步音序器，和弦 F–G–Em–Am，按战斗强度叠加声部 ----------
const CH = [[53, 57, 60, 65], [55, 59, 62, 67], [52, 55, 59, 64], [57, 60, 64, 69]], BASS = [41, 43, 40, 45];
const MEL = [0, -1, 2, -1, 3, 2, -1, 1, 0, -1, 2, 3, -1, 2, 1, -1, 3, -1, 2, -1, 1, 2, 3, -1, 2, -1, 1, -1, 0, 1, 2, -1];
const hz = n => 440 * pow(2, (n - 69) / 12);
let step = 0, nextT = 0, inten = 0, musOn = 1;
export const setIntensity = v => (inten = v);
export const toggleMusic = () => (musOn = !musOn);
function voice(type, f, t, dur, vol, cut, q = 1) {
  const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
  o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.Q.value = q; fl.frequency.setValueAtTime(cut, t); fl.frequency.exponentialRampToValueAtTime(max(cut * 0.25, 80), t + dur);
  env(g, t, vol, 0.006, dur); o.connect(fl); fl.connect(g); g.connect(mus); o.start(t); o.stop(t + dur + 0.02);
}
function drum(k, t, v) {
  const g = ac.createGain(); g.connect(mus);
  if (k == 0) { const o = ac.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); env(g, t, v, 0.002, 0.22); o.connect(g); o.start(t); o.stop(t + 0.25); return; }
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(); s.buffer = nbuf; f.type = k == 1 ? 'bandpass' : 'highpass'; f.frequency.value = k == 1 ? 1900 : 7500; f.Q.value = 0.8;
  env(g, t, v, 0.002, k == 1 ? 0.16 : 0.045); s.connect(f); f.connect(g); s.start(t, random(), 0.2);
  if (k == 1) { const o = ac.createOscillator(), g2 = ac.createGain(); o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08); env(g2, t, v * 0.6, 0.002, 0.1); o.connect(g2); g2.connect(mus); o.start(t); o.stop(t + 0.12); }
}
export function updateMusic() {
  if (!ok || !musOn || ac.state != 'running') { nextT = 0; return; }
  const bpm = inten > 2 ? 140 : 126, sl = 60 / bpm / 4;
  if (!nextT || nextT < ac.currentTime - 0.3) nextT = ac.currentTime + 0.06;
  while (nextT < ac.currentTime + 0.14) {
    const s = step % 16, bar = floor(step / 16) % 4, c = CH[bar], t = nextT, boss = inten > 2;
    const tr = boss ? -3 : 0; // Boss 战整体下移小三度，气氛更紧张
    if (s == 0) for (const n of c.slice(0, 3)) voice('sawtooth', hz(n + tr), t, sl * 15, 0.035, 900 + inten * 500, 0.7);
    if (inten >= 0) voice('triangle', hz(c[[0, 2, 1, 3, 2, 1, 3, 2][s % 8]] + 12 + tr), t, sl * 1.7, 0.07, 3000, 1);
    if (inten >= 1) {
      if (s % 4 == 0) drum(0, t, 0.6);
      if (s % 8 == 4) drum(1, t, 0.3);
      if (s % 2 == 1 || inten >= 2) drum(2, t, s % 4 == 2 ? 0.14 : 0.07);
      if (s % 2 == 0) voice('sawtooth', hz(BASS[bar] + tr - (s % 8 == 6 ? -12 : 0)), t, sl * 1.8, 0.2, 500 + inten * 250, 4);
    }
    if (inten >= 2) { const m = MEL[(step % 32)]; if (m >= 0) voice('square', hz(c[m] + 24 + tr), t, sl * 2.2, 0.045, 4200, 1.5); }
    nextT += sl; step++;
  }
}
