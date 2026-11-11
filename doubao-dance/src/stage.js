// 舞台：LED 地板（带镜面反射）、弧形大屏、摇头灯、激光、音箱、观众席、粒子。
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { rimUniform } from './character.js';
import { TAU, clamp, damp, mod, rng } from './util.js';

const STAGE_R = 6.2;
const CENTER_Z = -0.6;

const GLSL_HASH = /* glsl */ `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const FLOOR_SHADER = {
  name: 'LedFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uPulse: { value: 0 },
    uEnergy: { value: 0.5 },
    uChecker: { value: 0 },
    uReflect: { value: 1 },
    uFlash: { value: 0 },
    uCA: { value: new THREE.Color('#ff7eb6') },
    uCB: { value: new THREE.Color('#7aa8ff') },
    uCC: { value: new THREE.Color('#ffd36b') },
    uSpot: { value: new THREE.Vector3(0, 0.9, 1) },
    uCenterZ: { value: CENTER_Z },
    uRadius: { value: STAGE_R },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vW;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uBeat, uPulse, uEnergy, uChecker, uReflect, uFlash, uCenterZ, uRadius;
    uniform vec3 uCA, uCB, uCC, uSpot;
    varying vec4 vUvR;
    varying vec3 vW;
    ${GLSL_HASH}
    void main() {
      vec2 w = vW.xz - vec2(0.0, uCenterZ);
      float rad = length(w);
      vec2 g = w * 1.3;
      vec2 id = floor(g);
      vec2 f = fract(g);
      float border = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      float tile = smoothstep(0.015, 0.06, border);
      float h = hash21(id);
      float tr = length(id + 0.5) / 1.3;
      // 从中心向外扩散的光环，每两拍一圈
      float ring = pow(0.5 + 0.5 * sin(tr * 1.5 - uBeat * 3.14159), 5.0);
      float checker = mod(id.x + id.y + floor(uBeat), 2.0);
      float twinkle = step(0.86, fract(h * 17.0 + floor(uBeat * 2.0) * 0.37));
      float e = min(uEnergy, 1.25);
      float I = 0.06 + ring * 0.4 * e + checker * uChecker * 0.2 + uPulse * 0.1 * e + twinkle * 0.75 * e;
      vec3 col = mix(uCA, uCB, fract(h * 0.9 + tr * 0.11 + uTime * 0.04));
      col = mix(col, uCC, step(0.9, h));
      vec3 led = col * I * tile;
      // 舞台边缘的灯带
      float rim = smoothstep(uRadius - 0.34, uRadius - 0.12, rad);
      led = mix(led, uCC * (1.0 + uPulse * 1.1), rim);
      // 主角脚下的追光
      float d = length(vW.xz - uSpot.xy);
      led += vec3(1.0, 0.96, 0.9) * exp(-d * d / (uSpot.z * uSpot.z)) * 0.3;
      vec3 V = normalize(cameraPosition - vW);
      float fres = 0.06 + 0.36 * pow(1.0 - max(V.y, 0.0), 3.0);
      vec3 refl = min(texture2DProj(tDiffuse, vUvR).rgb, vec3(1.1));
      vec3 outc = led + vec3(0.012, 0.012, 0.03) + refl * fres * uReflect * (1.0 - rim);
      outc += vec3(1.0) * uFlash * 0.12 * tile;
      gl_FragColor = vec4(outc, 1.0);
    }`,
};

