// 渲染层：Three.js 底座 + 注入式 PBR 材质 + 自建后处理链
// 场景 → [半分辨率 AO/体积光 → 双边模糊] → 运动模糊 → Bloom → 自动曝光 → 合成(光晕/ACES/调色) → FXAA
import {
  WebGLRenderer, Scene, PerspectiveCamera, Camera, Mesh, InstancedMesh, BufferGeometry, InstancedBufferGeometry, SphereGeometry,
  Float32BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, InstancedInterleavedBuffer, InstancedBufferAttribute,
  MeshStandardMaterial, ShaderMaterial, DirectionalLight, HemisphereLight, PointLight, WebGLRenderTarget, DepthTexture,
  DataTexture, CanvasTexture, PMREMGenerator, Vector2, Vector3, Matrix4, HalfFloatType, RGBAFormat, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter, DynamicDrawUsage, BackSide, DoubleSide, CustomBlending, OneFactor, PCFShadowMap, NoToneMapping, NoColorSpace, UnsignedByteType,
} from 'three';
import { m4, mul, invert, hypot, round, min, max, floor, rng, PI } from './math.js';
import * as S from './shaders.js';

export let renderer, scene, camera, cv;
// 画质分档：渲染比例、MSAA、阴影分辨率、AO、体积光步数、运动模糊、环境贴图尺寸、像素比上限
export const TIERS = {
  low: { scale: 0.75, ms: 0, sh: 1024, ao: 0, vol: 0, mb: 0, fxaa: 1, env: 64, dpr: 1 },
  medium: { scale: 1, ms: 0, sh: 2048, ao: 1, vol: 10, mb: 0, fxaa: 1, env: 128, dpr: 1 },
  high: { scale: 1, ms: 4, sh: 2048, ao: 1, vol: 16, mb: 1, fxaa: 1, env: 128, dpr: 1.5 },
  ultra: { scale: 1, ms: 4, sh: 4096, ao: 1, vol: 28, mb: 1, fxaa: 1, env: 256, dpr: 2 },
};
export let Q = TIERS.high, qName = 'high';
export const view = { W: 1, H: 1, vp: m4(), ivp: m4(), pvp: m4(), cam: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1], fov: 1 };
export const fx = { dmg: 0, bt: 0, spd: 0, exp: 1, fade: 0, bloom: 0.5, flare: 0.022, key: 0.19, mbNear: 8 };
const SHR = 46; // 阴影覆盖半径

// 共享 uniform（所有注入材质引用同一批对象）
const V3 = () => new Vector3();
const U = { uTime: { value: 0 }, uNight: { value: 0 }, uFogK: { value: 0.004 }, tNoise: { value: null }, uHor: { value: V3() }, uGlow: { value: V3() }, uSunD: { value: V3() } };
const USky = { uZen: { value: V3() }, uMoonD: { value: V3() }, uCl: { value: V3() }, uSunK: { value: V3() } };

const meshes = [];
let matObj, matGround, matShell, matSign, sky, sun, hemi, pmrem, envScene, envRT, envT = -99, envSkyU;
const pool = [];
// 粒子 / 光束实例缓冲
const PMAX = 4096, TMAX = 1024;
export const pbuf = new Float32Array(PMAX * 12), tbuf = new Float32Array(TMAX * 12);
export const cnt = { p: 0, t: 0, PMAX, TMAX };
let pGeo, pIB, tGeo, tIB;
// 动态点光源：固定 6 盏的灯池，避免光源数量变化触发着色器重编译
const lights = [];
export const addLight = (x, y, z, r, cr, cg, cb) => lights.push([x, y, z, r, cr, cg, cb, 0]);

