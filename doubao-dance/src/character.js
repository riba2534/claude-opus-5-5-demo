// Q 版舞者：骨架是一棵 Object3D 关节树，身体由基础几何体拼装，脸是 Canvas 现画的表情贴图。
import * as THREE from 'three';
import { TAU, clamp, rng } from './util.js';

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
];

export const DANCERS = {
  doubao: {
    name: '豆包',
    hair: 'bob',
    hairColor: '#1d1a24',
    skin: '#ffe2d0',
    eye: '#8a5230',
    top: '#f6f7ff',
    accent: '#6f8dff',
    accent2: '#ffab7a',
    bottom: '#6a5cf0',
    shoe: '#f4f6ff',
    sole: '#6f8dff',
    emblem: '豆',
    headphones: '#ff8fb5',
  },
  naihuang: {
    name: '奶黄',
    hair: 'buns',
    hairColor: '#8a5530',
    skin: '#ffe6d2',
    eye: '#c07a20',
    top: '#ffd95a',
    accent: '#ffffff',
    accent2: '#ff9d4d',
    bottom: '#fff6dc',
    shoe: '#ffffff',
    sole: '#ffb84d',
    emblem: '黄',
  },
  matcha: {
    name: '抹茶',
    hair: 'pony',
    hairColor: '#23463c',
    skin: '#ffe0cc',
    eye: '#3f8f5a',
    top: '#a8dc86',
    accent: '#f7f4e6',
    accent2: '#5fae6a',
    bottom: '#3d6b52',
    shoe: '#f7f4e6',
    sole: '#5fae6a',
    emblem: '茶',
  },
  zhima: {
    name: '芝麻',
    hair: 'cap',
    hairColor: '#d9d9e8',
    skin: '#ffe0cc',
    eye: '#7a6bb0',
    top: '#2b2b38',
    accent: '#c9c9dc',
    accent2: '#ff5f8f',
    bottom: '#40404f',
    shoe: '#2b2b38',
    sole: '#ff5f8f',
    emblem: '芝',
  },
};

// ---------------------------------------------------------------- 共享资源
const gradTex = (() => {
  // 背光面为 0：暗部只靠环境光，三盏方向光叠加才不会过曝
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0, 140, 212, 255, 255]), 8, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

// 所有卡通材质共用的轮廓光颜色，由舞台灯光每帧更新
export const rimUniform = { value: new THREE.Color(0.25, 0.3, 0.6) };

function toon(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rimUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <opaque_fragment>',
        'float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);\noutgoingLight += uRim * rimF;\n#include <opaque_fragment>',
      );
  };
  m.customProgramCacheKey = () => 'toon-rim';
  return m;
}

const outlineMat = new THREE.ShaderMaterial({
  uniforms: { uThick: { value: 0.0075 }, uColor: { value: new THREE.Color('#2a1d47') } },
  vertexShader: 'uniform float uThick; void main(){ vec3 p = position + normalize(normal) * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
  side: THREE.BackSide,
});

// ---------------------------------------------------------------- 几何体小工具
function ell(rx, ry, rz, seg = 22) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)));
  squash(g, rx, ry, rz);
  return g;
}
// 把单位球压成椭球，并写入解析法线，避免缩放后轮廓线粗细不均
function squash(g, rx, ry, rz) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
    v.set(v.x / rx, v.y / ry, v.z / rz).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// 关节在顶端、向下生长的肢体胶囊，可上下收窄
