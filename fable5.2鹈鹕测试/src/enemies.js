// 敌人：程序化模型 + 分件骨骼动画 + 行为 AI + 敌方弹幕
import { G } from './state.js';
import { PI, TAU, sin, cos, abs, hypot, min, max, atan2, clamp, lerp, damp, dampAng, wrapPi, rnd, random, sign, sqrt, m4, T, ident, copy, translate, rotX, rotY, rotZ, scale, smooth } from './math.js';
import { Geo, SPH, SPL, CYL, CYL8, BOX, CONE, rbox, torus, surf, lathe } from './geo.js';
import { mesh, draw, addLight } from './gfx.js';
import { tube, E } from './doubao.js';
import { groundH, resolve, blocked, raycast, ARENA } from './world.js';
import * as FX from './fx.js';
import { S } from './audio.js';

// hs: 命中球 [相对高度, 半径, 是否弱点, 前向偏移]
export const KIND = [
  { n: 'Bug', hp: 24, r: 0.55, sc: 10, spd: 8.6, hs: [[0.4, 0.66, 0]], cost: 1, col: [1, 0.24, 0.5] },
  { n: '乱码兵', hp: 70, r: 0.6, sc: 25, spd: 3.8, hs: [[0.85, 0.6, 0], [1.74, 0.38, 1]], cost: 3, col: [1, 0.45, 0.15] },
  { n: '弹窗无人机', hp: 38, r: 0.6, sc: 30, spd: 7.5, hs: [[0, 0.66, 0]], cost: 2, col: [1, 0.2, 0.2], fly: 1 },
  { n: '流氓骑手', hp: 95, r: 0.7, sc: 50, spd: 14.5, hs: [[0.8, 0.66, 0], [1.7, 0.36, 1]], cost: 4, col: [1, 0.2, 0.75] },
  { n: '防火墙', hp: 380, r: 1.5, sc: 120, spd: 2.3, hs: [[1.6, 1.5, 0]], cost: 8, col: [1, 0.5, 0.1] },
  { n: '幻觉之王', hp: 2800, r: 3.3, sc: 1500, spd: 3.2, hs: [[0, 3.3, 0], [0, 1.35, 1, 2.6]], cost: 0, col: [1, 0.15, 0.6], fly: 1, boss: 1 },
];
const EM = {};
const DK = 0x2b1840, MG = 0xff3d81, RD = 0xff3b30, GM = 0x3a4152, OR = 0xff8a2a, ST = 0x8f97a8;

