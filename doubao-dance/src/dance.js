// 舞蹈动作：用"语义化姿势"描述关键帧，按节拍插值，再叠加律动与脚底贴地。
import * as THREE from 'three';
import { JOINTS } from './character.js';
import { DEG, TAU, clamp, ease, mod } from './util.js';

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const XAX = new THREE.Vector3(1, 0, 0);
const YAX = new THREE.Vector3(0, 1, 0);

const eulerQ = (x, y, z, out) => out.setFromEuler(_e.set(x * DEG, y * DEG, z * DEG, 'XYZ'));
// 手臂方向（按左臂书写，右臂自动镜像）：elev -90 垂下 / 0 平举 / 85 上举；azim 0 侧平、90 向前、180 横过身体。
// twist 决定手肘往哪边弯：手臂往侧上方举时，约 65 是向内（头顶）弯；侧平举时 0 向前弯，90 向上弯。
// 手臂是按真人比例做的：肘弯超过 100 度、上臂又抬得高，手就会挡住脸，所以胸前的动作上臂都压得比较低
function armQ(elev, azim, twist, out) {
  const e = elev * DEG;
  const a = azim * DEG;
  _v.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
  out.setFromUnitVectors(DOWN, _v);
  if (twist) out.multiply(_q.setFromAxisAngle(YAX, twist * DEG));
  return out;
}
const mirrorQ = (q) => {
  q.y = -q.y;
  q.z = -q.z;
  return q;
};

const BASE = {
  hips: [0, 0, 0],
  spine: [0, 0, 0],
  chest: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  armL: [-74, 20, 0],
  armR: [-74, 20, 0],
  elbowL: 16,
  elbowR: 16,
  legL: [0, 5, 0],
  legR: [0, 5, 0],
  kneeL: 4,
  kneeR: 4,
  footL: 0,
  footR: 0,
  x: 0,
  y: 0,
  z: 0,
  turn: 0,
  air: 0,
};

function mirrorSpec(spec) {
  const s = { ...BASE, ...spec };
  const o = { ...s };
  for (const k of ['arm', 'elbow', 'leg', 'knee', 'foot']) {
    o[k + 'L'] = s[k + 'R'];
    o[k + 'R'] = s[k + 'L'];
  }
  for (const j of ['hips', 'spine', 'chest', 'neck', 'head']) o[j] = [s[j][0], -s[j][1], -s[j][2]];
  o.x = -s.x;
  o.turn = -s.turn;
  return o;
}

function newPose() {
  const p = { q: {}, x: 0, y: 0, z: 0, turn: 0, air: 0, expr: null };
  for (const j of JOINTS) p.q[j] = new THREE.Quaternion();
  return p;
}

function makePose(spec) {
  const s = { ...BASE, ...spec };
  const p = newPose();
  for (const j of ['hips', 'spine', 'chest', 'neck', 'head']) eulerQ(s[j][0], s[j][1], s[j][2], p.q[j]);
  armQ(s.armL[0], s.armL[1], s.armL[2] || 0, p.q.armL);
  mirrorQ(armQ(s.armR[0], s.armR[1], s.armR[2] || 0, p.q.armR));
  eulerQ(-s.elbowL, 0, 0, p.q.foreL);
  eulerQ(-s.elbowR, 0, 0, p.q.foreR);
  eulerQ(-s.legL[0], s.legL[2] || 0, s.legL[1], p.q.legL);
  mirrorQ(eulerQ(-s.legR[0], s.legR[2] || 0, s.legR[1], p.q.legR));
  eulerQ(s.kneeL, 0, 0, p.q.shinL);
  eulerQ(s.kneeR, 0, 0, p.q.shinR);
  eulerQ(s.footL, 0, 0, p.q.footL);
  eulerQ(s.footR, 0, 0, p.q.footR);
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.turn = s.turn;
  p.air = s.air;
  p.expr = s.expr || null;
  return p;
}

function blendPose(a, b, f, out) {
  for (const j of JOINTS) out.q[j].slerpQuaternions(a.q[j], b.q[j], f);
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.z = a.z + (b.z - a.z) * f;
  out.air = a.air + (b.air - a.air) * f;
  const d = mod(b.turn - a.turn + 180, 360) - 180;
  out.turn = a.turn + d * f;
  out.expr = f > 0.5 ? b.expr : a.expr;
  return out;
}