// 可平铺噪声纹理：R=fbm  G=Voronoi 单元随机值  B=Voronoi 边距(F2-F1)  A=白噪声
function noiseTex(N = 256, C = 12) {
  const d = new Uint8Array(N * N * 4), r = rng(20261112), pts = [], lat = [8, 16, 32, 64].map(n => Float32Array.from({ length: n * n }, r));
  for (let i = 0; i < C * C; i++) pts.push([(i % C) + r(), floor(i / C) + r(), r()]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let f = 0, a = 0.5;
      lat.forEach((L, k) => {
        const n = 8 << k, u = (x / N) * n, v = (y / N) * n, iu = floor(u), iv = floor(v);
        let fu = u - iu, fv = v - iv; fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv);
        const g = (i, j) => L[((j + n) % n) * n + ((i + n) % n)];
        f += a * (g(iu, iv) * (1 - fu) * (1 - fv) + g(iu + 1, iv) * fu * (1 - fv) + g(iu, iv + 1) * (1 - fu) * fv + g(iu + 1, iv + 1) * fu * fv);
        a *= 0.5;
      });
      const u = (x / N) * C, v = (y / N) * C, cx = floor(u), cy = floor(v);
      let f1 = 9, f2 = 9, id = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const q = pts[((cy + j + C) % C) * C + ((cx + i + C) % C)], px = q[0] - ((cx + i + C) % C) + cx + i, py = q[1] - ((cy + j + C) % C) + cy + j;
        const dd = hypot(px - u, py - v);
        if (dd < f1) { f2 = f1; f1 = dd; id = q[2]; } else if (dd < f2) f2 = dd;
      }
      const o = (y * N + x) * 4;
      d[o] = min(f / 0.9375, 1) * 255; d[o + 1] = id * 255; d[o + 2] = min((f2 - f1) * 1.4, 1) * 255; d[o + 3] = r() * 255;
    }
  const t = new DataTexture(d, N, N, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.colorSpace = NoColorSpace; t.needsUpdate = true;
  return t;
}

// 在 three 标准 PBR 材质上注入自己的着色逻辑（保留其阴影、IBL、灯光计算）
function pbr(ground) {
  const m = new MeshStandardMaterial({ vertexColors: !ground, roughness: 1, metalness: 0 });
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + (ground ? 'varying vec3 vWp;' : S.V_PARS))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (ground ? '' : S.V_BEGIN))
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + (ground ? 'vWp=(modelMatrix*vec4(transformed,1.)).xyz;' : S.V_END));
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + S.PARS + (ground ? S.F_GROUND_PARS : 'varying vec4 vM,vT;'))
      .replace('#include <color_fragment>', ground ? S.F_GROUND : S.F_OBJ)
      .replace('#include <roughnessmap_fragment>', S.F_ROUGH)
      .replace('#include <metalnessmap_fragment>', S.F_METAL)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + (ground ? S.F_BUMP : ''))
      .replace('#include <emissivemap_fragment>', S.F_EMIS)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + S.F_LAMP)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + S.F_OUT);
  };
  m.customProgramCacheKey = () => (ground ? 'dbG' : 'dbO');
  return m;
}
const sm = (vs, fs, uniforms, o) => new ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, ...o });
const addBlend = { transparent: true, depthWrite: false, premultipliedAlpha: true, side: DoubleSide };

// ---------- 后处理资源 ----------
let rtScene, rtH1, rtH2, rtMB, rtLum, rtAd = [], rtLDR, bloom = [], adI = 0, frame = 0, dirty = 1;
const P = {}, fsTri = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)));
fsTri.frustumCulled = false;
const pcam = new Camera();
const pm = (fs, names, o) => { const u = {}; for (const n of names.split(' ')) u[n] = { value: null }; return sm(S.VS_Q, fs, u, { depthTest: false, depthWrite: false, ...o }); };
function pass(m, target) { fsTri.material = m; renderer.setRenderTarget(target); renderer.render(fsTri, pcam); }
// 不支持浮点颜色缓冲的老设备退回 8 位渲染目标（HDR 泛光会变弱，但能正常显示）
let FT = HalfFloatType;
const rt = (w, h, o) => new WebGLRenderTarget(w, h, { type: FT, depthBuffer: false, ...o });