export function buildEnemies() {
  let g = new Geo();
  // --- Bug：甲虫，背上有品红色发光纹 ---
  E(g, 0, 0.42, -0.14, 0.42, 0.3, 0.56, DK, 0, 0.85); E(g, 0, 0.4, 0.44, 0.3, 0.24, 0.3, 0x3a2258, 0, 0.8);
  for (const z of [-0.42, -0.16, 0.1]) g.add(torus(1, 0.05, 20, 5), T(0, 0.42, z, 0, PI / 2, PI / 2, 0.3, 0.42 * (z < -0.3 ? 0.78 : 0.99), 0.3), MG, 1, 0.5);
  for (const s of [-1, 1]) {
    E(g, 0.15 * s, 0.5, 0.66, 0.09, 0.09, 0.08, RD, 1, 0.9);
    g.add(CONE, T(0.1 * s, 0.34, 0.66, PI / 2 - 0.2, 0.35 * s, 0, 0.05, 0.26, 0.05), 0xe8e0d0, 0, 0.6);
    tube(g, [0.1 * s, 0.6, 0.6], [0.24 * s, 0.86, 0.86], 0.014, DK); E(g, 0.24 * s, 0.86, 0.86, 0.04, 0.04, 0.04, MG, 1, 0.5);
  }
  EM.bug = mesh(g, 0, 32);
  g = new Geo(); tube(g, [0, 0, 0], [0.36, 0.2, 0], 0.045, DK, 0, 0.7, 0); tube(g, [0.36, 0.2, 0], [0.62, -0.4, 0.04], 0.03, 0x3a2258, 0, 0.7, 0); E(g, 0.36, 0.2, 0, 0.06, 0.06, 0.06, MG, 0.6, 0.5);
  EM.bugLeg = mesh(g, 0, 128);
  // --- 乱码兵：显示器脑袋的机器人，屏幕上是愤怒的像素脸 ---
  g = new Geo();
  g.add(rbox(0.34, 0.36, 0.24, 0.08, 2), T(0, 1.1, 0), GM, 0, 0.6, 3); g.add(rbox(0.24, 0.12, 0.2, 0.06, 2), T(0, 0.72, 0), 0x2a2f3c, 0, 0.5, 3);
  g.add(BOX, T(0, 1.14, 0.245, 0, 0, 0, 0.36, 0.26, 0.02), 0x14161c, 0, 0.9); g.add(BOX, T(0, 1.14, 0.26, 0, 0, 0, 0.26, 0.05, 0.01), OR, 1, 0.5);
  for (const s of [-1, 1]) g.add(rbox(0.12, 0.1, 0.14, 0.05, 2), T(0.44 * s, 1.36, 0), RD, 0, 0.6, 3);
  g.add(CYL8, T(0, 1.44, 0, 0, 0, 0, 0.08, 0.1, 0.08), 0x2a2f3c, 0, 0.5, 3);
  g.add(rbox(0.33, 0.26, 0.26, 0.06, 2), T(0, 1.78, 0), 0x2a2f3c, 0, 0.6, 3); g.add(BOX, T(0, 1.78, 0.262, 0, 0, 0, 0.56, 0.4, 0.02), 0x180810, 0, 0.95);
  for (const s of [-1, 1]) { g.add(BOX, T(0.13 * s, 1.83, 0.275, 0, 0, -0.42 * s, 0.17, 0.055, 0.01), RD, 1, 0.5); g.add(BOX, T(0.13 * s, 1.77, 0.275, 0, 0, 0, 0.07, 0.07, 0.01), RD, 1, 0.5); }
  for (let i = -2; i <= 2; i++) g.add(BOX, T(i * 0.07, 1.66 + (i & 1) * 0.025, 0.275, 0, 0, 0, 0.05, 0.03, 0.01), RD, 1, 0.5);
  tube(g, [0.2, 2.03, 0], [0.3, 2.3, -0.05], 0.012, ST); E(g, 0.3, 2.3, -0.05, 0.035, 0.035, 0.035, RD, 1, 0.5);
  EM.gun = mesh(g, 0, 16);
  g = new Geo(); g.add(rbox(0.1, 0.36, 0.12, 0.05, 2), T(0, -0.36, 0), GM, 0, 0.6, 3); g.add(rbox(0.12, 0.07, 0.19, 0.05, 2), T(0, -0.72, 0.05), 0x2a2f3c, 0, 0.5, 3); E(g, 0, -0.36, 0.1, 0.07, 0.07, 0.05, OR, 0.5, 0.5);
  EM.gunLeg = mesh(g, 0, 32);
  g = new Geo(); g.add(rbox(0.09, 0.09, 0.2, 0.05, 2), T(0, 0, 0.14), GM, 0, 0.6, 3); g.add(CYL8, T(0, 0, 0.3, PI / 2, 0, 0, 0.075, 0.42, 0.075), 0x2a2f3c, 0, 0.7, 3);
  g.add(torus(0.085, 0.02, 12, 5), T(0, 0, 0.7, 0, PI / 2), OR, 1, 0.5); g.add(CYL8, T(0, 0, 0.72, PI / 2, 0, 0, 0.05, 0.02, 0.05), 0xffc27a, 1, 0.5);
  EM.gunArm = mesh(g, 0, 16);
  g = new Geo(); g.add(rbox(0.08, 0.3, 0.09, 0.05, 2), T(0, -0.28, 0), GM, 0, 0.6, 3); E(g, 0, -0.62, 0, 0.09, 0.09, 0.09, 0x2a2f3c, 0, 0.5, 3);
  EM.gunArmL = mesh(g, 0, 16);
  // --- 弹窗无人机 ---
  g = new Geo();
  E(g, 0, 0, 0, 0.4, 0.3, 0.44, 0xe8ebf0, 0, 0.75); E(g, 0, 0.02, 0.06, 0.41, 0.12, 0.42, 0x1c1f28, 0, 0.9); E(g, 0, 0, 0.36, 0.17, 0.17, 0.12, RD, 1, 0.9); E(g, 0, 0, 0.44, 0.07, 0.07, 0.05, 0x200408, 0, 0.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { tube(g, [0.2 * sx, 0, 0.2 * sz], [0.58 * sx, 0.1, 0.58 * sz], 0.03, 0x2a2f3c); g.add(CYL8, T(0.58 * sx, 0.04, 0.58 * sz, 0, 0, 0, 0.06, 0.14, 0.06), 0x2a2f3c, 0, 0.6, 3); E(g, 0.58 * sx, 0, 0.58 * sz, 0.04, 0.04, 0.04, RD, 1, 0.5); }
  g.add(CYL8, T(0, -0.26, 0.08, PI / 2, 0, 0, 0.045, 0.34, 0.045), 0x2a2f3c, 0, 0.7, 3);
  EM.drone = mesh(g, 0, 16);
  g = new Geo(); g.add(BOX, T(0, 0, 0, 0, 0, 0, 0.62, 0.012, 0.07), 0x1c1f28, 0, 0.6); g.add(BOX, T(0, 0, 0, 0, PI / 2, 0, 0.62, 0.012, 0.07), 0x1c1f28, 0, 0.6); g.add(CYL, T(0, -0.004, 0, 0, 0, 0, 0.31, 0.004, 0.31), 0x555c6a, 0, 0.2);
  EM.rotor = mesh(g, 0, 64);
  // --- 流氓骑手：独轮机车 ---
  g = new Geo(); g.add(torus(0.5, 0.12, 28, 8), null, 0x1c1f28, 0, 0.5); g.add(torus(0.4, 0.035, 28, 5), T(0.09, 0, 0), MG, 1, 0.5); g.add(torus(0.4, 0.035, 28, 5), T(-0.09, 0, 0), MG, 1, 0.5);
  g.add(CYL, T(-0.1, 0, 0, 0, 0, -PI / 2, 0.16, 0.2, 0.16), GM, 0, 0.7, 3);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; tube(g, [0, 0, 0], [0, cos(a) * 0.4, sin(a) * 0.4], 0.03, ST); }
  EM.rWheel = mesh(g, 0, 16);
  g = new Geo();
  g.add(surf((u, v) => { const a = lerp(1.25, -1.5, u), r = 0.68; return [(v - 0.5) * 0.4, 0.62 + r * cos(a), r * sin(a)]; }, 12, 3), null, DK, 0, 0.8, 3, 0, 0.8);
  g.add(rbox(0.22, 0.3, 0.17, 0.08, 2), T(0, 1.42, -0.05, 0.42), 0x3a2258, 0, 0.7, 3); g.add(rbox(0.2, 0.1, 0.24, 0.06, 2), T(0, 1.13, -0.16), 0x1c1f28, 0, 0.5);
  E(g, 0, 1.84, 0.12, 0.23, 0.25, 0.25, 0x1c1f28, 0, 0.9); g.add(rbox(0.19, 0.05, 0.06, 0.03, 2), T(0, 1.86, 0.33), MG, 1, 0.6);
  for (const s of [-1, 1]) { tube(g, [0.26 * s, 1.55, 0.02], [0.3 * s, 1.26, 0.5], 0.05, 0x3a2258, 0, 0.6, 3); tube(g, [0.14 * s, 1.12, -0.1], [0.2 * s, 0.74, 0.2], 0.07, 0x1c1f28, 0, 0.5, 0); E(g, 0.3 * s, 1.26, 0.5, 0.06, 0.06, 0.06, 0x1c1f28); }
  tube(g, [-0.34, 1.24, 0.52], [0.34, 1.24, 0.52], 0.022, ST); g.add(CYL8, T(0.36, 1.6, 0.05, PI / 2, 0, 0, 0.05, 0.6, 0.05), 0x2a2f3c, 0, 0.7, 3); g.add(CYL8, T(0.36, 1.6, 0.64, PI / 2, 0, 0, 0.035, 0.02, 0.035), MG, 1, 0.5);
  for (const s of [-1, 1]) tube(g, [0.2 * s, 0.62, 0], [0.2 * s, 1.1, -0.12], 0.035, ST);
  EM.rBody = mesh(g, 0, 16);
  // --- 防火墙：砖墙造型的悬浮重装单位 ---
  g = new Geo();
  g.add(rbox(1.25, 0.42, 1.5, 0.2, 2), T(0, 0.55, 0), 0x3d2a2a, 0, 0.6, 3); g.add(torus(1.05, 0.09, 28, 6), T(0, 0.16, 0, 0, 0, PI / 2, 1, 1, 1.2), OR, 1, 0.5);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g.add(rbox(0.3, 0.18, 0.42, 0.04, 1), T((c - 1.5) * 0.62 + (r & 1 ? 0.15 : -0.15), 1.18 + r * 0.38, 0.1), r & 1 ? 0xb5553c : 0xc96a48, 0, 0.35);
  g.add(BOX, T(0, 1.75, 0.1, 0, 0, 0, 2.3, 1.5, 0.7), 0xff7a2a, 0.55, 0.4);
  g.add(rbox(0.5, 0.26, 0.36, 0.1, 2), T(0, 2.86, 0.2), 0x2a2f3c, 0, 0.7, 3); g.add(BOX, T(0, 2.88, 0.565, 0, 0, 0, 0.74, 0.14, 0.02), OR, 1, 0.5);
  g.add(CYL, T(0.7, 2.5, -0.5, -0.6, 0, 0, 0.26, 1.2, 0.26), 0x2a2f3c, 0, 0.7, 3); g.add(torus(0.27, 0.04, 14, 5), T(0.7, 3.5, -1.18, PI / 2 - 0.6, 0, PI / 2), OR, 1, 0.5);
  for (const s of [-1, 1]) for (const z of [-1, 1]) g.add(CONE, T(0.9 * s, 0.3, 1.1 * z, PI, 0, 0, 0.22, 0.3, 0.22), 0xffb060, 1, 0.5);
  EM.heavy = mesh(g, 0, 8);
  g = new Geo();
  g.add(surf((u, v) => { const el = lerp(-0.35, 1.15, u), az = lerp(-1.15, 1.15, v), r = 2.5; return [r * sin(az) * cos(el), 1.5 + r * sin(el) * 0.9, r * cos(az) * cos(el)]; }, 8, 14), null, 0xffffff);
  EM.shield = mesh(g, 1, 8);
  // --- 幻觉之王：悬浮的巨型核心 ---
  g = new Geo();
  g.add(SPH, T(0, 0, 0, 0, 0, 0, 2.6), 0x1a1028, 0, 0.9, 3);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU, el = (i % 3 - 1) * 0.55; g.add(rbox(0.6, 0.5, 0.14, 0.1, 2), T(cos(a) * cos(el) * 2.62, sin(el) * 2.62, sin(a) * cos(el) * 2.62, -el, PI / 2 - a, 0), i & 1 ? 0x3a2258 : 0x2b1840, 0, 0.7, 3); }
  for (const rz of [0, 1.05, -1.05]) g.add(torus(2.63, 0.05, 40, 5), T(0, 0, 0, 0, 0, rz), MG, 0.6, 0.5);
  E(g, 0, 0, 2.3, 1.25, 1.25, 0.6, 0x12060c, 0, 0.95); E(g, 0, 0, 2.62, 0.95, 0.95, 0.35, MG, 0.55, 0.9); E(g, 0, 0, 2.86, 0.42, 0.62, 0.16, 0x0a0206, 0, 0.95); E(g, 0.18, 0.22, 2.96, 0.12, 0.12, 0.05, 0xffffff, 1, 0.9);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; g.add(CONE, T(cos(a) * 1.2, 2.25, sin(a) * 1.2, 0.35 * sin(a), 0, -0.35 * cos(a), 0.3, i & 1 ? 1.1 : 1.6, 0.3), 0xffc94d, 0.3, 0.85, 3); }
  g.add(CONE, T(0, -2.5, 0, PI, 0, 0, 0.9, 1.4, 0.9), 0x3a2258, 0, 0.7, 3); E(g, 0, -3.7, 0, 0.3, 0.3, 0.3, MG, 1, 0.5);
  EM.boss = mesh(g, 0, 2);
  g = new Geo(); g.add(torus(3.7, 0.13, 48, 6), null, 0x3a2258, 0, 0.8, 3); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; E(g, 0, cos(a) * 3.7, sin(a) * 3.7, 0.24, 0.24, 0.24, i & 1 ? MG : 0x59b6ff, 1, 0.6); }
  EM.bRing = mesh(g, 0, 4);
  // --- 弹幕 ---
  g = new Geo(); E(g, 0, 0, 0, 0.16, 0.16, 0.5, 0xffffff, 1, 0.5); EM.bolt = mesh(g, 0, 64);
  g = new Geo(); E(g, 0, 0, 0, 0.45, 0.45, 0.45, 0xffffff, 1, 0.5); g.add(torus(0.55, 0.05, 16, 4), T(0, 0, 0, 0, 0, PI / 2), 0xffffff, 1, 0.5); EM.orb = mesh(g, 0, 64);
  g = new Geo(); g.add(CYL8, T(0, 0, -0.35, PI / 2, 0, 0, 0.12, 0.6, 0.12), 0xe8ebf0, 0, 0.7, 3); g.add(CONE, T(0, 0, 0.25, PI / 2, 0, 0, 0.12, 0.28, 0.12), RD, 0.4, 0.7);
  for (let i = 0; i < 4; i++) g.add(BOX, T(0, 0, -0.3, 0, 0, (i * PI) / 2, 0.02, 0.36, 0.2), 0x2a2f3c, 0, 0.5); E(g, 0, 0, -0.38, 0.09, 0.09, 0.09, 0xffb060, 1, 0.5);
  EM.missile = mesh(g, 0, 16);
  g = new Geo(); E(g, 0, 0, 0, 0.3, 0.3, 0.3, 0x2a2f3c, 0, 0.7, 3); g.add(torus(0.3, 0.05, 14, 4), null, OR, 1, 0.5); EM.shellM = mesh(g, 0, 16);
  // 玩家火箭
  g = new Geo(); g.add(CYL8, T(0, 0, -0.3, PI / 2, 0, 0, 0.07, 0.5, 0.07), 0x35c98f, 0, 0.7); g.add(CONE, T(0, 0, 0.2, PI / 2, 0, 0, 0.07, 0.2, 0.07), 0xffd24a, 0.6, 0.7); E(g, 0, 0, -0.32, 0.06, 0.06, 0.06, 0xffb060, 1, 0.5);
  EM.rocket = mesh(g, 0, 8);
}
export const meshOf = n => EM[n];

