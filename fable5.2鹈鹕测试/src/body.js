// 豆包的身体：一张连续的蒙皮网格——T 恤、短裤、手臂、带手指的手、腿、袜子、球鞋。
// 全部由代码建模；每帧在 CPU 上按姿态变形：躯干沿脊柱逐段前倾 / 扭转，手臂和腿在肘、膝处按关节角度逐顶点弯曲，
// 所以关节是连续的皮肤，而不是几段胶囊拼在一起。
import { PI, TAU, sin, cos, hypot, max, min, lerp, smooth, clamp, atan2, abs, m4, T, ident, translate, rotX, rotY, rotZ } from './math.js';
import { sphere, capsule, rbox, torus } from './geo.js';
import { bodyMesh } from './gfx.js';

export const UA = 0.19, FA = 0.185, TH = 0.25, SH = 0.26, SHO = [0.152, 0.305, 0], HIP = [0.08, -0.035, 0.02];
const SKIN = 0xf6cfc0, BLUSH = 0xf3b9aa, TEE = 0x1f1f21, RIB = 0xf4f0ea, DENIM = 0x3e5e9e, CUFF = 0x7c9bcc, SOCK = 0xf6f6f2, SHOE = 0xf7f8fa, BLUE = 0x4d9bff, PALE = 0xbfe0fb, OUTSOLE = 0x3f7fe0;
// 骨骼：0 躯干（沿高度在 TK 级矩阵之间插值）；其余每块一个矩阵，四肢再加一个弯曲角
const TORSO = 0, LEG = 1, FOOT = 3, ARM = 5, HAND = 7, NB = 9, TK = 8;
const V = { p: [], n: [], c: [], uv: [], k: [], part: [], w: [], i: [] };
const lin = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map(v => v ** 2.2);
const mixh = (a, b, t) => { t = clamp(t, 0, 1); let o = 0; for (const s of [16, 8, 0]) o |= (((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s; return o; };
const se = (c, n) => Math.sign(c) * abs(c) ** (2 / n); // 超椭圆
// 表格插值（Hermite 样条）：tab = [[t, 值...], ...]
function spl(tab, t) {
  let k = 0; while (k < tab.length - 2 && t > tab[k + 1][0]) k++;
  const a = tab[k], b = tab[k + 1], h = b[0] - a[0], u = clamp((t - a[0]) / h, 0, 1), p = tab[max(k - 1, 0)], q = tab[min(k + 2, tab.length - 1)], o = [], u2 = u * u, u3 = u2 * u;
  for (let c = 1; c < a.length; c++) {
    const m0 = k ? (b[c] - p[c]) / (b[0] - p[0]) : (b[c] - a[c]) / h, m1 = k + 2 < tab.length ? (q[c] - a[c]) / (q[0] - a[0]) : (b[c] - a[c]) / h;
    o.push((2 * u3 - 3 * u2 + 1) * a[c] + (u3 - 2 * u2 + u) * h * m0 + (3 * u2 - 2 * u3) * b[c] + (u3 - u2) * h * m1);
  }
  return o;
}
// 参数网格曲面：f(i, j, 未取模的 i) -> [x, y, z, u, v]；wrap 时 i 方向首尾相接。法线按网格差分求，接缝处连续
function grid(nu, nv, f, wrap = 1) {
  const p = [], n = [], uv = [], idx = [], W = nu + 1, P = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const q = f(wrap ? i % nu : i, j, i); P.push(q); p.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); }
  const at = (i, j) => P[clamp(j, 0, nv) * W + (wrap ? ((i % nu) + nu) % nu : clamp(i, 0, nu))];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1), ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    let x = vy * uz - vz * uy, y = vz * ux - vx * uz, z = vx * uy - vy * ux, l = hypot(x, y, z); // v × u：i 绕 +Y 逆时针、j 向上时法线朝外
    if (l < 1e-12) { x = vx; y = vy; z = vz; l = (j ? 1 : -1) * (hypot(x, y, z) || 1); } // 收成一个点的端面：法线沿轴向朝外
    n.push(x / l, y / l, z / l);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * W + i, b = a + W; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { p, n, i: idx, uv };
}
// 并入身体网格。part 骨骼；kid 材质（0 皮肤 1 棉布 2 牛仔 3 牛仔口袋 4 袜子 5 鞋）；col 颜色或 (x,y,z)=>颜色；m 建模矩阵；w 权重（数或 (x,y,z)=>数）；flip 翻面
function add(g, part, kid, col, m, w = 0, flip = 0) {
  const o = V.p.length / 3, P = g.p, N = g.n, fn = typeof col == 'function', wf = typeof w == 'function', M = m || I4;
  const a0 = M[0], a1 = M[1], a2 = M[2], b0 = M[4], b1 = M[5], b2 = M[6], c0 = M[8], c1 = M[9], c2 = M[10];
  const k00 = b1 * c2 - b2 * c1, k01 = b2 * c0 - b0 * c2, k02 = b0 * c1 - b1 * c0, k10 = c1 * a2 - c2 * a1, k11 = c2 * a0 - c0 * a2, k12 = c0 * a1 - c1 * a0, k20 = a1 * b2 - a2 * b1, k21 = a2 * b0 - a0 * b2, k22 = a0 * b1 - a1 * b0;
  const det = a0 * k00 + a1 * k01 + a2 * k02, sg = (det < 0 ? -1 : 1) * (flip ? -1 : 1);
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2], X = a0 * x + b0 * y + c0 * z + M[12], Y = a1 * x + b1 * y + c1 * z + M[13], Z = a2 * x + b2 * y + c2 * z + M[14];
    const nx = k00 * N[v] + k10 * N[v + 1] + k20 * N[v + 2], ny = k01 * N[v] + k11 * N[v + 1] + k21 * N[v + 2], nz = k02 * N[v] + k12 * N[v + 1] + k22 * N[v + 2], l = sg / (hypot(nx, ny, nz) || 1);
    V.p.push(X, Y, Z); V.n.push(nx * l, ny * l, nz * l); V.c.push(...lin(fn ? col(X, Y, Z) : col));
    V.uv.push(g.uv ? g.uv[(v / 3) * 2] : X, g.uv ? g.uv[(v / 3) * 2 + 1] : Y); V.k.push(kid); V.part.push(part); V.w.push(wf ? w(X, Y, Z) : w);
  }
  const I = g.i, f = sg < 0;
  for (let t = 0; t < I.length; t += 3) V.i.push(o + I[t], o + I[t + (f ? 2 : 1)], o + I[t + (f ? 1 : 2)]);
}
const I4 = m4();
// 绕 Y 轴的管状曲面：r(a, y) 给半径，y 从 y0 到 y1；a=0 朝 +X，a=90° 朝 +Z
const tube = (nu, nv, y0, y1, r) => grid(nu, nv, (i, j, ii) => { const a = (i / nu) * TAU, y = lerp(y0, y1, j / nv), q = r(a, y); return [q * cos(a), y, q * sin(a), (ii / nu) * TAU * 0.05, y]; });

