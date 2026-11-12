// 豆包与她的自行车：自行车和玩具枪用基础几何体拼装；人物的身体见 body.js，头见本文件末尾。骑行姿态由两段 IK 实时求解
import { PI, TAU, sin, cos, hypot, max, min, lerp, smooth, clamp, atan2, rng, m4, mul, T, translate, rotX, rotY, rotZ, scale, aim, ik2, tp, ident, copy } from './math.js';
import { Geo, SPH, CYL, CYL8, BOX, CONE, rbox, torus, surf, lathe, normals } from './geo.js';
import { mesh, draw, headMesh, charU } from './gfx.js';
import { buildBody, setTorso, pelvis, setLimb, setRigid, skinBody, hideBody, GRIPL, GRIPR, SHO, HIP } from './body.js';
import HM from '../assets/doubao-head.json';

const BLUE = 0x4d9bff;
// 车架几何（米，车身局部坐标：+Z 向前，+Y 向上，原点在两轮触地点中间）
const WR = 0.29, RA = [0, WR, -0.47], FA = [0, WR, 0.5], BB = [0, 0.26, -0.02], CR = 0.115, PX = 0.105;
const HT = [0, 0.8, 0.3], HB = [0, 0.62, 0.345], TAUK = 0.245, GA = [0.19, 0.889, 0.258], GB = [0.275, 0.892, 0.24]; // GA→GB 是左握把的轴线
const PEL = [0, 0.74, -0.2], SPINE = 0.34, UA = 0.19, FAL = 0.185, TH = 0.25, SHN = 0.26, GRZ = [0, -0.02, -0.03, 0]; // GRZ：各把枪握把的前后位置
export const M = {}; // 网格表
let HEAD = null, lookSide = 1; // 头模；回头时转向哪一侧
export const GUNS = []; // 各武器枪口在枪局部坐标中的位置

export const tube = (g, a, b, r, col, e = 0, gl = 0.6, fl = 3) => {
  const m = aim(m4(), a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  g.add(CYL8, scale(m, r, hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), r), col, e, gl, fl);
};
// 以某点为中心的椭球/圆角盒的简写
export const E = (g, x, y, z, sx, sy, sz, col, e = 0, gl = 0.3, fl = 0, rx = 0, ry = 0, rz = 0) => g.add(SPH, T(x, y, z, rx, ry, rz, sx, sy, sz), col, e, gl, fl);

export function buildDoubao() {
  buildBody();
  // 手相对于被握物体的固定位置：左手在前叉坐标系里握车把，右手在枪的坐标系里握枪柄
  frameOf(HL, [GA[0] - GB[0], GA[1] - GB[1], GA[2] - GB[2]], [0, -0.35, 0.94], [(GA[0] + GB[0]) / 2, (GA[1] + GB[1]) / 2, (GA[2] + GB[2]) / 2], GRIPL);
  GRZ.forEach((z, k) => frameOf((HR[k] = m4()), [0, -cos(0.25), -sin(0.25)], [0, 0, 1], [0, -0.02, z], [0.006, GRIPR[1], GRIPR[2]]));
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
    for (const s of [-1, 1]) { tube(g, [0.11 * s, 0.882, 0.284], [0.2 * s, 0.89, 0.255], 0.012, 0xdfe5ee, 0, 0.9); tube(g, [GA[0] * s, GA[1], GA[2]], [GB[0] * s, GB[1], GB[2]], 0.0135, 0x7a4a2a, 0, 0.35, 0); E(g, GB[0] * s, GB[1], GB[2], 0.006, 0.0165, 0.0165, 0x5a3520, 0, 0.35); }
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
const B = m4(), mS = m4(), mA = m4(), mB = m4(), mH = m4(), mG = m4(), J = new Float32Array(6), v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0];
const HL = m4(), HR = [], GR = T(0, 0, 0, -PI / 2);
export const muzzle = [0, 0, 0], headPos = [0, 0, 0], headCam = [0, 0, 0], dbg = { blink: -1 }; // dbg.blink：调试时固定眨眼程度
const mS2 = m4();
const put = (ms, local, r, g, b, a) => draw(ms, mul(mB, B, local), r, g, b, a);
// 手的坐标系：X 沿被握物体的轴线，Y 尽量朝 f，原点取在"物体轴线经过手局部坐标 g 点"的位置
function frameOf(m, X, f, c, g) {
  let l = hypot(...X); X = X.map(v => v / l); const k = X[0] * f[0] + X[1] * f[1] + X[2] * f[2]; let Y = f.map((v, i) => v - X[i] * k); l = hypot(...Y); Y = Y.map(v => v / l);
  const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  for (let i = 0; i < 3; i++) { m[i] = X[i]; m[4 + i] = Y[i]; m[8 + i] = Z[i]; m[12 + i] = c[i] - X[i] * g[0] - Y[i] * g[1] - Z[i] * g[2]; }
}

