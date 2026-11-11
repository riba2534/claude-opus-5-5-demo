// 程序化几何：所有模型都由这里的基础体拼装烘焙而成，不加载任何外部模型
import { PI, TAU, sin, cos, hypot, asin, clamp, sqrt, m4 } from './math.js';

// 旋转体：prof 为自下而上的轮廓点 [半径, 高度, (可选法线 nr, ny)]，相邻重复点形成硬边
export function lathe(prof, seg = 16) {
  const p = [], n = [], idx = [], N = prof.length, pn = [];
  for (let i = 0; i < N; i++) {
    if (prof[i].length > 2) { pn.push([prof[i][2], prof[i][3]]); continue; }
    let nx = 0, ny = 0;
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= N - 1) continue;
      const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1], l = hypot(dr, dy);
      if (l > 1e-6) { nx += dy / l; ny -= dr / l; }
    }
    const l = hypot(nx, ny) || 1;
    pn.push([nx / l, ny / l]);
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU, c = cos(a), s = sin(a);
      p.push(prof[i][0] * c, prof[i][1], prof[i][0] * s);
      n.push(pn[i][0] * c, pn[i][1], pn[i][0] * s);
    }
  const W = seg + 1;
  for (let i = 0; i < N - 1; i++) {
    if (hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) < 1e-6) continue;
    for (let j = 0; j < seg; j++) {
      const a = i * W + j, b = a + W;
      if (prof[i][0] > 1e-6) idx.push(a, b, a + 1);
      if (prof[i + 1][0] > 1e-6) idx.push(b, b + 1, a + 1);
    }
  }
  return { p, n, i: idx };
}
export const sphere = (seg = 16, rings = 10) =>
  lathe(Array.from({ length: rings + 1 }, (_, k) => { const t = -PI / 2 + (PI * k) / rings; return [cos(t), sin(t), cos(t), sin(t)]; }), seg);
// 锥形胶囊：下球心在原点半径 r0，上球心在 y=len 半径 r1
export function capsule(r0, r1, len, seg = 12, rings = 4) {
  const al = asin(clamp((r0 - r1) / len, -1, 1)), pr = [];
  for (let k = 0; k <= rings; k++) { const t = -PI / 2 + ((al + PI / 2) * k) / rings; pr.push([r0 * cos(t), r0 * sin(t), cos(t), sin(t)]); }
  for (let k = 0; k <= rings; k++) { const t = al + ((PI / 2 - al) * k) / rings; pr.push([r1 * cos(t), len + r1 * sin(t), cos(t), sin(t)]); }
  return lathe(pr, seg);
}
// 圆台/圆柱（带盖），y 从 0 到 h
export const cyl = (r0 = 1, r1 = 1, h = 1, seg = 14) => lathe([[0, 0], [r0, 0], [r0, 0], [r1, h], [r1, h], [0, h]], seg);

