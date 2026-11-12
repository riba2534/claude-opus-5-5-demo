// 世界生成：地形高度场、分区、城市布局、碰撞体与射线检测（全部由种子随机数程序化生成）
import { rng, fbm, smooth, sat, hypot, abs, min, max, cos, sin, floor, sqrt, pow, PI, TAU, T, atan2, sign, clamp } from './math.js';
import { Geo, BOX, CYL, CYL8, SPH, SPL, CONE, rbox, cyl, lathe, normals, mixc } from './geo.js';
import { staticMesh, groundMesh, signMesh, mesh, setSignAtlas, facadeMesh, foliageMesh, grassField } from './gfx.js';
import { makeAtlas, R, AS } from './signs.js';
import { building, newFac, sidewalks, sidewalkH, car, trafficLight, busStop, bin, hydrant, bollard, cone, roadSign, utilBox } from './city.js';
import { tree, bush, newFol, leafAtlas, grassTex } from './flora.js';

export const PLAZA = 26, RING = 78, ARENA = 124;
const N = 257, SZ = 512, CS = SZ / (N - 1), HF = new Float32Array(N * N);
export const cols = [], ramps = [], tops = [];
export const W = { tl: [], bikes: [], jets: [], sak: [] }; // 需要每帧绘制/驱动的动态部件

// 分区：0 城区 1 公园 2 滑板公园 3 货柜场 4 森林 5 外环城区 6 场外
export function zone(x, z) {
  const r = hypot(x, z);
  if (r > ARENA) return 6;
  const sx = x > 0, sz = z > 0;
  if (r < RING) return sx ? (sz ? 0 : 3) : sz ? 1 : 2;
  return sx == sz ? 4 : 5;
}
const dRoad = (x, z) => min(abs(x), abs(z), abs(hypot(x, z) - RING));
function rawH(x, z) {
  const r = hypot(x, z), d = dRoad(x, z), zn = zone(x, z);
  let h = 0;
  if (zn == 1) h = 3 * smooth(7.5, 22, d) * smooth(PLAZA + 2, PLAZA + 16, r) * fbm(x * 0.045 + 3, z * 0.045 + 7);
  else if (zn == 4) h = 3.6 * smooth(7.5, 22, d) * smooth(ARENA - 1, ARENA - 12, r) * fbm(x * 0.04 + 11, z * 0.04 + 5);
  if (r > ARENA + 2) h += pow(sat((r - ARENA - 2) / 130), 1.3) * 46 * (0.45 + fbm(x * 0.012 + 40, z * 0.012 + 40));
  return h;
}
export function terrH(x, z) {
  const u = clamp((x + SZ / 2) / CS, 0, N - 1.001), v = clamp((z + SZ / 2) / CS, 0, N - 1.001), i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N + i;
  return (HF[o] * (1 - fu) + HF[o + 1] * fu) * (1 - fv) + (HF[o + N] * (1 - fu) + HF[o + N + 1] * fu) * fv;
}
const inBox = (c, x, z) => { const dx = x - c.x, dz = z - c.z; return abs(dx * c.c - dz * c.s) < c.hx && abs(dx * c.s + dz * c.c) < c.hz; };
// 地面高度：地形 + 人行道 + 坡道；传入 y 时还包含可骑行的平台顶面（脚已高于顶面才算）
export function groundH(x, z, y) {
  let h = terrH(x, z) + sidewalkH(x, z);
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z, l = dx * r.s + dz * r.c;
    if (l > 0 && l < r.len && abs(dx * r.c - dz * r.s) < r.w) { const q = r.f(l); if (q > h) h = q; }
  }
  if (y !== undefined) for (const c of tops) if (y >= c.y1 - 0.45 && c.y1 > h && inBox(c, x, z)) h = c.y1;
  return h;
}
// 圆（x,z,r）在高度 y 处与碰撞体求交并推出；o 的 x/z 被修改，nx/nz 为最后一次接触法线
export function resolve(o, r, y, hgt = 1.2) {
  let hit = 0;
  for (const c of cols) {
    if (y >= c.y1 - (c.top ? 0.45 : 0.05) || y + hgt < c.y0) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    if (c.t == 0) {
      const rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = sqrt(d2) || 1e-3; o.nx = dx / d; o.nz = dz / d; o.x = c.x + o.nx * rr; o.z = c.z + o.nz * rr; hit = 1; }
    } else {
      if (abs(dx) > c.br + r || abs(dz) > c.br + r) continue;
      const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c, ex = lx - clamp(lx, -c.hx, c.hx), ez = lz - clamp(lz, -c.hz, c.hz), d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      let nx, nz, pen;
      if (d2 > 1e-8) { const d = sqrt(d2); nx = ex / d; nz = ez / d; pen = r - d; }
      else { const px = c.hx - abs(lx), pz = c.hz - abs(lz); if (px < pz) { nx = sign(lx) || 1; nz = 0; pen = px + r; } else { nx = 0; nz = sign(lz) || 1; pen = pz + r; } }
      o.nx = nx * c.c + nz * c.s; o.nz = -nx * c.s + nz * c.c; o.x += o.nx * pen; o.z += o.nz * pen; hit = 1;
    }
  }
  const rr = hypot(o.x, o.z);
  if (rr > ARENA - 1.2 - r) { o.nx = -o.x / rr; o.nz = -o.z / rr; const k = (ARENA - 1.2 - r) / rr; o.x *= k; o.z *= k; hit = 1; }
  return hit;
}
export const blocked = (x, z, r, y = 0) => { const o = { x, z }; return resolve(o, r, y); };
// 射线与世界求交，返回命中距离（未命中返回 maxD），法线写入 rayN
export const rayN = [0, 1, 0];
export function raycast(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD;
  for (const c of cols) {
    const fx = ox - c.x, fz = oz - c.z;
    if (c.t == 0) {
      const a = dx * dx + dz * dz; if (a < 1e-8) continue;
      const b = fx * dx + fz * dz, disc = b * b - a * (fx * fx + fz * fz - c.r * c.r); if (disc < 0) continue;
      const t = (-b - sqrt(disc)) / a, y = oy + dy * t;
      if (t > 0 && t < best && y >= c.y0 && y <= c.y1) { best = t; rayN[0] = (fx + dx * t) / c.r; rayN[1] = 0; rayN[2] = (fz + dz * t) / c.r; }
    } else {
      const o3 = [fx * c.c - fz * c.s, oy, fx * c.s + fz * c.c], d3 = [dx * c.c - dz * c.s, dy, dx * c.s + dz * c.c], lo = [-c.hx, c.y0, -c.hz], hi = [c.hx, c.y1, c.hz];
      let t0 = 0, t1 = best, ax = -1, sg = 0, ok = 1;
      for (let k = 0; k < 3 && ok; k++) {
        if (abs(d3[k]) < 1e-9) { if (o3[k] < lo[k] || o3[k] > hi[k]) ok = 0; continue; }
        let a = (lo[k] - o3[k]) / d3[k], b = (hi[k] - o3[k]) / d3[k], s = -1;
        if (a > b) { const q = a; a = b; b = q; s = 1; }
        if (a > t0) { t0 = a; ax = k; sg = s; }
        if (b < t1) t1 = b;
        if (t0 > t1) ok = 0;
      }
      if (ok && ax >= 0) { best = t0; const nx = ax == 0 ? sg : 0, nz = ax == 2 ? sg : 0; rayN[0] = nx * c.c + nz * c.s; rayN[1] = ax == 1 ? sg : 0; rayN[2] = -nx * c.s + nz * c.c; }
    }
  }
  // 地形与坡道：步进 + 二分
  for (let t = 1.5, p = 0; p < best; p = t, t += 1.5) {
    const tt = min(t, best), y = oy + dy * tt;
    if (y > 70 && dy >= 0) break;
    if (y < groundH(ox + dx * tt, oz + dz * tt)) {
      let a = p, b = tt;
      for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (oy + dy * m < groundH(ox + dx * m, oz + dz * m)) b = m; else a = m; }
      best = a; rayN[0] = 0; rayN[1] = 1; rayN[2] = 0; break;
    }
  }
  return best;
}

