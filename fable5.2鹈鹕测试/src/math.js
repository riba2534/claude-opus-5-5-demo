// 数学基础：标量工具、随机数、噪声、4x4 矩阵（列主序 Float32Array）
export const PI = Math.PI, TAU = PI * 2;
export const { sin, cos, abs, sqrt, min, max, floor, ceil, round, atan2, exp, pow, hypot, sign, random, asin, tan } = Math;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sat = x => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { x = sat((x - a) / (b - a)); return x * x * (3 - 2 * x); };
export const damp = (a, b, k, dt) => b + (a - b) * exp(-k * dt);
export const wrapPi = a => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };
export const dampAng = (a, b, k, dt) => a + wrapPi(b - a) * (1 - exp(-k * dt));
export const rnd = (a = 1, b) => (b === undefined ? random() * a : a + random() * (b - a));
export const pick = arr => arr[(random() * arr.length) | 0];

// 可复现随机数（mulberry32），世界生成用
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const h2 = (x, y) => { const n = sin(x * 127.1 + y * 311.7) * 43758.5453; return n - floor(n); };
export function vnoise(x, y) {
  const ix = floor(x), iy = floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), fx), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), fx), fy);
}
export function fbm(x, y, oct = 4) {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.3; y = y * 2.03 + 9.1; a *= 0.5; }
  return s;
}

// ---------- mat4 ----------
export const ident = m => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export const m4 = () => ident(new Float32Array(16));
export const copy = (o, a) => { o.set(a); return o; };
export function mul(o, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
    a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 16; i += 4) {
    const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2], b3 = b[i + 3];
    o[i] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    o[i + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    o[i + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    o[i + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return o;
}
// 以下均为右乘：m = m * X
export function translate(m, x, y, z) {
  m[12] += m[0] * x + m[4] * y + m[8] * z;
  m[13] += m[1] * x + m[5] * y + m[9] * z;
  m[14] += m[2] * x + m[6] * y + m[10] * z;
  return m;
}
export function rotX(m, a) {
  const c = cos(a), s = sin(a);
  for (let i = 0; i < 3; i++) { const u = m[4 + i], v = m[8 + i]; m[4 + i] = u * c + v * s; m[8 + i] = v * c - u * s; }
  return m;
}
export function rotY(m, a) {
  const c = cos(a), s = sin(a);
  for (let i = 0; i < 3; i++) { const u = m[i], v = m[8 + i]; m[i] = u * c - v * s; m[8 + i] = u * s + v * c; }
  return m;
}
export function rotZ(m, a) {
  const c = cos(a), s = sin(a);
  for (let i = 0; i < 3; i++) { const u = m[i], v = m[4 + i]; m[i] = u * c + v * s; m[4 + i] = v * c - u * s; }
  return m;
}
export function scale(m, x, y = x, z = x) {
  for (let i = 0; i < 3; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; }
  return m;
}
// 平移 → Y 旋转 → X 旋转 → Z 旋转 → 缩放，建模时最常用
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = m4();
  m[12] = x; m[13] = y; m[14] = z;
  if (ry) rotY(m, ry);
  if (rx) rotX(m, rx);
  if (rz) rotZ(m, rz);
  if (sx != 1 || sy != 1 || sz != 1) scale(m, sx, sy, sz);
  return m;
}
export function persp(m, fovy, asp, n, f) {
  const t = 1 / tan(fovy / 2);
  m.fill(0);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
  return m;
}
export function ortho(m, l, r, b, t, n, f) {
  m.fill(0);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
  return m;
}
export function lookAt(m, ex, ey, ez, tx, ty, tz, ux = 0, uy = 1, uz = 0) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz, l = 1 / (hypot(zx, zy, zz) || 1);
  zx *= l; zy *= l; zz *= l;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  l = 1 / (hypot(xx, xy, xz) || 1); xx *= l; xy *= l; xz *= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez); m[13] = -(yx * ex + yy * ey + yz * ez); m[14] = -(zx * ex + zy * ey + zz * ez); m[15] = 1;
  return m;
}
export function invert(o, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
    a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
    b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
    b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  d = 1 / (d || 1e-20);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return o;
}
// 变换点，结果写入 o（长度 3 的数组）
export function tp(m, x, y, z, o) {
  o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return o;
}
// 在 p 处建立正交基：Y 轴沿 d，Z 轴尽量贴近提示方向 h（肢体、枪械朝向用）
export function aim(m, px, py, pz, dx, dy, dz, hx = 0, hy = 0, hz = 1) {
  let l = 1 / (hypot(dx, dy, dz) || 1);
  dx *= l; dy *= l; dz *= l;
  let k = hx * dx + hy * dy + hz * dz;
  let zx = hx - dx * k, zy = hy - dy * k, zz = hz - dz * k;
  l = hypot(zx, zy, zz);
  if (l < 1e-4) { zx = dy; zy = -dx; zz = 0; l = hypot(zx, zy) || ((zx = 1), 1); }
  zx /= l; zy /= l; zz /= l;
  m[0] = dy * zz - dz * zy; m[1] = dz * zx - dx * zz; m[2] = dx * zy - dy * zx; m[3] = 0;
  m[4] = dx; m[5] = dy; m[6] = dz; m[7] = 0;
  m[8] = zx; m[9] = zy; m[10] = zz; m[11] = 0;
  m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
// 两段骨骼 IK：根 a、目标 t、骨长 l1/l2、肘/膝朝向提示 pole，返回关节位置写入 o
export function ik2(ax, ay, az, tx, ty, tz, l1, l2, px, py, pz, o) {
  let dx = tx - ax, dy = ty - ay, dz = tz - az, d = hypot(dx, dy, dz) || 1e-4;
  const dd = clamp(d, abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  dx /= d; dy /= d; dz /= d;
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = sqrt(max(l1 * l1 - a * a, 0));
  const k = px * dx + py * dy + pz * dz;
  let ox = px - dx * k, oy = py - dy * k, oz = pz - dz * k, l = hypot(ox, oy, oz) || 1;
  o[0] = ax + dx * a + (ox / l) * h; o[1] = ay + dy * a + (oy / l) * h; o[2] = az + dz * a + (oz / l) * h;
  // 目标超出臂展时返回夹紧后的末端位置
  o[3] = ax + dx * dd; o[4] = ay + dy * dd; o[5] = az + dz * dd;
  return o;
}