// ---------- 生成 / 伤害 ----------
export function spawnEnemy(k, x, z) {
  const K = KIND[k], w = G.wave, hm = 1 + 0.07 * (w - 1) + (K.boss ? 0.35 * max(0, w / 5 - 1) : 0), gy = groundH(x, z);
  const e = {
    k, K, x, z, y: K.boss ? gy + 5.4 : k == 2 ? gy + 5.5 : gy, vx: 0, vy: 0, vz: 0, yaw: atan2(G.pl.x - x, G.pl.z - z), hp: K.hp * hm, mhp: K.hp * hm, r: K.r,
    t: 0, st: 0, cd: rnd(0.8, 2.2), cd2: 0, t2: 0, fl: 0, sp: 1, dead: 0, stun: 0, hb: 0, ph: rnd(TAU), side: random() < 0.5 ? -1 : 1, a: rnd(TAU), s: k == 0 ? rnd(0.85, 1.2) : 1,
    sh: k == 4 ? 140 * hm : 0, shT: 0, shF: 0, wh: 0, lean: 0, n: 0, n2: 0, ramT: 0, stuck: 0, ang: 0, aw: 0, las: 0,
  };
  G.enemies.push(e);
  FX.ring(x, gy + 0.1, z, 0.5, K.r * 3.4, 0.4, 1.6, 3, 0.7, 1); FX.flash(x, e.y + 1, z, 9, 0.6, 2.5, 5, 0.3);
  for (let i = 0; i < 10; i++) FX.spawn(x + rnd(-K.r, K.r), e.y + rnd(0, 2), z + rnd(-K.r, K.r), 0, rnd(4, 10), 0, 0.5, 0.25, 0.02, 0.5, 2, 4, 0, 0);
  S.spawn(x, e.y, z);
  return e;
}
// kind: 0 子弹 1 爆炸 2 冲撞
export function damageEnemy(e, dmg, crit, hx, hy, hz, dx, dz, kind = 0) {
  if (e.dead || e.hp <= 0) return 0;
  if (e.k == 4 && e.sh > 0 && kind != 2 && dx * sin(e.yaw) + dz * cos(e.yaw) < -0.2) {
    // 正面护盾吸收伤害，需要绕到侧后方
    e.sh -= dmg * (kind ? 0.6 : 1); e.shF = 1;
    FX.sparks(hx, hy, hz, -dx, 0.4, -dz, 5, 1, 0.6, 0.2, 7);
    if (e.sh <= 0) { e.shT = 7; FX.ring(e.x, e.y + 1.6, e.z, 1, 6, 3, 1.5, 0.4, 0.5); FX.burst(e.x + sin(e.yaw) * 2, e.y + 1.5, e.z + cos(e.yaw) * 2, 12, 1, 0.5, 0.15, 0.2, 8); S.die(e.x, e.y, e.z, 1.4); G.popup && G.popup('护盾击破', '#ffb060'); }
    else if (random() < 0.25) FX.text(hx, hy + 0.3, hz, '格挡', '#ffb060', 13, 0.5);
    return -1;
  }
  if (crit) dmg *= 2;
  dmg = min(dmg, e.hp + 5);
  e.hp -= dmg; e.fl = 1; e.hb = 3; G.stat.dmg += dmg;
  // Boss 每掉四分之一血就崩出补给，让持久战打得下去
  if (e.K.boss && e.hp > 0 && e.hp / e.mhp < 0.75 - 0.25 * e.n2) { e.n2++; for (const k of [0, 1]) G.pickups.push({ k, x: e.x + rnd(-5, 5), z: e.z + rnd(-5, 5), y: e.y - 3, t: 0, vy: 3 }); FX.ring(e.x, e.y, e.z, 2, 16, 3, 0.6, 2, 0.5); G.popup && G.popup('幻觉之王 崩出了补给', '#7dff9a'); }
  if (!e.K.boss && e.k != 4) { const kb = (kind == 2 ? 9 : kind ? 7 : 2.2) / (0.5 + e.r); e.vx += dx * kb; e.vz += dz * kb; }
  FX.text(hx, hy + 0.2, hz, '' + Math.round(dmg), crit ? '#ffd84a' : '#fff', crit ? 22 : 15, 0.7);
  if (e.hp <= 0) {
    e.dead = 0.001; e.hp = 0;
    const c = e.K.col, n = e.K.boss ? 60 : 6 + e.r * 12;
    FX.burst(e.x, e.y + (e.K.fly ? 0 : e.r), e.z, n, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, e.r * 0.3, 6 + e.r * 3, 0.6);
    FX.boom(e.x, e.y + (e.K.fly ? 0 : e.r * 0.8), e.z, e.K.boss ? 3 : 0.35 + e.r * 0.5, c[0], c[1], c[2]);
    S.die(e.x, e.y, e.z, 0.8 + e.r * 0.5);
    G.onKill && G.onKill(e, kind, crit);
  }
  return dmg;
}
// 射线与所有敌人（及可击落的导弹）求交：out 填入 {e, t, c}，返回数量
const HITS = [];
export function rayEnemies(ox, oy, oz, dx, dy, dz, maxT, inflate = 0) {
  HITS.length = 0;
  for (const e of G.enemies) {
    if (e.dead) continue;
    let bt = maxT, bc = -1;
    for (const h of e.K.hs) {
      const f = h[3] || 0, cx = e.x + sin(e.yaw) * f * e.s - ox, cy = e.y + h[0] * e.s - oy, cz = e.z + cos(e.yaw) * f * e.s - oz, r = h[1] * e.s + inflate;
      const b = cx * dx + cy * dy + cz * dz, c = cx * cx + cy * cy + cz * cz - r * r, d = b * b - c;
      if (d < 0) continue;
      let t = b - sqrt(d); if (t < 0) { if (c < 0) t = 0; else continue; }
      // 弱点球优先：只要不比身体命中点远太多就算暴击
      if (h[2]) { if (t < bt + 0.7) { bt = min(bt, t); bc = 1; } } else if (t < bt && !(bc == 1 && t > bt - 0.7)) { bt = t; bc = 0; }
    }
    if (bc >= 0) HITS.push({ e, t: bt, c: bc });
  }
  for (const s of G.shots) {
    if (s.k != 2) continue;
    const cx = s.x - ox, cy = s.y - oy, cz = s.z - oz, b = cx * dx + cy * dy + cz * dz, d = b * b - (cx * cx + cy * cy + cz * cz - 0.5);
    if (d >= 0 && b - sqrt(d) > 0 && b - sqrt(d) < maxT) HITS.push({ s, t: b - sqrt(d), c: 0 });
  }
  return HITS;
}