// ---------- 建造 ----------
const ACC = [0x1f6bff, 0xff5a7a, 0x18c08a, 0xffb020, 0x7a5cff, 0x19b8d8];
const CONT = [0x2f6fc4, 0xc4452f, 0x2f9a6c, 0xd9a21f, 0x7a62c9, 0xd8d4c8, 0x2a8fa3, 0x8c3b2a];
export function buildWorld(seed, img) {
  const R0 = rng(seed), rr = (a, b) => a + R0() * (b - a), pk = a => a[(R0() * a.length) | 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) HF[j * N + i] = rawH(-SZ / 2 + i * CS, -SZ / 2 + j * CS);
  const geos = new Map(), fols = new Map(), signs = [], F = newFac(), FF = newFac(), CELL = 40;
  const cell = (x, z) => floor((x + 280) / CELL) + floor((z + 280) / CELL) * 64;
  const FLc = (x, z) => { const k = cell(x, z); let f = fols.get(k); if (!f) fols.set(k, (f = newFol())); return f; };
  // 静态几何按 40 米的格子分块（每块一个网格），这样主视角、阴影和画中画三个通道都能剔除掉看不到的部分
  const G = (x, z) => { const k = cell(x, z); let g = geos.get(k); if (!g) geos.set(k, (g = new Geo())); return g; };
  const circ = (x, z, r, y1, y0 = 0) => cols.push({ t: 0, x, z, r, y0, y1 });
  const obb = (x, z, hx, hz, rot, y1, y0 = 0, top = 0) => { const c = { t: 1, x, z, hx, hz, c: cos(rot), s: sin(rot), y0, y1, top, br: hypot(hx, hz) }; cols.push(c); if (top) tops.push(c); return c; };
  const sign = (x, y, z, rot, w, h, r) => signs.push({ m: T(x, y, z, 0, rot, 0, w, h, 1), r });
  const RB = {}, rb = (hx, hy, hz, r) => RB[[hx, hy, hz, r]] || (RB[[hx, hy, hz, r]] = rbox(hx, hy, hz, r, 2));
  const C = { F, G, obb, circ, sign, R0, R }, CF = { ...C, F: FF };

  // --- 建筑：内城混合住宅/商业/写字楼，外环高层，远景天际线 ---
  [[21, 43, 13, 12.5, 26, 1], [43, 21, 14, 12, 19, 4], [43, 43, 13.5, 13.5, 30, 2], [21, 65, 13, 12, 23, 1], [65, 21, 12.5, 13, 27, 1]]
    .forEach(([x, z, w, d, h, st]) => building(C, x, z, w, d, h, pk([0, PI / 2, PI, -PI / 2]), st));
  for (const q of [0, 1]) for (let i = 0; i < 6; i++) {
    const a = (q ? -PI / 2 : PI / 2) + 0.24 + (i / 5) * (PI / 2 - 0.48), r = i % 2 ? 110 : 97.5, x = cos(a) * r, z = sin(a) * r, st = [3, 1, 2, 3, 1, 2][(i + q) % 6];
    building(C, x, z, rr(11.5, 13.5), rr(10.5, 12), st == 3 ? rr(42, 62) : rr(22, 38), -PI / 2 - a, st);
  }
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * TAU + rr(-0.05, 0.05), r = rr(150, 232), x = cos(a) * r, z = sin(a) * r, st = pk([3, 3, 2, 1, 2]);
    const w = rr(14, 26), d = rr(14, 26), y0 = terrH(x, z) - 6, hh = building(CF, x, z, w, d, rr(30, 100), a, st, 1, y0);
    if (R0() < 0.55) { const h2 = building(CF, x, z, w * 0.62, d * 0.62, rr(12, 24), a, st, 1, y0 + hh); if (R0() < 0.5) building(CF, x, z, w * 0.3, d * 0.3, rr(8, 14), a, st, 1, y0 + hh + h2); }
  }
  sidewalks(C);

  // --- 树、灌木、石头 ---
  for (let i = 0, n = 0; i < 4000 && n < 150; i++) {
    const a = R0() * TAU, r = rr(30, ARENA - 4), x = cos(a) * r, z = sin(a) * r, zn = zone(x, z);
    if ((zn != 1 && zn != 4) || dRoad(x, z) < 9 || fbm(x * 0.05 + 80, z * 0.05) < 0.42 || blocked(x, z, 2.4)) continue;
    const kind = zn == 1 ? (R0() < 0.42 ? 1 : 0) : R0() < 0.45 ? 2 : 0, s = rr(0.9, 1.3), y = terrH(x, z);
    circ(x, z, 0.3 * s, tree(G(x, z), FLc(x, z), R0, x, y, z, s, kind)); n++;
    if (kind == 1) W.sak.push([x, y + 5 * s, z]);
  }
  for (let i = 0; i < 130; i++) { const a = R0() * TAU, r = i < 70 ? rr(ARENA + 5, ARENA + 22) : rr(ARENA + 14, 172), x = cos(a) * r, z = sin(a) * r; tree(G(x, z), FLc(x, z), R0, x, terrH(x, z), z, rr(1.3, 2.1), R0() < 0.45 ? 2 : 0, 1); }
  // 行道树：沿十字路人行道外侧
  for (let k = 0; k < 4; k++) for (const lon of [39, 53, 67, 95, 109]) for (const sd of [-1, 1]) {
    const a = (k * PI) / 2, x = sin(a) * lon + cos(a) * sd * 7.9, z = cos(a) * lon - sin(a) * sd * 7.9;
    if (blocked(x, z, 1.2)) continue;
    const s = rr(0.8, 1); circ(x, z, 0.28, tree(G(x, z), FLc(x, z), R0, x, terrH(x, z), z, s, 0, 0, 1));
    G(x, z).m(4, 0.2).add(cyl(0.212 * s, 0.168 * s, 1.15, 10), T(x, 0, z), 0xe9e7e0, 0, 0.2).m(0);
    G(x, z).m(11, 0.3).add(BOX, T(x, 0.03, z, 0, a, 0, 1.3, 0.06, 1.3), 0x8a8780, 0, 0.3).m(0);
  }
  for (let i = 0, n = 0; i < 1500 && n < 90; i++) {
    const a = R0() * TAU, r = rr(29, ARENA - 3), x = cos(a) * r, z = sin(a) * r, zn = zone(x, z);
    if ((zn != 1 && zn != 4) || dRoad(x, z) < 7.6 || blocked(x, z, 0.9)) continue;
    const g = G(x, z), y = terrH(x, z), s = rr(0.35, 0.8); n++;
    if (R0() < 0.3) { g.m(2, 0.9).add(SPL, T(x, y + s * 0.15, z, rr(0, 1), rr(0, 6), 0, s * 1.3, s * 0.75, s), 0x9a9a96, 0, 0.2).m(0); if (s > 0.6) circ(x, z, s * 0.8, y + s * 0.8); }
    else bush(FLc(x, z), R0, x, y, z, s * 1.3, s * 1.5, R0() < 0.5);
  }

  // --- 路灯（位置与着色器里的解析灯光池一致）---
  function lamp(x, z, a) {
    const g = G(x, z), c = cos(a), s = sin(a);
    g.m(7, 0.15).add(CYL8, T(x, 0, z, 0, 0, 0, 0.085, 5.3, 0.065), 0x4a505a, 0, 0.6);
    g.add(CYL8, T(x, 0, z, 0, 0, 0, 0.16, 0.6, 0.13), 0x4a505a, 0, 0.5);
    g.add(BOX, T(x + c * 0.7, 5.3, z + s * 0.7, 0, -a, 0.08, 1.7, 0.08, 0.1), 0x4a505a, 0, 0.6);
    g.m(0).add(rb(0.5, 0.5, 0.5, 0.2), T(x + c * 1.45, 5.3, z + s * 1.45, 0, -a, 0, 0.8, 0.16, 0.34), 0xd9dde2, 0, 0.6);
    g.add(BOX, T(x + c * 1.45, 5.21, z + s * 1.45, 0, -a, 0, 0.62, 0.04, 0.24), 0xffe2b0, 1, 0.5, 2);
    circ(x, z, 0.17, 5.3);
  }
  for (let k = 0; k < 4; k++) for (const lon of [32, 46, 60, 88, 102, 116]) for (const sd of [-1, 1]) {
    const a = (k * PI) / 2, c = cos(a), s = sin(a);
    lamp(c * lon - s * sd * 6.4, s * lon + c * sd * 6.4, atan2(-c * sd, s * sd));
  }
  for (let k = 0; k < 32; k++) if (k % 8) for (const sd of [-1, 1]) { const a = (k / 32) * TAU; lamp(cos(a) * (RING + sd * 6.4), sin(a) * (RING + sd * 6.4), a + (sd > 0 ? PI : 0)); }

  // --- 中心广场：纪念碑、喷泉水池、花坛、长椅、小卖部 ---
  {
    const g = G(0.1, 0.1);
    g.m(11, 0.3).add(lathe([[0, 0], [3.4, 0], [3.4, 0], [3.4, 0.5], [3.4, 0.5], [2.7, 0.5], [2.7, 0.5], [2.7, 0.9], [2.7, 0.9], [2.1, 0.9], [2.1, 0.9], [2.1, 1.2], [2.1, 1.2], [0, 1.2]], 40), null, 0xd9d6cf, 0, 0.45);
    g.m(7, 0.1).add(lathe([[0.9, 1.2], [0.6, 1.6], [0.45, 3.2], [0.6, 4.6], [1.0, 5.0], [1.0, 5.0], [0, 5.0]], 20), null, 0x2a62d9, 0, 0.8);
    // 喷泉：环形水池 + 池沿
    g.m(11, 0.3).add(lathe([[6.4, 0], [6.9, 0], [6.9, 0], [6.9, 0.5], [6.9, 0.5], [6.4, 0.5], [6.4, 0.5], [6.4, 0]], 48), null, 0xcfcbc2, 0, 0.45);
    g.m(0).add(lathe([[3.4, 0.32], [6.4, 0.32]], 48), null, 0x1d4a66, 0, 0.99);
    g.add(lathe([[3.42, 0.34], [3.42, 0.4], [3.5, 0.4]], 40), null, 0x7fc4ff, 1, 0.5, 2);
    circ(0, 0, 6.95, 0.55); circ(0, 0, 1.1, 9);
    for (let i = 0; i < 8; i++) W.jets.push([cos((i / 8) * TAU) * 5, 0.34, sin((i / 8) * TAU) * 5]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + PI / 8, x = cos(a) * 19, z = sin(a) * 19;
      g.m(11, 0.3).add(lathe([[0, 0], [1.25, 0], [1.25, 0], [1.4, 0.7], [1.4, 0.7], [1.15, 0.7], [1.15, 0.7], [1.15, 0.55], [1.15, 0.55], [0, 0.55]], 16), T(x, 0, z), 0xd4d0c8, 0, 0.4);
      g.m(13, 0.5).add(CYL, T(x, 0.5, z, 0, 0, 0, 1.15, 0.08, 1.15), 0x8a6a4a, 0, 0.1).m(0);
      bush(FLc(x, z), R0, x, 0.55, z, 1, 1.3, 1);
      circ(x, z, 1.4, 0.75);
      const b = a + PI / 8, bx = cos(b) * 22.5, bz = sin(b) * 22.5, ry = PI / 2 - b;
      if (abs(bx) > 7 && abs(bz) > 7) {
        g.m(8, 0.4).add(rb(0.5, 0.5, 0.5, 0.12), T(bx, 0.48, bz, 0, ry, 0, 2.2, 0.1, 0.6), 0xffffff, 0, 0.3);
        g.add(rb(0.5, 0.5, 0.5, 0.12), T(bx + cos(b) * 0.3, 0.8, bz + sin(b) * 0.3, 0.2, ry, 0, 2.2, 0.5, 0.08), 0xffffff, 0, 0.3);
        for (const e of [-0.9, 0.9]) g.m(7, 0.2).add(BOX, T(bx + cos(ry) * e, 0.22, bz - sin(ry) * e, 0, ry, 0, 0.08, 0.44, 0.5), 0x30343c, 0, 0.6);
        obb(bx, bz, 1.1, 0.35, ry, 0.85);
        bin(C, cos(b + 0.09) * 22.6, sin(b + 0.09) * 22.6);
      }
    }
    for (const [x, z, sg] of [[13.5, 20.5, R.shop], [-20.5, 13.5, R.fix], [-13.5, -20.5, R.go], [20.5, -13.5, R.bug]]) {
      const ry = atan2(-x, -z), c = cos(ry), s = sin(ry);
      g.m(7, 0.2).add(rb(1.5, 1.25, 1.1, 0.1), T(x, 1.25, z, 0, ry), 0xe9e6de, 0, 0.4);
      g.m(0).add(rb(1.75, 0.08, 1.5, 0.06), T(x + s * 0.3, 2.62, z + c * 0.3, 0.08, ry), pk(ACC), 0, 0.4);
      g.add(BOX, T(x + s * 1.11, 1.5, z + c * 1.11, 0, ry, 0, 2.2, 1.0, 0.04), 0x16202c, 0.3, 0.95, 2);
      g.m(8, 0.4).add(rb(1.6, 0.05, 0.3, 0.04), T(x + s * 1.3, 0.95, z + c * 1.3, 0, ry), 0xffffff, 0, 0.4);
      sign(x + s * 1.14, 3.2, z + c * 1.14, ry, 2.8, 1.05, sg);
      g.m(7, 0.2).add(BOX, T(x + s * 1.1, 3.2, z + c * 1.1, 0, ry, 0, 2.95, 1.2, 0.06), 0x1a1d26, 0, 0.5).m(0);
      obb(x, z, 1.55, 1.2, ry, 2.7);
    }
    // 广场上的共享单车停放点
    for (const [a0, tint] of [[0.5, [1.5, 1.4, 0.25]], [3.64, [0.5, 1.5, 0.6]]]) {
      for (let i = 0; i < 6; i++) { const a = a0 + i * 0.03, x = cos(a) * 22.6, z = sin(a) * 22.6; W.bikes.push([x, z, PI / 2 - a + PI + 0.25, 0.14, ...tint]); }
      obb(cos(a0 + 0.075) * 22.6, sin(a0 + 0.075) * 22.6, 0.75, 1.9, PI / 2 - a0 - 0.075 + PI / 2, 1.0);
    }
  }
  // 纪念碑顶的旋转对话气泡（动态绘制）
  {
    const g = new Geo();
    g.add(rb(2.5, 1.9, 0.32, 0.32), T(0, 0, 0), 0xffffff, 0.08, 0.75);
    g.add(CONE, T(-1.1, -1.75, 0, 0, 0, 2.6, 0.5, 1.2, 0.3), 0xffffff, 0.08, 0.75);
    g.add(rb(2.62, 2.02, 0.2, 0.2), T(0, 0, 0), 0x1f6bff, 0.25, 0.6);
    W.bubble = mesh(g);
    W.bubbleSign = signMesh([{ m: T(-1.05, 0, 0.34, 0, 0, 0, 2.6, 2.6, 1), r: R.avatar }, { m: T(1.3, 0.35, 0.34, 0, 0, 0, 1.9, 0.95, 1), r: R.word },
    { m: T(1.05, 0, -0.34, 0, PI, 0, 2.6, 2.6, 1), r: R.avatar }, { m: T(-1.3, 0.35, -0.34, 0, PI, 0, 1.9, 0.95, 1), r: R.word }], AS);
  }

  // --- 广告牌 ---
  function board(x, z, ry, sg, w = 6) {
    const g = G(x, z), h = (w * sg[3]) / sg[2], c = cos(ry), s = sin(ry);
    g.m(7, 0.2);
    for (const e of [-w / 2 + 0.4, w / 2 - 0.4]) { g.add(CYL8, T(x + c * e, 0, z - s * e, 0, 0, 0, 0.13, 4.2, 0.13), 0x4a505a, 0, 0.6); circ(x + c * e, z - s * e, 0.2, 4.2 + h); }
    g.add(BOX, T(x, 4.2 + h / 2, z, 0, ry, 0, w + 0.3, h + 0.3, 0.2), 0x23262e, 0, 0.5).m(0);
    sign(x + s * 0.12, 4.2 + h / 2, z + c * 0.12, ry, w, h, sg); sign(x - s * 0.12, 4.2 + h / 2, z - c * 0.12, ry + PI, w, h, sg);
  }
  [[10.5, 52, PI / 2, R.hello, 7], [-10.5, -52, -PI / 2, R.zero, 6], [52, -10.5, PI, R.think, 5], [-52, 10.5, 0, R.ask, 6], [63.6, 63.6, -PI * 0.75, R.avatar, 4.2], [-63.6, -63.6, PI * 0.25, R.avatar, 4.2],
  [-62, 58, PI * 0.75, R.word, 5], [10.5, -96, -PI / 2, R.word, 5], [-96, -10.5, 0, R.bug, 6], [96, 10.5, PI, R.avatar, 4], [-10.5, 96, PI / 2, R.hello, 7]].forEach(b => board(...b));

  // --- 货柜场 ---
  function cont(x, z, ry, lv = 1) {
    const g = G(x, z);
    for (let i = 0; i < lv; i++) {
      const col = pk(CONT), y = 1.3 + i * 2.6;
      g.m(6, 0.5).add(BOX, T(x, y, z, 0, ry, 0, 2.44, 2.6, 6.1), col, 0, 0.45);
      g.m(7, 0.3); for (const e of [-1, 1]) for (const f of [-1, 1]) g.add(BOX, T(x + (cos(ry) * e * 1.19 + sin(ry) * f * 3.02), y, z + (-sin(ry) * e * 1.19 + cos(ry) * f * 3.02), 0, ry, 0, 0.14, 2.64, 0.14), mixc(col, 0x000000, 0.25), 0, 0.4);
      g.add(BOX, T(x + sin(ry) * 3.06, y, z + cos(ry) * 3.06, 0, ry, 0, 2.3, 2.4, 0.04), mixc(col, 0xffffff, 0.12), 0, 0.5);
      for (const e of [-0.5, 0.5]) g.add(CYL8, T(x + sin(ry) * 3.1 + cos(ry) * e, y - 1.1, z + cos(ry) * 3.1 - sin(ry) * e, 0, 0, 0, 0.025, 2.2, 0.025), 0xc9ccd0, 0, 0.7);
    }
    g.m(0);
    obb(x, z, 1.22, 3.05, ry, lv * 2.6, 0, 1);
  }
  for (const [x, z, ry, lv] of [[22, -24, 0, 1], [22, -31, 0, 2], [34, -22, PI / 2, 1], [44, -20, 0, 1], [47, -20, 0, 2], [33, -36, 0.5, 1], [22, -46, PI / 2, 1], [29, -46, PI / 2, 1],
  [44, -36, PI / 2, 2], [56, -33, 0, 1], [59, -33, 0, 1], [36, -52, 0, 1], [48, -50, 0.3, 1], [22, -60, 0, 2], [58, -18, PI / 2, 1]]) cont(x, z, ry, lv);
  for (let i = 0, n = 0; i < 400 && n < 22; i++) { // 木箱、油桶、锥桶
    const x = rr(14, 66), z = rr(-66, -14);
    if (zone(x, z) != 3 || dRoad(x, z) < 8.5 || blocked(x, z, 1.4)) continue;
    const g = G(x, z), k = R0(); n++;
    if (k < 0.4) { const s = rr(0.5, 0.75), ry = rr(0, 3); g.m(8, 0.5).add(rb(1, 1, 1, 0.04), T(x, s, z, 0, ry, 0, s), 0xffffff, 0, 0.2).m(0); obb(x, z, s, s, ry, s * 2, 0, 1); }
    else if (k < 0.75) { g.m(7, 0.3).add(CYL, T(x, 0, z, 0, 0, 0, 0.42, 1.15, 0.42), pk([0xc43a2f, 0x2f62c4, 0xd9a21f]), 0, 0.6); g.add(CYL, T(x, 1.15, z, 0, 0, 0, 0.36, 0.03, 0.36), 0x30343c, 0, 0.6).m(0); circ(x, z, 0.42, 1.15); }
    else for (let q = 0; q < 3; q++) cone(C, x + rr(-1.5, 1.5), z + rr(-1.5, 1.5));
  }

  // --- 坡道 ---
  function ramp(x, z, yaw, len, w, h, table) {
    const a = table ? (len - 2.4) / 2 : len, f = table ? l => h * pow(sat(min(l, len - l) / a), 1.5) : l => h * pow(l / len, 1.5);
    ramps.push({ x, z, s: sin(yaw), c: cos(yaw), len, w, f });
    const p = [], idx = [], ps = [], is = [], pb = [], ib = [], pe = [], ie = [], n = 14;
    const quad = (P, I, a, b, c, d) => { const o = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    for (let i = 0; i < n; i++) {
      const l0 = (i / n) * len, l1 = ((i + 1) / n) * len, h0 = f(l0), h1 = f(l1);
      const e = w - 0.28, P = i % 2 ? pb : p;
      quad(P, i % 2 ? ib : idx, [-e, h0, l0], [-e, h1, l1], [e, h1, l1], [e, h0, l0]);
      for (const s of [-1, 1]) quad(pe, ie, [s < 0 ? -w : e, h0, l0], [s < 0 ? -w : e, h1, l1], [s < 0 ? -e : w, h1, l1], [s < 0 ? -e : w, h0, l0]);
      quad(ps, is, [w, 0, l0], [w, h0, l0], [w, h1, l1], [w, 0, l1]);
      quad(ps, is, [-w, 0, l0], [-w, 0, l1], [-w, h1, l1], [-w, h0, l0]);
    }
    if (!table) quad(ps, is, [-w, 0, len], [w, 0, len], [w, h, len], [-w, h, len]);
    const g = G(x, z), m = T(x, 0.01, z, 0, yaw);
    g.m(8, 0.5).add({ p, n: normals(p, idx), i: idx }, m, 0xffffff, 0, 0.3); g.add({ p: pb, n: normals(pb, ib), i: ib }, m, 0xe6d6bd, 0, 0.3);
    g.m(7, 0.3).add({ p: pe, n: normals(pe, ie), i: ie }, m, 0xd9a52a, 0, 0.5); g.m(7, 0.3).add({ p: ps, n: normals(ps, is), i: is }, m, 0x565c68, 0, 0.5).m(0);
  }
  for (let k = 0; k < 4; k++) { const a = (k * PI) / 2; ramp(sin(a) * 44, cos(a) * 44, a, 13, 2.3, 1.25, 1); ramp(sin(a) * 96, cos(a) * 96, a, 13, 2.3, 1.25, 1); }
  for (let k = 0; k < 4; k++) { const a = PI / 4 + (k * PI) / 2; ramp(cos(a) * RING + sin(a) * 6, sin(a) * RING - cos(a) * 6, -a, 12, 2.3, 1.2, 1); }
  // 滑板公园：单向起跳台、可骑上的平台、矮栏杆
  [[-30, -30, -2.3, 7, 2.6, 1.7], [-52, -24, 1.2, 6.5, 2.4, 1.5], [-24, -52, 0.3, 6.5, 2.4, 1.5], [-46, -46, 2.4, 8, 3, 2.1], [-60, -40, -0.6, 6, 2.2, 1.3], [-38, -62, -1.9, 6, 2.2, 1.3]].forEach(r => ramp(...r));
  for (const [x, z, hx, hz, ry, h] of [[-40, -34, 3.5, 2.5, 0.4, 1], [-28, -42, 2.5, 4, -0.2, 1.1], [-52, -54, 4, 3, 0.9, 1], [-36, -50, 2, 2, 0.2, 2.1]]) {
    const g = G(x, z);
    g.m(2, 0.3).add(BOX, T(x, h / 2, z, 0, ry, 0, hx * 2, h, hz * 2), 0xd4d1ca, 0, 0.35);
    g.m(7, 0.2).add(BOX, T(x, h - 0.04, z, 0, ry, 0, hx * 2 + 0.06, 0.1, hz * 2 + 0.06), pk(ACC), 0, 0.5).m(0);
    obb(x, z, hx, hz, ry, h, 0, 1);
  }
  for (const [x, z, ry, l] of [[-22, -34, 0.8, 7], [-56, -30, -0.3, 6], [-44, -24, 1.5, 6]]) {
    const g = G(x, z);
    g.m(7, 0.1).add(CYL8, T(x - sin(ry) * l / 2, 0.55, z - cos(ry) * l / 2, PI / 2, ry, 0, 0.05, l, 0.05), 0xc9ccd0, 0, 0.8);
    for (const e of [-0.45, 0, 0.45]) g.add(CYL8, T(x + sin(ry) * l * e, 0, z + cos(ry) * l * e, 0, 0, 0, 0.045, 0.55, 0.045), 0x4a505a, 0, 0.6);
    g.m(0); obb(x, z, 0.08, l / 2, ry, 0.6);
  }

  // --- 车辆 ---
  const park = (x, z, ry, k) => { if (!blocked(x, z, 2.4)) car(C, x, z, ry, k); };
  for (let i = 0; i < 5; i++) park(54.6, 28 + i * 3.1, PI / 2 + (R0() < 0.5 ? PI : 0), pk([0, 0, 1, 2, 0]));
  for (const [a, k, r] of [[0.42, 0, 68.6], [0.5, 3, 68.6], [0.98, 1, 68.6], [1.12, 0, 68.6], [-0.62, 3, 68.6], [-0.95, 0, 68.6], [-0.5, 2, 87.4], [-1.05, 0, 87.4], [2.2, 0, 87.4], [2.62, 1, 87.4]]) park(cos(a) * r, sin(a) * r, -a + (R0() < 0.5 ? PI : 0), k);
  park(9.3, 34, 0, 3); park(-9.3, -35, PI, 0); park(36, -9.3, PI / 2, 1); park(58, 9.3, PI / 2, 3);
  for (const [x, z, ry, k] of [[31, 31, 0, 0], [31, 56, PI / 2, 2], [53, 60, 0, 0], [16, -38, 0, 2], [52, -44, PI / 2, 2], [-100, 30, 0, 0], [-90, 44, PI / 2, 1], [-44, 92, 0, 0], [-30, 100, PI / 2, 3], [100, -32, 0, 0], [92, -46, PI / 2, 1], [40, -96, 0, 2], [30, -104, PI / 2, 0]]) park(x, z, ry, k);

  // --- 红绿灯、公交站、路牌、垃圾桶、消防栓、配电箱、快递柜 ---
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2, s = sin(a), c = cos(a);
    for (const [lo, sd] of [[71.4, 1], [84.6, -1]]) trafficLight(C, s * lo + c * sd * 6.3, c * lo - s * sd * 6.3, a + (sd > 0 ? -PI / 2 : PI / 2), W.tl);
    for (const sd of [-1, 1]) { hydrant(C, s * 36 + c * sd * 6.3, c * 36 - s * sd * 6.3); bin(C, s * 63 + c * sd * 6.3, c * 63 - s * sd * 6.3); bin(C, s * 99 + c * sd * 6.3, c * 99 - s * sd * 6.3); }
    roadSign(C, s * 33.5 + c * 6.3, c * 33.5 - s * 6.3, a + PI, 0); roadSign(C, s * 68 - c * 6.3, c * 68 + s * 6.3, a, 2); roadSign(C, s * 91 + c * 6.3, c * 91 - s * 6.3, a + PI, 1);
    utilBox(C, s * 57 - c * 7.6, c * 57 + s * 7.6, a + PI / 2, 0);
  }
  for (const a of [0.72, 2.3, -0.82, -2.42]) { const x = cos(a) * 84.1, z = sin(a) * 84.1, ry = atan2(-cos(a), -sin(a)); busStop(C, x, z, ry); bin(C, cos(a + 0.04) * 84.2, sin(a + 0.04) * 84.2); for (let i = 0; i < 5; i++) { const b = a - 0.045 - i * 0.0075; W.bikes.push([cos(b) * 84.3, sin(b) * 84.3, -b + PI / 2 + PI / 2, 0.14, ...(i % 2 ? [1.5, 1.4, 0.25] : [0.5, 1.5, 0.6])]); } obb(cos(a - 0.06) * 84.3, sin(a - 0.06) * 84.3, 1.7, 0.75, -a + 0.06, 1.0); }
  utilBox(C, 33, 14.5, 0, 1); utilBox(C, 14.5, 56, PI / 2, 1);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.31; if (min(abs(cos(a)), abs(sin(a))) * 25 > 7) bollard(C, cos(a) * 25.2, sin(a) * 25.2); }

  // --- 边界：能量塔 + 能量墙 ---
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU, x = cos(a) * (ARENA + 0.6), z = sin(a) * (ARENA + 0.6), g = G(x * 0.98, z * 0.98);
    g.m(7, 0.3).add(lathe([[0, 0], [0.7, 0], [0.7, 0], [0.5, 0.6], [0.32, 6.4], [0.5, 6.8], [0.5, 6.8], [0, 6.8]], 6), T(x, terrH(x, z) - 0.2, z, 0, -a), 0x6b7380, 0, 0.6);
    g.m(0).add(SPL, T(x, terrH(x, z) + 7, z, 0, 0, 0, 0.36), 0x59b6ff, 1, 0.6);
  }
  {
    const g = new Geo(), wall = { p: [], n: [], i: [] }, n = 96;
    for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, c = cos(a), s = sin(a); for (const y of [0, 7]) { wall.p.push(c * (ARENA + 0.6), y, s * (ARENA + 0.6)); wall.n.push(-c, 0, -s); } }
    for (let i = 0; i < n; i++) wall.i.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    g.add(wall, null, (x, y) => (y > 3 ? 0x04101e : 0x3f9dff));
    W.wall = mesh(g, 1, 1);
  }
  geos.forEach(g => staticMesh(g));
  facadeMesh(F); facadeMesh(FF);
  { const la = leafAtlas(R0); fols.forEach(f => foliageMesh(f, la)); }
  grassField(grassTex(R0), HF, N);
  // --- 地形网格：按 64 米一块拆开 ---
  {
    const H = (i, j) => HF[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)], CH = 32, W1 = CH + 1;
    for (let cj = 0; cj < N - 1; cj += CH) for (let ci = 0; ci < N - 1; ci += CH) {
      const p = [], nn = [], idx = [];
      for (let j = 0; j <= CH; j++) for (let i = 0; i <= CH; i++) {
        const I = ci + i, J = cj + j, nx = H(I - 1, J) - H(I + 1, J), nz = H(I, J - 1) - H(I, J + 1), l = hypot(nx, 2 * CS, nz);
        p.push(-SZ / 2 + I * CS, HF[J * N + I], -SZ / 2 + J * CS); nn.push(nx / l, (2 * CS) / l, nz / l);
      }
      for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) { const a = j * W1 + i; idx.push(a, a + W1, a + 1, a + 1, a + W1, a + W1 + 1); }
      groundMesh(p, nn, idx);
    }
  }
  setSignAtlas(makeAtlas(img));
  signMesh(signs, AS);
}
// 随机找一个离 (px,pz) 距离在 [d0,d1] 内、场内且不被遮挡的落点
export function findSpot(px, pz, d0, d1, r = 1.2) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * TAU, d = d0 + Math.random() * (d1 - d0), x = px + cos(a) * d, z = pz + sin(a) * d;
    if (hypot(x, z) < ARENA - 6 && !blocked(x, z, r)) return [x, z];
  }
  const a = Math.random() * TAU;
  return [cos(a) * 60, sin(a) * 60];
}
