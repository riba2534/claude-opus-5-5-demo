// 城市构件：带立面的建筑（阳台、空调外机、底商、屋顶设备）、人行道与路缘石、汽车、红绿灯、公交站等街道设施
import { PI, TAU, sin, cos, hypot, min, max, floor, abs, T, m4, lerp, smooth } from './math.js';
import { Geo, BOX, CYL, CYL8, SPH, SPL, CONE, rbox, cyl, lathe, torus, normals, mixc } from './geo.js';

// 立面参数必须与着色器 F_FAC 保持一致：开间、层高、底层高度
export const FAC = { 1: [3.3, 3.1, 4.2], 2: [2.9, 3.7, 4.2], 3: [1.75, 3.9, 5], 4: [3.6, 3.5, 5] };
export const newFac = () => ({ p: [], n: [], uv: [], c: [], b: [], i: [] });
const RB = {}, rb = (hx, hy, hz, r) => RB[[hx, hy, hz, r]] || (RB[[hx, hy, hz, r]] = rbox(hx, hy, hz, r, 2));

// 一面墙：a→b 为沿墙方向，法线朝外
function wall(F, ax, az, bx, bz, y0, h, col, st, seed, lay) {
  const o = F.p.length / 3, w = hypot(bx - ax, bz - az), tx = (bx - ax) / w, tz = (bz - az) / w, nx = -tz, nz = tx;
  F.p.push(ax, y0, az, bx, y0, bz, bx, y0 + h, bz, ax, y0 + h, az);
  for (let k = 0; k < 4; k++) { F.n.push(nx, 0, nz); F.c.push(col >> 16, (col >> 8) & 255, col & 255); F.b.push(w, st, seed, lay); }
  F.uv.push(0, 0, w, 0, w, h, 0, h); F.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
function roof(F, pts, y, col, lay) {
  const o = F.p.length / 3;
  for (const [x, z] of pts) { F.p.push(x, y, z); F.n.push(0, 1, 0); F.c.push(col >> 16, (col >> 8) & 255, col & 255); F.b.push(1, 0, 0, lay); F.uv.push(x, z); }
  F.i.push(o, o + 2, o + 1, o, o + 3, o + 2);
}
const WALLS = { 1: [[3, 0xffffff], [12, 0xf2ede2], [12, 0xe6d3c0], [4, 0xd9cdb8], [3, 0xf6e9e2], [12, 0xcfdde6]], 2: [[2, 0xbfc2c6], [4, 0xcfc7ba], [2, 0xa9adb3], [11, 0xb9b4ab]], 3: [[7, 0x6f7f8e], [7, 0x8493a0]], 4: [[4, 0xe9e2d3], [12, 0xf4f1ea], [2, 0xc9c6c0], [3, 0xffffff]] };
const SHOPS = ['shop0', 'shop1', 'shop2', 'shop3', 'shop4', 'shop5', 'shop6', 'shop7'];
let shopN = 0;

// 建造一栋楼。C: {F 立面累加器, G(x,z) 取分块 Geo, obb, sign, R0, R 图集矩形}；far 为远景（无细节无碰撞）
export function building(C, x, z, w, d, h, rot, st, far, y0 = 0) {
  const { F, R0 } = C, rr = (a, b) => a + R0() * (b - a), pk = a => a[(R0() * a.length) | 0];
  const [W, FH, G0] = FAC[st], [lay, col] = pk(WALLS[st]), seed = floor(R0() * 97) + 1;
  const cap = st == 3 ? 0 : st == 4 ? 0.7 : 0.9;
  h = G0 + max(2, Math.round((h - G0) / FH)) * FH + cap;
  const c = cos(rot), s = sin(rot), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const P = [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
  // 四面墙：逆时针绕行时法线朝外需要 a→b 顺着 (nz,0,-nx)，这里按 3→2→1→0 的顺序
  for (let k = 0; k < 4; k++) { const a = P[(4 - k) % 4], b = P[3 - k]; wall(F, a[0], a[1], b[0], b[1], y0, h, col, st, seed, lay); }
  roof(F, P, y0 + h, 0xd8d4cc, 10);
  if (far) return h;
  C.obb(x, z, w / 2, d / 2, rot, h);
  const g = C.G(x, z), trim = mixc(col, 0x8a8a86, 0.5);
  // 女儿墙与屋顶设备
  g.m(2, 0.3);
  for (const [lx, lz, sx, sz] of [[0, d / 2 - 0.12, w, 0.24], [0, -d / 2 + 0.12, w, 0.24], [w / 2 - 0.12, 0, 0.24, d], [-w / 2 + 0.12, 0, 0.24, d]]) { const [ax, az] = at(lx, lz); g.add(BOX, T(ax, h + 0.45, az, 0, rot, 0, sx, 0.9, sz), trim, 0, 0.2); }
  { const [ax, az] = at(rr(-w / 5, w / 5), rr(-d / 5, d / 5)); g.m(4, 0.3).add(BOX, T(ax, h + 1.3, az, 0, rot, 0, 3.2, 2.6, 2.6), 0xe4dfd4, 0, 0.2); g.m(7, 0.3).add(BOX, T(ax + s * 1.31, h + 1.05, az + c * 1.31, 0, rot, 0, 0.9, 2, 0.05), 0x55606e, 0, 0.5); }
  for (let i = 0, n = 2 + ((R0() * 3) | 0); i < n; i++) {
    const [ax, az] = at(rr(-w / 2.6, w / 2.6), rr(-d / 2.6, d / 2.6)), k = R0();
    if (k < 0.4) { g.m(7, 0.3).add(BOX, T(ax, h + 0.55, az, 0, rot + rr(0, 0.3), 0, 1.5, 1.0, 0.9), 0xd4d7da, 0, 0.5); g.m(0).add(CYL, T(ax, h + 1.06, az, 0, 0, 0, 0.34, 0.03, 0.34), 0x30343c, 0, 0.5); }
    else if (k < 0.7) { g.m(7, 0.2); for (const e of [-0.5, 0.5]) for (const f of [-0.5, 0.5]) g.add(CYL8, T(ax + e, h, az + f, 0, 0, 0, 0.05, 1.1, 0.05), 0x8a8f99, 0, 0.6); g.add(CYL, T(ax, h + 1.1, az, 0, 0, 0, 0.85, 1.5, 0.85), 0xcdd2d8, 0, 0.6); g.add(CONE, T(ax, h + 2.6, az, 0, 0, 0, 0.9, 0.35, 0.9), 0xb9bec6, 0, 0.6); }
    else { g.m(7, 0.2).add(BOX, T(ax, h + 0.7, az, -0.6, rot, 0, 1.8, 0.06, 1.2), 0x1c2f55, 0, 0.9); g.add(CYL, T(ax - c * 0.9, h + 1.05, az + s * 0.9, 0, rot, PI / 2, 0.2, 1.8, 0.2), 0xdfe5ee, 0, 0.7); for (const e of [-0.8, 0.8]) g.add(CYL8, T(ax + c * e, h, az - s * e, 0, 0, 0, 0.03, 1, 0.03), 0x8a8f99, 0, 0.6); }
  }
  if (h > 24) { const [ax, az] = at(w / 4, -d / 4); g.m(7, 0.2).add(CYL8, T(ax, h, az, 0, 0, 0, 0.07, 6, 0.07), 0x9aa0a8, 0, 0.6); g.m(0).add(SPL, T(ax, h + 6, az, 0, 0, 0, 0.2), 0xff3030, 1, 0.5, 2); }
  // 逐面细节：阳台、空调外机、雨水管、底商雨棚与招牌
  const faces = [[0, 1, w, d / 2], [1, 0, d, w / 2], [0, -1, w, d / 2], [-1, 0, d, w / 2]];
  faces.forEach(([nx, nz, fw, off], fi) => {
    const nb = max(1, floor(fw / W + 0.01)), m0 = (fw - nb * W) / 2, tx = nz, tz = -nx, ry = rot + Math.atan2(nx, nz);
    const pos = (u, out) => at(tx * (u - fw / 2) + nx * (off + out), tz * (u - fw / 2) + nz * (off + out));
    const nf = max(1, Math.round((h - G0 - cap) / FH));
    if (st == 1) {
      const bal = fi % 2 == 0;
      for (let fl = 0; fl < nf; fl++) for (let b = 0; b < nb; b++) {
        const u = m0 + (b + 0.5) * W, yb = G0 + fl * FH;
        if (bal) {
          // 阳台：楼板 + 三面栏板
          const [ax, az] = pos(u, 0.55);
          g.m(2, 0.3).add(BOX, T(ax, yb + 0.02, az, 0, ry, 0, W * 0.7, 0.14, 1.1), 0xd9d6cf, 0, 0.2);
          const [fx, fz] = pos(u, 1.06); g.m(lay, 0.3).add(BOX, T(fx, yb + 0.6, fz, 0, ry, 0, W * 0.7, 1.05, 0.09), col, 0, 0.2);
          for (const e of [-1, 1]) { const [sx, sz] = pos(u + e * W * 0.345, 0.55); g.add(BOX, T(sx, yb + 0.6, sz, 0, ry, 0, 0.09, 1.05, 1.1), col, 0, 0.2); }
          if (R0() < 0.3) { const [qx, qz] = pos(u + rr(-0.6, 0.6), 0.8); g.m(0).add(SPL, T(qx, yb + 0.5, qz, 0, 0, 0, 0.3, 0.28, 0.3), 0x4f9a4a, 0, 0.1); g.add(CYL8, T(qx, yb + 0.1, qz, 0, 0, 0, 0.16, 0.22, 0.2), 0xb5653c, 0, 0.2); }
        } else if (R0() < 0.55) {
          // 空调外机挂在窗下
          const [ax, az] = pos(u + W * 0.22, 0.24);
          g.m(7, 0.25).add(BOX, T(ax, yb + 0.55, az, 0, ry, 0, 0.85, 0.6, 0.36), 0xe2e4e6, 0, 0.5);
          const [dx, dz] = pos(u + W * 0.22 - 0.12, 0.43); g.m(0).add(CYL, T(dx, yb + 0.55, dz, PI / 2, ry, 0, 0.22, 0.02, 0.22), 0x2a2e36, 0, 0.5);
          const [bx, bz] = pos(u + W * 0.22, 0.2); g.m(7, 0.2).add(BOX, T(bx, yb + 0.22, bz, 0, ry, 0, 0.9, 0.05, 0.42), 0x6b7078, 0, 0.5);
        }
      }
    }
    // 雨水管
    { const [ax, az] = pos(0.35, 0.09); g.m(7, 0.2); for (let y = 0; y < h; y += 4) { const l = min(4, h - y); g.add(BOX, T(ax, y + l / 2, az, 0, ry, 0, 0.11, l, 0.11), 0xb0b3b6, 0, 0.5); } } // 按 4 米分段，避免整根几十米长的细长三角形
    // 底商：雨棚 + 招牌 + 门前台阶
    if (st != 3) for (let b = 0; b < nb; b++) {
      const u = m0 + (b + 0.5) * W, k = R0();
      if (k < 0.75) {
        const acc = pk([0xb3261e, 0x1f6bff, 0x1a7f5a, 0xe08a1e, 0x6d4bd1, 0x2a2e36, 0xc2185b]);
        const [ax, az] = pos(u, 0.7); g.m(0).add(rb(0.5, 0.5, 0.5, 0.06), T(ax, G0 - 1.15, az, 0.32, ry, 0, W * 0.9, 0.08, 1.5), acc, 0, 0.3);
        const [vx, vz] = pos(u, 1.41); g.add(BOX, T(vx, G0 - 1.53, vz, 0, ry, 0, W * 0.9, 0.3, 0.04), mixc(acc, 0xffffff, 0.12), 0, 0.3);
        const [sx, sz] = pos(u, 0.14), sg = C.R[SHOPS[shopN++ % 8]]; g.m(7, 0.2).add(BOX, T(sx, G0 - 0.42, sz, 0, ry, 0, W * 0.88, 0.78, 0.12), 0x1a1d24, 0, 0.5);
        const [qx, qz] = pos(u, 0.21); C.sign(qx, G0 - 0.42, qz, ry, W * 0.84, (W * 0.84 * sg[3]) / sg[2], sg);
      }
      const [ex, ez] = pos(u, 0.35); g.m(11, 0.3).add(BOX, T(ex, 0.07, ez, 0, ry, 0, W * 0.5, 0.14, 0.7), 0xc9c6c0, 0, 0.3);
    } else { const [ex, ez] = pos(fw / 2, 1.4); if (fi == 0) { g.m(7, 0.2).add(BOX, T(ex, 3.6, ez, 0, ry, 0, min(fw * 0.5, 7), 0.18, 2.8), 0x3a3f48, 0, 0.6); for (const e of [-1, 1]) { const [px, pz] = pos(fw / 2 + e * min(fw * 0.22, 3), 2.5); g.add(CYL8, T(px, 0, pz, 0, 0, 0, 0.09, 3.6, 0.09), 0x9aa0a8, 0, 0.7); } } }
    // 楼顶大招牌
    if (fi == 0 && h > 16 && R0() < 0.6) {
      const sg = C.R[pk(['word', 'hello', 'ask', 'zero', 'think', 'en'])], sw = min(fw * 0.8, (sg[2] / sg[3]) * 2.8), sh = (sw * sg[3]) / sg[2];
      const [ax, az] = pos(fw / 2, 0.05); g.m(7, 0.2).add(BOX, T(ax, h + 0.9 + sh / 2 + 0.3, az, 0, ry, 0, sw + 0.3, sh + 0.3, 0.18), 0x1a1d26, 0, 0.6);
      for (const e of [-0.4, 0.4]) { const [px, pz] = pos(fw / 2 + e * sw, 0.05); g.add(CYL8, T(px, h + 0.9, pz, 0, 0, 0, 0.05, 0.4, 0.05), 0x555b66, 0, 0.6); }
      const [bx, bz] = pos(fw / 2, 0.16); C.sign(bx, h + 0.9 + sh / 2 + 0.3, bz, ry, sw, sh, sg);
    }
  });
  g.m(0);
  return h;
}

// 人行道与路缘石（抬高 13cm 的面包砖铺面）
const SWH = 0.13;
export function sidewalks(C) {
  const g = C.G(40, 1);
  const slab = (len, cx, cz, ry) => { g.m(5, 0.5).add(BOX, T(cx, SWH / 2, cz, 0, ry, 0, 1.56, SWH, len), 0xcfccc6, 0, 0.2); };
  for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) for (const [l0, l1] of [[27.6, 71.1], [84.9, 123.4]]) {
    const a = (k * PI) / 2, c = cos(a), s = sin(a), mid = (l0 + l1) / 2, G2 = C.G(s * mid, c * mid);
    const px = s * mid + c * sd * 6.02, pz = c * mid - s * sd * 6.02;
    G2.m(5, 0.5).add(BOX, T(px, SWH / 2, pz, 0, a, 0, 1.56, SWH, l1 - l0), 0xcfccc6, 0, 0.2);
    G2.m(2, 0.3).add(BOX, T(s * mid + c * sd * 5.12, SWH / 2 + 0.01, c * mid - s * sd * 5.12, 0, a, 0, 0.24, SWH + 0.02, l1 - l0), 0xe2dfd8, 0, 0.3);
    G2.m(5, 0.6).add(BOX, T(s * mid + c * sd * 5.8, SWH + 0.006, c * mid - s * sd * 5.8, 0, a, 0, 0.3, 0.012, l1 - l0), 0xe0b63a, 0, 0.3); // 盲道
  }
  // 环路两侧：按象限分段的圆弧
  const arc = (r0, r1, a0, a1, h, n = 28) => {
    const p = [], idx = [];
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n), c = cos(a), s = sin(a); p.push(c * r0, h, s * r0, c * r1, h, s * r1, c * r0, 0, s * r0, c * r1, 0, s * r1); }
    for (let i = 0; i < n; i++) { const o = i * 4; idx.push(o, o + 4, o + 1, o + 1, o + 4, o + 5, o + 2, o, o + 6, o + 6, o, o + 4, o + 1, o + 3, o + 5, o + 5, o + 3, o + 7); }
    // 展开成独立三角形以得到硬边法线
    const q = [], qi = [];
    for (let t = 0; t < idx.length; t++) { const v = idx[t] * 3; q.push(p[v], p[v + 1], p[v + 2]); qi.push(t); }
    return { p: q, n: normals(q, qi), i: qi };
  };
  for (let k = 0; k < 4; k++) {
    const a0 = (k * PI) / 2 + 0.098, a1 = ((k + 1) * PI) / 2 - 0.098, am = (a0 + a1) / 2, G2 = C.G(cos(am) * 78, sin(am) * 78);
    for (const [r0, r1] of [[71.2, 72.76], [83.24, 84.8]]) G2.m(5, 0.5).add(arc(r0, r1, a0, a1, SWH), null, 0xcfccc6, 0, 0.2);
    for (const [r0, r1] of [[72.76, 73], [83, 83.24]]) G2.m(2, 0.3).add(arc(r0, r1, a0, a1, SWH + 0.02), null, 0xe2dfd8, 0, 0.3);
    for (const [r0, r1] of [[72.06, 72.36], [83.64, 83.94]]) G2.m(5, 0.6).add(arc(r0, r1, a0, a1, SWH + 0.012), null, 0xe0b63a, 0, 0.3);
  }
  g.m(0);
}
// 与上面几何对应的解析高度（物理用，边缘放缓成 0.9 米的斜坡，车轮可以平滑上下台而不会被弹飞）
export function sidewalkH(x, z) {
  const r = hypot(x, z);
  if (r > 123.5 || r < 27.5) return 0;
  const dc = min(abs(x), abs(z)), dr = abs(r - 78), band = d => (d < 4.55 || d > 7.25 ? 0 : d < 5.45 ? ((d - 4.55) / 0.9) * SWH : d > 6.35 ? ((7.25 - d) / 0.9) * SWH : SWH);
  // 端头（广场边、路口、场地边缘）用一米长的缓坡收掉，否则 13 厘米的台阶会在一个物理子步里被当成极大的上升速度
  return max(band(dc) * smooth(7.25, 8.25, dr), band(dr) * smooth(7.25, 8.25, dc)) * smooth(27.5, 28.5, r) * smooth(123.5, 122.5, r);
}

