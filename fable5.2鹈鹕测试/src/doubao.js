// 豆包与她的自行车：全部用基础几何体程序化建模，骑行姿态由两段 IK 实时求解
import { PI, TAU, sin, cos, hypot, max, min, lerp, smooth, clamp, atan2, m4, mul, T, translate, rotX, rotY, rotZ, scale, aim, ik2, tp, ident, copy } from './math.js';
import { Geo, SPH, SPL, CYL, CYL8, BOX, CONE, sphere, capsule, rbox, torus, surf, lathe, mixc } from './geo.js';
import { mesh, draw } from './gfx.js';

const SKIN = 0xf9dccb, HAIR = 0x4a3029, TEE = 0x1e1e24, DENIM = 0x4a6fb5, BLUE = 0x4d9bff, PALE = 0xbfe0fb;
// 车架几何（米，车身局部坐标：+Z 向前，+Y 向上，原点在两轮触地点中间）
const WR = 0.29, RA = [0, WR, -0.47], FA = [0, WR, 0.5], BB = [0, 0.26, -0.02], CR = 0.115, PX = 0.105;
const HT = [0, 0.8, 0.3], HB = [0, 0.62, 0.345], TAUK = 0.245, GRIP = [0.24, 0.89, 0.25];
const PEL = [0, 0.74, -0.2], SPINE = 0.34, UA = 0.19, FAL = 0.185, TH = 0.25, SHN = 0.26;
export const M = {}; // 网格表
export const GUNS = []; // 各武器枪口在枪局部坐标中的位置

export const tube = (g, a, b, r, col, e = 0, gl = 0.6, fl = 3) => {
  const m = aim(m4(), a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  g.add(CYL8, scale(m, r, hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), r), col, e, gl, fl);
};
// 以某点为中心的椭球/圆角盒的简写
export const E = (g, x, y, z, sx, sy, sz, col, e = 0, gl = 0.3, fl = 0, rx = 0, ry = 0, rz = 0) => g.add(SPH, T(x, y, z, rx, ry, rz, sx, sy, sz), col, e, gl, fl);

