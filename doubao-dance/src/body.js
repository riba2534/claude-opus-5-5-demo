// 角色的身体。全部用"放样"生成：沿着骨骼排一串横截面环，连成连续的曲面；
// 每个环带蒙皮权重，在关节处从一根骨头过渡到下一根，所以弯曲时表面是连续的，
// 而不是一节一节的胶囊。一个角色的所有部件合成一个蒙皮网格，颜色和材质参数写在顶点上。
import * as THREE from 'three';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const spow = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
];
// 蒙皮用到的骨头：17 个关节，加一根只带裙摆晃动的骨头
export const BONES = [...JOINTS, 'skirt'];
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

// 骨架尺寸，约 5 头身（官方视频里的全身比例）。下面各部件的数值表都是按这套尺寸写的绝对高度。
export const DIM = {
  ankle: 0.075, shin: 0.3, thigh: 0.315, hipDrop: 0.025, legX: 0.06,
  spine: 0.085, chest: 0.16, neck: 0.275, head: 0.088,
  shoulderY: 0.245, shoulderX: 0.13, upper: 0.24, fore: 0.225,
};
export const HIP_Y = DIM.ankle + DIM.shin + DIM.thigh + DIM.hipDrop; // 0.715
// 和官方全身图并排比对后定下的横向比例：下面各表里的半宽是按略宽的版型写的，这里统一收窄
const TORSO_W = 0.875;
const LEG_W = 1;

export function createSkeleton(root) {
  const J = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    J[name] = b;
  };
  const D = DIM;
  mk('hips', root, 0, HIP_Y, 0);
  mk('spine', J.hips, 0, D.spine, 0);
  mk('chest', J.spine, 0, D.chest, 0);
  mk('neck', J.chest, 0, D.neck, 0);
  mk('head', J.neck, 0, D.head, 0);
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    mk('arm' + k, J.chest, D.shoulderX * s, D.shoulderY, 0);
    mk('fore' + k, J['arm' + k], 0, -D.upper, 0);
    mk('hand' + k, J['fore' + k], 0, -D.fore, 0);
    mk('leg' + k, J.hips, D.legX * s, -D.hipDrop, 0);
    mk('shin' + k, J['leg' + k], 0, -D.thigh, 0);
    mk('foot' + k, J['shin' + k], 0, -D.shin, 0);
  }
  mk('skirt', J.hips, 0, D.spine, 0);
  return J;
}

// ---------------------------------------------------------------- 共享的灯光参数与着色器
// 舞台每帧把自己的灯光写进来，所有角色材质共用这一份
export const charLight = {
  uKeyDir: { value: new THREE.Vector3(0.26, 0.62, 0.73).normalize() },
  uKeyCol: { value: new THREE.Color(1.85, 1.85, 1.85) },
  uSky: { value: new THREE.Color(1.1, 1.15, 1.3) },
  uGround: { value: new THREE.Color(0.5, 0.45, 0.75) },
  uRimADir: { value: new THREE.Vector3(-0.7, 0.4, -0.58).normalize() },
  uRimACol: { value: new THREE.Color(1, 0.5, 0.7) },
  uRimBDir: { value: new THREE.Vector3(0.7, 0.4, -0.58).normalize() },
  uRimBCol: { value: new THREE.Color(0.5, 0.65, 1) },
  uRim: { value: new THREE.Color(0.1, 0.12, 0.25) },
};

// 灯光函数：头部的着色器也用同一段，身体和头的明暗才对得上
export const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uKeyDir, uKeyCol, uSky, uGround, uRimADir, uRimACol, uRimBDir, uRimBCol, uRim;
  // 返回漫反射光照（已除以 π）。skin 越大，背光面越亮、越偏暖，模拟皮肤的透光
  vec3 softLight(vec3 N, float skin, float ao, out float lit) {
    lit = smoothstep(-0.45, 0.85, dot(N, uKeyDir));
    vec3 shade = mix(vec3(0.19, 0.185, 0.24), vec3(0.42, 0.27, 0.25), skin);
    vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
    vec3 rim = uRimACol * smoothstep(-0.1, 0.9, dot(N, uRimADir)) + uRimBCol * smoothstep(-0.1, 0.9, dot(N, uRimBDir));
    return (amb * mix(0.5, 1.0, ao) + (uKeyCol * mix(shade, vec3(1.0), lit) + rim * 0.6) * mix(0.42, 1.0, ao)) * 0.3183;
  }
`;

const SOFT_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  #ifdef USE_VATTR
    attribute vec3 aColor;
    attribute vec3 aMat;
  #endif
  uniform vec3 uColor;
  uniform vec3 uMat;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vC;
  varying vec3 vM;
  varying vec3 vO;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 w = modelMatrix * vec4(transformed, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * objectNormal;
    vO = position;
    #ifdef USE_VATTR
      vC = aColor;
      vM = aMat;
    #else
      vC = uColor;
      vM = uMat;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// vM = (皮肤程度, 光泽, 环境遮蔽)
const SOFT_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform float uHair;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vC;
  varying vec3 vM;
  varying vec3 vO;
  void main() {
    // 法线长度为零时不能直接归一化：得到的 NaN 会被泛光扩散成黑块
    float nl = length(vN);
    vec3 N = nl > 1e-5 ? vN / nl : vec3(0.0, 1.0, 0.0);
    float inside = gl_FrontFacing ? 0.0 : 1.0;
    N = mix(N, -N, inside);
    vec3 V = normalize(cameraPosition - vW);
    float skin = vM.x;
    float gloss = vM.y;
    float lit;
    vec3 dif = softLight(N, skin, vM.z, lit);
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 3.0);
    vec3 col = vC * dif;
    // 高光：皮肤和布料只有很淡很宽的一片，鞋面这类光滑材质才明显
    vec3 H = normalize(uKeyDir + V);
    float sp = pow(max(dot(N, H), 0.0), mix(14.0, 80.0, gloss)) * mix(0.035, 0.42, gloss) * lit;
    col += uKeyCol * sp * 0.3183;
    // 布料的绒面边缘光，深色衣服靠它才看得出体积
    col += (vC * 0.7 + vec3(0.03, 0.03, 0.04)) * pow(1.0 - ndv, 2.2) * (1.0 - skin) * (1.0 - gloss) * (0.45 + 0.55 * lit);
    col += uRim * fres * 0.9;
    if (uHair > 0.5) {
      // 头发：沿发丝方向（顺着表面往下）一条很淡很宽的各向异性高光带
      vec3 T = cross(cross(N, vec3(0.0, 1.0, 0.0)), N);
      float tl = length(T);
      T = tl > 1e-4 ? T / tl : vec3(1.0, 0.0, 0.0);
      float th = dot(normalize(T - N * 0.2), H);
      float band = pow(max(1.0 - th * th, 0.0), 14.0);
      col += (vC * 1.6 + vec3(0.02)) * band * 0.22 * uKeyCol * 0.3183 * smoothstep(-0.3, 0.5, dot(N, uKeyDir));
    }
    col *= mix(1.0, 0.42, inside);
    gl_FragColor = vec4(col, 1.0);
  }`;

