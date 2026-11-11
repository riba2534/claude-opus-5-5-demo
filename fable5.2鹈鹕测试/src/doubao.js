// 豆包与她的自行车：全部用基础几何体程序化建模，骑行姿态由两段 IK 实时求解
import { PI, TAU, sin, cos, hypot, max, min, lerp, smooth, clamp, atan2, sqrt, m4, mul, T, translate, rotX, rotY, rotZ, scale, aim, ik2, tp, ident, copy } from './math.js';
import { Geo, SPH, SPL, CYL, CYL8, BOX, CONE, sphere, capsule, rbox, torus, surf, lathe, mixc } from './geo.js';
import { mesh, draw, headMesh } from './gfx.js';
import HM from '../assets/doubao-head.json';

const SKIN = 0xf8dcd2, HAIR = 0x4a3029, TEE = 0x232323, SE = 0.05, DENIM = 0x4a6fb5, BLUE = 0x4d9bff, PALE = 0xbfe0fb;
// 车架几何（米，车身局部坐标：+Z 向前，+Y 向上，原点在两轮触地点中间）
const WR = 0.29, RA = [0, WR, -0.47], FA = [0, WR, 0.5], BB = [0, 0.26, -0.02], CR = 0.115, PX = 0.105;
const HT = [0, 0.8, 0.3], HB = [0, 0.62, 0.345], TAUK = 0.245, GRIP = [0.24, 0.89, 0.25];
const PEL = [0, 0.74, -0.2], SPINE = 0.34, UA = 0.19, FAL = 0.185, TH = 0.25, SHN = 0.26;
export const M = {}; // 网格表
let HEAD = null; // 官方头像生成的头模
export const GUNS = []; // 各武器枪口在枪局部坐标中的位置

export const tube = (g, a, b, r, col, e = 0, gl = 0.6, fl = 3) => {
  const m = aim(m4(), a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  g.add(CYL8, scale(m, r, hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), r), col, e, gl, fl);
};
// 以某点为中心的椭球/圆角盒的简写
export const E = (g, x, y, z, sx, sy, sz, col, e = 0, gl = 0.3, fl = 0, rx = 0, ry = 0, rz = 0) => g.add(SPH, T(x, y, z, rx, ry, rz, sx, sy, sz), col, e, gl, fl);