export function initGfx(canvas, q) {
  cv = canvas;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch (e) { return 0; }
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) FT = UnsignedByteType;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap; renderer.toneMapping = NoToneMapping;
  renderer.autoClear = false; renderer.info.autoReset = false;
  scene = new Scene();
  camera = new PerspectiveCamera(60, 1, 0.15, 1200);
  U.tNoise.value = noiseTex();
  matObj = pbr(0); matGround = pbr(1);
  matShell = sm(S.VS_SHL, S.FS_SHL, { uTime: U.uTime }, { ...addBlend, vertexColors: true });
  matSign = sm(S.VS_SG, S.FS_SG, { tMap: { value: null }, uK: { value: 1 }, uFogK: U.uFogK, uHor: U.uHor }, { side: DoubleSide });
  // 天空（主场景一份，环境贴图采集场景一份）
  const skyU = e => ({ ...U, ...USky, uEnv: { value: e } }), sg = new SphereGeometry(1, 32, 16);
  sky = new Mesh(sg, sm(S.VS_SKY, S.FS_SKY, skyU(0), { side: BackSide, depthWrite: false }));
  sky.frustumCulled = false; sky.renderOrder = 5; scene.add(sky);
  envScene = new Scene(); envSkyU = skyU(1);
  const es = new Mesh(sg, sm(S.VS_SKY, S.FS_SKY, envSkyU, { side: BackSide, depthWrite: false })); es.frustumCulled = false; envScene.add(es);
  pmrem = new PMREMGenerator(renderer);
  // 灯光
  sun = new DirectionalLight(0xffffff, 1); sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = sc.bottom = -SHR; sc.right = sc.top = SHR; sc.near = 20; sc.far = 240;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.2;
  hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(sun, sun.target, hemi);
  for (let i = 0; i < 6; i++) { const l = new PointLight(0xffffff, 0, 10, 2); pool.push(l); scene.add(l); }
  // 粒子与光束
  const inst = (buf, vs, fs, quad, names) => {
    const g = new InstancedBufferGeometry(), ib = new InstancedInterleavedBuffer(buf, 12, 1);
    g.setAttribute('position', new Float32BufferAttribute(quad, 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    ib.setUsage(DynamicDrawUsage);
    names.forEach((n, i) => g.setAttribute(n, new InterleavedBufferAttribute(ib, 4, i * 4)));
    const m = new Mesh(g, sm(vs, fs, {}, addBlend)); m.frustumCulled = false; m.renderOrder = 20; scene.add(m);
    g.instanceCount = 0;
    return [g, ib];
  };
  [pGeo, pIB] = inst(pbuf, S.VS_P, S.FS_P, [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], ['iP', 'iC', 'iR']);
  [tGeo, tIB] = inst(tbuf, S.VS_TR, S.FS_TR, [0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], ['iA', 'iB', 'iC']);
  // 后处理材质
  P.aov = pm(S.FS_AOV, 'tDepth uNF uTan uRadius uSteps uFrame uIV uShM uCam uSunD tSh uVolOn');
  P.blur = pm(S.FS_BLUR, 'tDepth uNF uTan tSrc uDir');
  P.mb = pm(S.FS_MB, 'tColor tDepth uIVP uPVP uShutter uNearZ uNF');
  P.dn = pm(S.FS_DN, 'tSrc uPx uThr'); P.up = pm(S.FS_UP, 'tSrc uPx', { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor, transparent: true });
  P.lum = pm(S.FS_LUM, 'tSrc'); P.ad = pm(S.FS_ADAPT, 'tSrc tPrev uK');
  P.comp = pm(S.FS_C, 'tScene tBloom tAOV tAdapt tDepth uFx uFx2 uSunCol uSunUv uTime uAspect uAoOn');
  P.fxaa = pm(S.FS_FXAA, 'tSrc uPx');
  for (const k in P) for (const n in P[k].uniforms) {
    const u = P[k].uniforms[n];
    if (/^u(NF|Tan|Px|Dir)$/.test(n)) u.value = new Vector2(); else if (/^u(IV|ShM|IVP|PVP)$/.test(n)) u.value = new Matrix4();
    else if (/^u(Cam|SunD|SunCol|SunUv)$/.test(n)) u.value = V3(); else if (/^uFx/.test(n)) u.value = [0, 0, 0, 0]; else if (n[0] == 'u') u.value = 0;
  }
  rtLum = rt(64, 64, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  rtAd = [rt(1, 1), rt(1, 1)];
  setQuality(q);
  return 1;
}
export function setQuality(n) {
  if (!TIERS[n]) n = 'high';
  Q = TIERS[n]; qName = n; dirty = 1; envT = -99;
  if (sun) { sun.shadow.mapSize.set(Q.sh, Q.sh); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
}

// ---------- 网格 ----------
function geom(g) {
  const b = new BufferGeometry(), ib = new InterleavedBuffer(new Uint8Array(g.c), 8);
  b.setAttribute('position', new Float32BufferAttribute(g.p, 3)); b.setAttribute('normal', new Float32BufferAttribute(g.n, 3));
  b.setAttribute('color', new InterleavedBufferAttribute(ib, 4, 0, true)); b.setAttribute('aM', new InterleavedBufferAttribute(ib, 4, 4, true));
  b.setIndex(g.i);
  return b;
}
// 可实例化的动态网格。mode: 0 不透明 PBR；1 加色能量壳
export function mesh(g, mode = 0, cap = 16) {
  const b = geom(g), m = { b, mode, n: 0, cap: 0, im: null, it: null };
  grow(m, cap);
  meshes.push(m);
  return m;
}
function grow(m, cap) {
  const old = m.im, im = new InstancedMesh(m.b, m.mode ? matShell : matObj, cap), it = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  if (old) { im.instanceMatrix.array.set(old.instanceMatrix.array); it.array.set(m.it.array); scene.remove(old); old.dispose(); }
  im.instanceMatrix.setUsage(DynamicDrawUsage); it.setUsage(DynamicDrawUsage);
  m.b.setAttribute('iT', it);
  im.frustumCulled = false; im.castShadow = im.receiveShadow = !m.mode; im.count = 0; im.visible = false;
  if (m.mode) im.renderOrder = 15;
  scene.add(im);
  m.im = im; m.it = it; m.cap = cap;
}
// 提交一个实例：t 为 4x4 模型矩阵，rgb 为颜色乘子，a>0 受击闪白 / a<0 溶解进度（能量壳里 a 为亮度）
export function draw(m, t, r = 1, g = 1, b = 1, a = 0) {
  if (m.n == m.cap) grow(m, m.cap * 2);
  m.im.instanceMatrix.array.set(t, m.n * 16);
  const d = m.it.array, o = m.n++ * 4;
  d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
}
// 静态世界网格（顶点已在世界坐标，参与视锥剔除）
export function staticMesh(g) {
  const b = geom(g), m = new Mesh(b, matObj);
  b.computeBoundingSphere(); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false;
  scene.add(m);
  return m;
}
export function groundMesh(p, n, i) {
  const b = new BufferGeometry();
  b.setAttribute('position', new Float32BufferAttribute(p, 3)); b.setAttribute('normal', new Float32BufferAttribute(n, 3)); b.setIndex(i);
  const m = new Mesh(b, matGround); m.receiveShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false;
  scene.add(m);
  return m;
}
// 招牌：rect 为图集中的像素矩形 [x,y,w,h]，S 为图集边长
export function setSignAtlas(canvas) {
  const t = new CanvasTexture(canvas); t.colorSpace = NoColorSpace; t.anisotropy = 4;
  matSign.uniforms.tMap.value = t;
}
export function signMesh(quads, S_) {
  // quads: [{m: 4x4 矩阵, r:[x,y,w,h]}]，合并成一个网格；返回的 Mesh 可整体再变换（动态招牌）
  const p = [], uv = [], idx = [], o = [0, 0, 0];
  quads.forEach((q, k) => {
    const [x, y, w, h] = q.r, m = q.m;
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      o[0] = m[0] * a + m[4] * b + m[12]; o[1] = m[1] * a + m[5] * b + m[13]; o[2] = m[2] * a + m[6] * b + m[14];
      p.push(...o); uv.push((x + (a + 0.5) * w) / S_, 1 - (y + (0.5 - b) * h) / S_);
    }
    idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3);
  });
  const b = new BufferGeometry();
  b.setAttribute('position', new Float32BufferAttribute(p, 3)); b.setAttribute('uv', new Float32BufferAttribute(uv, 2)); b.setIndex(idx);
  const m = new Mesh(b, matSign); m.frustumCulled = false; m.matrixAutoUpdate = false;
  scene.add(m);
  return m;
}

// ---------- 相机 ----------
export function setCam(ex, ey, ez, tx, ty, tz, fov) {
  const v = view;
  v.pvp.set(v.vp);
  camera.position.set(ex, ey, ez); camera.lookAt(tx, ty, tz);
  camera.fov = (fov * 180) / PI; camera.aspect = v.W / v.H; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const e = camera.matrixWorldInverse.elements;
  mul(v.vp, camera.projectionMatrix.elements, e); invert(v.ivp, v.vp);
  v.cam[0] = ex; v.cam[1] = ey; v.cam[2] = ez; v.fov = fov;
  v.r[0] = e[0]; v.r[1] = e[4]; v.r[2] = e[8];
  v.u[0] = e[1]; v.u[1] = e[5]; v.u[2] = e[9];
  v.f[0] = -e[2]; v.f[1] = -e[6]; v.f[2] = -e[10];
}
// 世界坐标投影到屏幕（CSS 像素），返回是否在相机前方
export function project(x, y, z, o) {
  const m = view.vp, w = m[3] * x + m[7] * y + m[11] * z + m[15];
  o[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * cv.clientWidth;
  o[1] = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * cv.clientHeight;
  return w > 0.1;
}

export const markDirty = () => (dirty = 1);
function resize() {
  const pr = min(window.devicePixelRatio || 1, Q.dpr) * Q.scale;
  const w = max((cv.clientWidth * pr) | 0, 8), h = max((cv.clientHeight * pr) | 0, 8);
  if (w == view.W && h == view.H && !dirty) return;
  dirty = 0; view.W = w; view.H = h;
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  for (const o of [rtScene, rtH1, rtH2, rtMB, rtLDR, ...bloom]) o && o.dispose();
  rtScene && rtScene.depthTexture && rtScene.depthTexture.dispose();
  rtScene = new WebGLRenderTarget(w, h, { type: FT, samples: Q.ms, depthTexture: new DepthTexture(w, h) });
  const hw = max(w >> 1, 4), hh = max(h >> 1, 4);
  rtH1 = rt(hw, hh); rtH2 = rt(hw, hh); rtMB = Q.mb ? rt(w, h) : null;
  rtLDR = new WebGLRenderTarget(w, h, { depthBuffer: false });
  bloom = [];
  let bw = w, bh = h;
  for (let i = 0; i < 5; i++) { bw = max(bw >> 1, 2); bh = max(bh >> 1, 2); bloom.push(rt(bw, bh)); }
}

function setLight(L, x, y, z) {
  // 阴影相机跟随焦点，并按纹素对齐避免阴影游泳
  let rx = L[2], rz = -L[0], l = hypot(rx, rz) || 1; rx /= l; rz /= l;
  const ux = L[1] * rz, uy = L[2] * rx - L[0] * rz, uz = -L[1] * rx, tx = (2 * SHR) / Q.sh;
  const a = x * rx + z * rz, b = x * ux + y * uy + z * uz, da = round(a / tx) * tx - a, db = round(b / tx) * tx - b;
  x += rx * da + ux * db; y += uy * db; z += rz * da + uz * db;
  sun.position.set(x + L[0] * 120, y + L[1] * 120, z + L[2] * 120); sun.target.position.set(x, y, z); sun.target.updateMatrixWorld();
}

export const stats = { calls: 0, tris: 0 };
// env: 环境光照参数；t: 时间；dt: 帧间隔；(fx_,fy,fz): 阴影焦点
export function render(env, t, dt, fx_, fy, fz) {
  resize();
  frame++;
  const W = view.W, H = view.H;
  U.uTime.value = t; U.uNight.value = env.night; U.uFogK.value = env.fog;
  U.uHor.value.fromArray(env.hor); U.uGlow.value.fromArray(env.glow); U.uSunD.value.fromArray(env.sun);
  USky.uZen.value.fromArray(env.zen); USky.uMoonD.value.fromArray(env.moon); USky.uCl.value.fromArray(env.cl); USky.uSunK.value.fromArray(env.sunK);
  matSign.uniforms.uK.value = 1.2 + env.night * 0.5;
  sun.color.setRGB(env.LC[0], env.LC[1], env.LC[2]); hemi.color.setRGB(env.as[0], env.as[1], env.as[2]); hemi.groundColor.setRGB(env.ag[0], env.ag[1], env.ag[2]);
  setLight(env.L, fx_, fy, fz);
  scene.environmentIntensity = env.envI;
  if (t - envT > (Q.env > 64 ? 2.5 : 6) || t < envT) {
    // 天空变化时重新卷积环境贴图，PBR 反射随昼夜更新
    envT = t;
    const r = pmrem.fromScene(envScene, 0, 1, 100, { size: Q.env });
    envRT && envRT.dispose(); envRT = r; scene.environment = r.texture;
  }
  // 点光源：按对相机的重要度挑 6 盏
  const c = view.cam;
  for (const l of lights) l[7] = (l[3] * l[3] * (l[4] + l[5] + l[6])) / (4 + (l[0] - c[0]) ** 2 + (l[1] - c[1]) ** 2 + (l[2] - c[2]) ** 2);
  lights.sort((a, b) => b[7] - a[7]);
  pool.forEach((p, i) => {
    const l = lights[i];
    if (l) { p.position.set(l[0], l[1], l[2]); p.distance = l[3]; p.color.setRGB(l[4], l[5], l[6]); p.intensity = l[3] * l[3] * 0.07; } else p.intensity = 0;
  });
  lights.length = 0;
  for (const m of meshes) {
    const im = m.im;
    im.count = m.n; im.visible = m.n > 0;
    if (m.n) { im.instanceMatrix.needsUpdate = true; m.it.needsUpdate = true; }
    m.n = 0;
  }
  pGeo.instanceCount = cnt.p; pIB.clearUpdateRanges(); pIB.addUpdateRange(0, cnt.p * 12); pIB.needsUpdate = true;
  tGeo.instanceCount = cnt.t; tIB.clearUpdateRanges(); tIB.addUpdateRange(0, cnt.t * 12); tIB.needsUpdate = true;
  cnt.p = cnt.t = 0;
  sky.position.set(c[0], c[1], c[2]); sky.updateMatrixWorld();
  renderer.info.reset();
  // ---- 场景 ----
  renderer.setRenderTarget(rtScene); renderer.clear();
  renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
  // ---- 后处理 ----
  const depth = rtScene.depthTexture, tanH = Math.tan(view.fov / 2), nf = [camera.near, camera.far];
  let src = rtScene.texture;
  const ao = Q.ao && sun.shadow.map;
  if (ao) {
    let u = P.aov.uniforms;
    u.tDepth.value = depth; u.uNF.value.fromArray(nf); u.uTan.value.set(tanH * W / H, tanH); u.uRadius.value = 0.9; u.uSteps.value = Q.vol || 1; u.uVolOn.value = Q.vol ? 1 : 0; u.uFrame.value = frame % 16;
    u.uIV.value.copy(camera.matrixWorld); u.uShM.value.copy(sun.shadow.matrix); u.uCam.value.fromArray(c); u.uSunD.value.fromArray(env.L);
    u.tSh.value = sun.shadow.map.depthTexture;
    pass(P.aov, rtH1);
    u = P.blur.uniforms; u.tDepth.value = depth; u.uNF.value.fromArray(nf); u.uTan.value.set(tanH * W / H, tanH);
    u.tSrc.value = rtH1.texture; u.uDir.value.set(1.6 / rtH1.width, 0); pass(P.blur, rtH2);
    u.tSrc.value = rtH2.texture; u.uDir.value.set(0, 1.6 / rtH1.height); pass(P.blur, rtH1);
  }
  if (rtMB && dt > 0) {
    const u = P.mb.uniforms;
    u.tColor.value = src; u.tDepth.value = depth; u.uIVP.value.fromArray(view.ivp); u.uPVP.value.fromArray(view.pvp);
    u.uShutter.value = min(0.5 * (1 / 60) / dt, 1.5); u.uNearZ.value = fx.mbNear; u.uNF.value.fromArray(nf);
    pass(P.mb, rtMB); src = rtMB.texture;
  }
  let u = P.dn.uniforms;
  for (let i = 0; i < bloom.length; i++) {
    const b = bloom[i], s = i ? bloom[i - 1] : null;
    u.tSrc.value = s ? s.texture : src; u.uPx.value.set(1 / (s ? s.width : W), 1 / (s ? s.height : H)); u.uThr.value = i ? 0 : 1.1;
    pass(P.dn, b);
  }
  u = P.up.uniforms;
  for (let i = bloom.length - 1; i > 0; i--) { u.tSrc.value = bloom[i].texture; u.uPx.value.set(0.5 / bloom[i].width, 0.5 / bloom[i].height); pass(P.up, bloom[i - 1]); }
  // 自动曝光
  P.lum.uniforms.tSrc.value = src; pass(P.lum, rtLum);
  u = P.ad.uniforms; u.tSrc.value = rtLum.texture; u.tPrev.value = rtAd[adI].texture; u.uK.value = frame < 3 ? 1 : 1 - Math.exp(-dt * 1.6);
  adI ^= 1; pass(P.ad, rtAd[adI]);
  // 合成
  u = P.comp.uniforms;
  u.tScene.value = src; u.tBloom.value = bloom[0].texture; u.tAOV.value = rtH1.texture; u.tAdapt.value = rtAd[adI].texture; u.tDepth.value = depth;
  u.uAoOn.value = ao ? 1 : 0; u.uTime.value = t; u.uAspect.value = W / H;
  u.uFx.value = [fx.dmg, fx.bt, fx.spd, fx.exp * env.exp]; u.uFx2.value = [fx.bloom, fx.fade, fx.flare, fx.key * (1 - 0.42 * env.night)];
  u.uSunCol.value.fromArray(env.LC).multiplyScalar(0.33);
  const sd = env.day > 0.02 ? env.sun : env.moon, m = view.vp, x = c[0] + sd[0] * 500, y = c[1] + sd[1] * 500, z = c[2] + sd[2] * 500;
  const sw = m[3] * x + m[7] * y + m[11] * z + m[15], sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / sw * 0.5 + 0.5, sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / sw * 0.5 + 0.5;
  u.uSunUv.value.set(sx, sy, sw > 0 && sx > 0.01 && sx < 0.99 && sy > 0.01 && sy < 0.99 ? (env.day > 0.02 ? 1 : 0.25) : 0);
  if (Q.fxaa) {
    pass(P.comp, rtLDR);
    P.fxaa.uniforms.tSrc.value = rtLDR.texture; P.fxaa.uniforms.uPx.value.set(1 / W, 1 / H); pass(P.fxaa, null);
  } else pass(P.comp, null);
}
// 不渲染只推进模拟时（快进测试）清空本帧已提交的实例
export function resetDraws() { for (const m of meshes) m.n = 0; cnt.p = cnt.t = 0; lights.length = 0; }
export const glInfo = () => { const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; };
