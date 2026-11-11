// 渲染层：Three.js 底座 + 程序化材质库 + 注入式 PBR 材质 + 自建后处理链
// 场景 → 画中画 → [半分辨率 AO/体积光 → 双边模糊] → 运动模糊 → Bloom → 自动曝光 → 合成(光晕/ACES/调色) → FXAA
import {
  WebGLRenderer, Scene, PerspectiveCamera, Camera, Mesh, InstancedMesh, BufferGeometry, InstancedBufferGeometry, SphereGeometry,
  Float32BufferAttribute, Uint8BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, InstancedInterleavedBuffer, InstancedBufferAttribute,
  MeshStandardMaterial, MeshLambertMaterial, MeshDepthMaterial, ShaderMaterial, DirectionalLight, HemisphereLight, PointLight,
  WebGLRenderTarget, WebGLArrayRenderTarget, DepthTexture, DataTexture, CanvasTexture, Texture, PMREMGenerator, DataUtils, Vector2, Vector3, Vector4, Matrix4,
  HalfFloatType, UnsignedByteType, RGBAFormat, RedFormat, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, DynamicDrawUsage, BackSide, DoubleSide,
  CustomBlending, OneFactor, PCFShadowMap, NoToneMapping, NoColorSpace, SRGBColorSpace, RGBADepthPacking,
} from 'three';
import { m4, mul, invert, hypot, round, min, max, floor, rng, PI } from './math.js';
import * as S from './shaders.js';

export let renderer, scene, camera, cv;
// 画质分档：渲染比例、MSAA、阴影分辨率、AO、体积光步数、运动模糊、环境贴图尺寸、像素比上限、材质贴图尺寸、草丛数量、画中画
export const TIERS = {
  low: { scale: 0.75, ms: 0, sh: 1024, ao: 0, vol: 0, mb: 0, fxaa: 1, env: 64, dpr: 1, tex: 256, grass: 0, pip: 0 },
  medium: { scale: 1, ms: 0, sh: 2048, ao: 1, vol: 10, mb: 0, fxaa: 1, env: 128, dpr: 1, tex: 512, grass: 9000, pip: 1 },
  high: { scale: 1, ms: 4, sh: 2048, ao: 1, vol: 16, mb: 1, fxaa: 1, env: 128, dpr: 1.5, tex: 512, grass: 18000, pip: 1 },
  ultra: { scale: 1, ms: 4, sh: 4096, ao: 1, vol: 28, mb: 1, fxaa: 1, env: 256, dpr: 2, tex: 512, grass: 30000, pip: 1 },
};
export let Q = TIERS.high, qName = 'high';
export const view = { W: 1, H: 1, vp: m4(), ivp: m4(), pvp: m4(), cam: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1], fov: 1 };
export const fx = { dmg: 0, bt: 0, spd: 0, exp: 1, fade: 0, bloom: 0.5, flare: 0.022, key: 0.23, mbNear: 8 };
// 画中画（豆包正面镜头）：on 是否显示；x,y,r 为屏幕上的圆（CSS 像素，y 自顶向下）；cam 为镜头位置与注视点
export const pip = { on: 0, x: 80, y: 80, r: 60, cam: [0, 2, 3, 0, 1, 0] };
const SHR = 46; // 阴影覆盖半径
const NL = 14; // 材质层数

const V3 = () => new Vector3();
// 共享 uniform（所有注入材质引用同一批对象）
const U = {
  uTime: { value: 0 }, uNight: { value: 0 }, uFogK: { value: 0.004 }, tNoise: { value: null }, uHor: { value: V3() }, uGlow: { value: V3() }, uSunD: { value: V3() },
  tMatA: { value: null }, tMatB: { value: null }, uCamP: { value: V3() }, uPlP: { value: V3() }, tHF: { value: null }, uGS: { value: 64 },
};
const USky = { uZen: { value: V3() }, uMoonD: { value: V3() }, uCl: { value: V3() }, uSunK: { value: V3() } };

const meshes = [];
let matObj, matGround, matFac, matShell, matSign, sky, sun, hemi, pmrem, envScene, envRT, envT = -99, grassM, fcam, rtFace, texRes = 0;
const pool = [];
let matRT = [];
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
const sm = (vs, fs, uniforms, o) => new ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, ...o });
const addBlend = { transparent: true, depthWrite: false, premultipliedAlpha: true, side: DoubleSide };
const fsTri = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)));
fsTri.frustumCulled = false;
const pcam = new Camera();
function pass(m, target, layer = 0) { fsTri.material = m; renderer.setRenderTarget(target, layer); renderer.render(fsTri, pcam); }