function limb(rTop, rBot, len, seg = 12) {
  const r = Math.max(rTop, rBot);
  const g = new THREE.CapsuleGeometry(r, len, 5, seg, 4);
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(-p.getY(i) / len, 0, 1);
    const s = (rTop + (rBot - rTop) * t) / r;
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 表情贴图
const EXPRS = ['smile', 'blink', 'happy', 'wow', 'oops', 'wink'];

function drawFace(canvas, expr, o) {
  const S = canvas.width;
  const x = canvas.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.save();
  x.scale(S / 512, S / 512);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const CX = 256;
  const EX = 106;
  const EY = 258;
  const dark = '#1c1216';

  // 腮红
  for (const s of [-1, 1]) {
    const bx = CX + s * 152;
    const g = x.createRadialGradient(bx, 334, 4, bx, 334, 54);
    g.addColorStop(0, expr === 'oops' ? 'rgba(255,110,130,0.75)' : 'rgba(255,128,150,0.55)');
    g.addColorStop(1, 'rgba(255,128,150,0)');
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(bx, 334, 58, 36, 0, 0, TAU);
    x.fill();
  }

  const openEye = (cx, big) => {
    const rx = big ? 41 : 37;
    const ry = big ? 54 : 50;
    x.save();
    x.beginPath();
    x.ellipse(cx, EY, rx + 5, ry + 5, 0, 0, TAU);
    x.fillStyle = '#ffffff';
    x.fill();
    x.clip();
    const g = x.createLinearGradient(0, EY - ry, 0, EY + ry);
    g.addColorStop(0, '#23120a');
    g.addColorStop(0.55, o.eye);
    g.addColorStop(1, '#ffd9a8');
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(cx, EY + 3, rx, ry, 0, 0, TAU);
    x.fill();
    x.fillStyle = '#160b06';
    x.beginPath();
    x.ellipse(cx, EY + 2, rx * 0.42, ry * 0.46, 0, 0, TAU);
    x.fill();
    x.restore();
    // 高光
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(cx - 13, EY - 21, big ? 14 : 12, 0, TAU);
    x.fill();
    x.globalAlpha = 0.9;
    x.beginPath();
    x.arc(cx + 15, EY + 20, 6, 0, TAU);
    x.fill();
    x.globalAlpha = 1;
    if (big) {
      // 惊喜时眼里的小星星
      x.fillStyle = '#fff6b0';
      star(x, cx + 10, EY - 6, 9);
    }
    // 上眼线
    x.strokeStyle = dark;
    x.lineWidth = 10;
    x.beginPath();
    x.ellipse(cx, EY, rx + 5, ry + 5, 0, Math.PI * 1.08, Math.PI * 1.92);
    x.stroke();
    x.lineWidth = 4;
    x.beginPath();
    x.ellipse(cx, EY, rx + 5, ry + 5, 0, Math.PI * 0.3, Math.PI * 0.7);
    x.stroke();
  };
  const arcEye = (cx, up) => {
    x.strokeStyle = dark;
    x.lineWidth = 11;
    x.beginPath();
    if (up) x.arc(cx, EY + 22, 36, Math.PI * 1.14, Math.PI * 1.86);
    else x.arc(cx, EY - 18, 36, Math.PI * 0.16, Math.PI * 0.84);
    x.stroke();
  };
  const crossEye = (cx, s) => {
    x.strokeStyle = dark;
    x.lineWidth = 11;
    x.beginPath();
    x.moveTo(cx - s * 30, EY - 26);
    x.lineTo(cx + s * 22, EY);
    x.lineTo(cx - s * 30, EY + 26);
    x.stroke();
  };
  // 粗眉：豆包形象里最有辨识度的特征
  const brow = (cx, s, lift, tilt) => {
    x.strokeStyle = o.brow;
    x.lineWidth = 17;
    x.beginPath();
    x.moveTo(cx - s * 40, EY - 80 - lift + tilt * 12);
    x.quadraticCurveTo(cx, EY - 96 - lift, cx + s * 40, EY - 84 - lift - tilt * 12);
    x.stroke();
  };

  const L = CX - EX;
  const R = CX + EX;
  let lift = 0;
  let tilt = 0;
  if (expr === 'smile') {
    openEye(L);
    openEye(R);
  } else if (expr === 'blink') {
    arcEye(L, false);
    arcEye(R, false);
  } else if (expr === 'happy') {
    arcEye(L, true);
    arcEye(R, true);
    lift = 8;
  } else if (expr === 'wow') {
    openEye(L, true);
    openEye(R, true);
    lift = 16;
  } else if (expr === 'oops') {
    crossEye(L, -1);
    crossEye(R, 1);
    tilt = 1;
  } else if (expr === 'wink') {
    openEye(L);
    arcEye(R, true);
    lift = 4;
  }
  brow(L, -1, lift, tilt);
  brow(R, 1, lift, tilt);

  // 嘴
  const MY = 372;
  x.strokeStyle = dark;
  x.lineWidth = 8;
  if (expr === 'smile' || expr === 'blink') {
    x.beginPath();
    x.arc(CX, MY - 22, 34, Math.PI * 0.2, Math.PI * 0.8);
    x.stroke();
  } else if (expr === 'happy' || expr === 'wink') {
    x.beginPath();
    x.moveTo(CX - 40, MY - 12);
    x.quadraticCurveTo(CX, MY - 4, CX + 40, MY - 12);
    x.quadraticCurveTo(CX + 30, MY + 44, CX, MY + 44);
    x.quadraticCurveTo(CX - 30, MY + 44, CX - 40, MY - 12);
    x.closePath();
    x.fillStyle = '#8c2f3f';
    x.fill();
    x.save();
    x.clip();
    x.fillStyle = '#ff8fa3';
    x.beginPath();
    x.ellipse(CX, MY + 42, 26, 18, 0, 0, TAU);
    x.fill();
    x.restore();
    x.lineWidth = 6;
    x.stroke();
  } else if (expr === 'wow') {
    x.fillStyle = '#8c2f3f';
    x.beginPath();
    x.ellipse(CX, MY + 6, 20, 26, 0, 0, TAU);
    x.fill();
    x.lineWidth = 6;
    x.stroke();
  } else if (expr === 'oops') {
    x.beginPath();
    x.moveTo(CX - 36, MY + 6);
    x.quadraticCurveTo(CX - 18, MY - 14, CX, MY + 6);
    x.quadraticCurveTo(CX + 18, MY + 26, CX + 36, MY + 6);
    x.stroke();
    // 一滴汗
    x.fillStyle = '#9fd8ff';
    x.beginPath();
    x.moveTo(CX + 196, EY - 96);
    x.quadraticCurveTo(CX + 216, EY - 60, CX + 196, EY - 52);
    x.quadraticCurveTo(CX + 176, EY - 60, CX + 196, EY - 96);
    x.fill();
  }
  x.restore();
}

function star(x, cx, cy, r) {
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
  x.fill();
}

function emblemTexture(ch, bg, fg) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.beginPath();
  x.arc(64, 64, 62, 0, TAU);
  x.fill();
  x.fillStyle = fg;
  x.font = '900 82px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- 建模
export function createDancer(specId, opts = {}) {
  const spec = DANCERS[specId];
  const outline = opts.outline !== false;
  const faceSize = opts.faceSize || 256;
  const rand = rng(specId.length * 977 + specId.charCodeAt(0));

  const mats = {
    skin: toon(spec.skin),
    hair: toon(spec.hairColor, { side: THREE.DoubleSide }),
    top: toon(spec.top),
    accent: toon(spec.accent),
    accent2: toon(spec.accent2),
    bottom: toon(spec.bottom, { side: THREE.DoubleSide }),
    shoe: toon(spec.shoe),
    sole: toon(spec.sole),
    white: toon('#ffffff'),
  };

  const root = new THREE.Group();
  root.name = spec.name;
  const J = {};
  const mk = (name, parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    J[name] = o;
    return o;
  };
  // 约 3.5 头身：四肢够长，举手能过头顶，舞蹈动作才看得清
  const THIGH = 0.25;
  const SHIN = 0.25;
  const UPPER = 0.185;
  const FORE = 0.175;
  const HIP_Y = 0.02 + THIGH + SHIN + 0.066;
  mk('hips', root, 0, HIP_Y, 0);
  mk('spine', J.hips, 0, 0.04, 0);
  mk('chest', J.spine, 0, 0.11, 0);
  mk('neck', J.chest, 0, 0.145, 0);
  mk('head', J.neck, 0, 0.04, 0);
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    mk('arm' + k, J.chest, 0.128 * s, 0.1, 0);
    mk('fore' + k, J['arm' + k], 0, -UPPER, 0);
    mk('hand' + k, J['fore' + k], 0, -FORE, 0);
    mk('leg' + k, J.hips, 0.064 * s, -0.02, 0);
    mk('shin' + k, J['leg' + k], 0, -THIGH, 0);
    mk('foot' + k, J['shin' + k], 0, -SHIN, 0);
  }

  const add = (parent, geo, mat, p, r, noOutline) => {
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    parent.add(m);
    if (outline && !noOutline) m.add(new THREE.Mesh(geo, outlineMat));
    return m;
  };

  // --- 躯干
  add(J.hips, ell(0.112, 0.085, 0.098), mats.bottom, [0, -0.008, 0]);
  add(J.spine, ell(0.102, 0.098, 0.088), mats.top, [0, 0.045, 0]);
  add(J.chest, ell(0.124, 0.116, 0.098), mats.top, [0, 0.056, 0]);
  add(J.spine, new THREE.TorusGeometry(0.1, 0.016, 8, 24), mats.accent, [0, -0.012, 0], [Math.PI / 2, 0, 0]);
  add(J.neck, new THREE.CylinderGeometry(0.034, 0.038, 0.1, 12), mats.skin, [0, 0.015, 0], null, true);
  // 兜帽
  const hood = new THREE.Object3D();
  hood.position.set(0, 0.138, -0.07);
  J.chest.add(hood);
  add(hood, ell(0.098, 0.066, 0.058), mats.top, [0, -0.015, -0.02], [-0.35, 0, 0]);
  // 胸口徽章
  const emblem = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 24),
    new THREE.MeshBasicMaterial({ map: emblemTexture(spec.emblem, spec.accent, spec.top), transparent: true }),
  );
  emblem.position.set(0, 0.066, 0.0985);
  emblem.rotation.x = -0.08;
  J.chest.add(emblem);

  // --- 裙摆（带褶）
  const skirtPivot = new THREE.Object3D();
  skirtPivot.position.set(0, 0.05, 0);
  J.hips.add(skirtPivot);
  {
    const pts = [
      [0.1, 0.02],
      [0.118, -0.01],
      [0.152, -0.075],
      [0.186, -0.15],
      [0.192, -0.168],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 48);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const xx = p.getX(i);
      const zz = p.getZ(i);
      const yy = p.getY(i);
      const a = Math.atan2(zz, xx);
      const t = clamp((0.02 - yy) / 0.19, 0, 1);
      const k = 1 + Math.cos(a * 14) * 0.085 * t;
      p.setX(i, xx * k);
      p.setZ(i, zz * k);
    }
    g.computeVertexNormals();
    add(skirtPivot, g, mats.bottom, null, null, false);
    // 裙边一圈亮色
    add(skirtPivot, new THREE.TorusGeometry(0.19, 0.008, 6, 40), mats.accent, [0, -0.166, 0], [Math.PI / 2, 0, 0], true);
  }

  // --- 四肢
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    add(J['arm' + k], limb(0.046, 0.04, UPPER), mats.top);
    add(J['arm' + k], ell(0.052, 0.05, 0.052, 14), mats.top, [0, 0, 0]);
    add(J['fore' + k], limb(0.04, 0.036, FORE - 0.012), mats.top);
    add(J['fore' + k], new THREE.TorusGeometry(0.038, 0.013, 8, 16), mats.accent, [0, -FORE + 0.02, 0], [Math.PI / 2, 0, 0]);
    add(J['hand' + k], ell(0.043, 0.047, 0.04, 14), mats.skin, [0, -0.022, 0]);
    add(J['leg' + k], limb(0.056, 0.046, THIGH), mats.skin);
    add(J['shin' + k], limb(0.045, 0.038, SHIN - 0.01), mats.skin);
    add(J['shin' + k], limb(0.047, 0.043, 0.11), mats.white, [0, -SHIN + 0.115, 0]);
    add(J['shin' + k], new THREE.TorusGeometry(0.046, 0.008, 6, 16), mats.accent, [0, -SHIN + 0.11, 0], [Math.PI / 2, 0, 0], true);
    add(J['foot' + k], ell(0.054, 0.044, 0.094, 16), mats.shoe, [0, -0.018, 0.032]);
    add(J['foot' + k], ell(0.057, 0.017, 0.098, 16), mats.sole, [0, -0.05, 0.032]);
  }

  // --- 头
  const R = 0.186;
  const K = R / 0.215; // 头部配件按头的大小等比缩放
  const HS = [1, 0.94, 0.965];
  const headC = new THREE.Object3D();
  headC.position.set(0, 0.15, 0.01);
  J.head.add(headC);
  add(headC, ell(R * HS[0], R * HS[1], R * HS[2], 32), mats.skin);
  for (const s of [1, -1]) add(headC, ell(0.027, 0.034, 0.02, 10), mats.skin, [R * 0.97 * s, -0.012, -0.005]);

  // 表情
  const faces = {};
  for (const e of EXPRS) {
    const c = document.createElement('canvas');
    c.width = c.height = faceSize;
    drawFace(c, e, { eye: spec.eye, brow: spec.hair === 'cap' ? '#8f8fa6' : spec.hairColor });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    faces[e] = t;
  }
  const PH = 0.64 * Math.PI;
  const faceGeo = new THREE.SphereGeometry(R * 1.004, 28, 20, Math.PI / 2 - PH / 2, PH, 0.26 * Math.PI, 0.54 * Math.PI);
  faceGeo.scale(HS[0], HS[1], HS[2]);
  const faceMat = new THREE.MeshBasicMaterial({ map: faces.smile, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const face = new THREE.Mesh(faceGeo, faceMat);
  headC.add(face);

  // --- 头发
  const bobbles = [];
  const bobble = (obj, gain, k = 110, d = 9, limit = 0.5) => {
    bobbles.push({ obj, gain, k, d, limit, ax: 0, az: 0, vx: 0, vz: 0, last: new THREE.Vector3(), init: false, rest: obj.rotation.clone() });
  };
  const hairR = R * 1.075;
  const shellGeo = (thetaLen, open = 0.6) => {
    const g = new THREE.SphereGeometry(hairR, 30, 16, (1.5 - (2 - open) / 2) * Math.PI, (2 - open) * Math.PI, 0, thetaLen * Math.PI);
    g.scale(HS[0] * 1.0, HS[1] * 1.01, HS[2] * 1.03);
    return g;
  };
  const capGeo = (thetaLen) => {
    const g = new THREE.SphereGeometry(hairR, 30, 8, 0, TAU, 0, thetaLen * Math.PI);
    g.scale(HS[0], HS[1] * 1.01, HS[2] * 1.03);
    return g;
  };
  // 在头的球面上摆一撮头发：theta 从头顶往下量，phi=0 为正前方
  const tuft = (parent, theta, phi, rx, ry, rz, lean = 0, rr = 1.03, tilt = 0) => {
    const st = Math.sin(theta);
    const dir = new THREE.Vector3(Math.sin(phi) * st, Math.cos(theta), Math.cos(phi) * st);
    const pos = dir.clone().multiplyScalar(R * rr);
    pos.x *= HS[0];
    pos.y *= HS[1];
    pos.z *= HS[2];
    const down = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), -Math.sin(theta), Math.cos(phi) * Math.cos(theta)).normalize();
    const side = new THREE.Vector3().crossVectors(down.clone().negate(), dir).normalize();
    const pivot = new THREE.Object3D();
    pivot.position.copy(pos);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, down.clone().negate(), dir));
    pivot.rotateZ(lean);
    // tilt 让发梢贴回头皮，不然切平面上的发片会越往下离脸越远
    if (tilt) pivot.rotateX(tilt);
    parent.add(pivot);
    add(pivot, ell(rx * K, ry * K, rz * K, 12), mats.hair, [0, -ry * K * 0.85, 0]);
    return pivot;
  };

  if (spec.hair === 'bob') {
    add(headC, shellGeo(0.7, 0.62), mats.hair, [0, 0.006, -0.006]);
    add(headC, capGeo(0.3), mats.hair, [0, 0.006, -0.006]);
    // 斜刘海
    const fr = [
      [-0.74, 0.07, 0.08, 0.25],
      [-0.44, 0.07, 0.064, 0.3],
      [-0.15, 0.072, 0.056, 0.32],
      [0.14, 0.07, 0.055, 0.3],
      [0.42, 0.066, 0.061, 0.12],
      [0.71, 0.062, 0.078, -0.2],
    ];
    for (const [phi, rx, ry, lean] of fr) tuft(headC, 0.24 * Math.PI, phi, rx, ry, 0.03, lean, 1.03, 0.35);
    // 两侧到下巴的鬓发
    for (const s of [1, -1]) {
      const lock = tuft(headC, 0.4 * Math.PI, s * 1.04, 0.042, 0.1, 0.04, -s * 0.1, 1.0, 0.3);
      bobble(lock, 0.05, 90, 8, 0.35);
    }
    // 小豆子发卡
    const clip = new THREE.Object3D();
    clip.position.set(0.102, 0.1, 0.137);
    clip.rotation.set(0.3, 0.6, 0.5);
    headC.add(clip);
    add(clip, ell(0.027, 0.019, 0.013, 10), mats.accent2, [-0.011, 0, 0]);
    add(clip, ell(0.027, 0.019, 0.013, 10), mats.accent2, [0.013, 0.005, 0]);
  } else if (spec.hair === 'buns') {
    add(headC, shellGeo(0.62, 0.66), mats.hair, [0, 0.006, -0.006]);
    add(headC, capGeo(0.3), mats.hair, [0, 0.006, -0.006]);
    for (let i = 0; i < 7; i++) tuft(headC, 0.24 * Math.PI, -0.69 + i * 0.23, 0.064, 0.057 + Math.abs(i - 3) * 0.006, 0.03, 0, 1.03, 0.35);
    for (const s of [1, -1]) {
      const bun = new THREE.Object3D();
      bun.position.set(0.13 * s, 0.148, -0.026);
      headC.add(bun);
      add(bun, ell(0.068, 0.064, 0.064, 16), mats.hair);
      add(bun, new THREE.TorusGeometry(0.043, 0.012, 6, 16), mats.accent2, [-0.026 * s, -0.039, 0.009], [Math.PI / 2 - 0.5, 0, 0.7 * s]);
      bobble(bun, 0.02, 160, 10, 0.2);
      tuft(headC, 0.42 * Math.PI, s * 1.04, 0.036, 0.085, 0.04, 0, 1.0, 0.3);
    }
  } else if (spec.hair === 'pony') {
    add(headC, shellGeo(0.58, 0.64), mats.hair, [0, 0.006, -0.006]);
    add(headC, capGeo(0.3), mats.hair, [0, 0.006, -0.006]);
    const fr = [
      [-0.68, 0.07, 0.074, -0.25],
      [-0.38, 0.07, 0.06, -0.3],
      [-0.08, 0.072, 0.055, -0.3],
      [0.22, 0.07, 0.056, -0.22],
      [0.54, 0.066, 0.072, 0.1],
    ];
    for (const [phi, rx, ry, lean] of fr) tuft(headC, 0.24 * Math.PI, phi, rx, ry, 0.03, lean, 1.03, 0.35);
    for (const s of [1, -1]) tuft(headC, 0.42 * Math.PI, s * 1.04, 0.03, 0.1, 0.035, 0, 1.0, 0.3);
    // 高马尾：三节，逐节摆动
    const base = new THREE.Object3D();
    base.position.set(0, 0.13, -0.138);
    base.rotation.x = -0.9;
    headC.add(base);
    add(base, new THREE.TorusGeometry(0.035, 0.013, 6, 14), mats.accent2, null, [Math.PI / 2, 0, 0]);
    let parent = base;
    const seg = [
      [0.05, 0.088],
      [0.043, 0.088],
      [0.031, 0.08],
    ];
    seg.forEach(([r, len], i) => {
      const pv = new THREE.Object3D();
      pv.position.set(0, i === 0 ? 0 : -seg[i - 1][1] * 1.5, 0);
      pv.rotation.x = i === 0 ? 0 : 0.35;
      parent.add(pv);
      add(pv, ell(r, len, r * 0.9, 12), mats.hair, [0, -len * 0.75, 0]);
      bobble(pv, 0.06 + i * 0.02, 70, 6, 0.6);
      parent = pv;
    });
  } else {
    // 反戴棒球帽 + 银色短发
    add(headC, shellGeo(0.56, 0.66), mats.hair, [0, 0.006, -0.006]);
    for (let i = 0; i < 6; i++) tuft(headC, 0.27 * Math.PI, -0.6 + i * 0.24, 0.05, 0.05, 0.03, (rand() - 0.5) * 0.7, 1.03, 0.3);
    for (const s of [1, -1]) tuft(headC, 0.42 * Math.PI, s * 1.04, 0.03, 0.075, 0.034, 0, 1.0, 0.3);
    const cap = new THREE.Object3D();
    cap.position.set(0, 0.026, -0.005);
    cap.rotation.x = -0.12;
    headC.add(cap);
    const dome = new THREE.SphereGeometry(hairR * 1.03, 28, 10, 0, TAU, 0, 0.36 * Math.PI);
    dome.scale(HS[0], HS[1] * 1.04, HS[2] * 1.03);
    add(cap, dome, mats.top);
    add(cap, new THREE.TorusGeometry(hairR * 0.93, 0.011, 6, 32), mats.accent2, [0, 0.08, 0], [Math.PI / 2, 0, 0], true);
    const brim = new THREE.CylinderGeometry(0.112, 0.112, 0.013, 20, 1, false, Math.PI * 0.62, Math.PI * 0.76);
    add(cap, brim, mats.top, [0, 0.073, -0.112], [0.2, 0, 0]);
    add(cap, ell(0.018, 0.011, 0.018, 8), mats.accent2, [0, hairR * 1.03 * HS[1] * 1.04, 0]);
  }

  // 颈挂耳机（豆包专属）
  if (spec.headphones) {
    const hpMat = toon(spec.headphones);
    const hp = new THREE.Object3D();
    hp.position.set(0, 0.16, 0.004);
    hp.rotation.x = 0.22;
    J.chest.add(hp);
    add(hp, new THREE.TorusGeometry(0.082, 0.013, 8, 20, Math.PI), hpMat, null, [-Math.PI / 2, 0, 0]);
    for (const s of [1, -1]) {
      add(hp, new THREE.CylinderGeometry(0.037, 0.037, 0.03, 16), hpMat, [0.084 * s, -0.004, 0.02], [0, 0, Math.PI / 2]);
      add(hp, new THREE.CylinderGeometry(0.026, 0.026, 0.034, 16), mats.white, [0.084 * s, -0.004, 0.02], [0, 0, Math.PI / 2], true);
    }
  }

  bobble(skirtPivot, 0.035, 120, 10, 0.22);
  bobble(hood, 0.03, 100, 9, 0.3);

  // ------------------------------------------------------------ 运行时
  let expr = 'smile';
  let exprHold = 0;
  let blinkT = 1 + rand() * 3;
  let blinking = 0;
  let lockT = 0;
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  const dancer = {
    spec,
    id: specId,
    root,
    joints: J,
    headC,
    hipY: HIP_Y,
    ok: true,
    // lock 为 true 时，在 hold 秒内不会被舞蹈动作自带的表情覆盖
    setExpr(name, hold = 0, lock = false) {
      if (!faces[name]) return;
      expr = name;
      exprHold = hold;
      blinking = 0;
      if (lock) lockT = hold;
      faceMat.map = faces[name];
    },
    // 舞蹈动作自带的表情：优先级低于判定触发的表情
    poseExpr(name) {
      if (lockT > 0 || !faces[name]) return;
      if (expr !== name) dancer.setExpr(name, 0.35);
      else exprHold = 0.35;
    },
    // 舞台变暗时脸部贴图跟着压暗，否则眼白会"发光"
    setFaceLight(k) {
      faceMat.color.setScalar(k);
      emblem.material.color.setScalar(k);
    },
    update(dt) {
      // 表情回落与眨眼
      if (lockT > 0) lockT -= dt;
      if (exprHold > 0) {
        exprHold -= dt;
        if (exprHold <= 0) dancer.setExpr('smile');
      }
      if (expr === 'smile') {
        if (blinking > 0) {
          blinking -= dt;
          if (blinking <= 0) faceMat.map = faces.smile;
        } else {
          blinkT -= dt;
          if (blinkT <= 0) {
            blinkT = 1.8 + rand() * 3.2;
            blinking = 0.11;
            faceMat.map = faces.blink;
          }
        }
      }
      // 头发、裙摆、兜帽的惯性摆动
      const idt = dt > 0 ? 1 / dt : 0;
      for (const b of bobbles) {
        const o = b.obj;
        o.parent.getWorldPosition(tmpV);
        if (!b.init) {
          b.last.copy(tmpV);
          b.init = true;
        }
        const vx = (tmpV.x - b.last.x) * idt;
        const vy = (tmpV.y - b.last.y) * idt;
        const vz = (tmpV.z - b.last.z) * idt;
        b.last.copy(tmpV);
        o.parent.getWorldQuaternion(tmpQ).invert();
        tmpV.set(vx, vy, vz).applyQuaternion(tmpQ);
        const tx = clamp(tmpV.z * b.gain * 4, -b.limit, b.limit);
        const tz = clamp(-tmpV.x * b.gain * 4, -b.limit, b.limit);
        b.vx += ((tx - b.ax) * b.k - b.vx * b.d) * dt;
        b.vz += ((tz - b.az) * b.k - b.vz * b.d) * dt;
        b.ax = clamp(b.ax + b.vx * dt, -b.limit, b.limit);
        b.az = clamp(b.az + b.vz * dt, -b.limit, b.limit);
        o.rotation.set(b.rest.x + b.ax, b.rest.y, b.rest.z + b.az);
      }
    },
    headWorld(out) {
      return headC.getWorldPosition(out);
    },
  };
  return dancer;
}