// ---------- 汽车 ----------
// 上窄下宽的车舱（梯台），返回硬边法线的图元
function frustum(w0, w1, zb0, zf0, zb1, zf1, h) {
  const P = [[-w0, 0, zb0], [w0, 0, zb0], [w0, 0, zf0], [-w0, 0, zf0], [-w1, h, zb1], [w1, h, zb1], [w1, h, zf1], [-w1, h, zf1]], p = [], idx = [];
  for (const f of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) { const o = p.length / 3; for (const k of f) p.push(...P[k]); idx.push(o, o + 2, o + 1, o, o + 3, o + 2); }
  return { p, n: normals(p, idx), i: idx };
}
const WHEEL = (() => { const g = new Geo(); g.add(cyl(1, 1, 1, 14), T(-0.5, 0, 0, 0, 0, -PI / 2), 0x18191c, 0, 0.3); g.add(CYL, T(0.5, 0, 0, 0, 0, -PI / 2, 0.62, 0.02, 0.62), 0xbfc4cc, 0, 0.8, 3); g.add(CYL, T(-0.52, 0, 0, 0, 0, -PI / 2, 0.62, 0.02, 0.62), 0xbfc4cc, 0, 0.8, 3); return { p: g.p, n: g.n, i: g.i, c: g.c }; })();
const DISC = (() => { const g = new Geo(); g.add(cyl(1, 1, 1, 16), T(-0.5, 0, 0, 0, 0, -PI / 2), 0); return { p: g.p, n: g.n, i: g.i }; })();
// kind: 0 轿车 1 SUV 2 面包车 3 出租车
export function car(C, x, z, ry, kind) {
  const { R0 } = C, pk = a => a[(R0() * a.length) | 0], g = C.G(x, z);
  const col = kind == 3 ? 0xf2c21a : kind == 2 ? pk([0xf2f2f0, 0xd9dde2, 0x2f6fd0]) : pk([0xf4f4f2, 0x16181c, 0x8f959e, 0xb3261e, 0x1f4fa8, 0x3c4a3a, 0xc7c9cc, 0x6d2a2a]);
  const L = kind == 2 ? 4.7 : kind == 1 ? 4.5 : 4.4, Wd = kind == 2 ? 0.92 : 0.9, bh = kind == 2 ? 0.62 : 0.5, ch = kind == 2 ? 0.95 : kind == 1 ? 0.72 : 0.6;
  const c = cos(ry), s = sin(ry), M = (lx, y, lz, rx = 0, sx = 1, sy = 1, sz = 1) => T(x + lx * c + lz * s, y, z - lx * s + lz * c, rx, ry, 0, sx, sy, sz);
  g.m(0);
  // 车身 + 车舱（深色玻璃）+ 车顶 + 立柱
  g.add(rb(Wd, bh / 2, L / 2, 0.14), M(0, 0.3 + bh / 2, 0), col, 0, 0.9);
  const zb = kind == 0 || kind == 3 ? -L * 0.32 : -L * 0.46, zf = kind == 2 ? L * 0.34 : L * 0.2, y1 = 0.3 + bh;
  const rz0 = zb + (kind == 2 ? 0.1 : 0.45), rz1 = zf - (kind == 2 ? 0.35 : 0.7);
  g.add(frustum(Wd - 0.04, Wd - 0.16, zb, zf, rz0, rz1, ch), M(0, y1 - 0.01, 0), 0x1c2a36, 0, 0.97, 3);
  g.add(rb(Wd - 0.14, 0.035, (rz1 - rz0) / 2 + 0.04, 0.03), M(0, y1 + ch, (rz0 + rz1) / 2), col, 0, 0.9);
  for (const e of [-1, 1]) for (const [za, zb2] of [[zb, rz0], [zf, rz1], [(zb + zf) / 2, (rz0 + rz1) / 2]]) {
    const dz = zb2 - za, len = hypot(dz, ch);
    g.add(BOX, M(e * (Wd - 0.09), y1 + ch / 2, (za + zb2) / 2, Math.atan2(dz, ch), 0.07, len, 0.08), col, 0, 0.9);
  }
  // 灯、保险杠、牌照、后视镜
  for (const e of [-1, 1]) {
    g.add(rb(0.17, 0.07, 0.04, 0.03), M(e * (Wd - 0.24), 0.3 + bh * 0.72, L / 2 - 0.01), 0xe9edf0, 0.03, 0.95);
    g.add(rb(0.16, 0.06, 0.04, 0.03), M(e * (Wd - 0.24), 0.3 + bh * 0.72, -L / 2 + 0.01), 0xa81414, 0.03, 0.9);
    g.add(rb(0.05, 0.04, 0.07, 0.03), M(e * (Wd + 0.07), y1 + 0.06, zf - 0.25), col, 0, 0.9);
  }
  for (const e of [-1, 1]) g.add(rb(Wd - 0.03, 0.09, 0.07, 0.05), M(0, 0.36, e * (L / 2 - 0.02)), 0x1c1e22, 0, 0.5);
  g.add(BOX, M(0, 0.47, L / 2 + 0.045, 0, 0.44, 0.13, 0.02), 0x1f55c9, 0, 0.5); g.add(BOX, M(0, 0.47, -L / 2 - 0.045, 0, 0.44, 0.13, 0.02), 0x1f55c9, 0, 0.5);
  if (kind == 3) { g.add(rb(0.2, 0.07, 0.09, 0.04), M(0, y1 + ch + 0.11, 0), 0xfff2a8, 0.25, 0.6, 2); g.add(BOX, M(0, 0.3 + bh * 0.55, 0, 0, Wd * 2 + 0.01, 0.14, L * 0.5), 0x1a7f5a, 0, 0.8); }
  // 车轮
  for (const e of [-1, 1]) for (const lz of [L * 0.31, -L * 0.3]) g.add(DISC, M(e * (Wd - 0.025), 0.36, lz, 0, 0.07, 0.42, 0.42), 0x0c0c0e, 0, 0.2);
  for (const e of [-1, 1]) for (const lz of [L * 0.31, -L * 0.3]) { const m = M(e * (Wd - 0.1), 0.33, lz, 0, 0.22 * e, 0.33, 0.33); const o = g.p.length / 3; g.add({ p: WHEEL.p, n: WHEEL.n, i: WHEEL.i }, m, 0x18191c, 0, 0.3); for (let k = 0; k < WHEEL.c.length / 12; k++) for (let q = 0; q < 8; q++) g.c[(o + k) * 12 + q] = WHEEL.c[k * 12 + q]; }
  // 碰撞分两块：车身（引擎盖和后备箱可以骑上去）和车舱
  C.obb(x, z, Wd + 0.05, L / 2 + 0.05, ry, y1, 0, 1);
  { const lz = (zb + zf) / 2; C.obb(x + lz * s, z + lz * c, Wd - 0.08, (zf - zb) / 2 - 0.1, ry, y1 + ch + 0.04, y1 - 0.02, 1); }
}