// p: {x,y,z,yaw,pitch,lean,steer,wheel,crank,aimY(相对车头的瞄准偏航),aimP(俯仰),recoil,sprint,wpn,squash,fl(受击闪白),nod,look(回头看镜头的程度),camY(镜头相对车头的方位)}
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
  // 躯干：前倾 + 朝瞄准方向扭转。镜头在正后方附近时固定朝一侧回头（开始回头时选定，中途不换边，避免头从一侧瞬间甩到另一侧）
  const lk = p.look || 0, cy_ = p.camY || 0;
  if (lk < 0.05) lookSide = cy_ < 0 && cy_ > -2.85 ? -1 : 1;
  const side = Math.abs(cy_) < 2 ? cy_ : lookSide * min(Math.abs(cy_), 2.85);
  const leanF = 0.36 + sp * 0.2 - p.pitch * 0.5, tw = lerp(clamp(p.aimY, -2.2, 2.2) * 0.62, clamp(side, -1, 1) * 0.62, lk);
  const mT = setTorso(px, py, pz, tw, leanF);
  // 腿：髋 → 脚踝（脚踝在踏板上方），膝盖朝前外侧
  for (const s of [1, -1]) {
    const k = s > 0 ? 0 : 1, ph = p.crank + (s > 0 ? PI : 0), ex = PX * s, ey = BB[1] + cos(ph) * CR, ez = BB[2] + sin(ph) * CR;
    put(M.pedal, translate(ident(mA), ex * 1.08, ey, ez), 1, 1, 1, fl);
    tp(pelvis(), HIP[0] * s, HIP[1], HIP[2], v0);
    ik2(v0[0], v0[1], v0[2], ex, ey + 0.085 + 0.015 * cos(ph), ez - 0.045, TH, SHN, 0.32 * s, 0.25, 1, J);
    v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
    setLimb(1 + k, v0, v1, v2, 0.32 * s, 0.25, 1);
    setRigid(3 + k, rotX(translate(ident(mA), v2[0], v2[1], v2[2]), 0.12 - 0.22 * cos(ph)));
  }
  // 头：原点在脖子根部；抵消前倾并看向瞄准方向（look>0 时回头看镜头）
  const hy_ = clamp(lerp(p.aimY - tw, side - tw, lk), -1.5, 1.5);
  copy(mH, mT); translate(mH, 0, SPINE + 0.034, 0.002); rotX(mH, -leanF * 0.85); rotY(mH, hy_); rotX(mH, -clamp(p.aimP, -0.6, 0.7) * 0.6 * (1 - lk) + (p.nod || 0)); rotZ(mH, lk * 0.12 * Math.sign(hy_));
  mul(mB, B, mH);
  if (HEAD) { HEAD.matrix.fromArray(mB); HEAD.matrixWorldNeedsUpdate = true; HEAD.visible = true; }
  tp(mB, 0, 0.27, 0.04, headPos);
  // 画中画镜头的位置：大体在车头正前方，但跟着头转过去一部分，所以转头看得出来、又始终拍得到脸
  ident(mS2); translate(mS2, p.x, p.y, p.z); rotY(mS2, p.yaw + (tw + hy_) * 0.72); tp(mS2, -0.28, headPos[1] - p.y + 0.02, 1.6, headCam);
  // 左手握车把（把位随转向移动），手腕的位置由握把反推，再解出肩—肘—腕
  mul(mA, mS, HL); setRigid(7, mA);
  tp(mT, SHO[0], SHO[1], SHO[2], v0);
  ik2(v0[0], v0[1], v0[2], mA[12], mA[13], mA[14], UA, FAL, 0.7, -1, -0.3, J);
  v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
  setLimb(5, v0, v1, v2, 0.7, -1, -0.3);
  // 右手持枪指向准星：瞄准方向转到车身局部坐标
  const wy = p.yaw + p.aimY, cp = cos(p.aimP), wx = sin(wy) * cp, wz = cos(wy) * cp, wyy = sin(p.aimP);
  let dx = B[0] * wx + B[1] * wyy + B[2] * wz, dy = B[4] * wx + B[5] * wyy + B[6] * wz, dz = B[8] * wx + B[9] * wyy + B[10] * wz;
  const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  tp(mT, -SHO[0], SHO[1], SHO[2], v0);
  // 枪：沿瞄准方向，后坐时枪口上扬；手握在枪柄上，手腕的位置同样由枪反推
  const reach = 0.365 - (p.recoil || 0) * 0.07, rk = (p.recoil || 0) * 0.16;
  aim(mG, v0[0] + dx * reach, v0[1] + dy * reach + rk * 0.3 - 0.01, v0[2] + dz * reach, dx, dy + rk, dz, 0, -1, 0);
  mul(mA, mul(mB, mG, GR), HR[p.wpn]); setRigid(8, mA);
  ik2(v0[0], v0[1], v0[2], mA[12], mA[13], mA[14], UA, FAL, -0.5, -1, -0.2, J);
  v1[0] = J[0]; v1[1] = J[1]; v1[2] = J[2]; v2[0] = J[3]; v2[1] = J[4]; v2[2] = J[5];
  setLimb(6, v0, v1, v2, -0.5, -1, -0.2);
  mul(mB, B, mG); draw(M['gun' + p.wpn], mB, 1, 1, 1, fl);
  const g = GUNS[p.wpn]; tp(mB, g[0], g[2], -g[1], muzzle);
  // 眨眼：隔几秒眨一下，偶尔连眨两下；挨打时闭眼
  const t = performance.now() / 1000, c1 = t % 3.7, c2 = (t + 1.3) % 11.3;
  charU.uBlink.value = dbg.blink >= 0 ? dbg.blink : max(c1 < 0.17 ? sin((c1 / 0.17) * PI) : 0, c2 < 0.15 ? sin((c2 / 0.15) * PI) : 0, min(fl * 2, 1));
  charU.uFl.value = fl;
  skinBody(B);
}