export function box(hx = 0.5, hy = 0.5, hz = 0.5) {
  const p = [], n = [], i = [], h = [hx, hy, hz];
  for (let f = 0; f < 6; f++) {
    const a = f >> 1, s = f & 1 ? -1 : 1, b = (a + 1) % 3, c = (a + 2) % 3, o = p.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = [0, 0, 0], nn = [0, 0, 0];
      q[a] = s * h[a]; q[b] = su * h[b]; q[c] = sv * h[c]; nn[a] = s;
      p.push(...q); n.push(...nn);
    }
    s > 0 ? i.push(o, o + 1, o + 2, o, o + 2, o + 3) : i.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  return { p, n, i };
}
// 圆角盒：把球面按八个卦限拆开后各自外推，面是真正的平面、棱角是圆弧
export function rbox(hx, hy, hz, r, k = 3) {
  r = Math.min(r, hx, hy, hz);
  const p = [], n = [], idx = [], rows = 2 * k + 2, colsN = 4 * k + 4;
  for (let i = 0; i < rows; i++) {
    const top = i > k, la = top ? ((PI / 2) * (i - k - 1)) / k : -PI / 2 + ((PI / 2) * i) / k, sy = top ? 1 : -1;
    for (let j = 0; j < colsN; j++) {
      const q = (j / (k + 1)) | 0, lo = ((q + (j - q * (k + 1)) / k) * PI) / 2;
      const sx = q == 0 || q == 3 ? 1 : -1, sz = q < 2 ? 1 : -1;
      const nx = cos(la) * cos(lo), ny = sin(la), nz = cos(la) * sin(lo);
      p.push(sx * (hx - r) + nx * r, sy * (hy - r) + ny * r, sz * (hz - r) + nz * r);
      n.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < colsN; j++) {
      const a = i * colsN + j, b = a + colsN, j2 = (j + 1) % colsN, d = i * colsN + j2, c = d + colsN;
      idx.push(a, b, d, b, c, d);
    }
  const o = p.length / 3;
  for (const s of [1, -1]) for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) { p.push(sx * (hx - r), s * hy, sz * (hz - r)); n.push(0, s, 0); }
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3, o + 4, o + 6, o + 5, o + 4, o + 7, o + 6);
  return { p, n, i: idx };
}
// 圆环，位于 YZ 平面（轮轴沿 X）
export function torus(R, r, seg = 24, tube = 8) {
  const p = [], n = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    for (let j = 0; j <= tube; j++) {
      const b = (j / tube) * TAU, q = R + r * cos(b);
      p.push(r * sin(b), q * cos(a), q * sin(a));
      n.push(sin(b), cos(b) * cos(a), cos(b) * sin(a));
    }
  }
  const W = tube + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) { const a = i * W + j, b = a + W; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { p, n, i: idx };
}
// 由参数曲面采样生成网格：f(u,v) -> [x,y,z]，法线按面积加权自动计算
export function surf(f, nu, nv) {
  const p = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) p.push(...f(i / nu, j / nv));
  const W = nv + 1;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * W + j, b = a + W; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { p, n: normals(p, idx), i: idx };
}
export function normals(p, idx) {
  const n = new Array(p.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

// 常用单位基础体缓存
export const SPH = sphere(20, 14), SPL = sphere(10, 7), CYL = cyl(1, 1, 1, 16), CYL8 = cyl(1, 1, 1, 8), BOX = box(), CONE = cyl(1, 0, 1, 14);

const I4 = m4();
// 几何累加器：把基础体按矩阵变换后烘焙进同一个网格，顶点自带颜色/自发光/光泽等材质参数
export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.l = [0, 0, 64]; }
  // 设置后续图元使用的材质层：lay 层号，bump 凹凸强度 0..1，cyl 是否用柱面投影（树干、立柱）
  m(lay = 0, bump = 0.25, cyl = 0) { this.l = [lay, cyl ? 255 : 0, (bump * 255) | 0]; return this; }
  // col: 0xRRGGBB 或 (x,y,z)=>0xRRGGBB（按局部坐标着色）；e 自发光；g 光泽；fl: 2=仅夜间发光 3=金属；sw 随风摆动权重；two 双面
  add(pr, m, col, e = 0, g = 0.3, fl = 0, sw = 0, two = 0) {
    m = m || I4;
    const { p, n, c, i } = this, o = p.length / 3, P = pr.p, Nn = pr.n;
    const a0 = m[0], a1 = m[1], a2 = m[2], b0 = m[4], b1 = m[5], b2 = m[6], c0 = m[8], c1 = m[9], c2 = m[10];
    // 法线用余子式矩阵变换，非均匀缩放也正确
    const k00 = b1 * c2 - b2 * c1, k01 = b2 * c0 - b0 * c2, k02 = b0 * c1 - b1 * c0,
      k10 = c1 * a2 - c2 * a1, k11 = c2 * a0 - c0 * a2, k12 = c0 * a1 - c1 * a0,
      k20 = a1 * b2 - a2 * b1, k21 = a2 * b0 - a0 * b2, k22 = a0 * b1 - a1 * b0;
    const det = a0 * k00 + a1 * k01 + a2 * k02, fn = typeof col == 'function';
    const E = (e * 255) | 0, Gl = (g * 255) | 0, F1 = fl == 3 ? 128 : 0, F2 = fl == 2 ? 255 : 0, SW = (sw * 255) | 0, [l0, l1, l2] = this.l;
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2], nx = Nn[v], ny = Nn[v + 1], nz = Nn[v + 2];
      p.push(a0 * x + b0 * y + c0 * z + m[12], a1 * x + b1 * y + c1 * z + m[13], a2 * x + b2 * y + c2 * z + m[14]);
      let X = k00 * nx + k10 * ny + k20 * nz, Y = k01 * nx + k11 * ny + k21 * nz, Z = k02 * nx + k12 * ny + k22 * nz;
      const l = (det < 0 ? -1 : 1) / (hypot(X, Y, Z) || 1);
      n.push(X * l, Y * l, Z * l);
      const h = fn ? col(x, y, z) : col;
      c.push(h >> 16, (h >> 8) & 255, h & 255, E, Gl, F1, SW, F2, l0, l1, l2, 0);
    }
    const I = pr.i, f = det < 0;
    for (let t = 0; t < I.length; t += 3) i.push(o + I[t], o + I[t + (f ? 2 : 1)], o + I[t + (f ? 1 : 2)]);
    if (two) {
      const o2 = p.length / 3, cnt = o2 - o;
      for (let v = 0; v < cnt; v++) {
        const s = (o + v) * 3, q = (o + v) * 12;
        p.push(p[s], p[s + 1], p[s + 2]); n.push(-n[s], -n[s + 1], -n[s + 2]);
        c.push((c[q] * two) | 0, (c[q + 1] * two) | 0, (c[q + 2] * two) | 0, c[q + 3], c[q + 4], c[q + 5], c[q + 6], c[q + 7], c[q + 8], c[q + 9], c[q + 10], 0);
      }
      for (let t = 0; t < I.length; t += 3) i.push(o2 + I[t], o2 + I[t + (f ? 1 : 2)], o2 + I[t + (f ? 2 : 1)]);
    }
    return this;
  }
}

// 颜色插值（0xRRGGBB）
export function mixc(a, b, t) {
  t = clamp(t, 0, 1);
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t, g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t, bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (r << 16) | (g << 8) | (bl | 0);
}
export { sqrt };