// ---------------------------------------------------------------- 动作库
export const MOVES = {};
function move(name, len, keys, o = {}) {
  const build = (mir) => ({
    name: name + (mir ? 'M' : ''),
    len,
    once: !!o.once,
    snap: o.snap == null ? 0.35 : o.snap,
    bounce: o.bounce == null ? 8 : o.bounce,
    keys: keys.map(([t, spec]) => ({ t, pose: makePose(mir ? mirrorSpec(spec) : spec) })),
  });
  MOVES[name] = build(false);
  MOVES[name + 'M'] = build(true);
}
const M = mirrorSpec;

{
  const a = { hips: [0, 0, 3], chest: [0, 0, -3], head: [0, 0, 3], x: 0.025, armL: [-66, 35], elbowL: 34, armR: [-72, 10], elbowR: 24, legL: [0, 6, 0], legR: [0, 8, 0], kneeL: 6, kneeR: 10 };
  move('idle', 4, [[0, a], [2, M(a)]], { bounce: 6, snap: 0 });
}
{
  const a = { x: 0.11, hips: [0, -8, 4], chest: [0, 12, -4], head: [0, -6, 2], armL: [-42, 62], elbowL: 74, armR: [-56, -32], elbowR: 46, legL: [0, 16, 0], legR: [0, 2, 0], kneeL: 8, kneeR: 14 };
  const b = { x: 0.11, armL: [-64, 28], elbowL: 44, armR: [-64, 28], elbowR: 44, legL: [0, 5, 0], legR: [0, 5, 0], kneeL: 16, kneeR: 16 };
  move('step', 4, [[0, a], [1, b], [2, M(a)], [3, M(b)]], { bounce: 9 });
}
{
  const a = { x: 0.05, hips: [0, 0, 6], chest: [0, 0, 6], head: [0, 0, 7], armL: [60, 12], elbowL: 12, armR: [80, 8], elbowR: 14, legL: [0, 13, 0], legR: [0, 4, 0], kneeR: 14, expr: 'happy' };
  move('wave', 4, [[0, a], [1, M(a)], [2, a], [3, M(a)]], { bounce: 8, snap: 0.15 });
}
{
  const a = { x: -0.03, hips: [0, 10, -7], chest: [0, -12, 5], head: [0, -16, 4], armR: [56, 14], elbowR: 4, armL: [-36, -24], elbowL: 104, legL: [0, 16, 0], legR: [0, 4, 0], kneeR: 8 };
  const b = { x: 0.03, hips: [0, -10, 7], chest: [0, 14, -4], head: [0, 10, -4], armR: [-40, 150], elbowR: 8, armL: [-36, -24], elbowL: 104, legL: [0, 6, 0], legR: [0, 14, 0], kneeL: 14, kneeR: 4 };
  move('point', 4, [[0, a], [1, b], [2, a], [3, b]], { bounce: 8 });
}
{
  const a = { x: 0.1, chest: [0, 0, -4], armL: [-24, 25], elbowL: 26, armR: [-24, 25], elbowR: 26, legL: [0, 16, 0], legR: [0, 4, 0] };
  const b = { x: 0.1, head: [-8, 0, 0], armL: [-40, 104, 0], elbowL: 62, armR: [-40, 104, 0], elbowR: 62, legL: [0, 6, 0], legR: [0, 6, 0], kneeL: 14, kneeR: 14, expr: 'happy' };
  move('clap', 4, [[0, a], [1, b], [2, M(a)], [3, M(b)]], { bounce: 9 });
}
{
  const a = { spine: [10, 0, 0], armL: [-70, 80], elbowL: 125, armR: [-70, 80], elbowR: 125, legL: [22, 8, 0], legR: [22, 8, 0], kneeL: 48, kneeR: 48 };
  const b = { air: 0.14, chest: [-6, 0, -5], armR: [80, 40], elbowR: 5, armL: [-50, 30], elbowL: 60, legL: [6, 6, 0], legR: [-8, 6, 0], kneeL: 30, kneeR: 20, expr: 'happy' };
  move('pump', 4, [[0, a], [0.5, b], [1, a], [1.5, M(b)], [2, a], [2.5, b], [3, a], [3.5, M(b)]], { bounce: 0, snap: 0.05 });
}
{
  const open = { turn: 0, armL: [6, 20], elbowL: 10, armR: [6, 20], elbowR: 10, legL: [0, 10, 0], legR: [0, 10, 0] };
  const tuck1 = { turn: 120, armL: [-55, 95], elbowL: 105, armR: [-55, 95], elbowR: 105, legR: [30, 0, 0], kneeR: 70 };
  const tuck2 = { ...tuck1, turn: 240 };
  const tada = { turn: 360, hips: [0, 0, -6], head: [0, 0, 6], armR: [60, 20], elbowR: 4, armL: [-30, -22], elbowL: 96, legL: [0, 18, 0], legR: [0, 3, 0], expr: 'wink' };
  const tada2 = { ...tada, hips: [0, 0, 6], head: [0, 0, -4] };
  move('spin', 4, [[0, open], [0.67, tuck1], [1.33, tuck2], [2, tada], [3, tada2]], { bounce: 4, snap: 0.05 });
}
{
  const a = { spine: [4, 0, 0], chest: [0, -14, 0], legR: [62, 0, 0], kneeR: 86, armL: [-55, 80], elbowL: 92, armR: [-46, -50], elbowR: 70 };
  const b = { spine: [-12, 0, 0], head: [8, 0, 0], legR: [78, 0, 0], kneeR: 6, footR: -20, armL: [0, -10], elbowL: 8, armR: [0, -10], elbowR: 8 };
  move('kick', 4, [[0, a], [1, b], [2, M(a)], [3, M(b)]], { bounce: 5, snap: 0.3 });
}
{
  const a = { x: 0.04, hips: [0, 0, 6], chest: [0, 0, 5], head: [0, 0, 10], armL: [55, 15, 67], elbowL: 80, armR: [55, 15, 67], elbowR: 80, legL: [0, 14, 0], legR: [0, 3, 0], kneeR: 18, expr: 'happy' };
  move('heart', 4, [[0, a], [1, M(a)], [2, a], [3, M(a)]], { bounce: 7, snap: 0.2 });
}
{
  const a = { air: 0.03, hips: [0, 8, 0], chest: [0, -16, 0], legR: [58, 4, 0], kneeR: 82, armL: [-60, 76], elbowL: 95, armR: [-55, -45], elbowR: 66 };
  const n = { legL: [10, 6, 0], legR: [10, 6, 0], kneeL: 28, kneeR: 28, armL: [-55, 40], elbowL: 70, armR: [-55, 40], elbowR: 70 };
  move('shuffle', 4, [[0, a], [0.5, n], [1, M(a)], [1.5, n], [2, a], [2.5, n], [3, M(a)], [3.5, n]], { bounce: 0, snap: 0.05 });
}
{
  const a = { hips: [0, 26, 3], chest: [0, -42, 0], head: [0, 16, 0], armL: [-55, 62], elbowL: 90, armR: [-55, -30], elbowR: 80, legL: [6, 8, 18], legR: [6, 8, -18], kneeL: 26, kneeR: 26 };
  move('twist', 4, [[0, a], [1, M(a)], [2, a], [3, M(a)]], { bounce: 6, snap: 0.1 });
}
{
  const c = { spine: [14, 0, 0], head: [10, 0, 0], armL: [-50, 120], elbowL: 70, armR: [-50, 120], elbowR: 70, legL: [24, 4, 0], legR: [24, 4, 0], kneeL: 52, kneeR: 52 };
  const s = { air: 0.2, head: [-10, 0, 0], armL: [42, 0], elbowL: 0, armR: [42, 0], elbowR: 0, legL: [0, 30, 0], legR: [0, 30, 0], kneeL: 0, kneeR: 0, expr: 'happy' };
  const v = { hips: [0, 0, 5], armL: [62, 10], elbowL: 5, armR: [62, 10], elbowR: 5, legL: [0, 18, 0], legR: [0, 18, 0], expr: 'happy' };
  move('star', 4, [[0, c], [0.5, s], [1, c], [1.5, s], [2, c], [2.5, v], [3.25, M(v)]], { bounce: 0, snap: 0.05 });
}
{
  const a = { x: 0.16, hips: [0, 0, -6], chest: [0, 0, 8], head: [0, 20, 0], armL: [6, 10], elbowL: 8, armR: [-8, 170], elbowR: 20, legL: [0, 22, 0], legR: [0, 10, 0], kneeL: 20 };
  const b = { x: 0.16, armL: [-60, 20], elbowL: 50, armR: [-60, 20], elbowR: 50, legL: [0, 6, 0], legR: [0, 6, 0], kneeL: 20, kneeR: 20 };
  move('slide', 4, [[0, a], [1, b], [2, M(a)], [3, M(b)]], { bounce: 7 });
}
{
  const a = { air: 0.12, armL: [76, 20], elbowL: 8, armR: [60, 30], elbowR: 20, legL: [0, 10, 0], legR: [10, 6, 0], kneeR: 40, expr: 'happy' };
  const n = { armL: [-70, 75], elbowL: 125, armR: [-70, 75], elbowR: 125, legL: [18, 6, 0], legR: [18, 6, 0], kneeL: 40, kneeR: 40, expr: 'happy' };
  move('cheer', 2, [[0, n], [0.5, a], [1, n], [1.5, M(a)]], { bounce: 0, snap: 0.05 });
}
{
  const a = { spine: [8, 0, 3], chest: [10, 0, 0], head: [22, 0, 4], x: 0.02, armL: [-84, 10], elbowL: 6, armR: [-84, 10], elbowR: 6, kneeL: 10, kneeR: 10, expr: 'oops' };
  move('sad', 4, [[0, a], [2, M(a)]], { bounce: 2, snap: 0 });
}
// 一次性动作：终结造型、失误踉跄、自由发挥的四个造型
move('finish', 4, [[0, { x: -0.03, hips: [0, -8, -8], chest: [0, 10, 6], head: [0, -10, 8], armR: [72, 25], elbowR: 3, armL: [-36, -28], elbowL: 106, legL: [0, 24, 0], legR: [0, 2, 0], kneeR: 6, expr: 'wink' }]], { once: true, bounce: 2 });
move(
  'stumble',
  2,
  [
    [0, { z: -0.05, spine: [-16, 0, 6], chest: [-6, 0, 0], head: [-10, 0, -8], armL: [20, -30], elbowL: 30, armR: [-5, 60], elbowR: 40, legR: [38, 6, 0], kneeR: 62, kneeL: 16, expr: 'oops' }],
    [1, { z: 0.04, spine: [18, 0, -4], head: [12, 0, 6], armL: [-40, 70], elbowL: 50, armR: [-40, 70], elbowR: 50, legL: [14, 8, 0], legR: [14, 8, 0], kneeL: 38, kneeR: 38, expr: 'oops' }],
  ],
  { once: true, bounce: 0 },
);
move('poseL', 1, [[0, { hips: [0, 0, -6], chest: [0, 14, 6], head: [0, 20, 0], armL: [22, 0], elbowL: 4, armR: [-44, -25], elbowR: 100, legL: [0, 22, 0], legR: [0, 4, 0], kneeR: 14, expr: 'wink' }]], { once: true, bounce: 0 });
move('poseU', 1, [[0, { air: 0.16, armL: [66, 10], elbowL: 4, armR: [66, 10], elbowR: 4, legL: [10, 14, 0], legR: [10, 14, 0], kneeL: 40, kneeR: 40, expr: 'happy' }]], { once: true, bounce: 0 });
move('poseD', 1, [[0, { spine: [16, 0, 0], head: [-14, 0, 6], armL: [-50, 80], elbowL: 120, armR: [-45, 60], elbowR: 70, legL: [40, 14, 0], legR: [40, 14, 0], kneeL: 88, kneeR: 88, expr: 'wow' }]], { once: true, bounce: 0 });

