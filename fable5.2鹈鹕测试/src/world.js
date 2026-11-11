// 世界生成：地形高度场、分区、建筑/植被/路灯/货柜/坡道、碰撞体与射线检测（全部由种子随机数程序化生成）
import { rng, fbm, smooth, sat, hypot, abs, min, max, cos, sin, floor, sqrt, pow, PI, TAU, T, atan2, sign, clamp } from './math.js';
import { Geo, BOX, CYL, CYL8, SPH, SPL, CONE, rbox, cyl, lathe, normals, mixc } from './geo.js';
import { staticMesh, groundMesh, signMesh, mesh, setSignAtlas } from './gfx.js';
import { makeAtlas, R, AS } from './signs.js';

export const PLAZA = 26, RING = 78, ARENA = 124;
const N = 257, SZ = 512, CS = SZ / (N - 1), HF = new Float32Array(N * N);
export const cols = [], ramps = [], tops = [];
export const W = {}; // 需要每帧绘制的动态部件

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
  if (zn == 1) h = 3 * smooth(7, 22, d) * smooth(PLAZA + 2, PLAZA + 16, r) * fbm(x * 0.045 + 3, z * 0.045 + 7);
  else if (zn == 4) h = 3.6 * smooth(7, 22, d) * smooth(ARENA - 1, ARENA - 12, r) * fbm(x * 0.04 + 11, z * 0.04 + 5);
  if (r > ARENA + 2) h += pow(sat((r - ARENA - 2) / 130), 1.3) * 46 * (0.45 + fbm(x * 0.012 + 40, z * 0.012 + 40));
  return h;
}
export function terrH(x, z) {
  const u = clamp((x + SZ / 2) / CS, 0, N - 1.001), v = clamp((z + SZ / 2) / CS, 0, N - 1.001), i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N + i;
  return (HF[o] * (1 - fu) + HF[o + 1] * fu) * (1 - fv) + (HF[o + N] * (1 - fu) + HF[o + N + 1] * fu) * fv;
}
const inBox = (c, x, z) => { const dx = x - c.x, dz = z - c.z; return abs(dx * c.c - dz * c.s) < c.hx && abs(dx * c.s + dz * c.c) < c.hz; };
// 地面高度：地形 + 坡道；传入 y 时还包含可骑行的平台顶面（脚已高于顶面才算）
export function groundH(x, z, y) {
  let h = terrH(x, z);
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
const PAL = [0xf2e6d8, 0xcfe3f7, 0xf6d3cc, 0xd3ebd2, 0xe6dcf5, 0xffe7b3, 0xdde5ee, 0xfbd9b5];
const ACC = [0x1f6bff, 0xff5a7a, 0x18c08a, 0xffb020, 0x7a5cff, 0x19b8d8];
const CONT = [0x4f9dff, 0xff7d6b, 0x3fc79a, 0xffc94d, 0x9a82ff, 0xf5f1e8, 0x37b6c9];
export function buildWorld(seed = 4207) {
  const R0 = rng(seed), rr = (a, b) => a + R0() * (b - a), pk = a => a[(R0() * a.length) | 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) HF[j * N + i] = rawH(-SZ / 2 + i * CS, -SZ / 2 + j * CS);
  const geos = [], signs = [];
  const G = (x, z) => { const r = hypot(x, z), k = (((atan2(z, x) + PI) / TAU) * 6 | 0) % 6 + (r > RING ? 6 : 0) + (r > ARENA + 6 ? 6 : 0); return geos[k] || (geos[k] = new Geo()); };
  const circ = (x, z, r, y1, y0 = 0) => cols.push({ t: 0, x, z, r, y0, y1 });
  const obb = (x, z, hx, hz, rot, y1, y0 = 0, top = 0) => { const c = { t: 1, x, z, hx, hz, c: cos(rot), s: sin(rot), y0, y1, top, br: hypot(hx, hz) }; cols.push(c); if (top) tops.push(c); return c; };
  const sign = (x, y, z, rot, w, h, r) => signs.push({ m: T(x, y, z, 0, rot, 0, w, h, 1), r });
  const RB = {}, rb = (hx, hy, hz, r) => RB[[hx, hy, hz, r]] || (RB[[hx, hy, hz, r]] = rbox(hx, hy, hz, r, 2));

  // --- 建筑 ---
  function bld(x, z, w, d, h, rot, far) {
    const g = G(x, z), col = pk(PAL), acc = pk(ACC), y0 = far ? terrH(x, z) - 6 : 0;
    g.add(BOX, T(x, y0 + h / 2, z, 0, rot, 0, w, h, d), col, 0, 0.25, 1);
    if (far) return;
    obb(x, z, w / 2, d / 2, rot, h);
    // 底层商铺：深色玻璃 + 夜间暖光 + 彩色雨棚
    g.add(BOX, T(x, 1.7, z, 0, rot, 0, w + 0.16, 3.4, d + 0.16), mixc(col, 0x30343c, 0.72), 0, 0.5, 1);
    g.add(rb(0.5, 0.5, 0.5, 0.08), T(x, 3.55, z, 0, rot, 0, w + 1.5, 0.3, d + 1.5), acc, 0, 0.4);
    g.add(BOX, T(x, h + 0.25, z, 0, rot, 0, w + 0.3, 0.5, d + 0.3), mixc(col, 0xffffff, 0.4), 0, 0.3);
    // 屋顶设备
    const c = cos(rot), s = sin(rot), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    for (let i = 0, n = 1 + (R0() * 3 | 0); i < n; i++) {
      const [ax, az] = at(rr(-w / 3, w / 3), rr(-d / 3, d / 3));
      if (R0() < 0.5) g.add(BOX, T(ax, h + 1, az, 0, rot + rr(0, 1), 0, rr(1.4, 2.6), 1.2, rr(1.2, 2)), 0xb8bec8, 0, 0.5, 3);
      else { g.add(CYL, T(ax, h + 0.5, az, 0, 0, 0, 1, 1.8, 1), 0xc9b28a, 0, 0.3); g.add(CONE, T(ax, h + 2.3, az, 0, 0, 0, 1.15, 0.6, 1.15), 0x8a6a4a, 0, 0.3); }
    }
    if (h > 20) { const [ax, az] = at(w / 4, -d / 4); g.add(CYL8, T(ax, h, az, 0, 0, 0, 0.08, 5, 0.08), 0x8a8f99, 0, 0.6, 3); g.add(SPL, T(ax, h + 5, az, 0, 0, 0, 0.22), 0xff3030, 1, 0.5, 2); }
    if (h > 14 && R0() < 0.75) {
      const sgn = pk([R.word, R.hello, R.ask, R.zero, R.think, R.en]), sw = min(w * 0.85, (sgn[2] / sgn[3]) * 2.6), sh = (sw * sgn[3]) / sgn[2];
      const [ax, az] = at(0, d / 2 + 0.12);
      g.add(BOX, T(ax, h - 2.2 - sh / 2, az, 0, rot, 0, sw + 0.3, sh + 0.3, 0.16), 0x1a1d26, 0, 0.6);
      const [bx, bz] = at(0, d / 2 + 0.22); sign(bx, h - 2.2 - sh / 2, bz, rot, sw, sh, sgn);
    }
  }
  for (const gx of [21, 43, 65]) for (const gz of [21, 43, 65]) {
    const r = hypot(gx, gz);
    if (r > 33 && r < 70) bld(gx, gz, rr(11, 14), rr(11, 14), rr(9, 27), pk([0, PI / 2, PI, -PI / 2]));
  }
  for (const q of [0, 1]) for (let i = 0; i < 6; i++) {
    const a = (q ? -PI / 2 : PI / 2) + 0.24 + (i / 5) * (PI / 2 - 0.48), r = i % 2 ? 110 : 97, x = cos(a) * r, z = sin(a) * r;
    bld(x, z, rr(11, 13.5), rr(10, 12), rr(16, 44), -PI / 2 - a);
  }
  for (let i = 0; i < 46; i++) { // 远景天际线
    const a = (i / 46) * TAU + rr(-0.05, 0.05), r = rr(150, 232);
    bld(cos(a) * r, sin(a) * r, rr(14, 26), rr(14, 26), rr(28, 96), a, 1);
  }

  // --- 树、灌木、石头 ---
  function tree(x, z, s, kind) {
    const g = G(x, z), y = terrH(x, z), th = (kind == 2 ? 3.9 : 3.5) * s;
    g.add(cylT, T(x, y - 0.2, z, 0, R0() * 6, 0, 0.2 * s, th + 0.2, 0.2 * s), 0x6b4a34, 0, 0.1);
    const cA = kind == 1 ? 0xf7a8c4 : kind == 2 ? 0x3f8f4a : 0x4fa84e, cB = kind == 1 ? 0xffd0e0 : kind == 2 ? 0x6fbf5a : 0x86cf5a;
    if (kind == 2) for (let i = 0; i < 3; i++) g.add(SPL, T(x, y + th + i * 1.3 * s, z, 0, 0, 0, (1.25 - i * 0.3) * s, 1.25 * s, (1.25 - i * 0.3) * s), mixc(cA, cB, i / 2.5), 0, 0.12, 0, 0.35 + i * 0.25);
    else for (let i = 0; i < 4; i++) {
      const a = i * 2.1 + R0(), q = i ? 0.75 * s : 0, sc = (i ? rr(0.95, 1.3) : 1.55) * s;
      g.add(SPL, T(x + cos(a) * q, y + th + (i ? rr(0.2, 1) : 0.9) * s, z + sin(a) * q, 0, 0, 0, sc, sc * 0.86, sc), mixc(cA, cB, R0()), 0, 0.12, 0, 0.45 + R0() * 0.4);
    }
    circ(x, z, 0.3 * s, y + th);
  }
  const cylT = cyl(1, 0.62, 1, 8);
  for (let i = 0, n = 0; i < 4000 && n < 150; i++) {
    const a = R0() * TAU, r = rr(30, ARENA - 4), x = cos(a) * r, z = sin(a) * r, zn = zone(x, z);
    if ((zn != 1 && zn != 4) || dRoad(x, z) < 8.5 || fbm(x * 0.05 + 80, z * 0.05) < 0.42 || blocked(x, z, 2.2)) continue;
    tree(x, z, rr(0.85, 1.35), zn == 1 ? (R0() < 0.4 ? 1 : 0) : R0() < 0.45 ? 2 : 0); n++;
  }
  for (let i = 0; i < 46; i++) { // 场外山坡上的树
    const a = R0() * TAU, r = rr(ARENA + 8, 175), x = cos(a) * r, z = sin(a) * r;
    tree(x, z, rr(1.3, 2.2), R0() < 0.5 ? 2 : 0); cols.pop();
  }
  for (let i = 0, n = 0; i < 1500 && n < 110; i++) {
    const a = R0() * TAU, r = rr(29, ARENA - 3), x = cos(a) * r, z = sin(a) * r, zn = zone(x, z);
    if ((zn != 1 && zn != 4) || dRoad(x, z) < 7.2 || blocked(x, z, 0.8)) continue;
    const g = G(x, z), y = terrH(x, z), s = rr(0.35, 0.8);
    if (R0() < 0.25) g.add(SPL, T(x, y + s * 0.2, z, rr(0, 1), rr(0, 6), 0, s * 1.3, s * 0.8, s), 0x9a9da3, 0, 0.2);
    else {
      g.add(SPL, T(x, y + s * 0.5, z, 0, 0, 0, s * 1.2, s * 0.8, s * 1.2), mixc(0x3f9a4a, 0x7fcf5a, R0()), 0, 0.1, 0, 0.2);
      if (R0() < 0.5) for (let k = 0; k < 4; k++) g.add(SPL, T(x + rr(-s, s), y + s * rr(0.8, 1.1), z + rr(-s, s), 0, 0, 0, 0.12), pk([0xffe066, 0xff8fb0, 0xffffff, 0xa98bff]), 0.15, 0.4, 0, 0.3);
    }
    n++;
  }

  // --- 路灯（位置与着色器里的解析灯光池一致）---
  function lamp(x, z, a) {
    const g = G(x, z), c = cos(a), s = sin(a);
    g.add(CYL8, T(x, 0, z, 0, 0, 0, 0.09, 5.3, 0.09), 0x30343c, 0, 0.6, 3);
    g.add(CYL8, T(x, 0, z, 0, 0, 0, 0.16, 0.5, 0.16), 0x30343c, 0, 0.5, 3);
    g.add(BOX, T(x + c * 0.7, 5.3, z + s * 0.7, 0, -a, 0, 1.7, 0.1, 0.12), 0x30343c, 0, 0.6, 3);
    g.add(rb(0.5, 0.5, 0.5, 0.2), T(x + c * 1.45, 5.22, z + s * 1.45, 0, -a, 0, 0.8, 0.18, 0.34), 0xe9edf2, 0, 0.5);
    g.add(BOX, T(x + c * 1.45, 5.12, z + s * 1.45, 0, -a, 0, 0.62, 0.04, 0.24), 0xffe2b0, 1, 0.5, 2);
    circ(x, z, 0.17, 5.3);
  }
  for (let k = 0; k < 4; k++) for (const lon of [32, 46, 60, 88, 102, 116]) for (const sd of [-1, 1]) {
    const a = (k * PI) / 2, c = cos(a), s = sin(a);
    lamp(c * lon - s * sd * 6.4, s * lon + c * sd * 6.4, atan2(-c * sd, s * sd));
  }
  for (let k = 0; k < 32; k++) if (k % 8) for (const sd of [-1, 1]) { const a = (k / 32) * TAU; lamp(cos(a) * (RING + sd * 6.4), sin(a) * (RING + sd * 6.4), a + (sd > 0 ? PI : 0)); }

  // --- 中心广场：纪念碑基座、花坛、长椅 ---
  {
    const g = G(0.1, 0.1);
    g.add(lathe([[0, 0], [4.2, 0], [4.2, 0], [4.2, 0.35], [4.2, 0.35], [3.5, 0.35], [3.5, 0.35], [3.5, 0.7], [3.5, 0.7], [2.6, 0.7], [2.6, 0.7], [2.6, 1.05], [2.6, 1.05], [0, 1.05]], 40), null, 0xe8e4dc, 0, 0.45);
    g.add(lathe([[0.9, 1.05], [0.6, 1.5], [0.45, 3.2], [0.6, 4.6], [1.0, 5.0], [1.0, 5.0], [0, 5.0]], 20), null, 0x1f6bff, 0, 0.8, 3);
    g.add(lathe([[3.55, 0.36], [3.55, 0.44], [3.45, 0.44]], 40), null, 0x7fc4ff, 1, 0.5, 2);
    circ(0, 0, 4.25, 1.05); circ(0, 0, 1.1, 9);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + PI / 8, x = cos(a) * 19, z = sin(a) * 19;
      g.add(lathe([[0, 0], [1.25, 0], [1.25, 0], [1.4, 0.7], [1.4, 0.7], [1.15, 0.7], [1.15, 0.7], [1.15, 0.55], [1.15, 0.55], [0, 0.55]], 16), T(x, 0, z), 0xf3efe8, 0, 0.4);
      g.add(SPL, T(x, 1.1, z, 0, 0, 0, 1.15, 0.8, 1.15), 0x58b45a, 0, 0.1, 0, 0.15);
      for (let k = 0; k < 6; k++) g.add(SPL, T(x + cos(k) * 0.8, 1.4 + (k % 2) * 0.2, z + sin(k) * 0.8, 0, 0, 0, 0.17), ACC[(i + k) % 6], 0.12, 0.4, 0, 0.2);
      circ(x, z, 1.4, 0.75);
      const b = a + PI / 8, bx = cos(b) * 22.5, bz = sin(b) * 22.5, ry = PI / 2 - b;
      if (abs(bx) > 7 && abs(bz) > 7) {
        g.add(rb(0.5, 0.5, 0.5, 0.12), T(bx, 0.48, bz, 0, ry, 0, 2.2, 0.12, 0.6), 0xc98f5a, 0, 0.3);
        g.add(rb(0.5, 0.5, 0.5, 0.12), T(bx + cos(b) * 0.3, 0.8, bz + sin(b) * 0.3, 0.2, ry, 0, 2.2, 0.5, 0.1), 0xc98f5a, 0, 0.3);
        for (const e of [-0.9, 0.9]) g.add(BOX, T(bx + cos(ry) * e, 0.22, bz - sin(ry) * e, 0, ry, 0, 0.1, 0.44, 0.5), 0x30343c, 0, 0.6, 3);
        obb(bx, bz, 1.1, 0.35, ry, 0.85);
      }
    }
    // 广场入口的小卖部与立牌
    for (const [x, z, sg] of [[13.5, 20.5, R.shop], [-20.5, 13.5, R.fix], [-13.5, -20.5, R.go], [20.5, -13.5, R.bug]]) {
      const ry = atan2(-x, -z), c = cos(ry), s = sin(ry);
      g.add(rb(1.5, 1.25, 1.1, 0.15), T(x, 1.25, z, 0, ry), 0xfdfaf3, 0, 0.4);
      g.add(rb(1.7, 0.12, 1.35, 0.1), T(x, 2.6, z, 0, ry), pk(ACC), 0, 0.4);
      g.add(BOX, T(x + s * 1.11, 1.45, z + c * 1.11, 0, ry, 0, 2.2, 1.0, 0.04), 0x1c2430, 0.25, 0.9, 2);
      g.add(rb(1.6, 0.06, 0.3, 0.05), T(x + s * 1.3, 0.92, z + c * 1.3, 0, ry), 0xd9c9a8, 0, 0.4);
      sign(x + s * 1.14, 3.2, z + c * 1.14, ry, 2.8, 0.7, sg);
      g.add(BOX, T(x + s * 1.1, 3.2, z + c * 1.1, 0, ry, 0, 2.95, 0.85, 0.06), 0x1a1d26, 0, 0.5);
      obb(x, z, 1.55, 1.2, ry, 2.7);
    }
  }
  // 纪念碑顶的旋转对话气泡（动态绘制）
  {
    const g = new Geo();
    g.add(rb(2.5, 1.9, 0.32, 0.32), T(0, 0, 0), 0xffffff, 0.08, 0.75);
    g.add(CONE, T(-1.1, -1.75, 0, 0, 0, 2.6, 0.5, 1.2, 0.3), 0xffffff, 0.08, 0.75);
    g.add(rb(2.62, 2.02, 0.2, 0.2), T(0, 0, 0), 0x1f6bff, 0.25, 0.6);
    W.bubble = mesh(g);
    W.bubbleSign = signMesh([{ m: T(-1.05, 0, 0.34, 0, 0, 0, 2.5, 2.5, 1), r: R.avatar }, { m: T(1.3, 0.35, 0.34, 0, 0, 0, 1.9, 0.95, 1), r: R.word },
    { m: T(1.05, 0, -0.34, 0, PI, 0, 2.5, 2.5, 1), r: R.avatar }, { m: T(-1.3, 0.35, -0.34, 0, PI, 0, 1.9, 0.95, 1), r: R.word }], AS);
  }

  // --- 广告牌 ---
  function board(x, z, ry, sg, w = 6) {
    const g = G(x, z), h = (w * sg[3]) / sg[2], c = cos(ry), s = sin(ry);
    for (const e of [-w / 2 + 0.4, w / 2 - 0.4]) { g.add(CYL8, T(x + c * e, 0, z - s * e, 0, 0, 0, 0.13, 4.2, 0.13), 0x30343c, 0, 0.6, 3); circ(x + c * e, z - s * e, 0.2, 4.2 + h); }
    g.add(BOX, T(x, 4.2 + h / 2, z, 0, ry, 0, w + 0.3, h + 0.3, 0.2), 0x1a1d26, 0, 0.5);
    sign(x + s * 0.12, 4.2 + h / 2, z + c * 0.12, ry, w, h, sg); sign(x - s * 0.12, 4.2 + h / 2, z - c * 0.12, ry + PI, w, h, sg);
  }
  [[10, 52, PI / 2, R.hello, 7], [-10, -52, -PI / 2, R.zero, 7], [52, -10, PI, R.think, 6], [-52, 10, 0, R.ask, 6], [60, 60, -PI * 0.75, R.en, 7.5], [-60, -60, PI * 0.25, R.go, 5],
  [-62, 58, PI * 0.75, R.lane, 4], [10, -96, -PI / 2, R.word, 5], [-96, -10, 0, R.bug, 6], [96, 10, PI, R.fix, 5], [-10, 96, PI / 2, R.shop, 6]].forEach(b => board(...b));

  // --- 货柜场 ---
  function cont(x, z, ry, lv = 1) {
    const g = G(x, z);
    for (let i = 0; i < lv; i++) {
      const col = pk(CONT), y = 1.3 + i * 2.6;
      g.add(rb(1.22, 1.3, 3.05, 0.07), T(x, y, z, 0, ry), col, 0, 0.45, 3);
      for (let k = -4; k <= 4; k++) g.add(BOX, T(x + sin(ry) * k * 0.62, y, z + cos(ry) * k * 0.62, 0, ry, 0, 2.5, 2.3, 0.1), mixc(col, 0x000000, 0.14), 0, 0.4, 3);
      g.add(BOX, T(x + sin(ry) * 3.06, y, z + cos(ry) * 3.06, 0, ry, 0, 2.1, 2.2, 0.06), mixc(col, 0xffffff, 0.18), 0, 0.5, 3);
    }
    obb(x, z, 1.22, 3.05, ry, lv * 2.6, 0, 1);
  }
  for (const [x, z, ry, lv] of [[22, -24, 0, 1], [22, -31, 0, 2], [34, -22, PI / 2, 1], [44, -20, 0, 1], [47, -20, 0, 2], [33, -36, 0.5, 1], [22, -46, PI / 2, 1], [29, -46, PI / 2, 1],
  [44, -36, PI / 2, 2], [56, -33, 0, 1], [59, -33, 0, 1], [36, -52, 0, 1], [48, -50, 0.3, 1], [22, -60, 0, 2], [58, -18, PI / 2, 1], [33, -64, PI / 2, 1], [46, -62, -0.4, 1]]) cont(x, z, ry, lv);
  for (let i = 0, n = 0; i < 300 && n < 16; i++) { // 木箱与油桶
    const x = rr(14, 66), z = rr(-66, -14);
    if (zone(x, z) != 3 || dRoad(x, z) < 8 || blocked(x, z, 1.4)) continue;
    const g = G(x, z); n++;
    if (R0() < 0.5) { const s = rr(0.5, 0.75), ry = rr(0, 3); g.add(rb(1, 1, 1, 0.06), T(x, s, z, 0, ry, 0, s), 0xc99a5b, 0, 0.2); g.add(BOX, T(x, s, z, 0, ry, 0, s * 2.04, s * 0.3, s * 2.04), 0xa87a42, 0, 0.2); obb(x, z, s, s, ry, s * 2, 0, 1); }
    else { g.add(CYL, T(x, 0, z, 0, 0, 0, 0.42, 1.15, 0.42), pk([0xff5a5a, 0x2f7bff, 0xffc233]), 0, 0.6, 3); g.add(CYL, T(x, 1.15, z, 0, 0, 0, 0.36, 0.03, 0.36), 0x30343c, 0, 0.6, 3); circ(x, z, 0.42, 1.15); }
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
    g.add({ p, n: normals(p, idx), i: idx }, m, 0xf4f1ea, 0, 0.4); g.add({ p: pb, n: normals(pb, ib), i: ib }, m, 0xffc94d, 0, 0.4); g.add({ p: pe, n: normals(pe, ie), i: ie }, m, 0x1f6bff, 0.15, 0.5);
    g.add({ p: ps, n: normals(ps, is), i: is }, m, 0x3a4252, 0, 0.5, 3);
  }
  for (let k = 0; k < 4; k++) { const a = (k * PI) / 2; ramp(sin(a) * 44, cos(a) * 44, a, 13, 2.3, 1.25, 1); ramp(sin(a) * 96, cos(a) * 96, a, 13, 2.3, 1.25, 1); }
  for (let k = 0; k < 4; k++) { const a = PI / 4 + (k * PI) / 2; ramp(cos(a) * RING + sin(a) * 6, sin(a) * RING - cos(a) * 6, -a, 12, 2.3, 1.2, 1); }
  // 滑板公园：单向起跳台、可骑上的平台、矮栏杆
  [[-30, -30, -2.3, 7, 2.6, 1.7], [-52, -24, 1.2, 6.5, 2.4, 1.5], [-24, -52, 0.3, 6.5, 2.4, 1.5], [-46, -46, 2.4, 8, 3, 2.1], [-60, -40, -0.6, 6, 2.2, 1.3], [-38, -62, -1.9, 6, 2.2, 1.3]].forEach(r => ramp(...r));
  for (const [x, z, hx, hz, ry, h] of [[-40, -34, 3.5, 2.5, 0.4, 1], [-28, -42, 2.5, 4, -0.2, 1.1], [-52, -54, 4, 3, 0.9, 1], [-36, -50, 2, 2, 0.2, 2.1]]) {
    const g = G(x, z);
    g.add(rb(hx, h / 2, hz, 0.08), T(x, h / 2, z, 0, ry), 0xe9e4da, 0, 0.35);
    g.add(BOX, T(x, h - 0.06, z, 0, ry, 0, hx * 2 + 0.06, 0.1, hz * 2 + 0.06), pk(ACC), 0, 0.5);
    obb(x, z, hx, hz, ry, h, 0, 1);
  }
  for (const [x, z, ry, l] of [[-22, -34, 0.8, 7], [-56, -30, -0.3, 6], [-44, -24, 1.5, 6]]) {
    const g = G(x, z);
    g.add(CYL8, T(x - sin(ry) * l / 2, 0.55, z - cos(ry) * l / 2, PI / 2, ry, 0, 0.05, l, 0.05), 0xff5a7a, 0, 0.8, 3);
    for (const e of [-0.45, 0, 0.45]) g.add(CYL8, T(x + sin(ry) * l * e, 0, z + cos(ry) * l * e, 0, 0, 0, 0.045, 0.55, 0.045), 0x30343c, 0, 0.6, 3);
    obb(x, z, 0.08, l / 2, ry, 0.6);
  }

  // --- 边界：能量塔 + 能量墙 ---
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU, x = cos(a) * (ARENA + 0.6), z = sin(a) * (ARENA + 0.6), g = G(x * 0.98, z * 0.98);
    g.add(lathe([[0, 0], [0.7, 0], [0.7, 0], [0.5, 0.6], [0.32, 6.4], [0.5, 6.8], [0.5, 6.8], [0, 6.8]], 6), T(x, terrH(x, z) - 0.2, z, 0, -a), 0x2a3142, 0, 0.6, 3);
    g.add(SPL, T(x, terrH(x, z) + 7, z, 0, 0, 0, 0.36), 0x59b6ff, 1, 0.6);
  }
  {
    const g = new Geo(), wall = { p: [], n: [], i: [] }, n = 96;
    for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, c = cos(a), s = sin(a); for (const y of [0, 7]) { wall.p.push(c * (ARENA + 0.6), y, s * (ARENA + 0.6)); wall.n.push(-c, 0, -s); } }
    for (let i = 0; i < n; i++) wall.i.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    g.add(wall, null, (x, y) => (y > 3 ? 0x04101e : 0x3f9dff));
    W.wall = mesh(g, 1, 1);
  }
  geos.forEach(g => g && staticMesh(g));
  // --- 地形网格 ---
  {
    const p = new Float32Array(N * N * 3), nn = new Float32Array(N * N * 3), idx = new Uint32Array((N - 1) * (N - 1) * 6);
    const H = (i, j) => HF[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
    for (let j = 0, o = 0; j < N; j++) for (let i = 0; i < N; i++, o += 3) {
      p[o] = -SZ / 2 + i * CS; p[o + 1] = HF[j * N + i]; p[o + 2] = -SZ / 2 + j * CS;
      const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), l = hypot(nx, 2 * CS, nz);
      nn[o] = nx / l; nn[o + 1] = (2 * CS) / l; nn[o + 2] = nz / l;
    }
    for (let j = 0, o = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx[o++] = a; idx[o++] = a + N; idx[o++] = a + 1; idx[o++] = a + 1; idx[o++] = a + N; idx[o++] = a + N + 1; }
    groundMesh(p, nn, Array.from(idx));
  }
  setSignAtlas(makeAtlas());
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