// ---------- 街道设施 ----------
export function trafficLight(C, x, z, ry, list) {
  const g = C.G(x, z), c = cos(ry), s = sin(ry);
  g.m(7, 0.2).add(CYL8, T(x, 0, z, 0, 0, 0, 0.11, 5.6, 0.11), 0x3a3f48, 0, 0.6); g.add(CYL8, T(x, 0, z, 0, 0, 0, 0.2, 0.6, 0.2), 0x3a3f48, 0, 0.6);
  g.add(BOX, T(x + s * 2, 5.5, z + c * 2, 0, ry, 0, 0.12, 0.12, 4.2), 0x3a3f48, 0, 0.6);
  g.m(0).add(rb(0.2, 0.55, 0.16, 0.05), T(x + s * 3.9, 5.05, z + c * 3.9, 0, ry + PI / 2), 0x1a1c20, 0, 0.5);
  g.add(rb(0.16, 0.36, 0.12, 0.04), T(x + c * 0.2, 2.8, z - s * 0.2, 0, ry + PI / 2), 0x1a1c20, 0, 0.5);
  list.push({ x: x + s * 3.9 + c * 0.17, y: 5.05, z: z + c * 3.9 - s * 0.17, ph: (ry * 2) % 1 });
  C.circ(x, z, 0.2, 5.6);
}
export function busStop(C, x, z, ry) {
  const g = C.G(x, z), c = cos(ry), s = sin(ry), P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  g.m(7, 0.2);
  for (const e of [-1.9, 1.9]) { const [ax, az] = P(e, -0.6); g.add(CYL8, T(ax, 0, az, 0, 0, 0, 0.06, 2.6, 0.06), 0x4a505a, 0, 0.6); }
  g.add(rb(2.2, 0.05, 0.9, 0.04), T(x, 2.62, z, 0.06, ry), 0x3a3f48, 0, 0.6);
  { const [ax, az] = P(0, -0.62); g.m(0).add(BOX, T(ax, 1.45, az, 0, ry, 0, 3.7, 1.9, 0.04), 0x9fc3d8, 0, 0.97, 3); C.sign(ax + s * 0.04, 1.5, az + c * 0.04, ry, 2.2, 1.1, C.R.hello); }
  { const [ax, az] = P(0, -0.2); g.m(8, 0.4).add(rb(1.4, 0.04, 0.22, 0.03), T(ax, 0.5, az, 0, ry), 0xffffff, 0, 0.3); for (const e of [-1.1, 1.1]) { const [bx, bz] = P(e, -0.2); g.m(7, 0.2).add(BOX, T(bx, 0.24, bz, 0, ry, 0, 0.06, 0.48, 0.36), 0x3a3f48, 0, 0.6); } }
  { const [ax, az] = P(2.6, 0); g.m(7, 0.2).add(CYL8, T(ax, 0, az, 0, 0, 0, 0.05, 2.9, 0.05), 0x4a505a, 0, 0.6); g.m(0).add(rb(0.3, 0.3, 0.03, 0.03), T(ax, 2.6, az, 0, ry), 0x1f6bff, 0, 0.5); C.sign(ax + s * 0.04, 2.6, az + c * 0.04, ry, 0.5, 0.5, C.R.bike); C.circ(ax, az, 0.12, 2.9); }
  C.obb(...P(0, -0.55), 2, 0.18, ry, 2.7);
}
export function bin(C, x, z) { const g = C.G(x, z); g.m(7, 0.25).add(cyl(0.3, 0.34, 0.85, 12), T(x, 0, z), 0x3d7f5a, 0, 0.5); g.add(cyl(0.36, 0.3, 0.12, 12), T(x, 0.85, z), 0x2a2e36, 0, 0.5); g.m(0); C.circ(x, z, 0.36, 0.97); }
export function hydrant(C, x, z) { const g = C.G(x, z); g.m(0).add(lathe([[0, 0], [0.16, 0], [0.16, 0.06], [0.11, 0.08], [0.11, 0.55], [0.14, 0.58], [0.12, 0.66], [0.06, 0.76], [0, 0.78]], 12), T(x, 0, z), 0xc22a1e, 0, 0.6); for (const a of [0, PI]) g.add(CYL8, T(x, 0.42, z, PI / 2, a, 0, 0.055, 0.2, 0.055), 0xc22a1e, 0, 0.6); C.circ(x, z, 0.2, 0.78); }
export function bollard(C, x, z) { const g = C.G(x, z); g.m(7, 0.2).add(cyl(0.09, 0.08, 0.85, 10), T(x, 0, z), 0x4a505a, 0, 0.6); g.m(0).add(cyl(0.092, 0.092, 0.1, 10), T(x, 0.62, z), 0xf2c21a, 0.15, 0.6); C.circ(x, z, 0.1, 0.85); }
export function cone(C, x, z) { const g = C.G(x, z); g.m(0).add(lathe([[0, 0], [0.2, 0], [0.2, 0.03], [0.14, 0.04], [0.035, 0.6], [0, 0.6]], 10), T(x, 0, z), (px, py) => (py > 0.25 && py < 0.4 ? 0xf4f4f0 : 0xf0641e), 0, 0.4); }
export function roadSign(C, x, z, ry, kind) {
  const g = C.G(x, z), c = cos(ry), s = sin(ry);
  g.m(7, 0.2).add(CYL8, T(x, 0, z, 0, 0, 0, 0.04, 2.9, 0.04), 0x9aa0a8, 0, 0.7);
  g.m(0);
  if (kind == 0) { g.add(cyl(0.34, 0.34, 0.03, 20), T(x, 2.55, z, PI / 2, ry), 0x1f55c9, 0, 0.5); C.sign(x + s * 0.045, 2.55, z + c * 0.045, ry, 0.5, 0.5, C.R.bike); }
  else if (kind == 1) { g.add(cyl(0.34, 0.34, 0.03, 20), T(x, 2.55, z, PI / 2, ry), 0xf4f4f0, 0, 0.5); g.add(torus(0.29, 0.045, 20, 4), T(x + s * 0.02, 2.55, z + c * 0.02, 0, ry + PI / 2), 0xd41818, 0, 0.5); }
  else { g.add(rb(0.55, 0.16, 0.02, 0.02), T(x, 2.6, z, 0, ry), 0x1f55c9, 0, 0.5); C.sign(x + s * 0.03, 2.6, z + c * 0.03, ry, 1.04, 0.26, C.R.lane); }
  C.circ(x, z, 0.08, 2.9);
}
// 配电箱 / 报刊栏 / 快递柜
export function utilBox(C, x, z, ry, kind) {
  const g = C.G(x, z);
  if (kind == 0) { g.m(7, 0.25).add(rb(0.5, 0.75, 0.3, 0.04), T(x, 0.75, z, 0, ry), 0x56705a, 0, 0.4); C.obb(x, z, 0.5, 0.3, ry, 1.5); }
  else { g.m(7, 0.25).add(rb(1.4, 1, 0.28, 0.04), T(x, 1, z, 0, ry), 0xe9a31a, 0, 0.5); for (let i = -2; i <= 2; i++) for (let j = 0; j < 4; j++) g.m(0).add(BOX, T(x + cos(ry) * i * 0.52 + sin(ry) * 0.285, 0.35 + j * 0.44, z - sin(ry) * i * 0.52 + cos(ry) * 0.285, 0, ry, 0, 0.48, 0.4, 0.01), 0xf4c84a, 0, 0.6, 3); C.obb(x, z, 1.4, 0.28, ry, 2); }
  g.m(0);
}