function softMaterial(extra) {
  return new THREE.ShaderMaterial({
    uniforms: { ...charLight, uColor: { value: new THREE.Color(1, 1, 1) }, uMat: { value: new THREE.Vector3(0, 0, 1) }, uHair: { value: 0 } },
    vertexShader: SOFT_VERT,
    fragmentShader: SOFT_FRAG,
    ...extra,
  });
}

// 给头发、耳朵这些不蒙皮的零件用：颜色和材质参数走 uniform
export function softMat(color, o = {}) {
  const m = softMaterial({ side: o.double ? THREE.DoubleSide : THREE.FrontSide });
  m.uniforms.uColor.value.set(color);
  m.uniforms.uMat.value.set(o.skin || 0, o.gloss || 0, 1);
  m.uniforms.uHair.value = o.hair ? 1 : 0;
  return m;
}

// ---------------------------------------------------------------- 放样工具
const AX = [1, 0, 0];
const AY = [0, 1, 0];
const AZ = [0, 0, 1];
const MAT = { cloth: [0, 0], skin: [1, 0.12], shoe: [0, 0.3], rubber: [0, 0.18], denim: [0, 0.03] };
const colorCache = new Map();
function linear(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    const t = new THREE.Color(hex);
    c = [t.r, t.g, t.b];
    colorCache.set(hex, c);
  }
  return c;
}
const pick = (v, th, cs, sn) => (typeof v === 'function' ? v(th, cs, sn) : v);

class Sculpt {
  constructor() {
    this.p = [];
    this.i = [];
    this.si = [];
    this.sw = [];
    this.c = [];
    this.m = [];
  }
  get count() {
    return this.p.length / 3;
  }
  vert(x, y, z, w, col, ao, mat) {
    this.p.push(x, y, z);
    let sum = 0;
    for (const [, v] of w) sum += v;
    for (let k = 0; k < 4; k++) {
      const e = w[k];
      this.si.push(e ? BI[e[0]] : 0);
      this.sw.push(e ? e[1] / sum : 0);
    }
    const c = linear(col);
    this.c.push(c[0], c[1], c[2]);
    this.m.push(mat[0], mat[1], ao);
  }
  // rings：一串横截面。每个环 { c 中心, u/v 环平面的两个轴, ru/rv 半径, rvB 背面半径, n 超椭圆指数,
  //   shape 自定义截面, k 半径倍率, off 额外位移, w 蒙皮权重, col 颜色, ao 遮蔽, mat 材质 }，
  //   其中 k / off / w / col / ao 都可以是 (θ, cosθ, sinθ) 的函数
  loft(rings, o = {}) {
    const seg = o.seg || 20;
    const base = this.count;
    const R = rings.length;
    for (let r = 0; r < R; r++) {
      const g = rings[r];
      const u = g.u || AX;
      const v = g.v || AZ;
      const e = 2 / (g.n || o.n || 2);
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * TAU;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        let a;
        let b;
        if (g.shape) [a, b] = g.shape(th, cs, sn);
        else {
          a = g.ru * spow(cs, e);
          b = (sn >= 0 ? g.rv : g.rvB ?? g.rv) * spow(sn, e);
        }
        if (g.k) {
          const k = g.k(th, cs, sn);
          a *= k;
          b *= k;
        }
        let x = g.c[0] + u[0] * a + v[0] * b;
        let y = g.c[1] + u[1] * a + v[1] * b;
        let z = g.c[2] + u[2] * a + v[2] * b;
        if (g.off) {
          const d = g.off(th, cs, sn);
          x += d[0];
          y += d[1];
          z += d[2];
        }
        this.vert(x, y, z, pick(g.w ?? o.w, th, cs, sn), pick(g.col ?? o.col, th, cs, sn), pick(g.ao ?? o.ao ?? 1, th, cs, sn), g.mat ?? o.mat ?? MAT.cloth);
      }
    }
    const tris = [];
    const start = (r) => base + r * seg;
    const lim = o.loop ? R : R - 1;
    for (let r = 0; r < lim; r++) {
      const A = start(r);
      const B = start((r + 1) % R);
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        tris.push(A + j, B + j, A + j1, A + j1, B + j, B + j1);
      }
    }
    const centroid = (r) => {
      const c = [0, 0, 0];
      for (let j = 0; j < seg; j++) for (let k = 0; k < 3; k++) c[k] += this.p[(start(r) + j) * 3 + k] / seg;
      return c;
    };
    const cap = (r, flip) => {
      const c = centroid(r);
      const s = start(r);
      const idx = this.count;
      // 封口中心点沿用这一环第一个顶点的权重、颜色和材质
      this.p.push(c[0], c[1], c[2]);
      for (let k = 0; k < 4; k++) {
        this.si.push(this.si[s * 4 + k]);
        this.sw.push(this.sw[s * 4 + k]);
      }
      for (let k = 0; k < 3; k++) {
        this.c.push(this.c[s * 3 + k]);
        this.m.push(this.m[s * 3 + k]);
      }
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        if (flip) tris.push(idx, s + j1, s + j);
        else tris.push(idx, s + j, s + j1);
      }
    };
    if (o.capA) cap(0, false);
    if (o.capB) cap(R - 1, true);
    // 朝向：找中心间距最大的一对相邻环，看它的面是否朝外；不是就把整段的三角形翻过来
    let best = 0;
    let bestD = -1;
    for (let r = 0; r < lim; r++) {
      const a = rings[r].c;
      const b = rings[(r + 1) % R].c;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > bestD) {
        bestD = d;
        best = r;
      }
    }
    const P = (i) => [this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]];
    const a0 = P(start(best));
    const b0 = P(start((best + 1) % R));
    const a1 = P(start(best) + 1);
    const cen = centroid(best);
    const e1 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
    const e2 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const out = nx * (a0[0] - cen[0]) + ny * (a0[1] - cen[1]) + nz * (a0[2] - cen[2]);
    if (out < 0) for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
    for (const t of tris) this.i.push(t);
  }
  // 沿一条折线的圆管（手指、鞋带、鞋口这些）。pts: [{ p, r, rv? }]
  tube(pts, o = {}) {
    const ref = o.ref || AZ;
    const n = pts.length;
    const rings = pts.map((q, k) => {
      const a = pts[o.loop ? (k - 1 + n) % n : Math.max(0, k - 1)].p;
      const b = pts[o.loop ? (k + 1) % n : Math.min(n - 1, k + 1)].p;
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1;
      t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const d = ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2];
      let u = [ref[0] - t[0] * d, ref[1] - t[1] * d, ref[2] - t[2] * d];
      const ul = Math.hypot(u[0], u[1], u[2]) || 1;
      u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      return { ...q, c: q.p, u, v, ru: q.r, rv: q.rv ?? q.r };
    });
    this.loft(rings, o);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------- 躯干与上衣
