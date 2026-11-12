// 豆包的头：真实的 3D 头模 + 官方原图。
// 几何和侧面、后脑的贴图来自用官方头像做图生 3D 得到的模型（src/assets/head3d.*）；
// 正面再把官方应用图标沿视线方向投影上去，所以从正面看就是官方那张脸，
// 转到侧面和背面也有真实的五官起伏和头发体积。表情靠切换投影用的那张图实现。
import * as THREE from 'three';
import headUrl from './assets/doubao-head.webp';
import avatarUrl from './assets/doubao-avatar.webp';
import eyeLClosed from './assets/eye-l-closed.webp';
import eyeLHappy from './assets/eye-l-happy.webp';
import eyeRClosed from './assets/eye-r-closed.webp';
import eyeRHappy from './assets/eye-r-happy.webp';
import meta from './assets/head.json';
import meshBin from './assets/head3d.bin';
import sideUrl from './assets/head3d.webp';
import mesh3d from './assets/head3d.json';
import { charLight, LIGHT_GLSL } from './body.js';

export const DOUBAO_AVATAR = avatarUrl;
export const DOUBAO_COLORS = meta.colors;

const PATCH = { 'eye-l-closed': eyeLClosed, 'eye-l-happy': eyeLHappy, 'eye-r-closed': eyeRClosed, 'eye-r-happy': eyeRHappy };
// 表情 → 左右眼各用哪个补丁（null 表示保持原图的睁眼）
const EXPR = {
  smile: [null, null],
  wow: [null, null],
  blink: ['closed', 'closed'],
  oops: ['closed', 'closed'],
  happy: ['happy', 'happy'],
  wink: [null, 'happy'],
};

// 头模在世界里的大小：模型坐标里下巴到头顶约 0.66，这里缩到约 0.35。
// 官方全身图里头宽大约是肩宽的四分之三，按这个比例定的
const SCALE = 0.53;
// 脖子中心在模型坐标里的前后位置
const NECK_Z = -0.045;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('头部贴图解码失败'));
    im.src = url;
  });
}