// ---------- 躯干（T 恤）与短裤 ----------
// 截面表：[高度, 半宽, 前半厚, 后半厚, 前后偏移, 超椭圆指数]，原点在骨盆中心
const TS = [[-0.024, 0.114, 0.098, 0.103, 0.004, 2.4], [-0.016, 0.1275, 0.109, 0.1145, 0.004, 2.4], [0.02, 0.121, 0.103, 0.107, 0.002, 2.3], [0.09, 0.11, 0.091, 0.093, 0, 2.3], [0.16, 0.113, 0.095, 0.09, 0.002, 2.3],
  [0.225, 0.121, 0.101, 0.09, 0.004, 2.3], [0.27, 0.128, 0.096, 0.088, 0.002, 2.2], [0.3, 0.126, 0.084, 0.082, 0, 2.1], [0.325, 0.108, 0.07, 0.074, -0.002, 2], [0.348, 0.08, 0.059, 0.064, -0.004, 2], [0.368, 0.0605, 0.053, 0.056, -0.004, 2]];
const SS = [[-0.112, 0.004, 0.004, 0.004, 0, 2.2], [-0.106, 0.06, 0.05, 0.06, 0, 2.2], [-0.092, 0.097, 0.08, 0.092, 0, 2.3], [-0.07, 0.118, 0.098, 0.108, 0.002, 2.3], [-0.04, 0.123, 0.103, 0.111, 0.003, 2.3], [0, 0.119, 0.101, 0.107, 0.003, 2.3], [0.045, 0.111, 0.095, 0.099, 0.002, 2.3]];
const ring = (tab, a, y) => { const [rx, rf, rb, cz, n] = spl(tab, y), s = sin(a); return [rx * se(cos(a), n), cz + (s > 0 ? rf : rb) * se(s, n)]; };
function torso() {
  // T 恤：前倾时肚子前面会挤出几道横向的褶子
  const fold = (a, y) => 0.0038 * smooth(-0.01, 0.04, y) * smooth(0.19, 0.08, y) * (0.3 + 0.7 * max(sin(a), 0)) * sin(y * 205 + 2.2 * sin(a + 0.5) + 0.8 * sin(3 * a));
  add(grid(40, 58, (i, j, ii) => { const a = (i / 40) * TAU, y = lerp(-0.024, 0.368, j / 58), [x, z] = ring(TS, a, y), k = 1 + fold(a, y) / 0.1; return [x * k, y, z * k, (ii / 40) * 0.7, y]; }), TORSO, 1, TEE, null, (x, y) => smooth(-0.02, 0.24, y));
  // 领口里露出的一小圈皮肤（脖子根）
  add(grid(24, 3, (i, j) => { const a = (i / 24) * TAU, t = j / 3, [x, z] = ring(TS, a, 0.366); return [x * 0.86 * (1 - t), 0.364 + 0.012 * t, lerp(-0.004 + (z + 0.004) * 0.86, -0.004, t), 0, 0]; }), TORSO, 0, SKIN, null, 1);
  // 圆领：黑色罗纹领口 + 里面露出的一圈白边（官方形象的领口）
  add(torus(0.0565, 0.0125, 28, 8), TORSO, 1, TEE, T(0, 0.37, -0.0025, 0.05, 0, PI / 2, 1, 1, 0.9), 1);
  add(torus(0.05, 0.0075, 28, 6), TORSO, 4, RIB, T(0, 0.3795, -0.0025, 0.05, 0, PI / 2, 1, 1, 0.9), 1);
  // 短裤的裆部
  add(grid(36, 22, (i, j, ii) => { const a = (i / 36) * TAU, y = lerp(-0.112, 0.045, j / 22), [x, z] = ring(SS, a, y); return [x, y, z, (ii / 36) * 0.7, y]; }), TORSO, 2, DENIM);
  // 后裤兜：贴着臀部曲面的两块布，底边是尖角，边上有明线（着色器里画）
  for (const s of [-1, 1]) add(grid(8, 7, (i, j) => {
    const u = i / 8, v = j / 7, a = 1.5 * PI + s * lerp(0.2, 0.98, u), y = lerp(-0.024, -0.07 - 0.013 * (1 - abs(2 * u - 1)), v), [x, z] = ring(SS, a, y), k = 1 + 0.004 / 0.1;
    return [x * k, y, z * k, u, v];
  }, 0), TORSO, 3, mixh(DENIM, 0x1a2a50, 0.12), null, 0, s > 0);
}
// ---------- 腿：短裤的裤腿（跟大腿走）+ 连续的腿 + 袜子（跟小腿走）。局部坐标：原点在髋，+Y 指向膝，+Z 是膝盖弯过去的一侧（腿肚子那面）----------
const LS = [[-0.03, 0.064], [0.03, 0.0645], [0.1, 0.061], [0.18, 0.055], [0.235, 0.0495], [TH, 0.0475], [0.275, 0.046], [0.32, 0.0475], [0.38, 0.043], [0.45, 0.035], [0.5, 0.0305], [0.53, 0.03]];
function leg(k) {
  const skin = (a, y) => spl(LS, y)[0] + 0.004 * smooth(0.2, 0.25, y) * smooth(0.3, 0.25, y) * max(-sin(a), 0) + 0.0065 * smooth(0.27, 0.33, y) * smooth(0.44, 0.34, y) * max(sin(a), 0) ** 2;
  add(tube(24, 44, -0.03, 0.525, skin), LEG + k, 0, (x, y, z) => mixh(SKIN, BLUSH, 0.7 * smooth(0.2, 0.25, y) * smooth(0.31, 0.26, y) * smooth(0.01, -0.03, z)), null, (x, y) => smooth(TH - 0.05, TH + 0.05, y));
  // 裤腿：外层、卷边、往里翻的一圈（看得出布料的厚度）
  const PS = [[0, -0.076, 0.001], [1, -0.069, 0.032], [2, -0.05, 0.058], [3, -0.02, 0.0735], [4, 0.02, 0.0742], [5, 0.06, 0.0725], [6, 0.097, 0.0725], [7, 0.1, 0.0758], [8, 0.119, 0.0766], [9, 0.1215, 0.073], [10, 0.118, 0.0665], [11, 0.1, 0.0645]];
  add(grid(24, 40, (i, j, ii) => { const a = (i / 24) * TAU, [y, r] = spl(PS, (j / 40) * 11); return [r * cos(a), y, r * sin(a), (ii / 24) * 0.45, y]; }),
    LEG + k, 2, (x, y, z) => (y > 0.099 && hypot(x, z) > 0.07 ? CUFF : hypot(x, z) < 0.07 && y > 0.09 ? mixh(DENIM, 0, 0.45) : DENIM));
  // 袜子：比小腿略粗一圈，袜口有罗纹
  add(tube(24, 12, 0.418, 0.53, (a, y) => spl(LS, y)[0] + 0.0042 * smooth(0.416, 0.424, y) + 0.0011 * cos(a * 22) * smooth(0.475, 0.46, y)), LEG + k, 4, SOCK, null, 1);
}
// ---------- 球鞋。局部坐标：原点在脚踝，+Z 朝脚尖，鞋底在 y=-0.088 ----------
function shoe(k) {
  const NS = 22, Z0 = -0.054, LEN = 0.172, YB = -0.064, tOf = i => 0.5 - 0.5 * cos((PI * i) / NS);
  // 鞋底轮廓的半宽：前掌宽、后跟窄，两头收圆
  const hw = t => lerp(0.035, 0.0445, smooth(0, 0.6, t)) * (1 - 0.22 * smooth(0.68, 1, t)) * (1 - abs(2 * t - 1) ** 5) ** 0.45;
  const HT = [[0, 0.056], [0.08, 0.066], [0.24, 0.07], [0.34, 0.064], [0.46, 0.049], [0.6, 0.038], [0.78, 0.031], [0.92, 0.023], [1, 0.006]];
  // 鞋面：沿脚长方向一道道拱形截面
  add(grid(NS, 14, (i, j) => { const t = tOf(i), b = (j / 14) * PI, w = hw(t) * 0.955, h = spl(HT, t)[0]; return [w * se(cos(b), 2.7), YB + h * se(sin(b), 2.2), Z0 + LEN * t, t, j / 14]; }, 0), FOOT + k, 5,
    (x, y, z) => (z > 0.078 ? PALE : z < -0.032 && y < -0.012 ? BLUE : SHOE));
  // 两侧各一道斜向的装饰条
  for (const s of [-1, 1]) add(rbox(0.0022, 0.0065, 0.03, 0.002, 1), FOOT + k, 5, BLUE, T(s * 0.0372, -0.044, 0.012, 0.42, s * 0.1));
  // 中底与外底：绕轮廓一圈
  const LV = [[-0.064, 0.0025], [-0.067, 0], [-0.083, 0], [-0.088, 0.005], [-0.088, 1]];
  add(grid(NS * 2, 4, (i, j, ii) => { const s = i < NS ? 1 : -1, t = tOf(i < NS ? i : 2 * NS - i), [y, ins] = LV[j], w = max(hw(t) - (ins < 1 ? ins : 9), 0) * s; return [ins < 1 ? w : 0, y, Z0 + LEN * (ins < 1 ? lerp(t, 0.5, ins * 6) : t), ii / (NS * 2), j / 4]; }), FOOT + k, 5, (x, y) => (y < -0.0815 ? OUTSOLE : 0xfbfbf8), null, 0, 1);
  // 鞋口的软包边、鞋舌、鞋带
  add(torus(0.035, 0.0095, 20, 8), FOOT + k, 5, BLUE, T(0, -0.011, -0.008, -0.1, 0, PI / 2, 1, 1, 1.12));
  add(rbox(0.0175, 0.022, 0.0055, 0.005, 2), FOOT + k, 5, PALE, T(0, -0.012, 0.032, -0.72));
  for (const t of [0.5, 0.58, 0.66, 0.735]) add(capsule(0.0028, 0.0028, 0.03, 6, 2), FOOT + k, 5, 0xffffff, T(-0.015, YB + spl(HT, t)[0] + 0.0015, Z0 + LEN * t, 0, 0, -PI / 2));
}
// ---------- 手臂：短袖（跟上臂走）+ 连续的手臂。局部坐标：原点在肩，+Y 指向肘，+Z 是前臂弯过去的一侧 ----------
const AS = [[-0.02, 0.046], [0.08, 0.0435], [0.16, 0.0405], [UA, 0.0395], [0.215, 0.041], [0.25, 0.0405], [0.32, 0.0335], [0.362, 0.0288], [0.378, 0.0275]];
function arm(k) {
  add(tube(20, 36, -0.02, UA + FA + 0.003, (a, y) => spl(AS, y)[0] + 0.003 * smooth(0.16, UA, y) * smooth(0.225, UA, y) * max(-sin(a), 0)), ARM + k, 0,
    (x, y, z) => mixh(SKIN, BLUSH, 0.6 * smooth(0.16, UA, y) * smooth(0.225, UA, y) * smooth(0.01, -0.03, z)), null, (x, y) => smooth(UA - 0.04, UA + 0.04, y));
  // 短袖：肩头是个球冠，袖口略微外翻，再往里翻一圈
  const SL = [[0, -0.061, 0.001], [1, -0.054, 0.03], [2, -0.038, 0.05], [3, -0.014, 0.0615], [4, 0.015, 0.0635], [5, 0.05, 0.061], [6, 0.085, 0.06], [7, 0.097, 0.0618], [8, 0.0985, 0.058], [9, 0.094, 0.0525], [10, 0.08, 0.051]];
  add(grid(20, 30, (i, j, ii) => { const a = (i / 20) * TAU, [y, r] = spl(SL, (j / 30) * 10); return [r * cos(a), y, r * sin(a) * 1.04, (ii / 20) * 0.4, y]; }), ARM + k, 1, (x, y, z) => (hypot(x, z) < 0.056 && y > 0.07 ? 0x0c0c0d : TEE));
}
// ---------- 手：手掌 + 四指（各三节）+ 拇指，按"握住一根圆柱"的姿势摆好。局部坐标：原点在手腕，+Y 指向指尖，掌心朝 -Z，拇指在 ts 一侧 ----------
// rb 被握物体的半径：手指沿着绕它的圆弧弯曲；idx 食指另给一组弯曲角（扣扳机）
function hand(k, ts, rb, idx) {
  const part = HAND + k, R = rb + 0.0072;
  add(sphere(14, 9), part, 0, SKIN, T(0, 0.002, 0, 0, 0, 0, 0.0275, 0.03, 0.0235));
  add(rbox(0.027, 0.03, 0.0118, 0.0115, 3), part, 0, SKIN, T(0, 0.032, 0));
  for (let f = 0; f < 4; f++) {
    const L = [0.044, 0.048, 0.045, 0.036][f], ls = [L * 0.45, L * 0.31, L * 0.24], r0 = f == 3 ? 0.0068 : 0.0078;
    // 三节指骨搭在半径 R 的圆上：相邻两节之间的弯曲角 = 两段弦所对圆心角之和的一半
    const th = ls.map(l => 2 * Math.asin(min(l / (2 * R), 0.95))), c = f == 0 && idx ? idx : [0.12 + th[0] / 2, (th[0] + th[1]) / 2, (th[1] + th[2]) / 2];
    const m = T(ts * (0.0205 - f * 0.0137), 0.06 - abs(f - 1.3) * 0.0022, 0, 0, 0, ts * (f - 1.5) * 0.03);
    ls.forEach((l, s) => { rotX(m, -c[s]); add(capsule(r0 - s * 0.0006, r0 - (s + 1) * 0.0006, l, 8, 3), part, 0, s == 0 ? mixh(SKIN, BLUSH, 0.35) : SKIN, m); translate(m, 0, l, 0); });
  }
  // 拇指：从掌根侧面伸出，绕到被握物体的另一侧，和四指对握
  const m = T(ts * 0.0255, 0.015, -0.003, 0, 0, -ts * 0.55); rotX(m, -0.95); rotY(m, -ts * 0.5);
  add(capsule(0.0092, 0.0084, 0.025, 8, 3), part, 0, SKIN, m); translate(m, 0, 0.025, 0); rotX(m, -0.3); rotZ(m, ts * 0.45);
  add(capsule(0.0082, 0.0068, 0.021, 8, 3), part, 0, SKIN, m);
  return [0, 0.056, -R]; // 被握圆柱的轴线经过的点（手的局部坐标）
}

