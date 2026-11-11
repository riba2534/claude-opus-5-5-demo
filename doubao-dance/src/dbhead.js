// 豆包的头：贴图取自官方应用图标（由 tools/make_head.py 抠图生成），
// 运行时按轮廓把它"吹"成一个有厚度的浮雕头，正面是官方的脸，背面是头发。
import * as THREE from 'three';
import headUrl from './assets/doubao-head.webp';
import avatarUrl from './assets/doubao-avatar.webp';
import eyeLClosed from './assets/eye-l-closed.webp';
import eyeLHappy from './assets/eye-l-happy.webp';
import eyeRClosed from './assets/eye-r-closed.webp';
import eyeRHappy from './assets/eye-r-happy.webp';
import meta from './assets/head.json';

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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('头部贴图解码失败'));
    im.src = url;
  });
}

// 两遍扫描的近似欧氏距离变换：返回 mask 内每个像素到 mask 外的距离。
// open 为 true 时图像边界不算"外"。
function distanceField(mask, w, h, open = false) {
  const INF = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const A = 1;
  const B = Math.SQRT2;
  const edge = open ? INF : A;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x > 0 ? d[i - 1] + A : edge);
      if (y > 0) {
        v = Math.min(v, d[i - w] + A);
        if (x > 0) v = Math.min(v, d[i - w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
      } else v = Math.min(v, edge);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x < w - 1 ? d[i + 1] + A : edge);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + A);
        if (x > 0) v = Math.min(v, d[i + w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
      } else v = Math.min(v, edge);
      d[i] = v;
    }
  }
  return d;
}

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const HEAD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
// 贴图以预乘 alpha 上传、不做 sRGB 自动解码：先除回 alpha 再手动转线性，边缘才不会出现暗边
const HEAD_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uTint;
  uniform vec3 uRim;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = smoothstep(0.5, 0.5 + max(fwidth(t.a), 0.0001), t.a);
    if (a <= 0.0) discard;
    vec3 col = toLinear(clamp(t.rgb / max(t.a, 0.001), 0.0, 1.0)) * uTint;
    float rim = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.6);
    col += uRim * rim;
    gl_FragColor = vec4(col, a);
  }`;

let shared = null;

// 解码图片、处理贴图、生成浮雕几何体。只做一次，结果共享。
export async function loadDoubaoHead() {
  if (shared) return shared;
  const [base, ...patchImgs] = await Promise.all([loadImage(headUrl), ...Object.values(PATCH).map(loadImage)]);
  const patches = {};
  Object.keys(PATCH).forEach((k, i) => (patches[k] = patchImgs[i]));
  const [W, H] = meta.size;
  const chinY = meta.chin[1] * H;
  const neckX = meta.neck[0] * W;

  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const toTexture = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.NoColorSpace;
    t.premultiplyAlpha = true;
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };

  // ------------------------------------------------------------ 1. 轮廓的有符号距离场（1/2 分辨率）
  const STEP = 2;
  const fw = Math.ceil(W / STEP);
  const fh = Math.ceil(H / STEP);
  const probe = document.createElement('canvas');
  probe.width = fw;
  probe.height = fh;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  pc.drawImage(base, 0, 0, fw, fh);
  const q = pc.getImageData(0, 0, fw, fh).data;
  const inside = new Uint8Array(fw * fh);
  const outside = new Uint8Array(fw * fh);
  const notHair = new Uint8Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) {
    inside[i] = q[i * 4 + 3] > 127 ? 1 : 0;
    outside[i] = 1 - inside[i];
    const lum = q[i * 4] * 0.299 + q[i * 4 + 1] * 0.587 + q[i * 4 + 2] * 0.114;
    notHair[i] = inside[i] && lum < 120 ? 0 : 1;
  }
  const dIn = distanceField(inside, fw, fh);
  const dOut = distanceField(outside, fw, fh, true);
  const sdf = new Float32Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) sdf[i] = inside[i] ? dIn[i] - 0.5 : 0.5 - dOut[i];
  const dHair = distanceField(notHair, fw, fh, true); // 非头发像素到最近头发像素的距离
  const bilinear = (field, pxX, pxY) => {
    const fx = Math.min(fw - 1.001, Math.max(0, pxX / STEP - 0.5));
    const fy = Math.min(fh - 1.001, Math.max(0, pxY / STEP - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * fw + x0;
    return ((field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty) + (field[i + fw] * (1 - tx) + field[i + fw + 1] * tx) * ty) * STEP;
  };
  // 到轮廓的距离（像素）：轮廓内为正，轮廓外为负
  const sdAt = (pxX, pxY) => bilinear(sdf, pxX, pxY);

  // ------------------------------------------------------------ 2. 从官方图里按行采样发色
  const full = makeCanvas();
  const fc = full.getContext('2d', { willReadFrequently: true });
  fc.drawImage(base, 0, 0);
  const src = fc.getImageData(0, 0, W, H);
  const S8 = src.data;
  const lumOf = (i) => S8[i] * 0.299 + S8[i + 1] * 0.587 + S8[i + 2] * 0.114;
  const ramp = new Float32Array(H * 3);
  const has = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (S8[i + 3] < 255 || lumOf(i) > 100) continue;
      if (sdAt(x + 0.5, y + 0.5) < 46) continue; // 只采内部的头发，避开边缘的轮廓光
      r += S8[i];
      g += S8[i + 1];
      b += S8[i + 2];
      n++;
    }
    if (n >= 6) {
      ramp[y * 3] = r / n;
      ramp[y * 3 + 1] = g / n;
      ramp[y * 3 + 2] = b / n;
      has[y] = 1;
    }
  }
  // 没采到的行用最近的有效行补上，再做一次上下平滑
  let lastOk = -1;
  for (let y = 0; y < H; y++) {
    if (has[y]) lastOk = y;
    else if (lastOk >= 0) {
      for (let c = 0; c < 3; c++) ramp[y * 3 + c] = ramp[lastOk * 3 + c];
      has[y] = 2;
    }
  }
  lastOk = -1;
  for (let y = H - 1; y >= 0; y--) {
    if (has[y]) lastOk = y;
    else if (lastOk >= 0) for (let c = 0; c < 3; c++) ramp[y * 3 + c] = ramp[lastOk * 3 + c];
  }
  const hair = new Float32Array(H * 3);
  const RAD = 28;
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, y - RAD); k <= Math.min(H - 1, y + RAD); k++) {
        sum += ramp[k * 3 + c];
        n++;
      }
      hair[y * 3 + c] = sum / n;
    }
  }

  // ------------------------------------------------------------ 3. 处理正面与背面贴图
  // 正面：贴近轮廓的一圈头发换成采样到的发色。官方渲染在发丝边缘有一圈浅色轮廓光，
  //       留着它的话，头转到侧面时这圈浅色会被拉伸成一条亮带。脸和内部的头发一个像素都不动。
  // 背面：整片涂成同一套发色，只保留耳朵和脖子。两面在轮廓处颜色相同，接缝就看不出来。
  const isNeck = (x, y) => y > chinY - 4 && Math.abs(x - neckX) < 72;
  const isEar = (x, y) => x > W * 0.925 && y > H * 0.56 && y < H * 0.83;
  const front = fc.createImageData(W, H);
  const backImg = fc.createImageData(W, H);
  const F8 = front.data;
  const B8 = backImg.data;
  for (let y = 0; y < H; y++) {
    const hr = hair[y * 3];
    const hg = hair[y * 3 + 1];
    const hb = hair[y * 3 + 2];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = S8[i + 3];
      F8[i + 3] = B8[i + 3] = a;
      if (a === 0) continue;
      const sd = sdAt(x + 0.5, y + 0.5);
      const keepSkin = isNeck(x, y) || isEar(x, y);
      // 头发的程度：像素本身够暗，或者是紧贴头发的抠图毛边
      let hairness = Math.min(1, Math.max(0, (130 - lumOf(i)) / 30));
      if (sd < 12 && bilinear(dHair, x + 0.5, y + 0.5) < 16) hairness = 1;
      const w = keepSkin ? 0 : (1 - smooth(18, 46, sd)) * hairness;
      F8[i] = S8[i] * (1 - w) + hr * w;
      F8[i + 1] = S8[i + 1] * (1 - w) + hg * w;
      F8[i + 2] = S8[i + 2] * (1 - w) + hb * w;
      if (keepSkin) {
        B8[i] = S8[i];
        B8[i + 1] = S8[i + 1];
        B8[i + 2] = S8[i + 2];
      } else {
        // 后脑勺中间加一道柔和的高光，只在远离轮廓的地方出现
        const hx = (x / W - 0.5) / 0.4;
        const hy = (y / H - 0.3) / 0.2;
        const hl = Math.max(0, 1 - hx * hx - hy * hy) * 18 * smooth(40, 110, sd);
        B8[i] = hr + hl;
        B8[i + 1] = hg + hl * 0.86;
        B8[i + 2] = hb + hl * 0.8;
      }
    }
  }
  const frontBase = makeCanvas();
  frontBase.getContext('2d').putImageData(front, 0, 0);
  const back = makeCanvas();
  back.getContext('2d').putImageData(backImg, 0, 0);
  const backTex = toTexture(back);

  // ------------------------------------------------------------ 4. 表情贴图
  const cache = new Map();
  const textures = {};
  for (const [name, [l, r]] of Object.entries(EXPR)) {
    const key = `${l}|${r}`;
    if (!cache.has(key)) {
      const c = makeCanvas();
      const x = c.getContext('2d');
      x.drawImage(frontBase, 0, 0);
      if (l) x.drawImage(patches[`eye-l-${l}`], ...meta.patches[`eye-l-${l}`]);
      if (r) x.drawImage(patches[`eye-r-${r}`], ...meta.patches[`eye-r-${r}`]);
      cache.set(key, toTexture(c));
    }
    textures[name] = cache.get(key);
  }

  // ------------------------------------------------------------ 5. 浮雕几何体
  // 世界单位 / 像素：头顶到下巴约 0.45
  const S = 0.45 / (chinY - 8);
  const EDGE = 72; // 边缘圆角半径（像素）
  const BULGE = 205; // 头部中央额外鼓起的高度（像素）；两者相加约等于半个头宽，侧面看才是圆的
  // 轮廓内侧这几个像素宽的一圈不鼓起来，正反两片在这里都贴在 z=0 平面上、顶点完全重合。
  // 贴图的 alpha 裁切落在这圈"帽檐"里，所以无论裁在哪儿，侧面都不会露出缝。
  const SEAL = 6;
  const CX = 292;
  const CY = 300;
  const AX = 252;
  const AY = 300;
  const relief = (pxX, pxY) => {
    const sd = sdAt(pxX, pxY) - SEAL;
    if (sd <= 0) return 0;
    const d = Math.min(sd, EDGE);
    const edge = Math.sqrt(d * (2 * EDGE - d));
    const e = 1 - ((pxX - CX) / AX) ** 2 - ((pxY - CY) / AY) ** 2;
    const bulge = e > 0 ? BULGE * Math.sqrt(e) * (d / EDGE) : 0;
    return (edge + bulge) * S;
  };

  const GW = 96;
  const GH = 108;
  const buildSide = (sign, depthK) => {
    const n = (GW + 1) * (GH + 1);
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const cover = new Uint8Array(n);
    for (let j = 0; j <= GH; j++) {
      for (let i = 0; i <= GW; i++) {
        const k = j * (GW + 1) + i;
        const X = (i / GW) * W;
        const Y = (j / GH) * H;
        pos[k * 3] = (X - neckX) * S;
        pos[k * 3 + 1] = (chinY - Y) * S;
        pos[k * 3 + 2] = sign * relief(X, Y) * depthK;
        uv[k * 2] = i / GW;
        uv[k * 2 + 1] = 1 - j / GH;
        cover[k] = sdAt(X, Y) > -8 ? 1 : 0;
      }
    }
    const idx = [];
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const a = j * (GW + 1) + i;
        const b = a + 1;
        const c = a + GW + 1;
        const d = c + 1;
        if (!(cover[a] || cover[b] || cover[c] || cover[d])) continue;
        if (sign > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  shared = {
    textures,
    backTex,
    front: buildSide(1, 0.9),
    back: buildSide(-1, 1.0),
    centerY: (chinY - CY) * S,
  };
  return shared;
}

// 每个实例有自己的材质（表情和灯光各自独立），几何体和贴图共享
export function createDoubaoHead(assets, rimUniform) {
  const group = new THREE.Group();
  const tint = { value: new THREE.Color(1, 1, 1) };
  const rim = { value: new THREE.Color(0, 0, 0) };
  const mat = (map) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uTint: tint, uRim: rim },
      vertexShader: HEAD_VERT,
      fragmentShader: HEAD_FRAG,
      alphaToCoverage: true,
    });
  const frontMat = mat(assets.textures.smile);
  const backMat = mat(assets.backTex);
  group.add(new THREE.Mesh(assets.front, frontMat), new THREE.Mesh(assets.back, backMat));
  group.position.set(0, -0.012, 0.004);
  return {
    group,
    has: (name) => !!assets.textures[name],
    setExpr(name) {
      frontMat.uniforms.map.value = assets.textures[name] || assets.textures.smile;
    },
    setLight(k) {
      tint.value.setScalar(k);
      // 轮廓光跟随舞台，但比身体弱一些，保住官方脸的原色
      rim.value.copy(rimUniform.value).multiplyScalar(0.14);
    },
    centerY: assets.centerY - 0.012,
  };
}
