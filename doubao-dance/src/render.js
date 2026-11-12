// 渲染器、后处理链与镜头导演。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, damp } from './util.js';

export const QUALITY = {
  high: { name: 'high', dpr: 2, msaa: 4, bloom: true, reflect: true, reflectSize: 768, crowd: 260, particles: 1600 },
  // 手机默认落在这一档：镜面反射要把整个场景多画一遍，对手描边又把角色的绘制次数翻倍，这两样都关掉
  medium: { name: 'medium', dpr: 1.5, msaa: 2, bloom: true, reflect: false, reflectSize: 512, crowd: 160, particles: 1200 },
  low: { name: 'low', dpr: 1, msaa: 0, bloom: true, reflect: false, reflectSize: 256, crowd: 90, particles: 700 },
};

export function pickQuality(pref) {
  if (pref && QUALITY[pref]) return QUALITY[pref];
  let soft = false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    soft = /swiftshader|llvmpipe|software/i.test(name);
  } catch (e) {
    /* ignore */
  }
  if (soft) return QUALITY.low;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  if (mobile) return QUALITY.medium;
  return QUALITY.high;
}

const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uAberr: { value: 0.0015 },
    uVig: { value: 0.5 },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberr, uVig, uFlash;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberr * (0.5 + r2 * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - uVig * smoothstep(0.12, 0.9, r2 * 2.0);
      col += uTint * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// 镜头位：主角站在 (0, 0, 0.9)
const SHOTS = {
  title: { pos: [0.2, 1.1, 4.7], look: [0, 0.87, 0.9], fov: 34 },
  select: { pos: [-0.3, 1.3, 5.7], look: [0, 0.9, 0.5], fov: 36 },
  front: { pos: [0, 1.5, 6.6], look: [0, 0.92, 0.5], fov: 36 },
  frontL: { pos: [-2.8, 1.35, 5.8], look: [0, 0.94, 0.5], fov: 36 },
  frontR: { pos: [2.8, 1.35, 5.8], look: [0, 0.94, 0.5], fov: 36 },
  low: { pos: [1.6, 0.45, 4.9], look: [0, 1.02, 0.7], fov: 42 },
  lowL: { pos: [-1.6, 0.45, 4.9], look: [0, 1.02, 0.7], fov: 42 },
  close: { pos: [0.7, 1.38, 5.2], look: [0, 1.2, 0.9], fov: 32 },
  wide: { pos: [0, 3.4, 11.4], look: [0, 1.38, -1], fov: 40 },
  crane: { pos: [3.9, 4.1, 8.4], look: [0, 0.82, -0.2], fov: 38 },
  craneL: { pos: [-3.9, 4.1, 8.4], look: [0, 0.82, -0.2], fov: 38 },
  results: { pos: [0.95, 1.25, 4.8], look: [0.15, 0.97, 0.9], fov: 34 },
  // 调试用机位
  face: { pos: [0.28, 1.5, 2.0], look: [0, 1.44, 0.9], fov: 30 },
  body: { pos: [0.5, 1.0, 4.5], look: [0, 0.83, 0.9], fov: 30 },
  bodyS: { pos: [3.5, 1.0, 1.6], look: [0, 0.83, 0.9], fov: 30 },
  torso: { pos: [0.35, 1.15, 2.7], look: [0, 1.08, 0.9], fov: 30 },
  hand: { pos: [0.75, 0.82, 1.75], look: [0.16, 0.7, 0.9], fov: 22 },
  feet: { pos: [0.55, 0.3, 1.9], look: [0.02, 0.1, 0.9], fov: 26 },
};
const SEQUENCES = {
  verse: ['front', 'frontL', 'low', 'frontR', 'close', 'lowL'],
  chorus: ['wide', 'front', 'crane', 'low', 'frontL', 'craneL', 'close', 'frontR'],
  build: ['frontL', 'close'],
  break: ['close', 'frontR', 'frontL'],
  intro: ['wide', 'front'],
  finish: ['front', 'close'],
};

export function createRender(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.setClearColor(0x04040c, 1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  camera.position.set(0, 1.4, 6.3);

  let dprCap = quality.dpr;
  let scale = 1; // 动态分辨率系数
  const size = new THREE.Vector2(1, 1);

  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.0);
  bloom.enabled = quality.bloom;
  composer.addPass(bloom);
  const fin = new ShaderPass(FINAL_SHADER);
  composer.addPass(fin);
  composer.addPass(new OutputPass());

  const R = {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    quality,
    width: 1,
    height: 1,
    aspect: 1,
    shiftY: 0,
    shiftX: 0,
    fx: fin.uniforms,
  };

  let shiftYT = 0;
  let shiftXT = 0;
  R.setShift = (x, y) => {
    shiftXT = x;
    shiftYT = y;
  };

  R.resize = () => {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * scale;
    R.width = w;
    R.height = h;
    R.aspect = w / h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(size);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------ 镜头导演
  const pos = new THREE.Vector3(0, 1.4, 6.3);
  const look = new THREE.Vector3(0, 0.8, 0.5);
  const tPos = pos.clone();
  const tLook = look.clone();
  let fov = 36;
  let tFov = 36;
  let punch = 0;
  let shake = 0;
  let time = 0;
  let seqName = null;
  let seqIdx = 0;
  let seqBar = -99;
  let zoom = 0;
  const director = {
    shot: 'title',
    zoomOut: 0,
    set(name, cut = false) {
      const s = SHOTS[name];
      if (!s) return;
      director.shot = name;
      tPos.fromArray(s.pos);
      tLook.fromArray(s.look);
      tFov = s.fov;
      if (cut) {
        pos.copy(tPos);
        look.copy(tLook);
        fov = tFov;
      }
    },
    // 按段落自动切镜头：每两小节换一个机位，副歌用硬切
    sequence(name) {
      if (seqName === name) return;
      seqName = name;
      seqIdx = 0;
      seqBar = -99;
    },
    stopSequence() {
      seqName = null;
    },
    punch(a = 1) {
      punch = Math.max(punch, a);
    },
    shake(a = 1) {
      shake = Math.max(shake, a);
    },
    update(dt, beat) {
      time += dt;
      if (seqName && SEQUENCES[seqName]) {
        const bar = Math.floor(beat / 4);
        if (bar >= seqBar + 2 || seqBar < -50) {
          const list = SEQUENCES[seqName];
          const first = seqBar < -50;
          seqBar = bar - (bar % 2);
          director.set(list[seqIdx % list.length], !first && (seqName === 'chorus' || seqName === 'finish'));
          seqIdx++;
        }
      }
      const k = 1 - Math.exp(-dt * 2.6);
      pos.lerp(tPos, k);
      look.lerp(tLook, k);
      fov = damp(fov, tFov, 2.6, dt);
      punch = Math.max(0, punch - dt * 4);
      shake = Math.max(0, shake - dt * 5);
      // 竖屏时把视角放宽，保证主角完整入镜
      const portrait = clamp((1.15 - R.aspect) / 0.65, 0, 1);
      zoom = damp(zoom, director.zoomOut, 3, dt);
      camera.fov = (fov * (1 + portrait * 0.42) - punch * 2.2) * (1 + zoom * 0.22);
      camera.position.copy(pos);
      camera.position.x += Math.sin(time * 0.31) * 0.16 + (Math.sin(time * 37) + Math.sin(time * 53)) * 0.012 * shake;
      camera.position.y += Math.sin(time * 0.23 + 1) * 0.06 + (Math.sin(time * 41) + Math.sin(time * 59)) * 0.012 * shake;
      camera.position.z += portrait * 0.9;
      camera.lookAt(look);
      // 镜头偏移：游戏中把画面整体上移，给底部的操作区让位
      R.shiftY = damp(R.shiftY, shiftYT, 4, dt);
      R.shiftX = damp(R.shiftX, shiftXT, 4, dt);
      if (Math.abs(R.shiftY) > 0.001 || Math.abs(R.shiftX) > 0.001) {
        camera.setViewOffset(R.width, R.height, -R.shiftX * R.width, R.shiftY * R.height, R.width, R.height);
      } else if (camera.view) {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
    },
  };
  R.director = director;

  // ------------------------------------------------------------ 每帧渲染 + 动态分辨率
  let acc = 0;
  let frames = 0;
  let cool = 2;
  R.stats = { fps: 60, scale: 1, calls: 0, tris: 0 };
  let pendingResize = false;
  R.frame = (dt) => {
    // 改画布尺寸会把画布清空，所以放在这一帧开画之前做，不能在画完之后
    if (pendingResize) {
      pendingResize = false;
      R.resize();
    }
    fin.uniforms.uFlash.value = Math.max(0, fin.uniforms.uFlash.value - dt * 2.5);
    fin.uniforms.uAberr.value = damp(fin.uniforms.uAberr.value, 0.0015, 6, dt);
    renderer.info.reset();
    composer.render(dt);
    R.stats.calls = renderer.info.render.calls;
    R.stats.tris = renderer.info.render.triangles;
    acc += dt;
    frames++;
    if (acc >= 1) {
      const fps = frames / acc;
      R.stats.fps = fps;
      acc = 0;
      frames = 0;
      if (cool > 0) cool--;
      else if (!R.lockScale) {
        if (fps < 45 && scale > 0.55) {
          scale = Math.max(0.55, scale * 0.85);
          cool = 2;
          pendingResize = true;
        } else if (fps > 57 && scale < 1) {
          scale = Math.min(1, scale * 1.08);
          cool = 3;
          pendingResize = true;
        }
      }
      R.stats.scale = scale;
    }
  };
  R.flash = (amount, color) => {
    fin.uniforms.uFlash.value = Math.max(fin.uniforms.uFlash.value, amount);
    if (color) fin.uniforms.uTint.value.copy(color);
    else fin.uniforms.uTint.value.setScalar(1);
  };
  R.aberrate = (a) => {
    fin.uniforms.uAberr.value = Math.max(fin.uniforms.uAberr.value, a);
  };
  R.resize();
  director.set('title', true);
  return R;
}