// ---------- 蒙皮 ----------
let MESH, RP, RN, WT, OP, ON, RNG;
const BM = Array.from({ length: NB }, m4), BEND = new Float32Array(NB), PIV = [0, TH, TH, 0, 0, UA, UA, 0, 0], TL = Array.from({ length: TK }, m4);
export let GRIPL, GRIPR; // 左手握车把、右手握枪柄时，被握物体轴线在手局部坐标里的位置
export function buildBody() {
  torso();
  for (const k of [0, 1]) { leg(k); shoe(k); arm(k); }
  GRIPL = hand(0, 1, 0.0135); GRIPR = hand(1, -1, 0.02, [0.34, 0.5, 0.3]);
  // 按骨骼排序，蒙皮时每块骨骼处理一段连续的顶点
  const nv = V.part.length, ord = Array.from({ length: nv }, (_, i) => i).sort((a, b) => V.part[a] - V.part[b] || a - b), inv = new Uint32Array(nv);
  RP = new Float32Array(nv * 3); RN = new Float32Array(nv * 3); WT = new Float32Array(nv); RNG = new Uint32Array(NB + 1);
  const c = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), kk = new Float32Array(nv);
  ord.forEach((s, d) => { inv[s] = d; for (let e = 0; e < 3; e++) { RP[d * 3 + e] = V.p[s * 3 + e]; RN[d * 3 + e] = V.n[s * 3 + e]; c[d * 3 + e] = V.c[s * 3 + e]; } uv[d * 2] = V.uv[s * 2]; uv[d * 2 + 1] = V.uv[s * 2 + 1]; kk[d] = V.k[s]; WT[d] = V.w[s]; RNG[V.part[s] + 1] = d + 1; });
  for (let b = 1; b <= NB; b++) RNG[b] = max(RNG[b], RNG[b - 1]);
  OP = new Float32Array(nv * 3); ON = new Float32Array(nv * 3);
  MESH = bodyMesh({ p: OP, n: ON, c, uv, k: kk, i: V.i.map(i => inv[i]) });
}
// 躯干姿态：骨盆在 (px,py,pz)，整体前倾 lean、朝瞄准方向扭转 tw；越往上转得越多。返回胸腔的矩阵（肩和头挂在它上面）
export function setTorso(px, py, pz, tw, lean) {
  for (let k = 0; k < TK; k++) { const s = k / (TK - 1), m = TL[k]; ident(m); translate(m, px, py, pz); rotY(m, tw * 0.35 * s); rotX(m, lean * (0.22 + 0.78 * s)); rotY(m, tw * 0.65 * s); }
  return TL[TK - 1];
}
export const pelvis = () => TL[0];
// 四肢：根、中间关节、末端三点定出骨架平面；极向量只在几乎伸直时用来定朝向
export function setLimb(k, r, m, e, px, py, pz) {
  const A = BM[k]; let yx = m[0] - r[0], yy = m[1] - r[1], yz = m[2] - r[2], l = hypot(yx, yy, yz) || 1; yx /= l; yy /= l; yz /= l;
  let dx = e[0] - m[0], dy = e[1] - m[1], dz = e[2] - m[2]; l = hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  const c = dx * yx + dy * yy + dz * yz; let zx = dx - yx * c, zy = dy - yy * c, zz = dz - yz * c; const sn = hypot(zx, zy, zz);
  if (sn < 0.03) { const q = px * yx + py * yy + pz * yz; zx = yx * q - px; zy = yy * q - py; zz = yz * q - pz; }
  l = hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  A[0] = yy * zz - yz * zy; A[1] = yz * zx - yx * zz; A[2] = yx * zy - yy * zx; A[4] = yx; A[5] = yy; A[6] = yz; A[8] = zx; A[9] = zy; A[10] = zz; A[12] = r[0]; A[13] = r[1]; A[14] = r[2];
  BEND[k] = atan2(sn, c);
}
export const setRigid = (k, m) => BM[k].set(m);
export const hideBody = () => { if (MESH) MESH.visible = false; };
// 按当前姿态算出所有顶点（车身局部坐标），world 是车身的世界矩阵
export function skinBody(world) {
  const P = RP, N = RN, O = OP, Q = ON;
  for (let v = RNG[0]; v < RNG[1]; v++) { // 躯干：相邻两级矩阵之间线性插值
    const s = WT[v] * (TK - 1), k = min(s | 0, TK - 2), f = s - k, g = 1 - f, a = TL[k], b = TL[k + 1], o = v * 3, x = P[o], y = P[o + 1], z = P[o + 2], nx = N[o], ny = N[o + 1], nz = N[o + 2];
    O[o] = (a[0] * x + a[4] * y + a[8] * z + a[12]) * g + (b[0] * x + b[4] * y + b[8] * z + b[12]) * f;
    O[o + 1] = (a[1] * x + a[5] * y + a[9] * z + a[13]) * g + (b[1] * x + b[5] * y + b[9] * z + b[13]) * f;
    O[o + 2] = (a[2] * x + a[6] * y + a[10] * z + a[14]) * g + (b[2] * x + b[6] * y + b[10] * z + b[14]) * f;
    Q[o] = (a[0] * nx + a[4] * ny + a[8] * nz) * g + (b[0] * nx + b[4] * ny + b[8] * nz) * f;
    Q[o + 1] = (a[1] * nx + a[5] * ny + a[9] * nz) * g + (b[1] * nx + b[5] * ny + b[9] * nz) * f;
    Q[o + 2] = (a[2] * nx + a[6] * ny + a[10] * nz) * g + (b[2] * nx + b[6] * ny + b[10] * nz) * f;
  }
  for (let b = 1; b < NB; b++) { // 四肢：关节附近的顶点绕关节轴转过"权重 × 弯曲角"，再整体变换到骨骼上
    const A = BM[b], be = BEND[b], L = PIV[b], c1 = cos(be), s1 = sin(be), a0 = A[0], a1 = A[1], a2 = A[2], a4 = A[4], a5 = A[5], a6 = A[6], a8 = A[8], a9 = A[9], a10 = A[10], tx = A[12], ty = A[13], tz = A[14];
    for (let v = RNG[b]; v < RNG[b + 1]; v++) {
      const o = v * 3, w = WT[v], x = P[o], nx = N[o]; let y = P[o + 1], z = P[o + 2], ny = N[o + 1], nz = N[o + 2];
      if (w > 0 && be) { const c = w == 1 ? c1 : cos(w * be), s = w == 1 ? s1 : sin(w * be), yy = y - L, t = ny; y = L + yy * c - z * s; z = yy * s + z * c; ny = t * c - nz * s; nz = t * s + nz * c; }
      O[o] = a0 * x + a4 * y + a8 * z + tx; O[o + 1] = a1 * x + a5 * y + a9 * z + ty; O[o + 2] = a2 * x + a6 * y + a10 * z + tz;
      Q[o] = a0 * nx + a4 * ny + a8 * nz; Q[o + 1] = a1 * nx + a5 * ny + a9 * nz; Q[o + 2] = a2 * nx + a6 * ny + a10 * nz;
    }
  }
  const g = MESH.geometry.attributes; g.position.needsUpdate = g.normal.needsUpdate = true;
  MESH.matrix.fromArray(world); MESH.matrixWorldNeedsUpdate = true; MESH.visible = true;
}