// ---------- 弹幕 ----------
export function shoot(k, x, y, z, vx, vy, vz, dmg, col, o = {}) {
  if (G.shots.length > 220) return;
  G.shots.push({ k, x, y, z, vx, vy, vz, dmg: dmg * (1 + 0.045 * (G.wave - 1)), col, life: o.life || 4, hp: 10, t: 0, tx: o.tx, tz: o.tz });
}
function aimBolt(e, x, y, z, spd, dmg, err, lead = 0.75) {
  const p = G.pl, d = hypot(p.x - x, p.z - z), tt = (d / spd) * lead;
  const tx = p.x + sin(p.yaw) * p.spd * tt + rnd(-err, err), tz = p.z + cos(p.yaw) * p.spd * tt + rnd(-err, err), ty = p.y + 0.95 + p.vy * tt * 0.3;
  const dx = tx - x, dy = ty - y, dz = tz - z, l = hypot(dx, dy, dz) || 1;
  shoot(0, x, y, z, (dx / l) * spd, (dy / l) * spd, (dz / l) * spd, dmg, e.K.col);
  FX.flash(x, y, z, 6, e.K.col[0] * 3, e.K.col[1] * 3, e.K.col[2] * 3, 0.07); FX.spawn(x, y, z, 0, 0, 0, 0.08, 0.7, 0.2, e.K.col[0] * 4, e.K.col[1] * 4, e.K.col[2] * 4, 0, 4);
  S.ebolt(x, y, z);
}
const los = (x, y, z) => { const p = G.pl, dx = p.x - x, dy = p.y + 1 - y, dz = p.z - z, d = hypot(dx, dy, dz); return raycast(x, y, z, dx / d, dy / d, dz / d, d) >= d - 0.5; };
function explodeAt(x, y, z, R, dmg, k = 1) {
  const p = G.pl, d = hypot(p.x - x, p.y + 0.8 - y, p.z - z);
  FX.boom(x, y, z, k); S.boom(x, y, z, k); G.cam.shake = max(G.cam.shake, clamp(1.6 - d / 14, 0, 1) * k);
  if (d < R) G.onHurt(dmg * (1 - (d / R) * 0.6), x, z);
}
const mm = m4(), ml = m4();
function updateShots(dt) {
  const p = G.pl, A = G.shots;
  for (let i = A.length - 1; i >= 0; i--) {
    const s = A[i]; let kill = 0;
    s.life -= dt; s.t += dt;
    if (s.k == 1) s.vy -= 18 * dt;
    else if (s.k == 2) {
      // 追踪导弹：限速转向
      const tx = p.x - s.x, ty = p.y + 0.9 - s.y, tz = p.z - s.z, l = hypot(tx, ty, tz) || 1, sp = hypot(s.vx, s.vy, s.vz), k = min(1, (s.t < 0.5 ? 0.3 : 2.1) * dt);
      s.vx += ((tx / l) * sp - s.vx) * k; s.vy += ((ty / l) * sp - s.vy) * k; s.vz += ((tz / l) * sp - s.vz) * k;
      const n = 15.5 / (hypot(s.vx, s.vy, s.vz) || 1); s.vx *= n; s.vy *= n; s.vz *= n;
      if (random() < dt * 40) FX.spawn(s.x, s.y, s.z, rnd(-0.5, 0.5), rnd(-0.2, 0.6), rnd(-0.5, 0.5), 0.6, 0.2, 0.7, 0.35, 0.33, 0.36, 0.5, 1, 1, -0.5);
      if (l < 1.5 || s.hp <= 0) { explodeAt(s.x, s.y, s.z, s.hp <= 0 ? 0 : 3, s.dmg, 0.6); kill = 1; }
    }
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    const gh = groundH(s.x, s.z);
    if (s.k == 3) s.y = gh + 0.9;
    if (!kill) {
      const dx = p.x - s.x, dy = p.y + 0.85 - s.y, dz = p.z - s.z;
      if (s.k == 1) { if (s.y <= gh + 0.2) { explodeAt(s.x, gh, s.z, 4.8, s.dmg, 1); kill = 1; } }
      else if (s.k != 2 && dx * dx + dz * dz < (s.k == 3 ? 0.95 : 0.6) && abs(dy) < (s.k == 3 ? 1.05 : 0.95)) { G.onHurt(s.dmg, s.x - s.vx, s.z - s.vz); kill = 2; }
      else if (s.life <= 0 || s.y < gh || (s.k != 3 || s.t > 0.4) && blocked(s.x, s.z, 0.12, s.y)) kill = s.k == 2 ? (explodeAt(s.x, s.y, s.z, 3, s.dmg, 0.6), 1) : 2;
    }
    const c = s.col;
    if (kill) { if (kill == 2) FX.sparks(s.x, s.y, s.z, 0, 0.5, 0, 5, c[0], c[1], c[2], 6); A.splice(i, 1); continue; }
    // 绘制：沿速度方向的发光弹体
    ident(mm); translate(mm, s.x, s.y, s.z); rotY(mm, atan2(s.vx, s.vz)); rotX(mm, -atan2(s.vy, hypot(s.vx, s.vz)));
    if (s.k == 0) { draw(EM.bolt, mm, c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 0); if (i % 3 == 0) addLight(s.x, s.y, s.z, 5, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5); }
    else if (s.k == 1) { rotX(mm, s.t * 6); draw(EM.shellM, mm, 1, 1, 1, 0); FX.spawn(s.tx, groundH(s.tx, s.tz) + 0.08, s.tz, 0, 0, 0, 0.05, 4.8, 4.8, 3 * min(s.t, 1), 0.5, 0.15, 0, 9); }
    else if (s.k == 2) { draw(EM.missile, mm, 1, 1, 1, 0); addLight(s.x, s.y, s.z, 6, 3, 1.5, 0.5); }
    else { rotY(mm, s.t * 5); draw(EM.orb, mm, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5, 0); if (i % 4 == 0) addLight(s.x, s.y, s.z, 6, c[0] * 2, c[1] * 2, c[2] * 2); }
  }
}

