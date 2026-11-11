// 特效：粒子（公告板）、弹道光束、碎块物理、闪光点光源、飘字
import { pbuf, tbuf, cnt, addLight, draw, mesh } from './gfx.js';
import { Geo, rbox, CYL8 } from './geo.js';
import { m4, T, ident, translate, rotX, rotY, rotZ, scale, random, sin, cos, sqrt, hypot, PI, TAU, min, max, rnd, exp } from './math.js';
import { groundH } from './world.js';

const N = 3000, F = 18, P = new Float32Array(N * F); // x y z vx vy vz life max s0 s1 r g b a shape drag grav rot
let pn = 0;
// a: 0 = 加色发光，1 = 普通半透明（烟尘）
export function spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 0, shape = 0, drag = 0, grav = 0) {
  if (pn >= N) return;
  const o = pn++ * F;
  P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = vx; P[o + 4] = vy; P[o + 5] = vz; P[o + 6] = life; P[o + 7] = life;
  P[o + 8] = s0; P[o + 9] = s1; P[o + 10] = r; P[o + 11] = g; P[o + 12] = b; P[o + 13] = a; P[o + 14] = shape; P[o + 15] = drag; P[o + 16] = grav; P[o + 17] = random() * TAU;
}
const TR = [], FL = [], DB = [], NDB = 260;
export const texts = [];
export let MC = {};
export function buildFx() {
  let g = new Geo(); g.add(rbox(0.5, 0.5, 0.5, 0.1, 1), null, 0xffffff, 0, 0.6); MC.cube = mesh(g, 0, 64);
  g = new Geo(); g.add(rbox(0.5, 0.5, 0.5, 0.1, 1), null, 0xffffff, 1, 0.6); MC.cubeE = mesh(g, 0, 64);
  g = new Geo(); g.add(CYL8, T(0, -0.5, 0, 0, 0, 0, 0.35, 1, 0.35), 0xd9a441, 0, 0.9, 3); MC.shell = mesh(g, 0, 32);
}
// 光束：w 宽度，life 持续时间，tail=0 尾部渐隐 / 1 均匀
export const tracer = (ax, ay, az, bx, by, bz, w, r, g, b, life = 0.07, tail = 0) => TR.push([ax, ay, az, bx, by, bz, w, r, g, b, life, life, tail]);
export const flash = (x, y, z, rad, r, g, b, life = 0.08) => FL.push([x, y, z, rad, r, g, b, life, life]);
export function text(x, y, z, s, col = '#fff', size = 18, life = 0.8) { if (texts.length < 60) texts.push({ x, y, z, s, col, size, t: 0, life, vy: 1.6 + random() }); }
// 碎块：kind 0 普通方块 1 发光方块 2 弹壳
export function debris(x, y, z, vx, vy, vz, s, r, g, b, kind = 0, life = 1.6) {
  if (DB.length >= NDB) DB.shift();
  DB.push({ x, y, z, vx, vy, vz, s, r, g, b, kind, life, max: life, ax: rnd(TAU), ay: rnd(TAU), wx: rnd(-12, 12), wy: rnd(-12, 12) });
}
export function sparks(x, y, z, nx, ny, nz, n, r, g, b, sp = 9, life = 0.35) {
  for (let i = 0; i < n; i++) {
    const s = sp * (0.3 + random());
    spawn(x, y, z, (nx + rnd(-0.8, 0.8)) * s, (ny + rnd(-0.6, 0.9)) * s, (nz + rnd(-0.8, 0.8)) * s, life * (0.5 + random()), 0.07, 0.01, r * 3, g * 3, b * 3, 0, 3, 2, 14);
  }
}
export function smoke(x, y, z, n, s = 0.6, c = 0.35, up = 1.2, life = 1) {
  for (let i = 0; i < n; i++) spawn(x + rnd(-s, s) * 0.5, y + rnd(0, s) * 0.5, z + rnd(-s, s) * 0.5, rnd(-1, 1), up * (0.4 + random()), rnd(-1, 1), life * (0.6 + random() * 0.8), s * 0.6, s * 2.2, c, c, c * 1.05, 0.55, 1, 1.5, -0.4);
}
export function dust(x, y, z, n, vx = 0, vz = 0) {
  for (let i = 0; i < n; i++) spawn(x + rnd(-0.2, 0.2), y + 0.1, z + rnd(-0.2, 0.2), vx + rnd(-1.2, 1.2), rnd(0.3, 1.4), vz + rnd(-1.2, 1.2), 0.5 + random() * 0.5, 0.18, 0.75, 0.5, 0.46, 0.4, 0.3, 1, 2.5, 0);
}
export const ring = (x, y, z, s0, s1, r, g, b, life = 0.4, ground = 0) => spawn(x, y, z, 0, 0, 0, life, s0, s1, r, g, b, 0, ground ? 8 : 2);
export function boom(x, y, z, k = 1, r = 1, g = 0.55, b = 0.2) {
  flash(x, y + 0.5, z, 14 * k, r * 6, g * 6, b * 6, 0.22);
  spawn(x, y + 0.4, z, 0, 0, 0, 0.16, 1.2 * k, 5 * k, 6, 5, 4, 0, 0);
  spawn(x, y + 0.4, z, 0, 0, 0, 0.3, 3 * k, 4.4 * k, r * 3, g * 3, b * 3, 0, 4);
  ring(x, y + 0.15, z, 0.6 * k, 7 * k, r * 2, g * 2, b * 2, 0.4, 1);
  for (let i = 0; i < 14 * k; i++) { const a = rnd(TAU), s = rnd(2, 7) * k; spawn(x, y + 0.5, z, cos(a) * s, rnd(1, 6) * k, sin(a) * s, rnd(0.25, 0.6), 0.9 * k, 0.2, r * 4, g * 2.5, b * 1.5, 0, 0, 2.5, 3); }
  sparks(x, y + 0.5, z, 0, 0.6, 0, 16 * k, r, g * 0.8, b * 0.5, 16 * k, 0.6);
  smoke(x, y + 0.6, z, 7 * k, 1.1 * k, 0.16, 2.2, 1.4);
}
export function burst(x, y, z, n, r, g, b, s = 0.16, sp = 7, glow = 1) {
  for (let i = 0; i < n; i++) { const a = rnd(TAU), q = rnd(0.3, 1) * sp; debris(x, y, z, cos(a) * q, rnd(2, 8), sin(a) * q, s * rnd(0.6, 1.4), r, g, b, random() < glow ? 1 : 0); }
}