// 躯干三根骨头（胯、腰、胸）按高度分配权重
function torsoW(y) {
  const hips = y < 0.73 ? 0.8 : y < 0.8 ? lerp(0.8, 0.2, (y - 0.73) / 0.07) : y < 0.86 ? lerp(0.2, 0, (y - 0.8) / 0.06) : 0;
  const chest = y < 0.84 ? 0 : y < 0.96 ? lerp(0, 0.7, (y - 0.84) / 0.12) : y < 1.04 ? lerp(0.7, 1, (y - 0.96) / 0.08) : 1;
  const spine = Math.max(0, 1 - hips - chest);
  const w = [];
  if (hips > 0.001) w.push(['hips', hips]);
  if (spine > 0.001) w.push(['spine', spine]);
  if (chest > 0.001) w.push(['chest', chest]);
  return w;
}

// 各款上衣的轮廓：[高度, 半宽, 前厚, 后厚, 超椭圆指数]，从下摆到领口
const TOPS = {
  // 宽松的落肩 T 恤：从肩膀直着垂下来，下摆略微外撇
  tee: {
    rows: [
      [0.698, 0.159, 0.113, 0.114, 2.5],
      [0.76, 0.156, 0.111, 0.112, 2.5],
      [0.82, 0.153, 0.108, 0.108, 2.5],
      [0.89, 0.151, 0.107, 0.104, 2.5],
      [0.96, 0.151, 0.109, 0.102, 2.5],
      [1.04, 0.153, 0.112, 0.101, 2.5],
      [1.11, 0.157, 0.108, 0.1, 2.6],
      [1.165, 0.165, 0.099, 0.097, 2.7],
      [1.205, 0.176, 0.088, 0.092, 2.8],
      [1.232, 0.158, 0.076, 0.083, 2.6],
      [1.25, 0.108, 0.063, 0.071, 2.3],
      [1.262, 0.066, 0.053, 0.059, 2.1],
    ],
    sleeve: [0.069, 0.066],
    sleeveLen: 0.152,
    drape: 1,
    dip: 0.016,
  },
  // 贴身上衣，下摆收在裙腰里
  fitted: {
    rows: [
      [0.792, 0.112, 0.088, 0.093, 2.3],
      [0.84, 0.108, 0.086, 0.088, 2.3],
      [0.89, 0.111, 0.089, 0.088, 2.3],
      [0.96, 0.119, 0.096, 0.091, 2.4],
      [1.04, 0.127, 0.103, 0.093, 2.4],
      [1.11, 0.135, 0.098, 0.094, 2.5],
      [1.165, 0.149, 0.092, 0.092, 2.6],
      [1.205, 0.158, 0.083, 0.088, 2.7],
      [1.232, 0.143, 0.072, 0.08, 2.5],
      [1.25, 0.104, 0.062, 0.07, 2.3],
      [1.262, 0.065, 0.052, 0.058, 2.1],
    ],
    sleeve: [0.054, 0.053],
    sleeveLen: 0.115,
    dip: 0.02,
  },
  // 卫衣：更宽松，下摆是一圈收紧的罗纹
  hoodie: {
    rows: [
      [0.756, 0.128, 0.098, 0.103, 2.3],
      [0.782, 0.131, 0.101, 0.106, 2.3],
      [0.797, 0.158, 0.116, 0.118, 2.5],
      [0.85, 0.16, 0.117, 0.116, 2.5],
      [0.9, 0.159, 0.116, 0.112, 2.5],
      [0.96, 0.159, 0.117, 0.109, 2.5],
      [1.04, 0.161, 0.119, 0.107, 2.5],
      [1.11, 0.164, 0.113, 0.106, 2.6],
      [1.165, 0.172, 0.104, 0.103, 2.7],
      [1.205, 0.176, 0.093, 0.098, 2.8],
      [1.232, 0.157, 0.08, 0.089, 2.6],
      [1.25, 0.113, 0.068, 0.076, 2.3],
      [1.262, 0.071, 0.057, 0.063, 2.1],
    ],
    sleeve: [0.064, 0.063],
    drape: 0.6,
    dip: 0.012,
    rib: 0.785,
  },
};