// ---------- 移动 ----------
const o2 = { x: 0, z: 0, nx: 0, nz: 0 };
// 朝目标点加速移动，带简单的绕障（前方受阻时向固定一侧偏转）
function moveTo(e, tx, tz, spd, acc, dt, fly) {
  let dx = tx - e.x, dz = tz - e.z, d = hypot(dx, dz) || 1; dx /= d; dz /= d;
  if (blocked(e.x + dx * (e.r + 1.6), e.z + dz * (e.r + 1.6), e.r * 0.8, e.y)) { const c = cos(1.15 * e.side), s = sin(1.15 * e.side), nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx; }
  const k = min(1, acc * dt / (spd + 1));
  e.vx += (dx * spd - e.vx) * k; e.vz += (dz * spd - e.vz) * k;
}
function integrate(e, dt) {
  const ox = e.x, oz = e.z;
  e.x += e.vx * dt; e.z += e.vz * dt;
  o2.x = e.x; o2.z = e.z;
  if (resolve(o2, e.r * 0.8, e.y, 1.6)) { e.x = o2.x; e.z = o2.z; const vn = e.vx * o2.nx + e.vz * o2.nz; if (vn < 0) { e.vx -= o2.nx * vn; e.vz -= o2.nz * vn; } }
  if (hypot(e.x - ox, e.z - oz) < 0.25 * dt * hypot(e.vx, e.vz) + 0.001 && hypot(e.vx, e.vz) > 1) { e.stuck += dt; if (e.stuck > 0.7) { e.side = -e.side; e.stuck = 0; } } else e.stuck = max(0, e.stuck - dt);
  if (!e.K.fly) {
    const gh = groundH(e.x, e.z);
    if (gh - e.y > 0.7) { e.x = ox; e.z = oz; e.vx *= -0.3; e.vz *= -0.3; e.side = -e.side; }
    else if (e.y > gh + 0.05) { e.vy -= 22 * dt; e.y = max(gh, e.y + e.vy * dt); } else { e.y = gh; e.vy = 0; }
  }
}