const mt = m4();
export function updateFx(dt, rdt) {
  // 粒子积分并写入实例缓冲
  let o = 0, w = 0;
  for (let i = 0; i < pn; i++, o += F) {
    const life = P[o + 6] - dt;
    if (life <= 0) continue;
    if (w != o) P.copyWithin(w, o, o + F);
    P[w + 6] = life;
    const d = exp(-P[w + 15] * dt);
    P[w + 3] *= d; P[w + 4] = P[w + 4] * d - P[w + 16] * dt; P[w + 5] *= d;
    P[w] += P[w + 3] * dt; P[w + 1] += P[w + 4] * dt; P[w + 2] += P[w + 5] * dt;
    w += F;
  }
  pn = w / F;
  let c = cnt.p;
  for (let i = 0, q = 0; i < pn && c < cnt.PMAX; i++, q += F, c++) {
    const k = P[q + 6] / P[q + 7], f = k < 0.7 ? k / 0.7 : 1, a = P[q + 13], b = c * 12, sh = P[q + 14];
    const fade = sh == 2 || sh == 8 ? k : f;
    pbuf[b] = P[q]; pbuf[b + 1] = P[q + 1]; pbuf[b + 2] = P[q + 2]; pbuf[b + 3] = P[q + 8] + (P[q + 9] - P[q + 8]) * (1 - k);
    pbuf[b + 4] = P[q + 10] * fade * (a ? a : 1); pbuf[b + 5] = P[q + 11] * fade * (a ? a : 1); pbuf[b + 6] = P[q + 12] * fade * (a ? a : 1); pbuf[b + 7] = a * fade;
    pbuf[b + 8] = sh == 1 ? P[q + 17] + k : 0; pbuf[b + 9] = sh;
  }
  cnt.p = c;
  // 光束
  c = cnt.t;
  for (let i = TR.length - 1; i >= 0; i--) {
    const t = TR[i]; t[10] -= rdt;
    if (t[10] <= 0) { TR.splice(i, 1); continue; }
    if (c >= cnt.TMAX) continue;
    const k = t[10] / t[11], b = c++ * 12;
    tbuf[b] = t[0]; tbuf[b + 1] = t[1]; tbuf[b + 2] = t[2]; tbuf[b + 3] = t[6] * (0.4 + 0.6 * k);
    tbuf[b + 4] = t[3]; tbuf[b + 5] = t[4]; tbuf[b + 6] = t[5];
    tbuf[b + 8] = t[7] * k; tbuf[b + 9] = t[8] * k; tbuf[b + 10] = t[9] * k; tbuf[b + 11] = t[12];
  }
  cnt.t = c;
  for (let i = FL.length - 1; i >= 0; i--) {
    const f = FL[i]; f[7] -= rdt;
    if (f[7] <= 0) { FL.splice(i, 1); continue; }
    const k = f[7] / f[8]; addLight(f[0], f[1], f[2], f[3], f[4] * k, f[5] * k, f[6] * k);
  }
  // 碎块：重力 + 地面弹跳
  for (let i = DB.length - 1; i >= 0; i--) {
    const d = DB[i]; d.life -= dt;
    if (d.life <= 0) { DB.splice(i, 1); continue; }
    d.vy -= 22 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.ax += d.wx * dt; d.ay += d.wy * dt;
    const h = groundH(d.x, d.z) + d.s * 0.5;
    if (d.y < h) { d.y = h; d.vy = -d.vy * 0.42; d.vx *= 0.6; d.vz *= 0.6; d.wx *= 0.5; d.wy *= 0.5; if (d.vy < 1) d.vy = 0; }
    const s = d.s * min(1, d.life / 0.35);
    ident(mt); translate(mt, d.x, d.y, d.z); rotY(mt, d.ay); rotX(mt, d.ax);
    if (d.kind == 2) scale(mt, s * 0.4, s, s * 0.4); else scale(mt, s, s, s);
    draw(d.kind == 2 ? MC.shell : d.kind ? MC.cubeE : MC.cube, mt, d.r, d.g, d.b, 0);
  }
  for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.t += rdt; t.y += t.vy * rdt; t.vy *= 0.94; if (t.t > t.life) texts.splice(i, 1); }
}
export function clearFx() { pn = 0; TR.length = FL.length = DB.length = texts.length = 0; }