export function buildDoubao() {
  // ---------- 头 ----------
  {
    const g = new Geo(), k = 0.2, H = (x, y, z, rx, ry, rz, sx, sy, sz) => T(x * k, y * k, z * k, rx, ry, rz, sx * k, (sy ?? sx) * k, (sz ?? sx) * k);
    g.add(sphere(32, 22), H(0, 0, 0, 0, 0, 0, 1, 0.97, 0.95), (x, y, z) => {
      const b = max(0, 1 - min(hypot(x - 0.5, y + 0.3, z - 0.76), hypot(x + 0.5, y + 0.3, z - 0.76)) / 0.36);
      return mixc(SKIN, 0xf29a8e, b * b * 0.7);
    }, 0, 0.42);
    // 侧分波波头：每一圈头发从脸部开口的左缘绕过后脑到右缘，开口边缘就是发际线
    const PART = 0.6;
    const hair = surf((u, v) => {
      const th = u * 2.74, y = cos(th);
      const aR = y > 0.72 ? PART : y > 0.12 ? lerp(-0.8, PART, (y - 0.12) / 0.6) : -0.8 + 0.14 * smooth(0.12, -0.8, y);
      const aL = y > 0.72 ? PART : y > 0.2 ? lerp(1.9, PART, (y - 0.2) / 0.52) : 1.9;
      const az = aL + v * (aR + TAU - aL), ed = smooth(0, 0.075, min(v, 1 - v));
      let rho = (y > 0 ? sin(th) : 1 - 0.13 * smooth(-0.5, -0.92, y)) * lerp(1.015, 1.12, lerp(1, ed, smooth(0.98, 0.6, y)));
      // 刘海在额前略微蓬起
      rho *= 1 + 0.05 * smooth(0.9, 0.2, y) * smooth(1.6, 0.6, Math.abs(az > PI ? az - TAU : az)) * ed;
      return [rho * sin(az), y * 1.1 + 0.02, rho * cos(az) * 0.99 - 0.02];
    }, 24, 56);
    g.add(hair, H(0, 0, 0, 0, 0, 0, 1), (x, y, z) => mixc(0x38231e, 0x60402f, smooth(-1, 1.1, y) * 0.75 + 0.25 * (0.5 + 0.5 * sin(atan2(x, z) * 23))), 0, 0.62, 0, 0, 0.55);
    // 耳朵、鼻子、嘴
    for (const s of [-1, 1]) g.add(SPH, H(0.955 * s, -0.1, 0.02, 0, 0, 0, 0.09, 0.17, 0.12), 0xf6cfbd, 0, 0.4);
    g.add(SPH, H(0, -0.3, 0.935, 0, 0, 0, 0.05, 0.04, 0.05), 0xf3c4b2, 0, 0.4);
    g.add(SPH, H(0, -0.5, 0.835, 0.5, 0, 0, 0.075, 0.024, 0.035), 0xd9707a, 0, 0.6);
    for (const s of [-1, 1]) {
      g.add(SPH, H(0.072 * s, -0.487, 0.828, 0.5, 0, 0.55 * s, 0.035, 0.017, 0.028), 0xd9707a, 0, 0.6);
      // 眉毛
      g.add(SPH, H(0.37 * s, 0.36, 0.842, -0.35, 0.4 * s, -0.1 * s, 0.17, 0.024, 0.03), 0x3b2620, 0, 0.3);
    }
    M.head = mesh(g, 0, 2);
    // 眼睛单独成网格，便于眨眼（沿 Y 压扁）
    const e = new Geo();
    for (const s of [-1, 1]) {
      const az = 0.4 * s, px = sin(az), pz = cos(az) * 0.95, R = (d, x = 0, y = 0) => [px * (0.935 + d) + cos(az) * x, y - 0.08, pz * (0.935 + d) - sin(az) * x];
      let q = R(0); e.add(SPH, H(q[0], q[1], q[2], 0, az, 0, 0.225, 0.285, 0.09), 0x2a1916, 0, 0.95);
      q = R(0.05); e.add(SPH, H(q[0], q[1] - 0.025, q[2], 0, az, 0, 0.15, 0.195, 0.05), 0x70482f, 0, 0.9);
      q = R(0.078); e.add(SPH, H(q[0], q[1] - 0.025, q[2], 0, az, 0, 0.085, 0.115, 0.03), 0x120a08, 0, 0.95);
      q = R(0.095, 0.085, 0.11); e.add(SPH, H(q[0], q[1], q[2], 0, az, 0, 0.062, 0.068, 0.02), 0xffffff, 0.3, 0.9);
      q = R(0.095, -0.075, -0.11); e.add(SPH, H(q[0], q[1], q[2], 0, az, 0, 0.028, 0.032, 0.012), 0xffffff, 0.25, 0.9);
      q = R(0.03, 0, 0.245); e.add(SPH, H(q[0], q[1], q[2], -0.2, az, -0.08 * s, 0.26, 0.05, 0.075), 0x1c100e, 0, 0.4);
    }
    M.eyes = mesh(e, 0, 2);
  }
  // ---------- 身体 ----------
  {
    let g = new Geo();
    g.add(capsule(0.105, 0.092, 0.3, 16, 5), T(0, 0.02, 0), TEE, 0, 0.25);
    for (const s of [-1, 1]) E(g, 0.118 * s, 0.305, 0, 0.064, 0.06, 0.062, TEE, 0, 0.25);
    g.add(CYL, T(0, 0.33, 0.004, 0, 0, 0, 0.042, 0.09, 0.042), 0xf1c9b6, 0, 0.4);
    g.add(torus(0.05, 0.014, 16, 6), T(0, 0.352, 0.004, 0, 0, PI / 2), 0x2c2c34, 0, 0.3);
    // 背上的浅蓝色对话气泡小背包
    g.add(rbox(0.092, 0.105, 0.05, 0.04, 3), T(0, 0.17, -0.128), PALE, 0, 0.55);
    g.add(rbox(0.052, 0.04, 0.012, 0.012, 2), T(0, 0.185, -0.178), 0xffffff, 0.06, 0.6);
    g.add(CONE, T(-0.024, 0.15, -0.18, 0, 0, 2.6, 0.016, 0.03, 0.008), 0xffffff, 0.06, 0.6);
    for (const s of [-1, 0, 1]) E(g, 0.022 * s, 0.186, -0.191, 0.007, 0.007, 0.004, BLUE, 0.2, 0.6);
    for (const s of [-1, 1]) g.add(rbox(0.014, 0.12, 0.012, 0.01, 1), T(0.07 * s, 0.23, 0.07, 0.28), 0x8fc4f5, 0, 0.4);
    M.torso = mesh(g, 0, 2);
    g = new Geo(); E(g, 0, 0, 0, 0.118, 0.092, 0.105, DENIM, 0, 0.25); M.hips = mesh(g, 0, 2);
    g = new Geo(); g.add(capsule(0.045, 0.04, UA, 10, 3), null, 0xf6d3c0, 0, 0.4); g.add(capsule(0.054, 0.051, 0.06, 10, 3), null, TEE, 0, 0.25); M.uarm = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.039, 0.033, FAL, 10, 3), null, 0xf6d3c0, 0, 0.4); E(g, 0, FAL + 0.012, 0, 0.042, 0.046, 0.042, SKIN, 0, 0.4); M.farm = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.06, 0.05, TH, 10, 3), null, 0xf6d3c0, 0, 0.4); g.add(capsule(0.068, 0.064, 0.13, 10, 3), null, DENIM, 0, 0.25); M.thigh = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.047, 0.037, SHN, 10, 3), null, 0xf6d3c0, 0, 0.4); g.add(capsule(0.041, 0.041, 0.05, 10, 3), T(0, SHN - 0.07, 0), 0xffffff, 0, 0.3); M.shin = mesh(g, 0, 4);
    g = new Geo();
    g.add(rbox(0.046, 0.034, 0.085, 0.03, 3), T(0, -0.04, 0.035), 0xffffff, 0, 0.5);
    g.add(rbox(0.048, 0.014, 0.088, 0.012, 2), T(0, -0.072, 0.035), BLUE, 0, 0.4);
    g.add(rbox(0.04, 0.02, 0.03, 0.018, 2), T(0, -0.035, 0.1), PALE, 0, 0.5);
    M.shoe = mesh(g, 0, 4);
  }
  // ---------- 自行车 ----------
  {
    let g = new Geo();
    const SC = [0, 0.6, -0.175];
    tube(g, HB, BB, 0.021, BLUE, 0, 0.85); tube(g, [0, 0.77, 0.307], SC, 0.019, BLUE, 0, 0.85); tube(g, BB, [0, 0.635, -0.195], 0.02, BLUE, 0, 0.85);
    tube(g, [0, 0.6, 0.35], [0, 0.82, 0.295], 0.026, BLUE, 0, 0.85);
    for (const s of [-1, 1]) { tube(g, [0.03 * s, BB[1], BB[2]], [0.045 * s, RA[1], RA[2]], 0.012, BLUE, 0, 0.85); tube(g, [0.02 * s, SC[1], SC[2]], [0.045 * s, RA[1], RA[2]], 0.011, BLUE, 0, 0.85); }
    g.add(CYL, T(-0.04, BB[1], BB[2], 0, 0, -PI / 2, 0.03, 0.08, 0.03), 0xdfe5ee, 0, 0.8, 3);
    tube(g, [0, 0.6, -0.185], [0, 0.66, -0.2], 0.012, 0xdfe5ee, 0, 0.9);
    g.add(rbox(0.062, 0.022, 0.1, 0.02, 3), T(0, 0.668, -0.215), 0x7a4a2a, 0, 0.5);
    g.add(rbox(0.03, 0.02, 0.06, 0.018, 2), T(0, 0.666, -0.11), 0x7a4a2a, 0, 0.5);
    // 链条与后挡泥板
    g.add(BOX, T(-0.052, 0.295, -0.245, -0.09, 0, 0, 0.006, 0.008, 0.45), 0x2a2d34, 0, 0.7, 3); g.add(BOX, T(-0.052, 0.222, -0.245, 0.07, 0, 0, 0.006, 0.008, 0.45), 0x2a2d34, 0, 0.7, 3);
    g.add(CYL, T(-0.058, RA[1], RA[2], 0, 0, -PI / 2, 0.035, 0.012, 0.035), 0x2a2d34, 0, 0.7, 3);
    const fender = (a0, a1) => surf((u, v) => { const a = lerp(a0, a1, u), r = 0.318 + 0.006 * sin(v * PI); return [(v - 0.5) * 0.07, r * cos(a), r * sin(a)]; }, 14, 4);
    g.add(fender(0.7, -1.9), T(0, RA[1], RA[2]), 0xf4f7fb, 0, 0.75, 0, 0, 0.8);
    // 后货架与小旗杆
    g.add(rbox(0.05, 0.006, 0.11, 0.005, 1), T(0, 0.635, -0.5), 0xdfe5ee, 0, 0.8, 3);
    for (const s of [-1, 1]) tube(g, [0.045 * s, RA[1], RA[2]], [0.045 * s, 0.632, -0.56], 0.006, 0xdfe5ee, 0, 0.8);
    M.frame = mesh(g, 0, 2);
    // 前叉总成（随转向转动）：前叉、把立、车把、车铃、车灯、车篮与里面的豆包（包子）
    g = new Geo();
    for (const s of [-1, 1]) tube(g, [0.03 * s, HB[1] + 0.01, HB[2]], [0.047 * s, FA[1], FA[2]], 0.012, 0xf4f7fb, 0, 0.8);
    tube(g, [0, 0.8, 0.3], [0, 0.875, 0.283], 0.014, 0xdfe5ee, 0, 0.9);
    tube(g, [-0.11, 0.882, 0.284], [0.11, 0.882, 0.284], 0.012, 0xdfe5ee, 0, 0.9);
    for (const s of [-1, 1]) { tube(g, [0.11 * s, 0.882, 0.284], [0.2 * s, 0.89, 0.255], 0.012, 0xdfe5ee, 0, 0.9); tube(g, [0.19 * s, 0.889, 0.258], [0.275 * s, 0.892, 0.24], 0.017, 0x7a4a2a, 0, 0.35, 0); }
    E(g, 0.13, 0.905, 0.28, 0.022, 0.018, 0.022, 0xffd24a, 0, 0.9, 3);
    g.add(CYL, T(0, 0.8, 0.345, PI / 2, 0, 0, 0.03, 0.04, 0.03), 0xdfe5ee, 0, 0.8, 3); g.add(CYL, T(0, 0.8, 0.386, PI / 2, 0, 0, 0.025, 0.004, 0.025), 0xfff3c0, 1, 0.8, 2);
    g.add(fender(-1.0, 1.1), T(0, FA[1], FA[2]), 0xf4f7fb, 0, 0.75, 0, 0, 0.8);
    const bk = [0, 0.71, 0.5], wk = 0xe6cf9f;
    g.add(rbox(0.11, 0.008, 0.085, 0.006, 1), T(bk[0], bk[1] - 0.075, bk[2]), wk, 0, 0.3);
    for (const s of [-1, 1]) { g.add(rbox(0.008, 0.075, 0.09, 0.006, 1), T(0.112 * s, bk[1], bk[2], 0, 0, -0.1 * s), wk, 0, 0.3); g.add(rbox(0.118, 0.075, 0.008, 0.006, 1), T(0, bk[1], bk[2] + 0.088 * s, 0.08 * s), wk, 0, 0.3); }
    tube(g, [0, 0.7, 0.36], [0, 0.66, 0.42], 0.008, 0xdfe5ee, 0, 0.8);
    g.add(lathe([[0, 0], [0.05, 0.004], [0.078, 0.03], [0.07, 0.066], [0.04, 0.09], [0.012, 0.1], [0, 0.102]], 16), T(0.02, bk[1] + 0.005, bk[2]), 0xfffaf0, 0, 0.35);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; tube(g, [0.02 + cos(a) * 0.012, bk[1] + 0.105, bk[2] + sin(a) * 0.012], [0.02 + cos(a + 0.5) * 0.06, bk[1] + 0.078, bk[2] + sin(a + 0.5) * 0.06], 0.004, 0xeadfc8, 0, 0.3, 0); }
    M.fork = mesh(g, 0, 2);
    // 车轮
    g = new Geo();
    g.add(torus(0.262, 0.028, 32, 8), null, 0x25272c, 0, 0.35); g.add(torus(0.236, 0.011, 32, 6), null, 0xdfe5ee, 0, 0.85, 3);
    g.add(CYL, T(-0.035, 0, 0, 0, 0, -PI / 2, 0.022, 0.07, 0.022), 0xdfe5ee, 0, 0.8, 3);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, s = i % 2 ? 0.02 : -0.02; tube(g, [s, 0, 0], [0, cos(a) * 0.236, sin(a) * 0.236], 0.0035, 0xe8edf3, 0, 0.8); }
    for (const a of [0.4, 0.4 + PI]) g.add(BOX, T(0, cos(a) * 0.16, sin(a) * 0.16, a, 0, 0, 0.012, 0.03, 0.07), 0xffa126, 0.35, 0.6);
    M.wheel = mesh(g, 0, 4);
    // 曲柄 + 牙盘
    g = new Geo();
    g.add(CYL, T(-0.056, 0, 0, 0, 0, -PI / 2, 0.075, 0.008, 0.075), 0xdfe5ee, 0, 0.85, 3);
    g.add(BOX, T(-0.075, CR / 2, 0, 0, 0, 0, 0.012, CR, 0.022), 0x2a2d34, 0, 0.7, 3); g.add(BOX, T(0.075, -CR / 2, 0, 0, 0, 0, 0.012, CR, 0.022), 0x2a2d34, 0, 0.7, 3);
    M.crank = mesh(g, 0, 2);
    g = new Geo(); g.add(rbox(0.04, 0.01, 0.032, 0.008, 1), null, 0x2a2d34, 0, 0.5, 3); g.add(BOX, T(0, 0, 0, 0, 0, 0, 0.07, 0.012, 0.012), 0xffa126, 0.3, 0.6); M.pedal = mesh(g, 0, 4);
  }
  // ---------- 四把玩具爆能枪（自然朝向 +Z，烘焙时转成沿 +Y 以配合 aim()）----------
  const GR = T(0, 0, 0, -PI / 2), GT = (...a) => mul(m4(), GR, T(...a));
  const gun = (f, mz) => { const g = new Geo(); f(g); M['gun' + GUNS.length] = mesh(g, 0, 2); GUNS.push(mz); };
  const W0 = 0xf4f6fa, DK = 0x2a2e38;
  gun(g => { // 豆豆冲锋枪
    g.add(rbox(0.024, 0.036, 0.1, 0.012, 2), GT(0, 0.035, 0.07), W0, 0, 0.6); g.add(rbox(0.018, 0.045, 0.022, 0.01, 2), GT(0, -0.02, 0, 0.25), DK, 0, 0.4);
    g.add(CYL8, GT(0, 0.04, 0.17, PI / 2, 0, 0, 0.014, 0.1, 0.014), DK, 0, 0.7, 3); g.add(CYL8, GT(0, 0.04, 0.25, PI / 2, 0, 0, 0.019, 0.03, 0.019), 0xff8a3c, 0.25, 0.6);
    g.add(rbox(0.015, 0.05, 0.02, 0.008, 2), GT(0, -0.03, 0.09, -0.15), BLUE, 0, 0.5); g.add(BOX, GT(0, 0.05, 0.07, 0, 0, 0, 0.05, 0.008, 0.12), 0x3fd0ff, 0.9, 0.5);
    g.add(rbox(0.008, 0.014, 0.03, 0.006, 1), GT(0, 0.082, 0.05), DK, 0, 0.5);
  }, [0, 0.04, 0.29]);
  gun(g => { // 爆米花霰弹枪
    g.add(rbox(0.026, 0.034, 0.11, 0.012, 2), GT(0, 0.035, 0.05), 0xffc94d, 0, 0.6); g.add(rbox(0.018, 0.045, 0.022, 0.01, 2), GT(0, -0.02, -0.02, 0.3), DK, 0, 0.4);
    for (const s of [-1, 1]) g.add(CYL8, GT(0.014 * s, 0.045, 0.15, PI / 2, 0, 0, 0.014, 0.22, 0.014), DK, 0, 0.75, 3);
    g.add(rbox(0.03, 0.02, 0.05, 0.012, 2), GT(0, 0.02, 0.24), 0xff6b4a, 0, 0.5); g.add(rbox(0.032, 0.022, 0.012, 0.008, 1), GT(0, 0.045, 0.365), 0xff6b4a, 0.2, 0.5);
    g.add(BOX, GT(0, 0.072, 0.05, 0, 0, 0, 0.02, 0.006, 0.16), 0xffffff, 0.5, 0.5);
  }, [0, 0.045, 0.39]);
  gun(g => { // 深度思考磁轨炮
    g.add(rbox(0.024, 0.04, 0.12, 0.012, 2), GT(0, 0.035, 0.04), 0x2f2a52, 0, 0.7, 3); g.add(rbox(0.018, 0.045, 0.022, 0.01, 2), GT(0, -0.02, -0.03, 0.3), DK, 0, 0.4);
    for (const s of [-1, 1]) g.add(BOX, GT(0.02 * s, 0.04, 0.33, 0, 0, 0, 0.008, 0.03, 0.42), 0xdfe5ee, 0, 0.9, 3);
    g.add(BOX, GT(0, 0.04, 0.32, 0, 0, 0, 0.018, 0.012, 0.4), 0xb07cff, 1, 0.6);
    for (let i = 0; i < 5; i++) g.add(torus(0.036, 0.007, 12, 5), GT(0, 0.04, 0.2 + i * 0.075, 0, PI / 2), 0xb07cff, 0.8, 0.6);
    g.add(CYL8, GT(0, 0.095, 0, PI / 2, 0, 0, 0.016, 0.1, 0.016), DK, 0, 0.6, 3); E(g, 0, 0.1, -0.095, 0.014, 0.014, 0.014, 0x7fd0ff, 0.8, 0.9);
  }, [0, 0.04, 0.55]);
  gun(g => { // 灵感火箭筒
    g.add(CYL, GT(0, 0.06, -0.14, PI / 2, 0, 0, 0.05, 0.5, 0.05), 0x35c98f, 0, 0.6); g.add(CYL, GT(0, 0.06, 0.32, PI / 2, 0, 0, 0.062, 0.06, 0.062), W0, 0, 0.6);
    g.add(CYL, GT(0, 0.06, -0.19, PI / 2, 0, 0, 0.06, 0.06, 0.06), W0, 0, 0.6); g.add(rbox(0.018, 0.045, 0.022, 0.01, 2), GT(0, -0.02, 0, 0.25), DK, 0, 0.4);
    g.add(CONE, GT(0, 0.06, 0.37, PI / 2, 0, 0, 0.04, 0.07, 0.04), 0xffd24a, 0.5, 0.6); g.add(rbox(0.012, 0.03, 0.03, 0.008, 1), GT(0, 0.125, 0.05), DK, 0, 0.5);
    g.add(BOX, GT(0, 0.06, 0.1, 0, 0, 0, 0.104, 0.02, 0.03), 0xffd24a, 0, 0.5);
  }, [0, 0.06, 0.44]);
}