function ai(e, dt) {
  const p = G.pl, K = e.K, dx = p.x - e.x, dz = p.z - e.z, d = hypot(dx, dz) || 1, dm = 1 + 0.045 * (G.wave - 1), toP = atan2(dx, dz);
  e.cd -= dt; e.cd2 -= dt;
  if (e.k == 0) { // Bug：成群扑咬
    const tt = min(d / 14, 0.7), sp = min(K.spd + 0.6 + G.wave * 0.2, 12) * (1 / e.s);
    moveTo(e, p.x + sin(p.yaw) * p.spd * tt, p.z + cos(p.yaw) * p.spd * tt, sp, 34, dt);
    e.yaw = dampAng(e.yaw, atan2(e.vx, e.vz), 10, dt); e.ph += dt * hypot(e.vx, e.vz) * 2.4;
    if (d < 1.55 + e.r * 0.3 && abs(p.y - e.y) < 1.4 && e.cd <= 0) { G.onHurt(6 * dm, e.x, e.z); e.cd = 0.95; e.vy = 4; e.y += 0.06; e.vx *= 0.3; e.vz *= 0.3; }
    else if (d < 7 && d > 2 && e.cd2 <= 0 && e.y <= groundH(e.x, e.z) + 0.05) { e.cd2 = rnd(1.6, 2.6); e.vy = 5.2; e.y += 0.06; const tx = dx + sin(p.yaw) * p.spd * 0.35, tz = dz + cos(p.yaw) * p.spd * 0.35, l = hypot(tx, tz) || 1; e.vx = (tx / l) * 15; e.vz = (tz / l) * 15; }
  } else if (e.k == 1) { // 乱码兵：保持距离、横移、三连发
    e.yaw = dampAng(e.yaw, toP, 7, dt);
    if (e.st == 0) {
      const want = d > 27 ? 1 : d < 13 ? -1 : 0, px = -dz / d * e.side, pz = dx / d * e.side;
      moveTo(e, e.x + (dx / d) * want * 8 + px * 6, e.z + (dz / d) * want * 8 + pz * 6, K.spd, 14, dt);
      e.ph += dt * hypot(e.vx, e.vz) * 2.6; e.t2 -= dt; if (e.t2 < 0) { e.t2 = rnd(2, 4.5); if (random() < 0.5) e.side = -e.side; }
      if (e.cd <= 0 && d < 48 && los(e.x, e.y + 1.4, e.z)) { e.st = 1; e.t2 = 0.55; e.n = 3; }
    } else {
      e.vx *= 0.86; e.vz *= 0.86; e.t2 -= dt;
      const c = cos(e.yaw), s = sin(e.yaw), mx = e.x - c * 0.46 + s * 0.8, mz = e.z + s * 0.46 + c * 0.8, my = e.y + 1.32;
      if (e.st == 1) FX.spawn(mx, my, mz, 0, 0, 0, 0.05, 0.25 + (0.55 - e.t2) * 0.8, 0.1, 4, 1.4, 0.3, 0, 0);
      if (e.t2 <= 0) { aimBolt(e, mx, my, mz, 38, 7, 1.15, 0.9); e.aw = 1; if (--e.n > 0) { e.st = 2; e.t2 = 0.14; } else { e.st = 0; e.cd = rnd(2, 3.2); e.t2 = rnd(1, 3); } }
    }
  } else if (e.k == 2) { // 无人机：绕圈盘旋射击
    e.a += e.side * dt * 0.55; e.ph += dt * 40;
    const tx = p.x + cos(e.a) * 15, tz = p.z + sin(e.a) * 15, th = groundH(e.x, e.z) + 5.2 + sin(e.t * 1.4 + e.a) * 1.1;
    moveTo(e, tx, tz, K.spd, 12, dt); e.y = damp(e.y, max(th, p.y + 3), 2.5, dt); e.yaw = dampAng(e.yaw, toP, 6, dt);
    if (e.cd <= 0 && d < 42 && los(e.x, e.y - 0.3, e.z)) { aimBolt(e, e.x + sin(e.yaw) * 0.5, e.y - 0.26, e.z + cos(e.yaw) * 0.5, 34, 6, 1, 0.9); e.cd = rnd(1.4, 2.1); }
  } else if (e.k == 3) { // 骑手：高速追击，侧向扫射 + 冲撞
    const sp = K.spd + min(G.wave * 0.15, 2.5), tt = min(d / 20, 0.6), want = atan2(p.x + sin(p.yaw) * p.spd * tt - e.x, p.z + cos(p.yaw) * p.spd * tt - e.z);
    let df = wrapPi(want - e.yaw);
    if (blocked(e.x + sin(e.yaw) * 4, e.z + cos(e.yaw) * 4, 0.6, e.y)) df = e.side * 2.2;
    const tr = clamp(df * 4, -2.3, 2.3); e.yaw += tr * dt; e.lean = damp(e.lean, -tr * 0.2, 6, dt);
    const cur = hypot(e.vx, e.vz), v = cur + clamp(sp - cur, -20 * dt, 12 * dt); e.vx = sin(e.yaw) * v; e.vz = cos(e.yaw) * v; e.wh += (v / 0.62) * dt;
    if (e.cd <= 0 && d < 20 && d > 3 && los(e.x, e.y + 1.5, e.z)) { aimBolt(e, e.x + cos(e.yaw) * 0.36, e.y + 1.6, e.z - sin(e.yaw) * 0.36, 34, 6, 1.6); e.cd = e.n-- > 0 ? 0.16 : ((e.n = 2), rnd(1.4, 2.2)); }
    if (d < 1.5 && abs(p.y - e.y) < 1.5 && e.cd2 <= 0) { G.onHurt(11 * dm, e.x, e.z); e.cd2 = 1.3; e.vx *= -0.4; e.vz *= -0.4; p.spd *= 0.6; S.ram(); }
    if (random() < dt * 14 && v > 6) FX.spawn(e.x - sin(e.yaw) * 0.5, e.y + 0.1, e.z - cos(e.yaw) * 0.5, 0, 0.4, 0, 0.35, 0.3, 0.05, 2.5, 0.5, 1.8, 0, 0);
  } else if (e.k == 4) { // 防火墙：缓慢推进，迫击炮 + 近身震荡
    e.yaw = dampAng(e.yaw, toP, 0.85, dt); e.ph += dt;
    if (d > 24) moveTo(e, p.x, p.z, K.spd, 4, dt); else { e.vx *= 0.9; e.vz *= 0.9; }
    if (e.shT > 0) { e.shT -= dt; if (e.shT <= 0) e.sh = 140 * (1 + 0.07 * (G.wave - 1)); }
    if (e.cd <= 0 && d < 60 && d > 6) {
      const tt = 1.75, tx = p.x + sin(p.yaw) * p.spd * tt * 0.62 + rnd(-1.5, 1.5), tz = p.z + cos(p.yaw) * p.spd * tt * 0.62 + rnd(-1.5, 1.5), sx = e.x + cos(e.yaw) * 0.7 - sin(e.yaw) * 1.1, sz = e.z - sin(e.yaw) * 0.7 - cos(e.yaw) * 1.1, sy = e.y + 3.8;
      shoot(1, sx, sy, sz, (tx - sx) / tt, (groundH(tx, tz) - sy) / tt + 9 * tt, (tz - sz) / tt, 22, K.col, { life: 5, tx, tz });
      FX.flash(sx, sy, sz, 9, 5, 2.5, 0.6, 0.12); FX.smoke(sx, sy, sz, 3, 0.5, 0.3, 2); S.mortar(sx, sy, sz); e.cd = rnd(2.8, 3.8); e.aw = 1;
    }
    if (d < 5 && e.cd2 <= 0) { e.st = 1; e.t2 = 0.65; e.cd2 = 3.2; }
    if (e.st == 1) {
      e.t2 -= dt; FX.spawn(e.x, e.y + 0.1, e.z, 0, 0, 0, 0.05, 5.4, 5.4, 4, 1.4, 0.3, 0, 9);
      if (e.t2 <= 0) { e.st = 0; FX.ring(e.x, e.y + 0.2, e.z, 1.5, 12, 4, 1.6, 0.4, 0.4, 1); S.boom(e.x, e.y, e.z, 0.7); if (d < 5.6 && p.y - e.y < 1.6) { G.onHurt(15 * dm, e.x, e.z); p.vy = max(p.vy, 6); p.gnd = 0; } }
    }
  } else boss(e, dt, d, toP, dm);
}
function boss(e, dt, d, toP, dm) {
  const p = G.pl, K = e.K, rage = e.hp < e.mhp * 0.5, gx = e.x, gz = e.z, gy = groundH(gx, gz);
  e.yaw = dampAng(e.yaw, toP, 1.3, dt); e.ph += dt;
  e.y = damp(e.y, gy + 5.4 + sin(e.t * 0.9) * 0.5, 2, dt);
  if (d > 34 && e.st != 3) moveTo(e, p.x, p.z, K.spd * (rage ? 1.4 : 1), 3, dt); else { e.vx *= 0.94; e.vz *= 0.94; }
  if (hypot(e.x, e.z) > 96) { e.vx -= e.x * 0.02; e.vz -= e.z * 0.02; }
  if (rage && !e.rage) { e.rage = 1; S.roar(e.x, e.y, e.z); FX.ring(e.x, e.y, e.z, 2, 30, 4, 0.5, 2, 0.8); G.say && G.say('它进入了狂暴状态，注意弹幕！'); G.cam.shake = 1; }
  if (e.st == 0 && e.cd <= 0) {
    let n; do n = 1 + ((random() * 4) | 0); while (n == e.last); e.last = e.st = n; e.t2 = 0; e.n = 0;
    if (n == 3) { e.ang = toP + e.side * 1.9; e.side = -e.side; e.las = 0; S.laser(e.x, e.y, e.z); }
  }
  if (e.st == 1) { // 环形弹幕：贴地能量球，留有缺口
    e.t2 -= dt;
    if (e.t2 <= 0) {
      const N = 20, off = e.n * 0.157 + rnd(0.3);
      for (let i = 0; i < N; i++) { if (i % 5 == (e.n % 5)) continue; const a = off + (i / N) * TAU; shoot(3, gx + cos(a) * 3, gy + 0.9, gz + sin(a) * 3, cos(a) * 15, 0, sin(a) * 15, 10, K.col, { life: 6.5 }); }
      FX.ring(gx, gy + 0.3, gz, 2, 10, 4, 0.6, 2.4, 0.4, 1); S.ebolt(e.x, e.y, e.z); e.t2 = 0.75;
      if (++e.n >= (rage ? 4 : 3)) { e.st = 0; e.cd = rage ? 1.6 : 2.6; }
    }
  } else if (e.st == 2) { // 追踪导弹：可以击落
    e.t2 -= dt;
    if (e.t2 <= 0) {
      const a = rnd(TAU); shoot(2, e.x + cos(a) * 2, e.y + 2.5, e.z + sin(a) * 2, cos(a) * 6, 14, sin(a) * 6, 13, K.col, { life: 7 });
      FX.flash(e.x, e.y + 2.5, e.z, 10, 5, 2, 1, 0.1); S.mortar(e.x, e.y, e.z); e.t2 = 0.28;
      if (++e.n >= (rage ? 5 : 3)) { e.st = 0; e.cd = rage ? 1.7 : 2.6; }
    }
  } else if (e.st == 3) { // 贴地横扫激光：先预警，再旋转扫射；可以跳过，也可以躲在掩体后
    e.t2 += dt;
    const on = e.t2 > 1.3, w = rage ? 1.1 : 0.82;
    if (on) e.ang -= e.side * w * dt;
    const cx = sin(e.ang), cz = cos(e.ang), L = raycast(gx, gy + 0.8, gz, cx, 0, cz, 85), ex = gx + cx * L, ez = gz + cz * L, ey = gy + 0.8;
    if (on) {
      FX.tracer(e.x, e.y - 3.2, e.z, gx + cx * 2, ey, gz + cz * 2, 0.5, 6, 0.6, 2.4, 0.04, 1);
      FX.tracer(gx + cx * 2, ey, gz + cz * 2, ex, ey, ez, 0.75, 7, 0.7, 2.8, 0.04, 1); FX.tracer(gx + cx * 2, ey, gz + cz * 2, ex, ey, ez, 0.2, 9, 7, 9, 0.04, 1);
      FX.sparks(ex, ey, ez, -cx, 0.6, -cz, 2, 1, 0.3, 0.6, 8); addLight(gx + cx * min(L, 12), ey + 1, gz + cz * min(L, 12), 16, 6, 0.6, 2.4);
      const t = clamp((p.x - gx) * cx + (p.z - gz) * cz, 0, L), ld = hypot(p.x - gx - cx * t, p.z - gz - cz * t);
      if (ld < 0.8 && p.y - groundH(p.x, p.z) < 1.05 && t > 1.5) G.onHurt(15 * dm, gx + cx * t - cz, gz + cz * t + cx, 0.6);
    } else FX.tracer(gx + cx * 2, ey, gz + cz * 2, ex, ey, ez, 0.08 + 0.06 * sin(e.t2 * 40), 3, 0.3, 1.2, 0.04, 1);
    if (e.t2 > 1.3 + (rage ? 5 : 4.2)) { e.st = 0; e.cd = rage ? 1.7 : 2.6; }
  } else if (e.st == 4) { // 召唤 Bug
    const n = rage ? 6 : 4;
    for (let i = 0; i < n && G.enemies.length < 42; i++) { const a = rnd(TAU), r = rnd(6, 11); if (!blocked(gx + cos(a) * r, gz + sin(a) * r, 1)) spawnEnemy(0, gx + cos(a) * r, gz + sin(a) * r); }
    S.roar(e.x, e.y, e.z); e.st = 0; e.cd = rage ? 2 : 3;
  }
}