// 上衣正面在某个高度的前后位置，摆胸口徽章用
export function topFront(style, y) {
  const rows = TOPS[style || 'tee'].rows;
  for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) return lerp(rows[i - 1][2], rows[i][2], (y - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
  return rows[rows.length - 1][2];
}

function buildTop(S, spec) {
  const st = TOPS[spec.topStyle || 'tee'];
  const top = spec.top;
  const ribCol = spec.rib || top;
  const rows = st.rows;
  const n = rows.length;
  // 领口前低后高；腋下压暗
  const rings = rows.map(([y, rx, rf, rb, e], i) => {
    const k = i === n - 1 ? 1 : i === n - 2 ? 0.45 : 0;
    const w = torsoW(y);
    if (i === n - 1) w.push(['neck', 0.3]);
    return {
      c: [0, y, 0],
      ru: rx * (y > 1.245 ? 1 : TORSO_W),
      rv: rf * 0.97,
      rvB: rb * 0.97,
      n: e,
      w,
      col: st.rib && y < st.rib ? ribCol : top,
      k: st.drape && y < 1.0 && !(st.rib && y < st.rib) ? (th) => 1 + st.drape * 0.016 * sstep(1.0, 0.74, y) * (Math.sin(th * 5 + 0.6) + 0.6 * Math.sin(th * 9 + 2.1)) : null,
      ao: y > 1.1 && y < 1.22 ? (th, cs) => 1 - 0.5 * Math.pow(Math.abs(cs), 4) : i === 0 ? 0.8 : 1,
      off: k ? (th, cs, sn) => [0, -st.dip * k * Math.pow(Math.max(0, sn), 1.4), 0] : null,
    };
  });
  S.loft(rings, { seg: 32 });
  // 领口那圈内搭的白边
  if (spec.collar) {
    const [y, rx, rf, rb, e] = rows[n - 1];
    const lip = (dy, k) => ({ c: [0, y + dy, 0], ru: rx * k, rv: rf * k, rvB: rb * k, n: e, off: (th, cs, sn) => [0, -st.dip * Math.pow(Math.max(0, sn), 1.4), 0] });
    S.loft([lip(-0.001, 0.99), lip(0.004, 0.965), lip(0.0045, 0.925), lip(-0.002, 0.885)], { seg: 32, col: spec.collar, w: [['chest', 0.7], ['neck', 0.3]] });
  }

  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    const jx = DIM.shoulderX * s;
    const jy = 1.205;
    const so = st.sleeve[0] * 0.9;
    const sz = st.sleeve[1] * 0.9;
    const long = spec.sleeves === 'long';
    const slen = st.sleeveLen || 0.135;
    const cuffCol = spec.cuff || ribCol;
    // d：从肩关节往下的距离。顶上几环一半跟着胸、一半跟着上臂，抬手时袖窿被带起来而不是整个转走
    const rows2 = [
      [-0.022, 0.02, 0.022, 0.85],
      [-0.016, so * 0.6, sz * 0.68, 0.78],
      [-0.004, so * 0.8, sz * 0.86, 0.62],
      [0.018, so * 0.92, sz * 0.95, 0.38],
      [0.055, so * 0.95, sz * 0.97, 0.1],
      [0.095, so * 0.975, sz * 0.985, 0],
    ];
    const rings2 = rows2.map(([d, rx, rz, cw]) => ({
      c: [jx - s * 0.02 * sstep(0.01, -0.022, d) + s * (long ? 0.004 : 0.022) * sstep(0, slen, d), jy - d, 0],
      ru: rx,
      rv: rz,
      w: cw > 0 ? [['chest', cw], ['arm' + k, 1 - cw]] : [['arm' + k, 1]],
      ao: d < 0.03 ? (th, cs) => 1 - 0.45 * Math.max(0, -cs * s) : 1,
    }));
    if (!long) {
      rings2.push({ c: [jx + s * 0.022, jy - slen, 0], ru: so, rv: sz, w: [['arm' + k, 1]], ao: 0.85 });
    } else {
      // 长袖：过肘到手腕，袖口一圈罗纹
      const A = 'arm' + k;
      const F = 'fore' + k;
      const lr = [
        [0.14, 0.9, [[A, 1]]],
        [0.2, 0.84, [[A, 1]]],
        [0.222, 0.82, [[A, 0.78], [F, 0.22]]],
        [0.24, 0.81, [[A, 0.5], [F, 0.5]]],
        [0.258, 0.81, [[A, 0.22], [F, 0.78]]],
        [0.3, 0.8, [[F, 1]]],
        [0.37, 0.77, [[F, 1]]],
        [0.418, 0.75, [[F, 1]]],
        [0.43, 0.6, [[F, 1]], cuffCol],
        [0.462, 0.58, [[F, 0.6], ['hand' + k, 0.4]], cuffCol],
      ];
      for (const [d, f, w, col] of lr) rings2.push({ c: [jx, jy - d, 0], ru: so * f, rv: sz * f, w, col: col || top, ao: d > 0.45 ? 0.85 : 1 });
    }
    S.loft(rings2, { seg: 20, col: top, capA: true });
  }
}

