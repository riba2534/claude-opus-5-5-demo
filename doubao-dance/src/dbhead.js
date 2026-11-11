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

// 头模在世界里的大小：模型坐标里下巴到头顶约 0.66，这里缩到约 0.45
const SCALE = 0.686;
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
  varying vec3 vNv;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vP = position;
    vNo = normal;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNv = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
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
  uniform vec3 uTint;
  uniform vec3 uRim;
  varying vec3 vP;
  varying vec3 vNo;
  varying vec3 vNv;
  varying vec3 vV;
  varying vec2 vUv;
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  void main() {
    // 官方图沿 -Z 投影：模型的 xy → 图标坐标 → 头部裁剪图的坐标
    vec2 icon = vec2(uAlign.x + uAlign.z * vP.x, uAlign.y - uAlign.w * vP.y);
    vec2 fuv = (icon - uCrop.xy) / uCrop.zw;
    vec4 f = texture2D(uFront, vec2(fuv.x, 1.0 - fuv.y));
    vec3 front = clamp(f.rgb / max(f.a, 0.001), 0.0, 1.0);
    float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
    float nz = normalize(vNo).z;
    // 脸的范围（裁剪图坐标里的一个椭圆），只对朝前的半边头有效
    vec2 fc = (fuv - vec2(0.57, 0.6)) / vec2(0.37, 0.37);
    float face = (1.0 - smoothstep(0.8, 1.0, dot(fc, fc))) * smoothstep(-0.25, 0.0, nz);

    // 侧面和后脑：模型自带的贴图只取它的明暗，颜色用官方图里量到的发色和肤色。
    // 图生 3D 的贴图偏色，头发上还带一大片烘焙进去的高光，直接用会发白。
    vec3 tex = texture2D(uSide, vUv).rgb;
    float lum = dot(tex, vec3(0.299, 0.587, 0.114));
    float skin = smoothstep(0.5, 0.62, tex.r) * smoothstep(0.06, 0.16, tex.r - tex.b);
    // 图生 3D 在她右侧多补了一只耳朵（官方形象那一侧是头发盖着的），那一块按头发处理
    skin *= smoothstep(uEar.w * 0.55, uEar.w, distance(vP, uEar.xyz));
    // 脸上投影不到的小块（鼻孔、鼻底）一律按皮肤算，不然贴图里的暗处会被当成头发，变成脸上的黑点
    skin = max(skin, face);
    vec3 hairCol = uHair * mix(0.8, 1.42, smoothstep(0.08, 0.8, lum));
    vec3 skinCol = uSkin * mix(0.86, 1.0, smoothstep(0.3, 0.8, lum));
    vec3 side = mix(hairCol, skinCol, skin);

    // 脸的范围内，只要面不背对镜头就完全用官方图：眼窝、鼻底这些略微倾斜的面上
    // 不能让模型自己的五官透出来。头发则是越靠近轮廓、面越侧，越多地让位给侧面的着色。
    float wn = mix(smoothstep(0.1, 0.4, nz), smoothstep(-0.1, 0.06, nz), face);
    float w = wn * smoothstep(0.7, 0.99, f.a) * inside;

    vec3 col = toLinear(mix(side, front, w)) * uTint;
    float rim = pow(1.0 - clamp(dot(normalize(vNv), normalize(vV)), 0.0, 1.0), 2.6);
    col += uRim * rim;
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
    },
    chinY,
    neckX,
    hair,
  };
  return shared;
}

// 每个实例有自己的材质（表情和灯光各自独立），几何体和贴图共享
export function createDoubaoHead(assets, rimUniform) {
  const tint = { value: new THREE.Color(1, 1, 1) };
  const rim = { value: new THREE.Color(0, 0, 0) };
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
      uTint: tint,
      uRim: rim,
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
      // 轮廓光跟随舞台，但比身体弱一些，保住官方脸的原色
      rim.value.copy(rimUniform.value).multiplyScalar(0.22);
    },
    // 头的中心相对头部关节的高度，给特效定位用
    centerY: 0.2,
  };
}