// 在 GPU 上把程序化材质烘焙进两个纹理数组（反照率+高度 / 粗糙度+AO+金属度）
function bakeMaterials(size) {
  if (texRes == size) return;
  texRes = size;
  const mk = () => new WebGLArrayRenderTarget(size, size, NL, { depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, anisotropy: 8 });
  const a = mk(), b = mk(), m = sm(S.VS_Q, S.FS_BAKE, { uL: { value: 0 }, uPass: { value: 0 } }, { depthTest: false, depthWrite: false });
  for (let l = 0; l < NL; l++) for (let p = 0; p < 2; p++) { m.uniforms.uL.value = l; m.uniforms.uPass.value = p; pass(m, p ? b : a, l); }
  renderer.setRenderTarget(null);
  for (const o of matRT) o.dispose(); // 释放上一档画质烘焙的渲染目标
  matRT = [a, b];
  U.tMatA.value = a.texture; U.tMatB.value = b.texture; m.dispose();
}

// 在 three 标准 PBR 材质上注入自己的着色逻辑（保留其阴影、IBL、灯光计算）。kind: 0 物体 1 地面 2 建筑立面
function pbr(kind) {
  const m = new MeshStandardMaterial({ vertexColors: kind != 1, roughness: 1, metalness: 0 });
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + [S.V_PARS, 'varying vec3 vWp;', S.V_FAC_PARS][kind])
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (kind ? '' : S.V_BEGIN))
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + [S.V_END, 'vWp=(modelMatrix*vec4(transformed,1.)).xyz;', S.V_FAC_END][kind]);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + S.PARS + ['varying vec4 vM,vT,vX;varying vec3 vTp,vTn;', S.F_GROUND_PARS, 'varying vec4 vB;varying vec2 vFu;varying vec3 vTn;'][kind])
      .replace('#include <color_fragment>', [S.F_OBJ, S.F_GROUND, S.F_FAC][kind])
      .replace('#include <roughnessmap_fragment>', S.F_ROUGH)
      .replace('#include <metalnessmap_fragment>', S.F_METAL)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + S.F_NRM)
      .replace('#include <emissivemap_fragment>', S.F_EMIS)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + S.F_LAMP)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + S.F_OUT);
  };
  m.customProgramCacheKey = () => 'db' + kind;
  return m;
}
// 给带贴图的标准材质（枝叶、草、头像）补上雾与共享 uniform
function withFog(m, key, vPars, vBegin, fExtra, o = {}) {
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, U, o.uni);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + vPars);
    if (o.grass) s.vertexShader = s.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal=vec3(0.,1.,0.);').replace('#include <begin_vertex>', vBegin);
    else s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vBegin);
    s.vertexShader = s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + S.F_FOL_PARS + (o.fPars || ''))
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + (o.keepN ? '' : 'normal=normalize(vNormal);'))
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + (o.fMap || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (o.fEm || ''))
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + fExtra)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + S.F_FOG);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// ---------- 后处理资源 ----------
let rtScene, rtH1, rtH2, rtMB, rtLum, rtAd = [], rtLDR, bloom = [], adI = 0, frame = 0, dirty = 1;
const P = {};
const pm = (fs, names, o) => { const u = {}; for (const n of names.split(' ')) u[n] = { value: null }; return sm(S.VS_Q, fs, u, { depthTest: false, depthWrite: false, ...o }); };
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
  fcam = new PerspectiveCamera(30, 1, 0.2, 140);
  U.tNoise.value = noiseTex();
  matObj = pbr(0); matGround = pbr(1); matFac = pbr(2);
  matShell = sm(S.VS_SHL, S.FS_SHL, { uTime: U.uTime }, { ...addBlend, vertexColors: true });
  matSign = sm(S.VS_SG, S.FS_SG, { tMap: { value: null }, uK: { value: 1.25 }, uFogK: U.uFogK, uHor: U.uHor, uNight: U.uNight, uSunD: U.uSunD }, { side: DoubleSide });
  // 天空（主场景一份，环境贴图采集场景一份）
  const skyU = e => ({ ...U, ...USky, uEnv: { value: e } }), sg = new SphereGeometry(1, 32, 16);
  sky = new Mesh(sg, sm(S.VS_SKY, S.FS_SKY, skyU(0), { side: BackSide, depthWrite: false }));
  sky.frustumCulled = false; sky.renderOrder = 5; scene.add(sky);
  envScene = new Scene();
  const es = new Mesh(sg, sm(S.VS_SKY, S.FS_SKY, skyU(1), { side: BackSide, depthWrite: false })); es.frustumCulled = false; envScene.add(es);
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
  P.comp = pm(S.FS_C, 'tScene tBloom tAOV tAdapt tDepth tFace uFx uFx2 uPip uSunCol uSunUv uTime uAspect uAoOn uExMax');
  P.fxaa = pm(S.FS_FXAA, 'tSrc uPx');
  for (const k in P) for (const n in P[k].uniforms) {
    const u = P[k].uniforms[n];
    if (/^u(NF|Tan|Px|Dir)$/.test(n)) u.value = new Vector2(); else if (/^u(IV|ShM|IVP|PVP)$/.test(n)) u.value = new Matrix4();
    else if (/^u(Cam|SunD|SunCol|SunUv)$/.test(n)) u.value = V3(); else if (/^u(Fx|Pip)/.test(n)) u.value = [0, 0, 0, 0]; else if (n[0] == 'u') u.value = 0;
  }
  rtLum = rt(64, 64, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  rtAd = [rt(1, 1), rt(1, 1)];
  rtFace = new WebGLRenderTarget(384, 384, { type: FT });
  // 显卡上下文丢失再恢复后，渲染目标里烘焙好的材质会丢，需要重新烘焙并重建各级缓冲
  canvas.addEventListener('webglcontextrestored', () => { texRes = 0; bakeMaterials(Q.tex); envT = -99; dirty = 1; });
  setQuality(q);
  return 1;
}
export function setQuality(n) {
  if (!TIERS[n]) n = 'high';
  Q = TIERS[n]; qName = n; dirty = 1; envT = -99;
  if (sun) { sun.shadow.mapSize.set(Q.sh, Q.sh); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (renderer) bakeMaterials(Q.tex);
  if (grassM) { grassM.geometry.instanceCount = Q.grass; grassM.visible = Q.grass > 0; }
}

// ---------- 网格 ----------
function geom(g) {
  const b = new BufferGeometry(), ib = new InterleavedBuffer(new Uint8Array(g.c), 12);
  b.setAttribute('position', new Float32BufferAttribute(g.p, 3)); b.setAttribute('normal', new Float32BufferAttribute(g.n, 3));
  b.setAttribute('color', new InterleavedBufferAttribute(ib, 4, 0, true)); b.setAttribute('aM', new InterleavedBufferAttribute(ib, 4, 4, true));
  b.setAttribute('aT', new InterleavedBufferAttribute(ib, 4, 8, true));
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
const plain = (p, n, i, uv) => {
  const b = new BufferGeometry();
  b.setAttribute('position', new Float32BufferAttribute(p, 3)); b.setAttribute('normal', new Float32BufferAttribute(n, 3)); b.setIndex(i);
  if (uv) b.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return b;
};
export function groundMesh(p, n, i) {
  const m = new Mesh(plain(p, n, i), matGround); m.receiveShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false;
  scene.add(m);
  return m;
}
// 建筑立面网格：uv=(沿墙米数, 离地米数)，c 为墙体底色(0..255)，b=(墙宽, 样式, 种子, 材质层)
export function facadeMesh(g) {
  const b = plain(g.p, g.n, g.i, g.uv);
  b.setAttribute('color', new Uint8BufferAttribute(g.c, 3, true)); b.setAttribute('aB', new Float32BufferAttribute(g.b, 4));
  b.computeBoundingSphere();
  const m = new Mesh(b, matFac); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false;
  scene.add(m);
  return m;
}
// 枝叶卡片：透明测试 + 双面 + 逆光透射；阴影通道用带同一张贴图的深度材质
let matFol, depFol;
export function foliageMesh(g, canvas) {
  if (!matFol) {
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
    matFol = withFog(new MeshStandardMaterial({ map: t, alphaTest: 0.42, side: DoubleSide, vertexColors: true, roughness: 0.8, metalness: 0 }), 'dbFol', S.V_FOL_PARS, S.V_FOL_BEGIN, S.F_FOL_LIGHT,
      { fMap: 'diffuseColor.a*=1.+length(vWp-cameraPosition)*.045;' }); // 远处提高不透明度，抵消 mipmap 把细碎叶片平均掉造成的树冠变稀
    depFol = new MeshDepthMaterial({ map: t, alphaTest: 0.42, side: DoubleSide, depthPacking: RGBADepthPacking });
  }
  const b = plain(g.p, g.n, g.i, g.uv);
  b.setAttribute('color', new Float32BufferAttribute(g.c, 3)); b.setAttribute('aSw', new Float32BufferAttribute(g.s, 1));
  b.computeBoundingSphere();
  const m = new Mesh(b, matFol); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.customDepthMaterial = depFol;
  scene.add(m);
  return m;
}
// 草丛：实例数据只是 [0,S)² 内的随机偏移，顶点着色器按相机位置取模循环铺设，并从高度图取地形高度
export function grassField(canvas, hf, N) {
  const R0 = rng(77), max_ = 30000, o = new Float32Array(max_ * 4);
  for (let i = 0; i < max_ * 4; i += 4) { o[i] = R0() * 64; o[i + 1] = R0() * 64; o[i + 2] = R0(); o[i + 3] = R0(); }
  const g = new InstancedBufferGeometry(), p = [], uv = [], idx = [];
  for (let q = 0; q < 2; q++) { // 两片交叉的草叶面片
    const c = Math.cos(q * 1.6), s = Math.sin(q * 1.6), b = q * 4;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) { p.push(x * c * 0.9, y * 0.23, x * s * 0.9); uv.push(x + 0.5, y); }
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.setAttribute('normal', new Float32BufferAttribute(new Array(24).fill(0).map((_, i) => (i % 3 == 1 ? 1 : 0)), 3));
  g.setAttribute('iO', new InstancedBufferAttribute(o, 4));
  const h = new Uint16Array(N * N); for (let i = 0; i < N * N; i++) h[i] = DataUtils.toHalfFloat(hf[i]);
  const ht = new DataTexture(h, N, N, RedFormat, HalfFloatType); ht.magFilter = ht.minFilter = LinearFilter; ht.needsUpdate = true; U.tHF.value = ht;
  const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace;
  const m = withFog(new MeshLambertMaterial({ map: t, alphaTest: 0.4, side: DoubleSide }), 'dbGrass', S.V_GRASS_PARS, S.V_GRASS, '',
    { grass: 1, fPars: 'varying float vGk;', fMap: 'diffuseColor.rgb*=mix(vec3(.72,.95,.5),vec3(1.1,1.12,.66),vGk);diffuseColor.a*=1.+length(vWp-cameraPosition)*.04;' });
  grassM = new Mesh(g, m); grassM.frustumCulled = false; grassM.receiveShadow = true; grassM.matrixAutoUpdate = false;
  g.instanceCount = Q.grass; grassM.visible = Q.grass > 0;
  scene.add(grassM);
}
// 豆包的头：贴图用模型自带的（侧面与后脑），正面沿 +Z 投影官方原图；proj = [u0, v0, du/dx, dv/dy]，ear = [x, y, z, 半径]
export function headMesh(g, faceCv, sideImg, proj, ear) {
  const tf = new CanvasTexture(faceCv); tf.colorSpace = SRGBColorSpace; tf.anisotropy = 8;
  const ts = new Texture(sideImg); ts.colorSpace = SRGBColorSpace; ts.anisotropy = 4; ts.needsUpdate = true;
  const m = withFog(new MeshStandardMaterial({ map: ts, roughness: 0.74, metalness: 0, side: DoubleSide, envMapIntensity: 0.35 }), 'dbHead', 'varying vec3 vWp,vLp,vLn;', 'vLp=position;vLn=normal;', '', {
    keepN: 1, uni: { tFaceO: { value: tf }, uProj: { value: new Vector4(...proj) }, uEar: { value: new Vector4(...ear) } },
    fPars: 'varying vec3 vLp,vLn;uniform sampler2D tFaceO,tNoise;uniform vec4 uProj,uEar;',
    // 模型贴图里烘焙的光影把头发压得很暗：按亮度把暗部提亮到官方头发的色调；多补的耳朵涂成头发色；再叠上官方原图
    fMap: `vec3 sd=diffuseColor.rgb;float sl=dot(sd,vec3(.3,.6,.1)),hk=smoothstep(.2,.08,sl)*smoothstep(.1,.02,sd.r-sd.b);
      float ang=atan(vLp.x,vLp.z+.03),stn=texture2D(tNoise,vec2(ang*1.7,vLp.y*.3)).r;
      vec3 hb=vec3(.1,.052,.04)*(.95+1.1*sl)*(.8+.4*stn)+vec3(.085,.055,.045)*smoothstep(.075,0.,abs(vLp.y-.4+.025*sin(ang*3.)))*(.4+.6*stn);
      sd=mix(sd,hb,max(hk,smoothstep(uEar.w,uEar.w*.55,distance(vLp,uEar.xyz))));
      vec4 of=texture2D(tFaceO,uProj.xy+vLp.xy*uProj.zw);float fw=of.a*smoothstep(-.06,.04,normalize(vLn).z);
      diffuseColor.rgb=mix(sd,of.rgb*vec3(1.04,.99,.96),fw);`,
    // 官方原图自带柔和的光影，所以正面一部分当作自发光，避免被场景光二次压暗
    fEm: 'totalEmissiveRadiance+=diffuseColor.rgb*fw*.44*(1.-.6*uNight);diffuseColor.rgb*=mix(1.,.56,fw);',
  });
  const mh = new Mesh(plain(g.p, g.n, g.i, g.uv), m); mh.castShadow = true; mh.frustumCulled = false; mh.matrixAutoUpdate = false; // 不接收阴影：头发落在脸上的硬阴影会破坏官方原图自带的柔和光影
  scene.add(mh);
  return mh;
}
// 招牌图集
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
// env: 环境光照参数；t: 时间；dt: 帧间隔；(fx_,fy,fz): 阴影焦点（玩家位置）
export function render(env, t, dt, fx_, fy, fz) {
  resize();
  frame++;
  const W = view.W, H = view.H, c = view.cam;
  U.uTime.value = t; U.uNight.value = env.night; U.uFogK.value = env.fog;
  U.uHor.value.fromArray(env.hor); U.uGlow.value.fromArray(env.glow); U.uSunD.value.fromArray(env.sun);
  U.uCamP.value.fromArray(c); U.uPlP.value.set(fx_, fy, fz);
  USky.uZen.value.fromArray(env.zen); USky.uMoonD.value.fromArray(env.moon); USky.uCl.value.fromArray(env.cl); USky.uSunK.value.fromArray(env.sunK);
  sun.color.setRGB(env.LC[0], env.LC[1], env.LC[2]); hemi.color.setRGB(env.as[0], env.as[1], env.as[2]); hemi.groundColor.setRGB(env.ag[0], env.ag[1], env.ag[2]);
  setLight(env.L, fx_, fy, fz);
  scene.environmentIntensity = env.envI;
  if (t - envT > (Q.env > 64 ? 2.5 : 6) || t < envT) {
    // 天空变化时重新卷积环境贴图，PBR 反射随昼夜更新
    envT = t;
    const r = pmrem.fromScene(envScene, 0, 0.1, 100, { size: Q.env });
    envRT && envRT.dispose(); envRT = r; scene.environment = r.texture;
  }
  // 点光源：按对相机的重要度挑 6 盏
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
  renderer.info.reset();
  // ---- 场景 ----
  renderer.setRenderTarget(rtScene); renderer.clear();
  renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
  // ---- 画中画：从正面拍豆包，复用已有阴影贴图 ----
  const pon = pip.on && Q.pip;
  if (pon) {
    const q = pip.cam;
    fcam.position.set(q[0], q[1], q[2]); fcam.lookAt(q[3], q[4], q[5]); fcam.updateMatrixWorld(true);
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rtFace); renderer.clear(); renderer.render(scene, fcam);
    renderer.shadowMap.autoUpdate = true;
  }
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
    u.tSrc.value = s ? s.texture : src; u.uPx.value.set(1 / (s ? s.width : W), 1 / (s ? s.height : H)); u.uThr.value = i ? 0 : 1.25 + env.day * 1.1; // 白天阳光更强，泛光阈值随之抬高，只让真正的高光和灯光溢出
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
  u.tScene.value = src; u.tBloom.value = bloom[0].texture; u.tAOV.value = rtH1.texture; u.tAdapt.value = rtAd[adI].texture; u.tDepth.value = depth; u.tFace.value = rtFace.texture;
  u.uAoOn.value = ao ? 1 : 0; u.uTime.value = t; u.uAspect.value = W / H;
  u.uFx.value = [fx.dmg, fx.bt, fx.spd, fx.exp * env.exp]; u.uFx2.value = [fx.bloom, fx.fade, fx.flare * (1 - 0.65 * env.night), fx.key * (1 - 0.42 * env.night)];
  u.uExMax.value = 2.1 - 0.95 * env.night; // 夜里不让自动曝光把暗场景整体提亮
  const ps = W / cv.clientWidth; u.uPip.value = [pip.x * ps, H - pip.y * ps, pip.r * ps, pon ? 1 : 0];
  u.uSunCol.value.fromArray(env.LC).multiplyScalar(0.14);
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