export const FREE_POSES = ['poseL', 'poseD', 'poseU', 'poseLM']; // 对应 ← ↓ ↑ →

const SETS = {
  verse: ['step', 'twist', 'clap', 'point', 'slide', 'wave', 'heart'],
  chorus: ['pump', 'shuffle', 'star', 'kick', 'spin', 'heart', 'wave'],
  build: ['shuffle', 'pump'],
};
// 每两小节换一个动作，奇数小节用镜像版本，整队动作保持一致
export function choreoFor(kind, bar) {
  const set = SETS[kind];
  if (!set) return 'idle';
  const i = Math.floor(bar / 2);
  const name = set[(i * 3 + (kind === 'chorus' ? 1 : 0)) % set.length];
  if (name === 'spin') return bar % 2 ? 'wave' : 'spin';
  return name + (bar % 2 ? 'M' : '');
}

// ---------------------------------------------------------------- 动画器
function sample(mv, t, out) {
  const keys = mv.keys;
  if (keys.length === 1) return blendPose(keys[0].pose, keys[0].pose, 0, out);
  let i = 0;
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].t <= t) i = k;
    else break;
  }
  const a = keys[i];
  const last = i === keys.length - 1;
  if (last && mv.once) return blendPose(a.pose, a.pose, 0, out);
  const b = keys[last ? 0 : i + 1];
  const tb = last ? mv.len : b.t;
  const u = clamp((t - a.t) / (tb - a.t), 0, 1);
  // 前一小段保持姿势，后面快速到位：让每个造型落在拍点上
  const f = ease.inOut(clamp((u - mv.snap) / (1 - mv.snap), 0, 1));
  return blendPose(a.pose, b.pose, f, out);
}