// ---------------------------------------------------------------- 脖子、手臂、手
function buildNeck(S, spec) {
  const skin = spec.skin;
  // 脖子露出来一截（官方形象下巴到肩线大约是 0.17 个头高）。上半段比头模自带的那截脖子粗一圈，
  // 把它参差的切口包在里面，最上面再收进下巴底下
  const rows = [
    [1.196, 0.092, 0.058, 0.064, [['chest', 1]], 0.85],
    [1.235, 0.058, 0.047, 0.05, [['chest', 1]], 0.82],
    [1.258, 0.0465, 0.0435, 0.046, [['chest', 0.5], ['neck', 0.5]], 0.8],
    [1.276, 0.0455, 0.043, 0.0455, [['neck', 0.85], ['head', 0.15]], 0.74],
    [1.292, 0.0445, 0.042, 0.0445, [['neck', 0.6], ['head', 0.4]], 0.64],
    [1.306, 0.039, 0.037, 0.039, [['neck', 0.35], ['head', 0.65]], 0.52],
    [1.33, 0.03, 0.03, 0.031, [['head', 1]], 0.45],
  ];
  S.loft(rows.map(([y, rx, rf, rb, w, ao]) => ({ c: [0, y, 0.002], ru: rx, rv: rf, rvB: rb, w, ao })), { seg: 18, col: skin, mat: MAT.skin, capA: true, capB: true });
}

function buildArm(S, spec, s) {
  const k = s > 0 ? 'L' : 'R';
  const A = 'arm' + k;
  const F = 'fore' + k;
  const Hn = 'hand' + k;
  const jx = DIM.shoulderX * s;
  const jy = 1.205;
  const skin = spec.skin;
  const long = spec.sleeves === 'long';
  // [往下的距离, 厚（左右）, 宽（前后）, 权重]
  const rows = [
    [0.04, 0.028, 0.029, [[A, 1]]],
    [0.06, 0.0355, 0.0365, [[A, 1]]],
    [0.12, 0.036, 0.0375, [[A, 1]]],
    [0.18, 0.0335, 0.035, [[A, 1]]],
    [0.215, 0.031, 0.0325, [[A, 0.8], [F, 0.2]]],
    [0.24, 0.03, 0.0315, [[A, 0.5], [F, 0.5]]],
    [0.265, 0.031, 0.0325, [[A, 0.2], [F, 0.8]]],
    [0.3, 0.0315, 0.033, [[F, 1]]],
    [0.36, 0.0285, 0.03, [[F, 1]]],
    [0.42, 0.023, 0.0262, [[F, 1]]],
    [0.45, 0.0198, 0.0248, [[F, 0.7], [Hn, 0.3]]],
    [0.465, 0.0186, 0.0244, [[F, 0.4], [Hn, 0.6]]],
    [0.478, 0.0186, 0.0256, [[Hn, 1]]],
  ].filter(([d]) => !long || d >= 0.36);
  S.loft(rows.map(([d, rx, rz, w]) => ({ c: [jx, jy - d, 0], ru: rx, rv: rz, w, ao: d < 0.14 && !long ? 0.7 : 1 })), { seg: 16, col: skin, mat: MAT.skin, capA: true });

  // --- 手：手心朝向身体，拇指朝前。局部坐标 lx 向外（手背一侧），ly 向上，lz 向前
  const wy = jy - 0.465;
  const HK = 1.08;
  const P = (lx, ly, lz) => [jx + s * lx * HK, wy + ly * HK, lz * HK];
  const hw = [[Hn, 1]];
  const palm = [
    [0.0, 0.0172, 0.0235, 0],
    [0.014, 0.0178, 0.0278, 0.001],
    [0.032, 0.0168, 0.0336, 0.002],
    [0.05, 0.015, 0.0356, 0.001],
    [0.064, 0.0128, 0.035, 0],
    [0.0715, 0.0082, 0.0328, 0],
  ];
  S.loft(palm.map(([d, tx, wz, cz]) => ({ c: P(0, -d, cz), ru: tx * HK, rv: wz * HK, n: 2.7 })), { seg: 16, col: skin, mat: MAT.skin, w: hw, capB: true });
  // 四指：自然微屈，从食指到小指越来越弯
  const fingers = [
    [0.0258, 0.0084, 0.05, 0.07, 1.0],
    [0.0088, 0.0087, 0.056, 0.02, 1.08],
    [-0.0085, 0.0082, 0.051, -0.03, 1.2],
    [-0.0253, 0.0073, 0.041, -0.09, 1.35],
  ];
  for (const [fz, fr, len, spread, curl] of fingers) {
    let p = [0.0005, -0.056, fz];
    let r = fr;
    const pts = [{ p: P(...p), r: r * HK }];
    let dir = [0, -1, 0];
    for (const [fl, ang] of [[0.42, 10], [0.33, 30], [0.25, 46]]) {
      const a = ang * curl * DEG;
      dir = [-Math.sin(a), -Math.cos(a), spread];
      for (let h = 0; h < 2; h++) {
        p = [p[0] + (dir[0] * len * fl) / 2, p[1] + (dir[1] * len * fl) / 2, p[2] + (dir[2] * len * fl) / 2];
        r *= 0.975;
        pts.push({ p: P(...p), r: r * HK });
      }
    }
    // 指尖收圆
    for (const [adv, k2] of [[0.5, 0.78], [0.85, 0.42]]) pts.push({ p: P(p[0] + dir[0] * r * adv, p[1] + dir[1] * r * adv, p[2] + dir[2] * r * adv), r: r * k2 * HK });
    S.tube(pts, { seg: 8, ref: AZ, col: skin, mat: MAT.skin, w: hw, capB: true });
  }
  // 拇指
  {
    let p = [-0.002, -0.018, 0.024];
    let r = 0.0108;
    const pts = [{ p: P(...p), r: r * HK }];
    let dir = [0, -1, 0];
    for (const [d, len] of [[[-0.35, -0.55, 0.76], 0.03], [[-0.3, -0.84, 0.46], 0.024]]) {
      const l = Math.hypot(...d);
      dir = [d[0] / l, d[1] / l, d[2] / l];
      for (let h = 0; h < 2; h++) {
        p = [p[0] + (dir[0] * len) / 2, p[1] + (dir[1] * len) / 2, p[2] + (dir[2] * len) / 2];
        r *= 0.955;
        pts.push({ p: P(...p), r: r * HK });
      }
    }
    for (const [adv, k2] of [[0.5, 0.78], [0.85, 0.42]]) pts.push({ p: P(p[0] + dir[0] * r * adv, p[1] + dir[1] * r * adv, p[2] + dir[2] * r * adv), r: r * k2 * HK });
    S.tube(pts, { seg: 8, ref: AX, col: skin, mat: MAT.skin, w: hw, capB: true });
  }
}