const HEAD_VERT = /* glsl */ `
  varying vec3 vP;
  varying vec3 vNo;
  varying vec3 vNw;
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vP = position;
    vNo = normal;
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vNw = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// 两张贴图都不做 sRGB 自动解码：先在 sRGB 空间里把官方图和模型贴图混好，再统一转线性。
// uFront 以预乘 alpha 上传，采样后要先除回去。
const HEAD_FRAG = /* glsl */ `
  uniform sampler2D uFront;
  uniform sampler2D uSide;
  uniform vec4 uAlign;
  uniform vec4 uCrop;
  uniform vec3 uHair;
  uniform vec3 uSkin;
  uniform vec4 uEar;
  uniform float uNeckY;
  uniform vec3 uTint;
  ${LIGHT_GLSL}
  varying vec3 vP;
  varying vec3 vNo;
  varying vec3 vNw;
  varying vec3 vW;
  varying vec2 vUv;
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  void main() {
    // 官方图沿 -Z 投影：模型的 xy → 图标坐标 → 头部裁剪图的坐标
    vec2 icon = vec2(uAlign.x + uAlign.z * vP.x, uAlign.y - uAlign.w * vP.y);
    vec2 fuv = (icon - uCrop.xy) / uCrop.zw;
    vec2 puv = vec2(fuv.x, 1.0 - fuv.y);
    vec4 f = texture2D(uFront, puv);
    vec3 front = clamp(f.rgb / max(f.a, 0.001), 0.0, 1.0);
    // 同一个位置再取一份模糊的：只要大致的颜色和明暗，不要五官的细节
    vec4 fq = texture2D(uFront, puv, 3.2);
    vec3 fb = clamp(fq.rgb / max(fq.a, 0.001), 0.0, 1.0);
    float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
    float nz = normalize(vNo).z;
    const vec3 LUMA = vec3(0.299, 0.587, 0.114);

    // 这一块表面是头发还是皮肤，有两个来源，各有各的毛病：
    //   模型自带的贴图知道表面本身是什么，但它自己画的五官也是深色，贴图岛边缘还会串色；
    //   官方图知道正面看过去是什么，但侧着的面（比如垂在脸旁的那缕头发的侧壁）会投到别的东西上。
    // 所以朝前的半边以官方图为准、但模型说是头发的地方不算皮肤；背面只有发梢以下的脖子是皮肤。
    vec3 tex = texture2D(uSide, vUv).rgb;
    float lum = dot(tex, LUMA);
    // 「不是头发」要求偏粉：模型贴图里头发上那片烘焙进去的高光是灰白色的，不能算皮肤
    float notHairT = smoothstep(0.32, 0.46, tex.r) * smoothstep(0.03, 0.1, tex.r - tex.b);
    // 只对很侧的面用这条限制：朝前的面以正面看过去像官方图为先，而且模型自己画的眉眼也是深色
    float gate = max(notHairT, smoothstep(0.14, 0.34, nz));
    float skinT = smoothstep(0.5, 0.62, tex.r) * smoothstep(0.06, 0.16, tex.r - tex.b);
    float skinF = smoothstep(0.45, 0.62, dot(fb, LUMA)) * smoothstep(0.6, 0.95, fq.a) * inside;
    float frontish = smoothstep(-0.1, 0.2, nz);
    float skin = mix(skinT * step(vP.y, uNeckY), skinF * gate, frontish);
    // 图生 3D 在她右侧多补了一只耳朵（官方形象那一侧是头发盖着的），那一块按头发处理
    skin *= smoothstep(uEar.w * 0.55, uEar.w, distance(vP, uEar.xyz));
    // 脸的范围（裁剪图坐标里的一个椭圆）：投影不到的小块（鼻孔、鼻底）一律按皮肤算
    vec2 fc = (fuv - vec2(0.57, 0.6)) / vec2(0.37, 0.37);
    float face = (1.0 - smoothstep(0.8, 1.0, dot(fc, fc))) * smoothstep(-0.25, 0.0, nz) * gate;
    skin = max(skin, face);

    // 侧面的颜色：头发用官方图里量到的发色，只借模型贴图的明暗；
    // 皮肤用官方图在这个位置的模糊颜色，脸颊侧面的明暗就和正面接得上
    vec3 hairCol = uHair * mix(0.86, 1.22, smoothstep(0.08, 0.8, lum));
    vec3 skinCol = mix(uSkin * 0.9, fb, 0.75 * skinF * frontish);
    vec3 side = mix(hairCol, skinCol, skin);

    // 官方图的权重：脸的范围内只要面不背对镜头就完全用官方图（眼窝、鼻底这些略微倾斜的面上
    // 不能让模型自己的五官透出来）；其余地方越侧越让位给上面的侧面着色。
    float wn = mix(smoothstep(0.12, 0.45, nz), smoothstep(-0.1, 0.06, nz), face);
    // 模型说这里是头发、官方图在这个位置却是皮肤：这是头发的侧壁，不能把脸投上去
    float clash = (1.0 - gate) * smoothstep(0.45, 0.62, dot(front, LUMA));
    wn *= 1.0 - clash;
    float w = wn * smoothstep(0.7, 0.99, f.a) * inside;

    // 灯光：侧面和后脑完全按舞台灯光算，和身体用的是同一个函数；
    // 正面的官方图自带柔和的明暗，只轻轻跟一点舞台光，保住官方的观感
    float nl = length(vNw);
    vec3 N = nl > 1e-5 ? vNw / nl : vec3(0.0, 1.0, 0.0);
    vec3 V = normalize(cameraPosition - vW);
    float lit;
    vec3 L = softLight(N, skin, 1.0, lit);
    // 头发按舞台光略提亮；侧面的皮肤压暗一点，和官方图里脸颊边缘的明暗接上
    vec3 sideLit = toLinear(side) * L * mix(1.12, 0.9, skin);
    // 头发上一条很淡很宽的高光带（顺着发丝方向的各向异性高光）
    vec3 T = cross(cross(N, vec3(0.0, 1.0, 0.0)), N);
    float tl = length(T);
    T = tl > 1e-4 ? T / tl : vec3(1.0, 0.0, 0.0);
    vec3 H = normalize(uKeyDir + V);
    float th = dot(normalize(T - N * 0.2), H);
    float band = pow(max(1.0 - th * th, 0.0), 14.0) * (1.0 - skin);
    sideLit += (toLinear(uHair) * 1.6 + vec3(0.02)) * band * 0.22 * uKeyCol * 0.3183 * smoothstep(-0.3, 0.5, dot(N, uKeyDir));
    vec3 frontLit = toLinear(front) * mix(vec3(1.0), L * 1.04, 0.28) * uTint;

    vec3 col = mix(sideLit, frontLit, w);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += uRim * fres * 0.9 * (1.0 - w * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }`;

// 解码量化后的网格：[顶点数, 索引数, 包围盒最小值, 包围盒尺寸] + u16 位置 + u16 贴图坐标 + u16 索引
function decodeMesh(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nv = dv.getUint32(0, true);
  const ni = dv.getUint32(4, true);
  if (bytes.byteLength !== 32 + nv * 10 + ni * 2) throw new Error('头模数据长度不对');
  const mn = [0, 1, 2].map((k) => dv.getFloat32(8 + k * 4, true));
  const sz = [0, 1, 2].map((k) => dv.getFloat32(20 + k * 4, true));
  const u16 = (off) => dv.getUint16(off, true);
  const pos = new Float32Array(nv * 3);
  const q = new Uint16Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) {
    q[i] = u16(32 + i * 2);
    pos[i] = mn[i % 3] + (q[i] / 65535) * sz[i % 3];
  }
  const uv = new Float32Array(nv * 2);
  for (let i = 0; i < nv * 2; i++) uv[i] = u16(32 + nv * 6 + i * 2) / 65535;
  const idx = new Uint16Array(ni);
  for (let i = 0; i < ni; i++) idx[i] = u16(32 + nv * 10 + i * 2);

  // 法线：贴图接缝两侧的顶点位置相同，要按位置合并后再求面积加权法线，否则接缝处会有明暗断层
  const acc = new Map();
  const key = (v) => (q[v * 3] * 65536 + q[v * 3 + 1]) * 65536 + q[v * 3 + 2];
  for (let t = 0; t < ni; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) {
      const k = key(v);
      let o = acc.get(k);
      if (!o) acc.set(k, (o = [0, 0, 0]));
      o[0] += n[0];
      o[1] += n[1];
      o[2] += n[2];
    }
  }
  const nrm = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const o = acc.get(key(v)) || [0, 1, 0];
    const l = Math.hypot(o[0], o[1], o[2]) || 1;
    nrm[v * 3] = o[0] / l;
    nrm[v * 3 + 1] = o[1] / l;
    nrm[v * 3 + 2] = o[2] / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

let shared = null;

// 解码图片和网格、合成各表情的投影图。只做一次，结果共享。
export async function loadDoubaoHead() {
  if (shared) return shared;
  const [base, side, ...patchImgs] = await Promise.all([loadImage(headUrl), loadImage(sideUrl), ...Object.values(PATCH).map(loadImage)]);
  const patches = {};
  Object.keys(PATCH).forEach((k, i) => (patches[k] = patchImgs[i]));
  const [W, H] = meta.size;

  // 每种表情一张投影图：官方原图 + 眼部补丁
  const cache = new Map();
  const textures = {};
  for (const [name, [l, r]] of Object.entries(EXPR)) {
    const key = `${l}|${r}`;
    if (!cache.has(key)) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d');
      x.drawImage(base, 0, 0);
      if (l) x.drawImage(patches[`eye-l-${l}`], ...meta.patches[`eye-l-${l}`]);
      if (r) x.drawImage(patches[`eye-r-${r}`], ...meta.patches[`eye-r-${r}`]);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.premultiplyAlpha = true;
      t.anisotropy = 4;
      cache.set(key, t);
    }
    textures[name] = cache.get(key);
  }

  const sideTex = new THREE.Texture(side);
  sideTex.colorSpace = THREE.NoColorSpace;
  sideTex.anisotropy = 4;
  sideTex.needsUpdate = true;

  // 下巴在模型坐标里的高度：从裁剪图里量到的下巴位置，经图标坐标换算回去
  const [CX, CY, SX, SY] = mesh3d.align;
  const chinV = meta.crop[1] + meta.chin[1] * meta.crop[3];
  const chinY = (CY - chinV) / SY;
  const neckX = (meta.crop[0] + meta.neck[0] * meta.crop[2] - CX) / SX;
  const hair = new THREE.Color(meta.colors.hair);

  shared = {
    geometry: decodeMesh(meshBin),
    textures,
    sideTex,
    uniforms: {
      uAlign: new THREE.Vector4(CX, CY, SX, SY),
      uCrop: new THREE.Vector4(...meta.crop),
      // 着色器里是在 sRGB 空间混色的，所以这里传原始的 sRGB 分量
      uHair: new THREE.Vector3(parseInt(meta.colors.hair.slice(1, 3), 16) / 255, parseInt(meta.colors.hair.slice(3, 5), 16) / 255, parseInt(meta.colors.hair.slice(5, 7), 16) / 255),
      uSkin: new THREE.Vector3(parseInt(meta.colors.skin.slice(1, 3), 16) / 255, parseInt(meta.colors.skin.slice(3, 5), 16) / 255, parseInt(meta.colors.skin.slice(5, 7), 16) / 255),
      uEar: new THREE.Vector4(...(mesh3d.ear || [9, 9, 9]), 0.085),
      // 发梢的高度（模型坐标）：背面在它以下才可能是脖子
      uNeckY: chinY - 0.022,
    },
    chinY,
    neckX,
    hair,
  };
  return shared;
}

// 每个实例有自己的材质（表情和灯光各自独立），几何体和贴图共享
export function createDoubaoHead(assets) {
  const tint = { value: new THREE.Color(1, 1, 1) };
  const u = assets.uniforms;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFront: { value: assets.textures.smile },
      uSide: { value: assets.sideTex },
      uAlign: { value: u.uAlign },
      uCrop: { value: u.uCrop },
      uHair: { value: u.uHair },
      uSkin: { value: u.uSkin },
      uEar: { value: u.uEar },
      uNeckY: { value: u.uNeckY },
      uTint: tint,
      ...charLight,
    },
    vertexShader: HEAD_VERT,
    fragmentShader: HEAD_FRAG,
  });
  const mesh = new THREE.Mesh(assets.geometry, mat);
  mesh.scale.setScalar(SCALE);
  // 让下巴落在头部关节的高度上，脖子对准身体的脖子
  mesh.position.set(-assets.neckX * SCALE, -assets.chinY * SCALE - 0.014, -NECK_Z * SCALE);
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group,
    has: (name) => !!assets.textures[name],
    setExpr(name) {
      mat.uniforms.uFront.value = assets.textures[name] || assets.textures.smile;
    },
    setLight(k) {
      tint.value.setScalar(k);
    },
    // 头的中心相对头部关节的高度，给特效定位用
    centerY: 0.165,
  };
}