// ---------- 绘制 ----------
function drawEnemy(e) {
  const a = e.fl > 0.05 ? e.fl * 0.8 : e.sp > 0 ? -e.sp : e.dead ? -e.dead : 0, t = e.t;
  ident(mm); translate(mm, e.x, e.y, e.z); rotY(mm, e.yaw);
  if (e.k == 0) {
    scale(mm, e.s, e.s, e.s); translate(mm, 0, abs(sin(e.ph)) * 0.04, 0);
    draw(EM.bug, mm, 1, 1, 1, a);
    for (let i = 0; i < 6; i++) {
      const sd = i < 3 ? 1 : -1, ph = e.ph + ((i + (i < 3 ? 0 : 1)) % 2 ? PI : 0);
      copy(ml, mm); translate(ml, 0.2 * sd, 0.38, (i % 3 - 1) * 0.3 + 0.06); if (sd < 0) rotY(ml, PI); rotY(ml, sin(ph) * 0.45); rotZ(ml, max(0, cos(ph)) * 0.4);
      draw(EM.bugLeg, ml, 1, 1, 1, a);
    }
  } else if (e.k == 1) {
    const w = min(hypot(e.vx, e.vz) / 3, 1);
    translate(mm, 0, abs(sin(e.ph)) * 0.04 * w, 0); draw(EM.gun, mm, 1, 1, 1, a);
    for (const s of [-1, 1]) { copy(ml, mm); translate(ml, 0.17 * s, 0.78, 0); rotX(ml, sin(e.ph) * 0.6 * w * s); draw(EM.gunLeg, ml, 1, 1, 1, a); }
    const p = G.pl, pit = atan2(p.y + 0.9 - e.y - 1.32, hypot(p.x - e.x, p.z - e.z));
    copy(ml, mm); translate(ml, -0.46, 1.32, 0); rotX(ml, -pit - e.aw * 0.35); draw(EM.gunArm, ml, 1, 1, 1, a);
    copy(ml, mm); translate(ml, 0.46, 1.32, 0); rotX(ml, -sin(e.ph) * 0.5 * w); draw(EM.gunArmL, ml, 1, 1, 1, a);
  } else if (e.k == 2) {
    const c = cos(e.yaw), s = sin(e.yaw); rotX(mm, clamp((e.vx * s + e.vz * c) * 0.04, -0.4, 0.4)); rotZ(mm, clamp((e.vx * c - e.vz * s) * 0.05, -0.5, 0.5));
    draw(EM.drone, mm, 1, 1, 1, a);
    for (let i = 0; i < 4; i++) { copy(ml, mm); translate(ml, i & 1 ? 0.58 : -0.58, 0.19, i & 2 ? 0.58 : -0.58); rotY(ml, e.ph * (i & 1 ? 1 : -1)); draw(EM.rotor, ml, 1, 1, 1, a); }
  } else if (e.k == 3) {
    rotZ(mm, e.lean); draw(EM.rBody, mm, 1, 1, 1, a);
    copy(ml, mm); translate(ml, 0, 0.62, 0); rotX(ml, e.wh); draw(EM.rWheel, ml, 1, 1, 1, a);
  } else if (e.k == 4) {
    translate(mm, 0, 0.28 + sin(e.ph * 2) * 0.08, 0); draw(EM.heavy, mm, 1, 1, 1, a);
    if (e.sh > 0 && !e.dead) draw(EM.shield, mm, 1, 0.5, 0.12, 0.5 + e.shF * 1.5 + 0.1 * sin(t * 5));
    addLight(e.x, e.y + 0.3, e.z, 6, 3, 1.3, 0.3);
  } else {
    draw(EM.boss, mm, 1, 1, 1, a);
    copy(ml, mm); rotX(ml, t * 0.7); rotZ(ml, 0.5); draw(EM.bRing, ml, 1, 1, 1, a);
    copy(ml, mm); rotZ(ml, t * 0.5 + 1); rotX(ml, 1.3); scale(ml, 1.2, 1.2, 1.2); draw(EM.bRing, ml, 1, 1, 1, a);
    addLight(e.x + sin(e.yaw) * 4, e.y, e.z + cos(e.yaw) * 4, 22, 3, 0.5, 1.6);
    if (e.rage && random() < 0.4) FX.spawn(e.x + rnd(-3, 3), e.y + rnd(-3, 3), e.z + rnd(-3, 3), 0, rnd(1, 4), 0, 0.5, 0.4, 0.05, 4, 0.4, 2, 0, 0);
  }
}