// ---------------------------------------------------------------- 胯、腿、裤子、裙子
function buildHips(S, col, mat) {
  const rows = [
    [0.815, 0.1, 0.078, 0.084, [['spine', 0.5], ['hips', 0.5]]],
    [0.78, 0.113, 0.088, 0.096, [['hips', 1]]],
    [0.74, 0.123, 0.088, 0.105, [['hips', 1]]],
    [0.705, 0.126, 0.08, 0.106, [['hips', 1]]],
    [0.68, 0.118, 0.066, 0.094, [['hips', 1]]],
    [0.662, 0.08, 0.052, 0.07, [['hips', 1]]],
    [0.65, 0.03, 0.036, 0.044, [['hips', 1]]],
  ];
  S.loft(rows.map(([y, rx, rf, rb, w]) => ({ c: [0, y, 0], ru: rx * TORSO_W * 1.04, rv: rf, rvB: rb, w, n: 2.3 })), { seg: 24, col, mat, capA: true, capB: true, ao: 0.85 });
}

// 大腿根几环一半跟着胯，腿抬起来时臀部和大腿之间是连续的
function legTop(k) {
  const L = 'leg' + k;
  return [
    [0.752, [['hips', 1]]],
    [0.735, [['hips', 0.9], [L, 0.1]]],
    [0.705, [['hips', 0.6], [L, 0.4]]],
    [0.675, [['hips', 0.3], [L, 0.7]]],
  ];
}
const kneeW = (k, y) => {
  const L = 'leg' + k;
  const Sh = 'shin' + k;
  const t = sstep(0.4, 0.35, y);
  if (t <= 0.001) return [[L, 1]];
  if (t >= 0.999) return [[Sh, 1]];
  return [[L, 1 - t], [Sh, t]];
};
const ankleW = (k, y) => {
  const Sh = 'shin' + k;
  const F = 'foot' + k;
  const t = sstep(0.12, 0.05, y);
  if (t <= 0.001) return [[Sh, 1]];
  if (t >= 0.999) return [[F, 1]];
  return [[Sh, 1 - t], [F, t]];
};

function buildPantsLeg(S, spec, s) {
  const k = s > 0 ? 'L' : 'R';
  const x = DIM.legX * s;
  const tw = legTop(k);
  // 修身的锥形裤：[高度, 半宽, 前厚, 后厚]
  const rows = [
    [0.752, 0.034, 0.036, 0.036],
    [0.735, 0.054, 0.059, 0.06],
    [0.705, 0.0635, 0.067, 0.068],
    [0.675, 0.0645, 0.068, 0.07],
    [0.64, 0.063, 0.065, 0.068],
    [0.56, 0.058, 0.06, 0.062],
    [0.47, 0.053, 0.055, 0.056],
    [0.41, 0.0495, 0.052, 0.052],
    [0.39, 0.049, 0.0517, 0.0513],
    [0.375, 0.0485, 0.0513, 0.0508],
    [0.36, 0.0485, 0.0508, 0.0508],
    [0.33, 0.048, 0.0495, 0.052],
    [0.27, 0.0465, 0.0475, 0.051],
    [0.21, 0.0445, 0.0455, 0.0465],
    [0.168, 0.0435, 0.0445, 0.0455],
  ];
  S.loft(
    rows.map(([y, rx, rf, rb], i) => ({
      c: [i === 0 ? x * 0.9 : x, y, 0],
      ru: rx * LEG_W,
      rv: rf * LEG_W,
      rvB: rb * LEG_W,
      w: i < 4 ? tw[i][1] : kneeW(k, y),
      // 两腿之间压暗
      ao: y > 0.5 ? (th, cs) => 1 - 0.4 * Math.max(0, -cs * s) * sstep(0.5, 0.66, y) : 1,
    })),
    { seg: 20, col: spec.bottom, mat: MAT.denim, capA: true },
  );
  // 翻边：比裤腿粗一圈，颜色是牛仔布的反面
  const cuff = [
    [0.2, 0.0445],
    [0.196, 0.0488],
    [0.165, 0.0493],
    [0.132, 0.049],
    [0.128, 0.0462],
  ];
  S.loft(cuff.map(([y, r]) => ({ c: [x, y, 0.0005], ru: r * LEG_W, rv: r * 1.03 * LEG_W, w: [['shin' + k, 1]] })), { seg: 20, col: spec.pantsCuff || spec.bottom, mat: MAT.denim });
}