export function buildDoubao() {
  // ---------- 身体 ----------
  {
    let g = new Geo();
    // 官方形象的上衣：黑色圆领 T 恤 + 白色内领口；肩宽按官方半身像里头与肩的比例
    g.add(capsule(0.115, 0.1, 0.3, 16, 5), T(0, 0.02, 0), TEE, 0, 0.25);
    for (const s of [-1, 1]) E(g, 0.142 * s, 0.31, 0, 0.068, 0.06, 0.064, TEE, 0, 0.25);
    g.add(torus(0.068, 0.014, 20, 6), T(0, 0.396, 0.012, 0.2, 0, PI / 2), 0xf6efe9, 0.04, 0.3);
    M.torso = mesh(g, 0, 2);
    g = new Geo(); E(g, 0, 0, 0, 0.118, 0.092, 0.105, DENIM, 0, 0.25); M.hips = mesh(g, 0, 2);
    g = new Geo(); g.add(capsule(0.045, 0.04, UA, 10, 3), null, SKIN, SE, 0.4); g.add(capsule(0.054, 0.051, 0.06, 10, 3), null, TEE, 0, 0.25); M.uarm = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.039, 0.033, FAL, 10, 3), null, SKIN, SE, 0.4); E(g, 0, FAL + 0.012, 0, 0.042, 0.046, 0.042, SKIN, SE, 0.4); M.farm = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.06, 0.05, TH, 10, 3), null, SKIN, SE, 0.4); g.add(capsule(0.068, 0.064, 0.13, 10, 3), null, DENIM, 0, 0.25); M.thigh = mesh(g, 0, 4);
    g = new Geo(); g.add(capsule(0.047, 0.037, SHN, 10, 3), null, SKIN, SE, 0.4); g.add(capsule(0.041, 0.041, 0.05, 10, 3), T(0, SHN - 0.07, 0), 0xffffff, 0, 0.3); M.shin = mesh(g, 0, 4);
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
export const muzzle = [0, 0, 0], headPos = [0, 0, 0], headCam = [0, 0, 0];
const mS2 = m4();
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
  const lk = p.look || 0, cy_ = p.camY || 0, side = Math.abs(cy_) > 2.85 ? 2.85 : cy_;
  const leanF = 0.36 + sp * 0.2 - p.pitch * 0.5, tw = lerp(clamp(p.aimY, -2.2, 2.2) * 0.62, clamp(side, -1, 1) * 0.62, lk);
  ident(mT); translate(mT, px, py, pz); rotY(mT, tw * 0.35); rotX(mT, leanF); rotY(mT, tw * 0.65);
  put(M.torso, mT, 1, 1, 1, fl);
  // 头：官方头像充气成的头模，原点在脖子根部；抵消前倾并看向瞄准方向（look>0 时回头看镜头）
  const hy_ = clamp(lerp(p.aimY - tw, side - tw, lk), -1.5, 1.5);
  copy(mA, mT); translate(mA, 0, SPINE + 0.034, 0.012); rotX(mA, -leanF * 0.85); rotY(mA, hy_); rotX(mA, -clamp(p.aimP, -0.6, 0.7) * 0.6 * (1 - lk) + (p.nod || 0)); rotZ(mA, lk * 0.12 * Math.sign(hy_));
  mul(mB, B, mA);
  if (HEAD) { HEAD.matrix.fromArray(mB); HEAD.matrixWorldNeedsUpdate = true; HEAD.visible = true; }
  tp(mB, 0, 0.27, 0.04, headPos);
  // 画中画镜头的位置：大体在车头正前方，但跟着头转过去一部分，所以转头看得出来、又始终拍得到脸
  ident(mS2); translate(mS2, p.x, p.y, p.z); rotY(mS2, p.yaw + (tw + hy_) * 0.72); tp(mS2, -0.28, headPos[1] - p.y + 0.02, 1.6, headCam);
  // 左手握把（把位随转向移动）
  tp(mT, 0.152, SPINE - 0.035, 0, v0); tp(mS, GRIP[0], GRIP[1] + 0.01, GRIP[2], v2);
  ik2(v0[0], v0[1], v0[2], v2[0], v2[1], v2[2], UA, FAL + 0.02, 0.7, -1, -0.3, J);
  v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
  limb(M.uarm, v0, v1, 0, 0, 1, 1, 1, 1, fl); limb(M.farm, v1, v2, 0, 0, 1, 1, 1, 1, fl);
  // 右手持枪指向准星：瞄准方向转到车身局部坐标
  const wy = p.yaw + p.aimY, cp = cos(p.aimP), wx = sin(wy) * cp, wz = cos(wy) * cp, wyy = sin(p.aimP);
  let dx = B[0] * wx + B[1] * wyy + B[2] * wz, dy = B[4] * wx + B[5] * wyy + B[6] * wz, dz = B[8] * wx + B[9] * wyy + B[10] * wz;
  const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  tp(mT, -0.152, SPINE - 0.035, 0, v0);
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