const WALL_FRAG = /* glsl */ `
  uniform float uTime, uBeat, uPulse, uEnergy, uLogoMix;
  uniform vec3 uCA, uCB, uCC, uCD;
  uniform sampler2D uSpec, uLogo;
  varying vec2 vUv;
  ${GLSL_HASH}
  void main() {
    vec2 grid = vec2(120.0, 30.0);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid);
    vec2 cuv = (cell + 0.5) / grid;
    float dotMask = smoothstep(0.5, 0.28, length(f - 0.5));
    // 以中心对称的频谱柱
    float band = abs(cuv.x - 0.5) * 2.0;
    float amp = texture2D(uSpec, vec2(band * 0.8 + 0.02, 0.5)).r;
    float barH = amp * 0.7 + 0.03;
    float bar = step(cuv.y, barH);
    float cap = step(abs(cuv.y - barH - 0.03), 0.018);
    vec3 barCol = mix(uCA, uCB, clamp(cuv.y * 1.6, 0.0, 1.0));
    // 背景：放射光束 + 随节拍外扩的圆环
    vec2 p = (cuv - vec2(0.5, 0.42)) * vec2(4.0, 1.0);
    float r = length(p);
    float ang = atan(p.y, p.x);
    float rays = pow(0.5 + 0.5 * sin(ang * 12.0 + uTime * 0.7), 4.0) * smoothstep(1.6, 0.1, r);
    float rings = pow(0.5 + 0.5 * sin(r * 12.0 - uBeat * 3.14159), 8.0) * smoothstep(1.8, 0.0, r);
    float sparkle = step(0.965, hash21(cell + floor(uBeat * 2.0)));
    vec3 col = uCC * rays * 0.35 + uCD * rings * 0.5 * uEnergy + mix(uCA, uCC, hash21(cell)) * sparkle * uEnergy;
    col += barCol * bar * 0.85 + vec3(1.0) * cap * 0.9;
    // 中央的 LOGO / 歌名
    vec2 luv = (vUv - vec2(0.5, 0.66)) * vec2(4.4, 3.0) + 0.5;
    if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
      vec4 lg = texture2D(uLogo, luv);
      col = mix(col, lg.rgb * (1.5 + uPulse * 0.6), lg.a * uLogoMix);
    }
    col *= dotMask * (0.4 + 0.5 * min(uEnergy, 1.25));
    col = min(col, vec3(1.8));
    gl_FragColor = vec4(col, 1.0);
  }`;

const BEAM_VERT = /* glsl */ `
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vV;
  uniform float uLen;
  void main() {
    vAlong = clamp(-position.y / uLen, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInt;
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
    float fade = pow(1.0 - vAlong, 1.5) * smoothstep(0.0, 0.03, vAlong);
    gl_FragColor = vec4(uColor * edge * fade * uInt, 1.0);
  }`;

function makeLogoTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (title, sub) => {
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const g = x.createLinearGradient(160, 0, 864, 0);
    g.addColorStop(0, '#7fb2ff');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#ff9ccb');
    x.fillStyle = g;
    x.shadowColor = 'rgba(160,140,255,0.9)';
    x.shadowBlur = 30;
    let size = 190;
    x.font = `900 ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    while (x.measureText(title).width > 940 && size > 60) {
      size -= 8;
      x.font = `900 ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    }
    x.fillText(title, 512, 150);
    x.shadowBlur = 12;
    x.fillStyle = '#ffffff';
    x.font = '700 58px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    x.fillText(sub, 512, 310);
    tex.needsUpdate = true;
  };
  draw('豆包炫舞', 'DOUBAO  DANCE');
  return { tex, draw };
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createStage(scene, opts = {}) {
  const rand = rng(77);
  const group = new THREE.Group();
  scene.add(group);

  const pal = ['#ff7eb6', '#7aa8ff', '#ffd36b', '#8ef0d0'].map((h) => new THREE.Color(h));
  const cur = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  pal.forEach((c, i) => cur[i].copy(c));
  const tmpC = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);

  const st = {
    group,
    mode: 'lobby',
    energy: 0.5,
    fever: 0,
    flash: 0,
    quality: { reflect: opts.reflect !== false, crowd: opts.crowd || 260 },
    lights: {},
  };

  // ------------------------------------------------------------ 角色灯光
  const hemi = new THREE.HemisphereLight(0xdfe4ff, 0x6a5a9a, 1.3);
  const key = new THREE.DirectionalLight(0xffffff, 1.85);
  key.position.set(2.5, 6, 7);
  const rimA = new THREE.DirectionalLight(0xff7eb6, 1.5);
  rimA.position.set(-6, 3.5, -5);
  const rimB = new THREE.DirectionalLight(0x7aa8ff, 1.5);
  rimB.position.set(6, 3.5, -5);
  scene.add(hemi, key, rimA, rimB);
  st.lights = { hemi, key, rimA, rimB };

  // ------------------------------------------------------------ 背景穹顶
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(70, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uCA: { value: cur[0] }, uCB: { value: cur[1] }, uTime: { value: 0 }, uEnergy: { value: 0.5 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uCA, uCB; uniform float uTime, uEnergy; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 base = mix(vec3(0.035,0.02,0.09), vec3(0.004,0.006,0.03), smoothstep(-0.1, 0.7, h));
          float a = atan(vP.z, vP.x);
          float glow = pow(0.5 + 0.5*sin(a*3.0 + uTime*0.12), 3.0) * smoothstep(0.5, -0.05, h) * smoothstep(-0.4, 0.0, h);
          vec3 col = base + mix(uCA, uCB, 0.5 + 0.5*sin(a*2.0 - uTime*0.07)) * glow * 0.1 * (0.5 + uEnergy);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  group.add(dome);

  // 远处看台上的手机闪光
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU;
      const r = 26 + rand() * 18;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 1.5 + rand() * 13 + (r - 26) * 0.35;
      pos[i * 3 + 2] = Math.sin(a) * r;
      ph[i] = rand() * TAU;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    st.farLights = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: cur[2] } },
        vertexShader: 'attribute float aPhase; uniform float uTime; varying float vA; void main(){ vA = 0.35 + 0.65*pow(0.5+0.5*sin(uTime*1.7 + aPhase), 3.0); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = 90.0 / -mv.z; gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.5) * a * vA * 1.4, 1.0); }',
      }),
    );
    group.add(st.farLights);
  }

  // ------------------------------------------------------------ 地板
  const floorGeo = new THREE.CircleGeometry(STAGE_R, 72);
  let floor;
  if (st.quality.reflect) {
    const sz = opts.reflectSize || 768;
    floor = new Reflector(floorGeo, { shader: FLOOR_SHADER, textureWidth: sz, textureHeight: sz, clipBias: 0.003, multisample: 0 });
  } else {
    const u = THREE.UniformsUtils.clone(FLOOR_SHADER.uniforms);
    u.textureMatrix.value = new THREE.Matrix4();
    u.uReflect.value = 0;
    floor = new THREE.Mesh(floorGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLOOR_SHADER.vertexShader, fragmentShader: FLOOR_SHADER.fragmentShader }));
  }
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, CENTER_Z);
  group.add(floor);
  const FU = floor.material.uniforms;

  // 舞台侧壁与灯带
  const dark = new THREE.MeshStandardMaterial({ color: 0x11111c, roughness: 0.6, metalness: 0.3 });
  const side = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_R, STAGE_R + 0.25, 1.3, 72, 1, true), dark);
  side.position.set(0, -0.65, CENTER_Z);
  group.add(side);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strips = [];
  for (const [y, r] of [
    [-0.02, STAGE_R + 0.02],
    [-0.62, STAGE_R + 0.15],
  ]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 96), stripMat.clone());
    m.rotation.x = Math.PI / 2;
    m.position.set(0, y, CENTER_Z);
    group.add(m);
    strips.push(m);
  }
  // 观众区地面
  const pit = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: 0x05050c }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = -1.3;
  group.add(pit);

  // ------------------------------------------------------------ 弧形大屏
  const specData = new Uint8Array(32 * 4);
  const specTex = new THREE.DataTexture(specData, 32, 1, THREE.RGBAFormat);
  specTex.magFilter = THREE.LinearFilter;
  specTex.minFilter = THREE.LinearFilter;
  specTex.needsUpdate = true;
  const logo = makeLogoTexture();
  const WALL_R = 9.6;
  const wallArc = (150 * Math.PI) / 180;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(WALL_R, WALL_R, 6.4, 64, 1, true, Math.PI - wallArc / 2, wallArc),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uEnergy: { value: 0.5 },
        uLogoMix: { value: 1 },
        uCA: { value: cur[0] },
        uCB: { value: cur[1] },
        uCC: { value: cur[2] },
        uCD: { value: cur[3] },
        uSpec: { value: specTex },
        uLogo: { value: logo.tex },
      },
      // 从圆柱内侧看，u 方向是反的，这里翻回来保证文字不镜像
      vertexShader: 'varying vec2 vUv; void main(){ vUv = vec2(1.0 - uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: WALL_FRAG,
    }),
  );
  wall.position.set(0, 3.3, 1.2);
  group.add(wall);
  const WU = wall.material.uniforms;
  const wallFrame = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R + 0.12, WALL_R + 0.12, 7.0, 64, 1, true, Math.PI - wallArc / 2 - 0.03, wallArc + 0.06), new THREE.MeshBasicMaterial({ color: 0x06060e, side: THREE.BackSide }));
  wallFrame.position.copy(wall.position);
  group.add(wallFrame);

  // ------------------------------------------------------------ 桁架与光束
  const beams = [];
  const beamGeo = new THREE.CylinderGeometry(0.05, 0.8, 9.5, 20, 1, true);
  beamGeo.translate(0, -4.75, 0);
  const makeBeam = (x, y, z, up, phase) => {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, y, z);
    group.add(pivot);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uInt: { value: 0.5 }, uLen: { value: 9.5 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(beamGeo, mat);
    pivot.add(mesh);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.3, 12), dark);
    pivot.add(head);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.16;
    pivot.add(lens);
    if (up) pivot.rotation.x = Math.PI;
    beams.push({ pivot, mat, lens, up, phase, ci: beams.length % 4, x });
  };
  for (let i = 0; i < 6; i++) makeBeam(-5.5 + i * 2.2, 6.6, -3.2, false, i * 0.9);
  for (const sx of [-1, 1]) {
    makeBeam(sx * 6.4, 0.2, -3.6, true, sx * 2);
    makeBeam(sx * 4.9, 0.2, -5.4, true, sx * 3.1);
  }
  const truss = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.22, 0.22), dark);
  truss.position.set(0, 6.85, -3.2);
  group.add(truss);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 8.2, 0.22), dark);
    leg.position.set(sx * 6.75, 2.75, -3.2);
    group.add(leg);
  }

  // 激光扇面
  const lasers = [];
  {
    const g = new THREE.PlaneGeometry(0.05, 16);
    g.translate(0, -8, 0);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const pv = new THREE.Object3D();
      pv.position.set(i < 6 ? -3.2 : 3.2, 6.5, -3.4);
      pv.add(m);
      group.add(pv);
      lasers.push({ pv, m, i });
    }
  }

  // 悬浮霓虹环
  const rings = [];
  [3.0, 4.1, 5.2].forEach((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.position.set(0, 7.3 + i * 0.35, CENTER_Z - 0.6);
    group.add(m);
    rings.push(m);
  });

  // ------------------------------------------------------------ 音箱
  const speakers = [];
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.05, 0.95), dark);
      box.position.set(sx * 7.9, 0.55 + j * 1.08, -1.4);
      box.rotation.y = -sx * 0.35;
      group.add(box);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), new THREE.MeshBasicMaterial({ color: 0x1a1a2a }));
      cone.position.set(0, 0, 0.48);
      box.add(cone);
      const ringM = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.41, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ringM.position.set(0, 0, 0.482);
      box.add(ringM);
      speakers.push({ cone, ring: ringM });
    }
  }

  // ------------------------------------------------------------ 观众
  const N = st.quality.crowd;
  let crowd = null;
  let sticks = null;
  const people = [];
  if (N > 0) {
    const body = new THREE.CapsuleGeometry(0.2, 0.42, 3, 8);
    body.translate(0, 0.55, 0);
    const headG = new THREE.SphereGeometry(0.17, 10, 8);
    headG.translate(0, 1.12, 0);
    const merged = mergeGeos([body, headG]);
    crowd = new THREE.InstancedMesh(merged, new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
    crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.36, 0.035), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
    sticks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < N; i++) {
      // 前场一片 + 舞台两侧各一片
      let x;
      let z;
      const k = rand();
      if (k < 0.62) {
        x = (rand() * 2 - 1) * 12;
        z = 7.6 + rand() * 9;
      } else {
        const s = k < 0.81 ? -1 : 1;
        x = s * (8.6 + rand() * 6);
        z = -3 + rand() * 10;
      }
      const p = { x, z, y: -1.3 + (z > 7 ? (z - 7.6) * 0.05 : 0), ph: rand() * TAU, amp: 0.6 + rand() * 0.6, stick: rand() < 0.62, ci: Math.floor(rand() * 4), s: 0.85 + rand() * 0.3, ry: Math.atan2(-x, -(z - CENTER_Z)) };
      people.push(p);
      tmpC.setHSL(0.66 + rand() * 0.1, 0.35, 0.03 + rand() * 0.035);
      crowd.setColorAt(i, tmpC);
      sticks.setColorAt(i, WHITE);
    }
    crowd.frustumCulled = false;
    sticks.frustumCulled = false;
    group.add(crowd, sticks);
  }

  // ------------------------------------------------------------ 粒子
  const PN = opts.particles || 1600;
  const pPos = new Float32Array(PN * 3);
  const pCol = new Float32Array(PN * 3);
  const pSize = new Float32Array(PN);
  const pVel = new Float32Array(PN * 3);
  const pLife = new Float32Array(PN);
  const pMax = new Float32Array(PN);
  const pGrav = new Float32Array(PN);
  const pBase = new Float32Array(PN);
  let pHead = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(
    pGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aSize; attribute vec3 aColor; varying vec3 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float core = smoothstep(0.5, 0.0, d); float cross = max(0.0, 1.0 - abs(p.x)*9.0) * max(0.0, 1.0 - abs(p.y)*2.2) + max(0.0, 1.0 - abs(p.y)*9.0) * max(0.0, 1.0 - abs(p.x)*2.2); gl_FragColor = vec4(vC * (core*core + cross*0.6), 1.0); }',
    }),
  );
  points.frustumCulled = false;
  group.add(points);

  function emit(x, y, z, vx, vy, vz, color, size, life, grav) {
    const i = pHead;
    pHead = (pHead + 1) % PN;
    pPos[i * 3] = x;
    pPos[i * 3 + 1] = y;
    pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx;
    pVel[i * 3 + 1] = vy;
    pVel[i * 3 + 2] = vz;
    pCol[i * 3] = color.r;
    pCol[i * 3 + 1] = color.g;
    pCol[i * 3 + 2] = color.b;
    pBase[i] = size;
    pLife[i] = life;
    pMax[i] = life;
    pGrav[i] = grav;
  }
  for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -100;

  // 主角脚下的影子（没有阴影贴图，用柔和的圆斑代替）
  const blobTex = blobTexture();
  const blobs = [];
  st.addShadow = (dancer) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.006;
    m.renderOrder = 2;
    group.add(m);
    blobs.push({ m, dancer });
  };

  // ------------------------------------------------------------ 特效接口
  const v3 = new THREE.Vector3();
  st.burst = (pos, kind = 'perfect') => {
    const n = kind === 'perfect' ? 46 : kind === 'great' ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU;
      const b = (rand() - 0.3) * Math.PI * 0.8;
      const sp = 1.2 + rand() * (kind === 'perfect' ? 3 : 2);
      tmpC.copy(cur[i % 4]).lerp(WHITE, 0.35 + rand() * 0.4).multiplyScalar(1.3);
      emit(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 1.2, Math.sin(a) * Math.cos(b) * sp, tmpC, 0.05 + rand() * 0.07, 0.5 + rand() * 0.5, 3.5);
    }
  };
  st.confetti = (n = 160) => {
    for (let i = 0; i < n; i++) {
      tmpC.setHSL(rand(), 0.9, 0.6).multiplyScalar(1.3);
      emit((rand() * 2 - 1) * 5.5, 6 + rand() * 2.5, CENTER_Z + (rand() * 2 - 1) * 4.5, (rand() - 0.5) * 1.5, -0.5 - rand() * 1.2, (rand() - 0.5) * 1.5, tmpC, 0.07 + rand() * 0.06, 3.5 + rand() * 2, 0.7);
    }
  };
  st.firework = (x, y, z) => {
    const hue = rand();
    for (let i = 0; i < 90; i++) {
      v3.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(3.5 + rand() * 2.5);
      tmpC.setHSL((hue + rand() * 0.12) % 1, 0.9, 0.62).multiplyScalar(1.6);
      emit(x, y, z, v3.x, v3.y, v3.z, tmpC, 0.08 + rand() * 0.07, 1.1 + rand() * 0.8, 2.2);
    }
  };
  let fountainT = 0;
  st.pulse = (amt = 1) => {
    st.flash = Math.max(st.flash, amt);
  };

  st.setPalette = (hexes) => {
    hexes.forEach((h, i) => pal[i].set(h));
  };
  st.setLogo = (title, sub) => logo.draw(title, sub);
  st.setMode = (m) => {
    st.mode = m;
  };

  const ENERGY = { lobby: 0.45, intro: 0.5, verse: 0.72, build: 0.85, chorus: 1.0, break: 0.42, finish: 1.05, results: 0.6 };
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const s4 = new THREE.Vector3();
  const p4 = new THREE.Vector3();
  const e4 = new THREE.Euler();
  let time = 0;
  let lastBar = -1;
  let colorShift = 0;

  st.update = (dt, beat, levels, focus) => {
    time += dt;
    const mode = st.mode;
    const feverOn = st.fever > 0.5;
    const eTarget = (ENERGY[mode] || 0.6) + (feverOn ? 0.2 : 0);
    st.energy = damp(st.energy, eTarget, 3, dt);
    st.flash = Math.max(0, st.flash - dt * 3.2);
    const pulse = Math.pow(1 - (beat - Math.floor(beat)), 3);
    const bar = Math.floor(beat / 4);
    if (bar !== lastBar) {
      lastBar = bar;
      colorShift = (colorShift + 1) % 4;
    }
    // 当前配色：每小节轮转一次；灵感爆发时变成彩虹
    for (let i = 0; i < 4; i++) {
      if (feverOn) tmpC.setHSL((time * 0.25 + i * 0.25) % 1, 1, 0.5);
      else tmpC.copy(pal[(i + colorShift) % 4]);
      cur[i].lerp(tmpC, 1 - Math.exp(-dt * (feverOn ? 10 : 4)));
    }
    const E = st.energy;
    const bass = levels ? levels.bass : pulse * 0.6;

    FU.uTime.value = time;
    FU.uBeat.value = beat;
    FU.uPulse.value = pulse;
    FU.uEnergy.value = E;
    FU.uFlash.value = st.flash;
    FU.uChecker.value = damp(FU.uChecker.value, mode === 'chorus' || feverOn || mode === 'finish' ? 1 : 0, 4, dt);
    FU.uCA.value.copy(cur[0]);
    FU.uCB.value.copy(cur[1]);
    FU.uCC.value.copy(cur[2]);
    if (focus) FU.uSpot.value.set(focus.x, focus.z, mode === 'break' ? 1.6 : 1.1);

    WU.uTime.value = time;
    WU.uBeat.value = beat;
    WU.uPulse.value = pulse;
    WU.uEnergy.value = E;
    if (levels && levels.spectrum) {
      for (let i = 0; i < 32; i++) specData[i * 4] = Math.min(255, levels.spectrum[i] * 255 * 1.25);
    } else {
      for (let i = 0; i < 32; i++) specData[i * 4] = (0.25 + 0.5 * pulse * (0.5 + 0.5 * Math.sin(i * 1.7 + bar))) * 255 * (1 - i / 44);
    }
    specTex.needsUpdate = true;

    dome.material.uniforms.uTime.value = time;
    dome.material.uniforms.uEnergy.value = E;
    st.farLights.material.uniforms.uTime.value = time;

    // 角色灯光与轮廓光
    rimA.color.copy(cur[0]);
    rimB.color.copy(cur[1]);
    const dim = mode === 'break' ? 0.78 : 1;
    key.intensity = damp(key.intensity, 1.85 * dim + st.flash * 0.4, 5, dt);
    hemi.intensity = damp(hemi.intensity, 1.3 * dim, 5, dt);
    rimA.intensity = rimB.intensity = 0.9 + E * 0.7 + pulse * 0.4;
    rimUniform.value.copy(cur[0]).lerp(cur[1], 0.5 + 0.5 * Math.sin(time * 0.9)).multiplyScalar(0.16 + E * 0.2 + st.flash * 0.3);
    st.faceLight = clamp(0.82 * dim + 0.12 + st.flash * 0.1, 0.5, 1.05);

    stripMat.color.copy(cur[2]);
    strips[0].material.color.copy(cur[2]).multiplyScalar(1.2 + pulse * 1.3 * E);
    strips[1].material.color.copy(cur[3]).multiplyScalar(0.9 + pulse * 0.8 * E);

    // 光束
    const fast = mode === 'chorus' || mode === 'finish' || feverOn;
    for (const b of beams) {
      const t = beat * (fast ? 0.5 : 0.25) * Math.PI + b.phase;
      let rx;
      let rz;
      if (mode === 'break' && !b.up && focus) {
        // 间奏：顶灯收拢成追光，打在主角身上
        p4.set(focus.x - b.pivot.position.x, 1.0 - b.pivot.position.y, focus.z - b.pivot.position.z);
        rx = Math.atan2(-p4.z, -p4.y);
        rz = Math.atan2(p4.x, Math.hypot(p4.y, p4.z));
        b.pivot.rotation.set(damp(b.pivot.rotation.x, rx, 4, dt), 0, damp(b.pivot.rotation.z, rz, 4, dt));
      } else {
        const amp = fast ? 0.75 : 0.42;
        // 光束沿自身 -Y 方向射出：顶灯向前下方打，地灯向前上方打
        rx = (b.up ? Math.PI + 0.3 : -0.42) + Math.sin(t) * amp * 0.6;
        rz = Math.sin(t * 0.5 + b.phase * 1.7) * amp + (b.up ? -Math.sign(b.x) * 0.3 : -b.x * 0.05);
        b.pivot.rotation.set(damp(b.pivot.rotation.x, rx, 6, dt), 0, damp(b.pivot.rotation.z, rz, 6, dt));
      }
      const strobe = mode === 'build' ? 0.5 + 0.5 * Math.sin(beat * TAU * 2 + b.phase) : 1;
      const Eb = Math.min(E, 1.2);
      const base = mode === 'lobby' ? 0.26 : mode === 'break' ? (b.up ? 0.1 : 0.45) : 0.2 + Eb * 0.24;
      b.mat.uniforms.uInt.value = damp(b.mat.uniforms.uInt.value, (base + pulse * 0.2 * Eb) * strobe, 10, dt);
      b.mat.uniforms.uColor.value.copy(cur[mod(b.ci + (fast ? Math.floor(beat) : 0), 4)]).lerp(WHITE, mode === 'break' ? 0.6 : 0.15);
      b.lens.material.color.copy(b.mat.uniforms.uColor.value).multiplyScalar(2.2);
    }

    // 激光只在副歌 / 爆发 / 终结时出现
    const laserOn = mode === 'chorus' || mode === 'finish' || feverOn ? 1 : 0;
    for (const l of lasers) {
      const side = l.i < 6 ? -1 : 1;
      const k = (l.i % 6) / 5 - 0.5;
      l.pv.rotation.set(0.55 + Math.sin(beat * 0.5 * Math.PI + l.i) * 0.25, 0, side * 0.2 + k * 1.3 * Math.sin(beat * 0.25 * Math.PI + side) + side * 0.25);
      l.m.material.opacity = damp(l.m.material.opacity, laserOn * (0.55 + pulse * 0.45), 6, dt);
      l.m.material.color.copy(cur[mod(l.i + Math.floor(beat / 2), 4)]).multiplyScalar(1.6);
    }

    rings.forEach((r, i) => {
      r.rotation.set(Math.PI / 2 + Math.sin(time * 0.4 + i) * 0.22, 0, time * (0.12 + i * 0.05) * (i % 2 ? -1 : 1));
      r.material.color.copy(cur[i % 4]).multiplyScalar(0.8 + pulse * 0.9 * E + st.flash * 0.5);
    });

    for (let i = 0; i < speakers.length; i++) {
      const s = speakers[i];
      const k = 1 + bass * 0.22 + pulse * 0.06;
      s.cone.scale.setScalar(k);
      s.ring.material.color.copy(cur[i % 4]).multiplyScalar(0.6 + bass * 2.2);
    }

    // 观众：随拍子起伏，挥舞荧光棒
    if (crowd) {
      const jump = E * (fast ? 1.4 : 0.8);
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const hop = Math.abs(Math.sin(beat * Math.PI + p.ph * 0.15)) * 0.16 * p.amp * jump;
        e4.set(0, p.ry, Math.sin(beat * Math.PI * 0.5 + p.ph) * 0.06);
        q4.setFromEuler(e4);
        p4.set(p.x, p.y + hop, p.z);
        s4.setScalar(p.s);
        m4.compose(p4, q4, s4);
        crowd.setMatrixAt(i, m4);
        if (p.stick) {
          const sw = Math.sin(beat * Math.PI * 0.5 + p.ph) * 0.7;
          e4.set(-0.3, p.ry, sw);
          q4.setFromEuler(e4);
          p4.set(p.x + Math.sin(sw) * 0.3, p.y + hop + 1.55 * p.s, p.z);
          s4.setScalar(1);
          m4.compose(p4, q4, s4);
          tmpC.copy(cur[p.ci]).multiplyScalar(1.3 + pulse * 1.5);
        } else {
          p4.set(0, -50, 0);
          m4.compose(p4, q4, s4);
          tmpC.setScalar(0);
        }
        sticks.setMatrixAt(i, m4);
        sticks.setColorAt(i, tmpC);
      }
      crowd.instanceMatrix.needsUpdate = true;
      sticks.instanceMatrix.needsUpdate = true;
      sticks.instanceColor.needsUpdate = true;
    }

    // 灵感爆发：舞台前沿的火花喷泉
    if (feverOn || mode === 'finish') {
      fountainT += dt;
      while (fountainT > 0.012) {
        fountainT -= 0.012;
        const fx = [-4.6, -2.3, 2.3, 4.6][Math.floor(rand() * 4)];
        tmpC.setHSL(0.08 + rand() * 0.08, 1, 0.6).multiplyScalar(1.5);
        emit(fx, 0.05, 3.9, (rand() - 0.5) * 0.9, 4.5 + rand() * 2.5, (rand() - 0.5) * 0.9, tmpC, 0.045 + rand() * 0.04, 0.7 + rand() * 0.5, 7);
      }
    }
    // 常驻的漂浮微尘
    if (rand() < dt * 14) {
      tmpC.copy(cur[Math.floor(rand() * 4)]).multiplyScalar(0.7);
      emit((rand() * 2 - 1) * 6, rand() * 0.5, CENTER_Z + (rand() * 2 - 1) * 5, (rand() - 0.5) * 0.2, 0.25 + rand() * 0.4, (rand() - 0.5) * 0.2, tmpC, 0.03 + rand() * 0.03, 4 + rand() * 3, -0.02);
    }
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        pPos[i * 3 + 1] = -100;
        pSize[i] = 0;
        continue;
      }
      pVel[i * 3 + 1] -= pGrav[i] * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      const k = pLife[i] / pMax[i];
      pSize[i] = pBase[i] * Math.min(1, k * 3) * (0.75 + 0.25 * Math.sin(time * 18 + i));
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;

    for (const b of blobs) {
      const h = b.dancer.joints.hips;
      b.m.position.x = b.dancer.root.position.x + h.position.x;
      b.m.position.z = b.dancer.root.position.z + h.position.z;
      const lift = clamp((h.position.y - b.dancer.hipY) * 3, 0, 0.6);
      b.m.scale.setScalar(1 - lift * 0.5);
      b.m.material.opacity = 0.85 - lift;
    }
  };

  st.setPointScale = (h) => {
    points.material.uniforms.uScale.value = h * 0.9;
  };
  st.colors = cur;
  return st;
}

// 简单合并两个非索引化后的几何体（只保留 position），够给剪影用
function mergeGeos(list) {
  const parts = list.map((g) => g.toNonIndexed());
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

export const STAGE_CENTER_Z = CENTER_Z;