export function updateEnemies(dt) {
  const A = G.enemies, p = G.pl;
  for (let i = A.length - 1; i >= 0; i--) {
    const e = A[i];
    e.t += dt; e.fl = max(0, e.fl - dt * 7); e.hb -= dt; e.shF = max(0, e.shF - dt * 5); e.aw = max(0, e.aw - dt * 5); e.ramT -= dt;
    if (e.dead) { e.dead += dt * (e.K.boss ? 0.8 : 3.2); if (e.dead >= 1) { A.splice(i, 1); continue; } }
    else if (e.sp > 0) e.sp = max(0, e.sp - dt * 1.3);
    else if (e.stun > 0) { e.stun -= dt; e.vx *= 0.9; e.vz *= 0.9; }
    else if (!p.dead) ai(e, dt);
    else { e.vx *= 0.95; e.vz *= 0.95; }
    if (!e.dead) {
      // 敌人之间互相排斥，避免叠在一起
      for (let j = i - 1; j >= 0; j--) {
        const o = A[j]; if (o.dead || (e.K.fly != o.K.fly)) continue;
        const dx = e.x - o.x, dz = e.z - o.z, rr = (e.r + o.r) * 0.9, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-4) { const d = sqrt(d2), k = ((rr - d) / d) * 0.5 * min(1, dt * 12); e.x += dx * k; e.z += dz * k; o.x -= dx * k; o.z -= dz * k; }
      }
      integrate(e, dt);
    }
    drawEnemy(e);
  }
  updateShots(dt);
}
export function clearEnemies() { G.enemies.length = G.shots.length = G.rockets.length = 0; }