// ---------- 姿态与绘制 ----------
const B = m4(), mT = m4(), mS = m4(), mA = m4(), mB = m4(), J = new Float32Array(6), v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0];
export const muzzle = [0, 0, 0], headPos = [0, 0, 0];
const put = (ms, local, r, g, b, a) => draw(ms, mul(mB, B, local), r, g, b, a);
// 画一段肢体：从 a 指向 b，z 轴尽量贴近 hint
const limb = (ms, a, b, hx, hy, hz, r, g, bl, al) => put(ms, aim(mA, a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2], hx, hy, hz), r, g, bl, al);

// p: {x,y,z,yaw,pitch,lean,steer,wheel,crank,aimY(相对车头的瞄准偏航),aimP(俯仰),recoil,sprint,blink,wpn,squash,fl(受击闪白),ped(踩踏量)}
export function drawDoubao(p) {
  const fl = p.fl || 0, sq = p.squash || 0;
  ident(B); translate(B, p.x, p.y, p.z); rotY(B, p.yaw); rotX(B, -p.pitch); rotZ(B, p.lean);
  if (sq) scale(B, 1 + sq * 0.12, 1 - sq * 0.18, 1 + sq * 0.12);
  // 车架、车轮、曲柄
  put(M.frame, ident(mA), 1, 1, 1, fl);
  put(M.wheel, rotX(translate(ident(mA), RA[0], RA[1], RA[2]), p.wheel), 1, 1, 1, fl);
  ident(mS); translate(mS, HB[0], HB[1], HB[2]); rotX(mS, -TAUK); rotY(mS, p.steer); rotX(mS, TAUK); translate(mS, -HB[0], -HB[1], -HB[2]);
  put(M.fork, mS, 1, 1, 1, fl);
  put(M.wheel, rotX(translate(copy(mA, mS), FA[0], FA[1], FA[2]), p.wheel), 1, 1, 1, fl);
  put(M.crank, rotX(translate(ident(mA), BB[0], BB[1], BB[2]), p.crank), 1, 1, 1, fl);
  const sp = p.sprint || 0, stand = sp * 0.05, sway = sin(p.crank) * 0.022 * sp;
  const px = PEL[0] + sway, py = PEL[1] + stand, pz = PEL[2] + sp * 0.03;
  // 腿：髋 → 脚踝（脚踝在踏板上方）
  for (const s of [-1, 1]) {
    const ph = p.crank + (s > 0 ? PI : 0), ex = PX * s, ey = BB[1] + cos(ph) * CR, ez = BB[2] + sin(ph) * CR;
    put(M.pedal, translate(ident(mA), ex * 1.08, ey, ez), 1, 1, 1, fl);
    const tilt = 0.12 - 0.22 * cos(ph);
    const ax = ex, ay = ey + 0.085 + 0.015 * cos(ph), az = ez - 0.045;
    const hx = px + 0.08 * s, hy = py - 0.035, hz = pz + 0.02;
    ik2(hx, hy, hz, ax, ay, az, TH, SHN, 0.32 * s, 0.25, 1, J);
    v0[0] = hx; v0[1] = hy; v0[2] = hz; v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
    limb(M.thigh, v0, v1, 0, 0, 1, 1, 1, 1, fl); limb(M.shin, v1, v2, 0, 0, 1, 1, 1, 1, fl);
    put(M.shoe, rotX(translate(ident(mA), v2[0], v2[1], v2[2]), tilt), 1, 1, 1, fl);
  }
  put(M.hips, translate(ident(mA), px, py, pz), 1, 1, 1, fl);
  // 躯干：前倾 + 朝瞄准方向扭转
  const leanF = 0.36 + sp * 0.2 - p.pitch * 0.5, tw = clamp(p.aimY, -2.2, 2.2) * 0.62;
  ident(mT); translate(mT, px, py, pz); rotY(mT, tw * 0.35); rotX(mT, leanF); rotY(mT, tw * 0.65);
  put(M.torso, mT, 1, 1, 1, fl);
  // 头：抵消前倾，看向瞄准方向
  const hy_ = clamp(p.aimY - tw, -1.25, 1.25);
  copy(mA, mT); translate(mA, 0, SPINE + 0.2, 0.012); rotX(mA, -leanF * 0.85); rotY(mA, hy_); rotX(mA, -clamp(p.aimP, -0.6, 0.7) * 0.7 + (p.nod || 0));
  mul(mB, B, mA); draw(M.head, mB, 1, 1, 1, fl);
  headPos[0] = mB[12]; headPos[1] = mB[13]; headPos[2] = mB[14];
  const bl = p.blink ?? 1;
  translate(mA, 0, -0.016, 0); scale(mA, 1, bl, 1); translate(mA, 0, 0.016, 0);
  put(M.eyes, mA, 1, 1, 1, fl);
  // 左手握把（把位随转向移动）
  tp(mT, 0.128, SPINE - 0.04, 0, v0); tp(mS, GRIP[0], GRIP[1] + 0.01, GRIP[2], v2);
  ik2(v0[0], v0[1], v0[2], v2[0], v2[1], v2[2], UA, FAL + 0.02, 0.7, -1, -0.3, J);
  v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
  limb(M.uarm, v0, v1, 0, 0, 1, 1, 1, 1, fl); limb(M.farm, v1, v2, 0, 0, 1, 1, 1, 1, fl);
  // 右手持枪指向准星：瞄准方向转到车身局部坐标
  const wy = p.yaw + p.aimY, cp = cos(p.aimP), wx = sin(wy) * cp, wz = cos(wy) * cp, wyy = sin(p.aimP);
  let dx = B[0] * wx + B[1] * wyy + B[2] * wz, dy = B[4] * wx + B[5] * wyy + B[6] * wz, dz = B[8] * wx + B[9] * wyy + B[10] * wz;
  const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  tp(mT, -0.128, SPINE - 0.04, 0, v0);
  const reach = 0.33 - (p.recoil || 0) * 0.07, rk = (p.recoil || 0) * 0.16;
  v2[0] = v0[0] + dx * reach; v2[1] = v0[1] + dy * reach + rk * 0.3 - 0.01; v2[2] = v0[2] + dz * reach;
  ik2(v0[0], v0[1], v0[2], v2[0], v2[1], v2[2], UA, FAL + 0.02, -0.5, -1, -0.2, J);
  v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
  limb(M.uarm, v0, v1, 0, 0, 1, 1, 1, 1, fl); limb(M.farm, v1, v2, 0, 0, 1, 1, 1, 1, fl);
  // 枪：沿瞄准方向，后坐时枪口上扬
  aim(mA, v2[0] + dx * 0.035, v2[1] + dy * 0.035, v2[2] + dz * 0.035, dx, dy + rk, dz, 0, -1, 0);
  mul(mB, B, mA); draw(M['gun' + p.wpn], mB, 1, 1, 1, fl);
  const g = GUNS[p.wpn]; tp(mB, g[0], g[2], -g[1], muzzle);
}