// ---------- 豆包的头：3D 模型 + 官方原图 ----------
// 几何与侧面/后脑贴图来自用官方头像做图生 3D 得到的模型（tools/prep-head.mjs 裁剪、简化、量化）；
// 正面再把官方原图沿视线方向投影上去，所以从正面看就是官方那张脸，转到侧面和背面也有真实的头发体积。
const HS = 0.75, HOX = 0, HOZ = -0.045; // 头模缩放，以及脖子根部在模型坐标里的位置（y 取 HM.ycut）
export function buildHead(img, sideImg) {
  // 官方图抠图：从四周泛洪去掉白底与浅蓝圆底，边缘颜色向外扩几圈避免出现底色光晕
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0, S, S);
  const im = c.getImageData(0, 0, S, S), d = im.data, bgm = new Uint8Array(S * S), st = [];
  const isBg = i => { const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2]; return (R > 240 && G > 240 && B > 240) || (B > 228 && B - R > 14 && G > 196 && R > 150); };
  for (let i = 0; i < S; i++) st.push(i, (S - 1) * S + i, i * S, i * S + S - 1);
  while (st.length) { const i = st.pop(); if (bgm[i] || !isBg(i)) continue; bgm[i] = 1; const x = i % S; if (x > 0) st.push(i - 1); if (x < S - 1) st.push(i + 1); if (i >= S) st.push(i - S); if (i < S * (S - 1)) st.push(i + S); }
  for (let k = 0; k < 8; k++) { const add = []; for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) { const i = y * S + x; if (bgm[i] != 1) continue; for (const j of [i - 1, i + 1, i - S, i + S]) if (bgm[j] != 1) { add.push(i, j); break; } } for (let q = 0; q < add.length; q += 2) { const i = add[q], j = add[q + 1]; d[i * 4] = d[j * 4]; d[i * 4 + 1] = d[j * 4 + 1]; d[i * 4 + 2] = d[j * 4 + 2]; bgm[i] = 2; } }
  for (let i = 0; i < S * S; i++) d[i * 4 + 3] = bgm[i] ? 0 : 255;
  c.putImageData(im, 0, 0);
  // 解码量化几何：头部 [nv, ni, 包围盒] + u16 位置 + u16 贴图坐标 + u16 索引
  const raw = Uint8Array.from(atob(__HEADBIN__), ch => ch.charCodeAt(0)), dv = new DataView(raw.buffer), nv = dv.getUint32(0, true), ni = dv.getUint32(4, true);
  const mn = [0, 1, 2].map(k => dv.getFloat32(8 + k * 4, true)), sz = [0, 1, 2].map(k => dv.getFloat32(20 + k * 4, true)), org = [HOX, HM.ycut, HOZ];
  const q = new Uint16Array(raw.buffer, 32, nv * 3), qu = new Uint16Array(raw.buffer, 32 + nv * 6, nv * 2), ix = new Uint16Array(raw.buffer, 32 + nv * 10, ni);
  const g = { p: new Float32Array(nv * 3), n: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), i: Array.from(ix) }, P = g.p;
  for (let i = 0; i < nv * 3; i++) P[i] = (mn[i % 3] + (q[i] / 65535) * sz[i % 3] - org[i % 3]) * HS;
  for (let i = 0; i < nv * 2; i++) g.uv[i] = qu[i] / 65535;
  // 法线：贴图接缝两侧的顶点位置相同，按位置合并后再求面积加权法线，避免接缝处出现明暗断层
  const acc = new Map(), key = v => (q[v * 3] * 65536 + q[v * 3 + 1]) * 65536 + q[v * 3 + 2];
  for (let t = 0; t < ni; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, e = ix[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[e] - P[a], vy = P[e + 1] - P[a + 1], vz = P[e + 2] - P[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [ix[t], ix[t + 1], ix[t + 2]]) { const k = key(v); let o = acc.get(k); if (!o) acc.set(k, (o = [0, 0, 0])); o[0] += n[0]; o[1] += n[1]; o[2] += n[2]; }
  }
  for (let v = 0; v < nv; v++) { const o = acc.get(key(v)) || [0, 1, 0], l = hypot(o[0], o[1], o[2]) || 1; g.n[v * 3] = o[0] / l; g.n[v * 3 + 1] = o[1] / l; g.n[v * 3 + 2] = o[2] / l; }
  // 官方图的投影参数（模型 xy → 图片坐标），以及模型多补出来的那只右耳的位置（官方形象只露出左耳）
  const [CX, CY, SX, SY] = HM.align, e = HM.ear || [9, 9, 9];
  HEAD = headMesh(g, cv, sideImg, [CX + SX * HOX, 1 - CY + SY * HM.ycut, SX / HS, SY / HS], [(e[0] - HOX) * HS, (e[1] - HM.ycut) * HS, (e[2] - HOZ) * HS, 0.085 * HS]);
}
export const hideHead = () => { if (HEAD) HEAD.visible = false; };
// 停放的共享单车（复用豆包座驾的网格，换个车身颜色）
const pb = m4(), pl = m4();
export function drawBike(x, y, z, yaw, lean, r, g, b) {
  ident(pb); translate(pb, x, y, z); rotY(pb, yaw); rotZ(pb, lean);
  draw(M.frame, pb, r, g, b, 0);
  draw(M.wheel, rotX(translate(copy(pl, pb), RA[0], RA[1], RA[2]), 0.4), 1, 1, 1, 0);
  copy(pl, pb); translate(pl, HB[0], HB[1], HB[2]); rotX(pl, -TAUK); rotY(pl, 0.35); rotX(pl, TAUK); translate(pl, -HB[0], -HB[1], -HB[2]);
  draw(M.fork, pl, 1, 1, 1, 0); draw(M.wheel, translate(pl, FA[0], FA[1], FA[2]), 1, 1, 1, 0);
  draw(M.crank, rotX(translate(copy(pl, pb), BB[0], BB[1], BB[2]), 1), 1, 1, 1, 0);
}