function buildLeg(S, spec, s, fromY) {
  const k = s > 0 ? 'L' : 'R';
  const x = DIM.legX * s;
  const tw = legTop(k);
  const rows = [
    [0.752, 0.034, 0.036, 0.036],
    [0.735, 0.052, 0.056, 0.058],
    [0.705, 0.061, 0.064, 0.065],
    [0.675, 0.062, 0.065, 0.067],
    [0.64, 0.06, 0.062, 0.065],
    [0.56, 0.054, 0.056, 0.058],
    [0.47, 0.047, 0.049, 0.05],
    [0.41, 0.0425, 0.045, 0.0445],
    [0.39, 0.0415, 0.0445, 0.0438],
    [0.375, 0.041, 0.0445, 0.0435],
    [0.36, 0.041, 0.0437, 0.0435],
    [0.32, 0.0415, 0.0425, 0.048],
    [0.26, 0.04, 0.041, 0.048],
    [0.2, 0.0355, 0.0365, 0.04],
    [0.14, 0.03, 0.0315, 0.0325],
    [0.1, 0.0275, 0.03, 0.03],
    [0.075, 0.028, 0.032, 0.031],
    [0.05, 0.029, 0.034, 0.032],
  ];
  const used = rows.filter(([y]) => y <= fromY);
  S.loft(
    used.map(([y, rx, rf, rb]) => {
      const i = rows.findIndex((r) => r[0] === y);
      const lw = y > 0.15 ? LEG_W : 1;
      return { c: [i === 0 ? x * 0.9 : x, y, 0], ru: rx * lw, rv: rf * lw, rvB: rb * lw, w: i < 4 ? tw[i][1] : y > 0.2 ? kneeW(k, y) : ankleW(k, y), ao: y > 0.6 ? 0.75 : 1 };
    }),
    { seg: 18, col: spec.skin, mat: MAT.skin, capA: true, capB: true },
  );
  if (spec.socks) {
    const top = spec.sockTop || 0.2;
    const band = spec.sockBand || spec.socks;
    // 袜子贴着腿，腿的半径在脚踝以上乘过 LEG_W，这里同样处理
    const sr = rows.filter(([y]) => y < top + 0.01 && y >= 0.05).map(([y, rx, rf, rb]) => (y > 0.15 ? [y, rx * LEG_W, rf * LEG_W, rb * LEG_W] : [y, rx, rf, rb]));
    const first = sr[0];
    const rings = [
      { c: [x, top + 0.004, 0], ru: first[1] + 0.001, rv: first[2] + 0.001, rvB: first[3] + 0.001, w: kneeW(k, top), col: band },
      { c: [x, top, 0], ru: first[1] + 0.0045, rv: first[2] + 0.0045, rvB: first[3] + 0.0045, w: kneeW(k, top), col: band },
      { c: [x, top - 0.022, 0], ru: first[1] + 0.004, rv: first[2] + 0.004, rvB: first[3] + 0.004, w: kneeW(k, top), col: band },
    ];
    for (const [y, rx, rf, rb] of sr) if (y < top - 0.03) rings.push({ c: [x, y, 0], ru: rx + 0.0032, rv: rf + 0.0032, rvB: rb + 0.0032, w: y > 0.2 ? kneeW(k, y) : ankleW(k, y) });
    S.loft(rings, { seg: 18, col: spec.socks, capB: true });
  }
}

function buildSkirt(S, spec) {
  // 百褶裙：下半截一部分跟着两条腿走，抬腿时裙摆会被带起来；其余跟着一根带弹簧的骨头晃
  const rows = [
    [0.816, 0.108, 0.088, 0],
    [0.79, 0.118, 0.098, 0.06],
    [0.75, 0.14, 0.12, 0.28],
    [0.7, 0.163, 0.146, 0.55],
    [0.64, 0.186, 0.172, 0.82],
    [0.59, 0.202, 0.188, 1],
    [0.582, 0.204, 0.19, 1],
  ];
  const pleat = (f) => (th) => 1 + 0.06 * f * (Math.abs(((th * 16) / TAU) % 1 - 0.5) * 4 - 1);
  S.loft(
    rows.map(([y, rx, rz, f], i) => ({
      c: [0, y, 0.004],
      ru: rx * 0.93,
      rv: rz * 0.95,
      k: pleat(f),
      col: i >= rows.length - 2 && spec.skirtTrim ? spec.skirtTrim : spec.bottom,
      ao: lerp(1, 0.82, f),
      w: (th, cs) => {
        const leg = 0.46 * f;
        const l = sstep(-0.4, 0.4, cs);
        const w = [['hips', (1 - leg) * (1 - f)], ['skirt', (1 - leg) * f]];
        if (leg * l > 0.001) w.push(['legL', leg * l]);
        if (leg * (1 - l) > 0.001) w.push(['legR', leg * (1 - l)]);
        return w.filter((e) => e[1] > 0.001);
      },
    })),
    { seg: 96 },
  );
}