export function createAnimator(dancer) {
  const J = dancer.joints;
  const A = newPose();
  const B = newPose();
  const C = newPose();
  const S = newPose();
  let cur = MOVES.idle;
  let prev = null;
  let blendT = 1;
  let blendLen = 0.6;
  let lastBeat = 0;
  let strike = null;
  const an = {
    energy: 1,
    get move() {
      return cur.name;
    },
    setMove(name, blend = 0.6) {
      const m = MOVES[name];
      if (!m || m === cur) return;
      prev = cur;
      cur = m;
      blendT = 0;
      blendLen = blend;
    },
    // 叠加一个一次性动作（踉跄、造型），持续 beats 拍后自动淡出
    strike(name, beats, startBeat) {
      const m = MOVES[name];
      if (!m) return;
      strike = { m, start: startBeat, len: beats };
    },
    update(beat, dt) {
      const db = clamp(beat - lastBeat, 0, 1);
      lastBeat = beat;
      let P = sample(cur, mod(beat, cur.len), A);
      if (prev && blendT < 1) {
        blendT += db / blendLen;
        sample(prev, mod(beat, prev.len), B);
        P = blendPose(B, A, ease.inOut(clamp(blendT, 0, 1)), C);
      }
      let bounceAmp = cur.bounce;
      if (strike) {
        const t = beat - strike.start;
        if (t >= strike.len || t < -0.5) strike = null;
        else {
          const w = clamp(t / 0.14, 0, 1) * clamp((strike.len - t) / 0.4, 0, 1);
          sample(strike.m, clamp(t, 0, strike.m.len - 0.001), S);
          P = blendPose(P, S, ease.out(w), P === C ? B : C);
          bounceAmp *= 1 - w;
        }
      }
      for (const j of JOINTS) J[j].quaternion.copy(P.q[j]);
      if (P.turn) J.hips.quaternion.premultiply(_q.setFromAxisAngle(YAX, P.turn * DEG));

      // 律动：每一拍膝盖沉一下
      const c = 0.5 + 0.5 * Math.cos(beat * TAU);
      const a = bounceAmp * an.energy * c * c * DEG;
      if (a > 0.0005) {
        _q.setFromAxisAngle(XAX, -a);
        J.legL.quaternion.multiply(_q);
        J.legR.quaternion.multiply(_q);
        J.footL.quaternion.multiply(_q);
        J.footR.quaternion.multiply(_q);
        _q.setFromAxisAngle(XAX, 2 * a);
        J.shinL.quaternion.multiply(_q);
        J.shinR.quaternion.multiply(_q);
        _q.setFromAxisAngle(XAX, a * 0.35);
        J.spine.quaternion.multiply(_q);
        _q.setFromAxisAngle(XAX, -a * 0.3);
        J.head.quaternion.multiply(_q);
      }

      // 脚底贴地：以较低的脚踝为准把胯部提/压到位
      J.hips.position.set(P.x, dancer.hipY + P.y, P.z);
      dancer.root.updateMatrixWorld(true);
      const base = dancer.root.matrixWorld.elements[13];
      const low = Math.min(J.footL.matrixWorld.elements[13], J.footR.matrixWorld.elements[13]) - base;
      J.hips.position.y += dancer.ankleY - low + P.air;

      if (P.expr) dancer.poseExpr(P.expr);
    },
  };
  return an;
}