// ---------- 豆包的头：图生 3D 模型的形状 + 官方原图 ----------
// 形状来自用官方头像做图生 3D 得到的模型：tools/prep-head.mjs 把它的最外层表面重新采样成一张规则的半径图
// （上半是半球、下半是圆柱的参数化），头发和皮肤分区平滑。这里由半径图重建出布线规整的网格，
// 再加上发束起伏、参差的发梢、头发底面和脖子；正面沿视线方向投影官方原图，所以从正面看就是官方那张脸。
const HS = 0.75, HOZ = -0.045; // 头模缩放，以及脖子中轴在模型坐标里的 z（y 取 HM.ycut）
export function buildHead(img) {
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
  // 半径图：[列数, 半球行数, 圆柱行数, 球心高度, 半径量程] + 每列下沿高度 u16 + 半径 u16 + 头发权重 u8
  const raw = Uint8Array.from(atob(__HEADBIN__), ch => ch.charCodeAt(0)), dv = new DataView(raw.buffer);
  const NU = dv.getUint16(0, true), ND = dv.getUint16(2, true), NC = dv.getUint16(4, true), YC = dv.getFloat32(8, true), RM = dv.getFloat32(12, true), NR = ND + 1 + NC;
  const yb = new Uint16Array(raw.buffer, 16, NU), rr = new Uint16Array(raw.buffer, 16 + NU * 2, NU * NR), hh = new Uint8Array(raw.buffer, 16 + NU * 2 + NU * NR * 2, NU * NR);
  // 发束：把一圈分成宽窄不一的 NL 束，每束的截面是一段圆弧（束与束之间是沟）；q 是"发流坐标"——
  // 头顶上头发从偏左的发缝向两侧梳开，到了侧面和后脑就是绕头一圈的方位角
  const R0 = rng(11), NL = 34, lb = [0], lr = [], la = [], lp = [];
  for (let k = 0; k < NL; k++) { lb.push(lb[k] + 0.45 + R0() * R0() * 1.6); lr.push(R0()); la.push(0.35 + 0.65 * R0()); lp.push(R0() * TAU); }
  const XP = 0.09, ZCR = -0.04, Y0 = YC + 0.06, Y1 = YC + 0.2;
  const flow = (x, y, z) => { const dx = x - XP, dz = z - ZCR, f = smooth(-0.045, 0.075, dz) * smooth(Y0, Y1, y); return atan2((dx < 0 ? -1 : 1) * max(Math.abs(dx), 0.22 * f), dz); };
  const lock = (q, y = 0) => { let t = ((q / TAU + 1.5) % 1) * lb[NL]; t = clamp(t + 0.1 * sin(y * 14 + t * 2.3), 0, lb[NL] - 1e-4); let k = 0; while (lb[k + 1] < t) k++; const u = ((t - lb[k]) / (lb[k + 1] - lb[k])) * 2 - 1; return [(1 - u * u) * la[k] + 0.22 * (0.5 + 0.5 * cos(u * (4 + 5 * lr[k]) + lp[k])), lr[k]]; };
  const KC = [0.06, 0.18, 0.42, 0.74, 1], KN = 6, RN = 0.076, YB = HM.ycut - 0.022, NT = NR + KC.length + KN; // 脖子只往领口里伸一小截：头会相对躯干后仰，伸长了会从胸口戳出来
  const P = new Float32Array(NU * NT * 3), A = new Float32Array(NU * NT * 3), idx = [];
  let r0 = 0; for (let i = 0; i < NU; i++) r0 += rr[i] / NU; // 极点那一行所有列是同一个点
  for (let i = 0; i < NU; i++) {
    const th = (i / NU) * TAU, st_ = sin(th), ct = cos(th), hR = hh[(NR - 1) * NU + i] / 255;
    const rb = (rr[(NR - 1) * NU + i] / 65535) * RM, [lt, lv] = lock(flow(rb * st_, -0.1, rb * ct));
    const yB = yb[i] / 65535 - 0.5 - hR * (0.007 * lt + 0.009 * lv - 0.004); // 发梢：每束中间长一点，束与束长短不一
    let rx = 0, ry = 0, rz = 0;
    for (let j = 0; j < NR; j++) {
      const o = (j * NU + i) * 3, h = hh[j * NU + i] / 255;
      let r = ((j ? rr[j * NU + i] : r0) / 65535) * RM, x, y, z, fz;
      if (j <= ND) { const ph = ((j / ND) * PI) / 2; x = r * sin(ph) * st_; y = YC + r * cos(ph); z = r * sin(ph) * ct; fz = sin(ph) * ct; }
      else { const t = (j - ND) / NC; r *= 1 - 0.05 * hR * smooth(0.72, 1, t) ** 2; x = r * st_; y = YC - (YC - yB) * t; z = r * ct; fz = ct; }
      // 发束起伏：正面（投影官方原图的区域）和头顶发缝附近减弱
      const part = 1 - smooth(-0.045, 0.075, z - ZCR) * smooth(Y0, Y1, y) * smooth(0.06, 0, Math.abs(x - XP)); // 发缝上不起伏，否则两侧的发束在这里错开一道棱
      const k = 1 + (0.0085 * (lock(flow(x, y, z), y)[0] - 0.5) * h * part * (1 - 0.92 * smooth(-0.15, 0.45, fz)) * (0.3 + 0.7 * smooth(Y1 + 0.12, Y0 - 0.18, y))) / (r || 1);
      P[o] = rx = x * k; P[o + 1] = ry = y; P[o + 2] = rz = z * k; A[o] = h; A[o + 1] = 1;
    }
    // 底面：从发梢 / 下颌线向内收到脖子，头发的底面往上翻、颜色压暗，看上去是实心的发量而不是空壳
    const yN = ry + (hR > 0.5 ? 0.04 : 0.012);
    KC.forEach((s_, k) => {
      const j = NR + k, o = (j * NU + i) * 3, lip = sin(PI * min(s_ * 2.4, 1)) * (0.004 + 0.006 * hR);
      P[o] = lerp(rx, RN * st_, s_); P[o + 1] = ry + (yN - ry) * s_ * s_ - lip; P[o + 2] = lerp(rz, HOZ + RN * ct, s_);
      A[o] = hR; A[o + 1] = 1 - (hR > 0.5 ? 0.82 : 0.3) * smooth(0, 0.4, s_);
    });
    for (let k = 1; k <= KN; k++) {
      const j = NR + KC.length + k - 1, o = (j * NU + i) * 3, t = k / KN, rn = lerp(RN, 0.06, smooth(0, 0.5, t)) - 0.003 * sin(PI * t) - 0.008 * smooth(0.8, 1, t);
      P[o] = rn * st_; P[o + 1] = lerp(yN, YB, t); P[o + 2] = HOZ + rn * ct; A[o] = 0; A[o + 1] = 0.72 + 0.28 * t;
    }
    for (let j = 0; j < NT - 1; j++) { const a = j * NU + i, b = j * NU + ((i + 1) % NU); if (j) idx.push(a, a + NU, b); idx.push(b, a + NU, b + NU); }
  }
  // 官方图是沿 +Z 投影上去的，只该落在"从正面看得见"的那层表面上：耳朵后面的头发、鬓发挡住的脸颊不能也印上一份。
  // 沿 Z 方向做一张深度图（每个像素记最靠前的表面），顶点比它靠后就不接受投影
  const ZN = 256, zb = new Float32Array(ZN * ZN).fill(-9), zx = x => (x + 0.42) * (ZN / 0.84), zy = y => (y + 0.4) * (ZN / 0.9);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3, ax = zx(P[a]), ay = zy(P[a + 1]), bx = zx(P[b]), by = zy(P[b + 1]), cx = zx(P[c]), cy = zy(P[c + 1]), det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (det < 1e-9) continue; // 背向正面的三角形
    for (let y = max(0, Math.floor(min(ay, by, cy))); y <= min(ZN - 1, Math.ceil(max(ay, by, cy))); y++) for (let x = max(0, Math.floor(min(ax, bx, cx))); x <= min(ZN - 1, Math.ceil(max(ax, bx, cx))); x++) {
      const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / det, w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / det, w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const z = P[a + 2] * w0 + P[b + 2] * w1 + P[c + 2] * w2; if (z > zb[y * ZN + x]) zb[y * ZN + x] = z;
    }
  }
  for (let v = 0; v < P.length; v += 3) {
    const x = clamp(Math.round(zx(P[v])), 1, ZN - 2), y = clamp(Math.round(zy(P[v + 1])), 1, ZN - 2); let m = -9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = max(m, zb[(y + dy) * ZN + x + dx]);
    A[v + 2] = smooth(0.05, 0.022, m - P[v + 2]);
  }
  for (let v = 0; v < P.length; v += 3) { P[v] *= HS; P[v + 1] = (P[v + 1] - HM.ycut) * HS; P[v + 2] = (P[v + 2] - HOZ) * HS; }
  const [CX, CY, SX, SY] = HM.align;
  HEAD = headMesh({ p: P, n: normals(P, idx), i: idx, a: A }, cv, [CX, 1 - CY + SY * HM.ycut, SX / HS, SY / HS],
    [XP * HS, (ZCR - HOZ) * HS, (Y0 - HM.ycut) * HS, (Y1 - HM.ycut) * HS], HM.eyes);
}
export const hideHead = () => { if (HEAD) HEAD.visible = false; hideBody(); };
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