// ---------------------------------------------------------------- 运动鞋
function buildShoe(S, spec, s) {
  const k = s > 0 ? 'L' : 'R';
  const fw = [['foot' + k, 1]];
  const jx = DIM.legX * s;
  const jy = 0.075;
  const Z0 = -0.062;
  const LEN = 0.212;
  // 局部坐标：lx 向外侧，ly 向上（0 在脚踝，地面在 -0.075），lz 向前
  const P = (lx, ly, lz) => [jx + s * lx, jy + ly, lz];
  const U = [s, 0, 0];
  const upper = spec.shoe;
  const cap = spec.shoeCap || upper;
  const sole = spec.sole;
  const outsole = spec.outsole || sole;
  // 鞋底轮廓的半宽：脚跟窄、前掌宽，两头收圆
  const width = (t) => lerp(0.033, 0.0405, sstep(0.3, 0.7, t)) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 4.6)), 0.42);
  const cx = (t) => -0.005 * sstep(0.5, 1, t);
  const thick = (t) => lerp(0.03, 0.021, sstep(0.1, 0.8, t));
  const lift = (t) => 0.015 * Math.pow(sstep(0.7, 1, t), 1.4) + 0.004 * sstep(0.1, 0, t);
  const N = 15;
  const ts = [];
  for (let i = 0; i <= N; i++) ts.push(lerp(0.012, 0.988, i / N));
  // 鞋底：圆角矩形截面，最底下一条是外底
  S.loft(
    ts.map((t) => ({
      c: P(cx(t), -0.075 + thick(t) / 2 + lift(t), Z0 + LEN * t),
      u: U,
      v: AY,
      ru: width(t) + 0.0035,
      rv: thick(t) / 2,
      n: 4.5,
      col: (th, cs, sn) => (sn < -0.55 ? outsole : sole),
    })),
    { seg: 20, mat: MAT.rubber, w: fw, capA: true, capB: true },
  );
  // 鞋面：下半截贴着鞋底，上半截是拱形，高度从鞋口往鞋头降下去
  const hs = [
    [0, 0.046],
    [0.07, 0.064],
    [0.2, 0.07],
    [0.34, 0.066],
    [0.48, 0.05],
    [0.63, 0.037],
    [0.8, 0.029],
    [0.92, 0.021],
    [1, 0.01],
  ];
  const height = (t) => {
    for (let i = 1; i < hs.length; i++) if (t <= hs[i][0]) return lerp(hs[i - 1][1], hs[i][1], sstep(hs[i - 1][0], hs[i][0], t));
    return hs[hs.length - 1][1];
  };
  const tu = [];
  for (let i = 0; i <= N; i++) tu.push(lerp(0.03, 0.972, i / N));
  const baseY = (t) => -0.075 + thick(t) + lift(t) - 0.004;
  // 鞋面最高处的高度，鞋舌和鞋带都贴着它摆
  const topY = (t) => baseY(t) + height(t);
  const tOf = (z) => (z - Z0) / LEN;
  S.loft(
    tu.map((t) => {
      const w = width(t) - 0.0012;
      const h = height(t);
      // 脚踝一段的截面接近方形（鞋帮是立起来的），越往鞋头越圆
      const e = 2 / lerp(3.6, 2.4, sstep(0.3, 0.75, t));
      return {
        c: P(cx(t), baseY(t), Z0 + LEN * t),
        u: U,
        v: AY,
        shape: (th, cs, sn) => [w * spow(cs, e), sn >= 0 ? h * Math.pow(sn, e) : -0.006 * Math.pow(-sn, 0.6)],
        // 鞋头和后跟各一块包片，颜色略有区别
        col: t > 0.77 || t < 0.13 ? cap : upper,
      };
    }),
    { seg: 20, mat: MAT.shoe, w: fw, capA: true, capB: true },
  );
  // 鞋口：一圈软垫
  const collar = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const z = -0.008 + Math.sin(a) * 0.039;
    collar.push({ p: P(Math.cos(a) * 0.0295, Math.min(0.016, topY(tOf(z))) + 0.001, z), r: 0.0058 });
  }
  S.tube(collar, { seg: 8, ref: AY, loop: true, col: spec.shoeTrim || upper, mat: MAT.shoe, w: fw });
  // 鞋舌：从鞋口前沿贴着鞋面往前
  const tongue = [0.026, 0.045, 0.068, 0.092].map((z, i) => ({ p: P(cx(tOf(z)), topY(tOf(z)) + [0.008, 0.004, 0.002, 0.0005][i], z), r: [0.011, 0.0155, 0.0155, 0.013][i], rv: 0.0035 }));
  S.tube(tongue, { seg: 10, ref: U, col: upper, mat: MAT.shoe, w: fw, capA: true, capB: true });
  // 鞋带：四道，两头顺着鞋面弧度压下去
  for (let i = 0; i < 4; i++) {
    const z = 0.046 + i * 0.0145;
    const t = tOf(z);
    const y = topY(t) + 0.0035;
    const hw = (width(t) - 0.001) * 0.62;
    const drop = height(t) * 0.2;
    S.tube(
      [
        { p: P(cx(t) - hw, y - drop, z - 0.002), r: 0.0022 },
        { p: P(cx(t) - hw * 0.5, y - drop * 0.18, z - 0.0005), r: 0.0022 },
        { p: P(cx(t) + hw * 0.5, y - drop * 0.18, z + 0.002), r: 0.0022 },
        { p: P(cx(t) + hw, y - drop, z + 0.0035), r: 0.0022 },
      ],
      { seg: 6, ref: AZ, col: spec.laces || '#ffffff', mat: MAT.cloth, w: fw, capA: true, capB: true },
    );
  }
  // 后跟提环
  S.tube(
    [
      { p: P(0, -0.014, Z0 + 0.003), r: 0.007, rv: 0.0026 },
      { p: P(0, 0.006, Z0 + 0.005), r: 0.007, rv: 0.0026 },
      { p: P(0, 0.024, Z0 + 0.011), r: 0.0055, rv: 0.0024 },
    ],
    { seg: 8, ref: U, col: spec.shoeTrim || cap, mat: MAT.shoe, w: fw, capA: true, capB: true },
  );
}

// ---------------------------------------------------------------- 组装
export function buildBody(J, spec) {
  const S = new Sculpt();
  buildNeck(S, spec);
  buildTop(S, spec);
  for (const s of [1, -1]) buildArm(S, spec, s);
  if (spec.pants) {
    buildHips(S, spec.bottom, MAT.denim);
    for (const s of [1, -1]) {
      buildPantsLeg(S, spec, s);
      buildLeg(S, spec, s, 0.21);
    }
  } else {
    buildHips(S, spec.shorts || spec.bottom, MAT.cloth);
    buildSkirt(S, spec);
    for (const s of [1, -1]) buildLeg(S, spec, s, 1);
  }
  for (const s of [1, -1]) buildShoe(S, spec, s);

  const mat = softMaterial({ side: THREE.DoubleSide, defines: { USE_VATTR: 1 } });
  const mesh = new THREE.SkinnedMesh(S.geometry(), mat);
  mesh.frustumCulled = false;
  return { mesh, bones: BONES.map((n) => J[n]), triangles: S.i.length / 3 };
}
