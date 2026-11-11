// 植被：程序化枝干 + 透明测试的叶片卡片（阔叶 / 樱花 / 松），叶片图集与草丛贴图都用 Canvas 2D 现画
import { PI, TAU, sin, cos, hypot, max, T, m4, aim, scale, lerp } from './math.js';
import { cyl } from './geo.js';

const TR = cyl(1, 0.62, 1, 8), BARK = 0xc2a88e;
// 叶片图集 2×2：0 阔叶 1 樱花 2 松针 3 灌木。一张卡片约 1.2–1.6 米宽，对应 256 像素，所以叶片要画得很小（约 5–8 厘米）
export function leafAtlas(R0) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const c = cv.getContext('2d'), rr = (a, b) => a + R0() * (b - a);
  const leaf = (x, y, a, l, w, col) => { c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = col; c.beginPath(); c.moveTo(-l, 0); c.quadraticCurveTo(0, -w, l, 0); c.quadraticCurveTo(0, w, -l, 0); c.fill(); c.restore(); };
  const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
  const twigs = (cx, cy, n, col) => { for (let i = 0; i < n; i++) { c.strokeStyle = col; c.lineWidth = rr(1.2, 2.4); const a = rr(0, TAU), l = rr(60, 108); c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo(cx + cos(a + 0.3) * l * 0.5, cy + sin(a + 0.3) * l * 0.5, cx + cos(a) * l, cy + sin(a) * l); c.stroke(); } };
  // 0 阔叶：细枝 + 由深到浅三层小叶片
  twigs(128, 128, 9, '#3d2c1c');
  for (let k = 0; k < 3; k++) for (let i = 0; i < 300; i++) { const a = rr(0, TAU), d = Math.sqrt(R0()) * 116; leaf(128 + cos(a) * d, 128 + sin(a) * d, rr(0, TAU), rr(4.5, 7.5), rr(2.2, 3.6), hsl(rr(86, 120), rr(40, 60), 15 + k * 9 + rr(0, 8))); }
  // 1 樱花：成簇的五瓣小花，夹着少量嫩叶
  twigs(384, 128, 8, '#4a3324');
  for (let i = 0; i < 60; i++) { const a = rr(0, TAU), d = Math.sqrt(R0()) * 110; leaf(384 + cos(a) * d, 128 + sin(a) * d, rr(0, TAU), rr(4, 6), rr(2, 3), hsl(rr(70, 100), 45, rr(30, 42))); }
  for (let i = 0; i < 480; i++) {
    const a = rr(0, TAU), d = Math.sqrt(R0()) * 116, x = 384 + cos(a) * d, y = 128 + sin(a) * d, s = rr(2.4, 3.8), l = rr(80, 95), h = rr(334, 350), st = rr(55, 85);
    for (let p = 0; p < 5; p++) { const q = a + (p / 5) * TAU; c.fillStyle = hsl(h, st, l); c.beginPath(); c.ellipse(x + cos(q) * s * 0.75, y + sin(q) * s * 0.75, s * 0.72, s * 0.5, q, 0, TAU); c.fill(); }
    c.fillStyle = '#e06a8c'; c.beginPath(); c.arc(x, y, s * 0.26, 0, TAU); c.fill();
  }
  // 2 松枝：从卡片上沿中点向下散开的小枝，两侧排满短针叶
  for (let b = 0; b < 12; b++) {
    const a0 = PI / 2 + rr(-1.3, 1.3), L = rr(70, 120);
    c.strokeStyle = '#3a2a1c'; c.lineWidth = 2; c.beginPath(); c.moveTo(128, 262); c.lineTo(128 + cos(a0) * L, 262 + sin(a0) * L); c.stroke();
    for (let i = 0; i < 64; i++) { const t = rr(0.06, 1), x = 128 + cos(a0) * L * t, y = 262 + sin(a0) * L * t, q = a0 + (R0() < 0.5 ? 1 : -1) * rr(0.45, 1.05), l = rr(7, 13); c.strokeStyle = hsl(rr(105, 150), rr(28, 48), rr(13, 30)); c.lineWidth = rr(1, 1.7); c.beginPath(); c.moveTo(x, y); c.lineTo(x + cos(q) * l, y + sin(q) * l); c.stroke(); }
  }
  // 3 灌木：更小更密的叶片
  for (let k = 0; k < 3; k++) for (let i = 0; i < 420; i++) { const a = rr(0, TAU), d = Math.sqrt(R0()) * 118; leaf(384 + cos(a) * d, 384 + sin(a) * d, rr(0, TAU), rr(3.5, 5.5), rr(1.8, 2.8), hsl(rr(95, 135), rr(36, 56), 12 + k * 8 + rr(0, 8))); }
  return cv;
}
export function grassTex(R0) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const c = cv.getContext('2d'), rr = (a, b) => a + R0() * (b - a);
  for (let i = 0; i < 34; i++) {
    const x = rr(10, 246), h = rr(55, 124), w = rr(2.6, 5.2), lean = rr(-26, 26), g = c.createLinearGradient(0, 128, 0, 128 - h);
    g.addColorStop(0, `hsl(${rr(84, 108)},${rr(34, 48)}%,${rr(14, 21)}%)`); g.addColorStop(1, `hsl(${rr(70, 100)},${rr(40, 56)}%,${rr(34, 46)}%)`);
    c.fillStyle = g; c.beginPath(); c.moveTo(x - w, 128); c.quadraticCurveTo(x - w * 0.5 + lean * 0.4, 128 - h * 0.6, x + lean, 128 - h); c.quadraticCurveTo(x + w * 0.5 + lean * 0.4, 128 - h * 0.6, x + w, 128); c.fill();
  }
  return cv;
}

// 叶片卡片累加器
export const newFol = () => ({ p: [], n: [], uv: [], c: [], s: [], i: [] });
// 一张叶片卡片：中心 c，半边长 sz，沿 u / v 两个方向张开（不给就随机取向）；o 为树冠中心，法线取"从树冠中心指向外"，整棵树的受光才柔和
function card(F, R0, cx, cy, cz, sz, cell, ox, oy, oz, tint, sw, ux, uy, uz, vx, vy, vz) {
  const o = F.p.length / 3;
  if (ux === undefined) {
    ux = R0() - 0.5; uy = (R0() - 0.5) * 0.7; uz = R0() - 0.5; let l = hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const nx = R0() - 0.5, ny = R0() - 0.5, nz = R0() - 0.5; vx = ny * uz - nz * uy; vy = nz * ux - nx * uz; vz = nx * uy - ny * ux; l = hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
  }
  const u0 = (cell & 1) * 0.5, v0 = cell & 2 ? 0 : 0.5;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + (ux * a + vx * b) * sz, y = cy + (uy * a + vy * b) * sz, z = cz + (uz * a + vz * b) * sz;
    F.p.push(x, y, z);
    const dx = x - ox, dy = y - oy + sz * 0.6, dz = z - oz, d = hypot(dx, dy, dz) || 1; F.n.push(dx / d, dy / d, dz / d);
    F.uv.push(u0 + (a * 0.5 + 0.5) * 0.5, v0 + (b * 0.5 + 0.5) * 0.5);
    F.c.push(tint[0], tint[1], tint[2]); F.s.push(sw);
  }
  F.i.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
}
const seg = (g, ax, ay, az, bx, by, bz, r0) => { const m = aim(m4(), ax, ay, az, bx - ax, by - ay, bz - az), L = hypot(bx - ax, by - ay, bz - az); g.add(TR, scale(m, r0, L, r0), BARK, 0, 0.1); };

// kind: 0 阔叶 1 樱花 2 松；lod=1 用于场外远景（卡片更少更大）；straight=1 树干不歪（行道树）。返回树干顶部高度（给碰撞体用）
export function tree(g, F, R0, x, y, z, s, kind, lod = 0, straight = 0) {
  const rr = (a, b) => a + R0() * (b - a);
  g.m(9, 0.15, 1);
  if (kind == 2) {
    const h = rr(6, 8.5) * s, tiers = lod ? 5 : 8;
    g.add(TR, T(x, y - 0.2, z, 0, R0() * 6, 0, 0.2 * s, h, 0.2 * s), 0xa8937d, 0, 0.1);
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1), yy = y + h * (0.26 + 0.72 * k), R = (2.5 - 2.05 * k) * s, n = lod ? 5 : 7 - (k > 0.7 ? 2 : 0);
      for (let i = 0; i < n; i++) {
        // 每根侧枝：一张向外下垂的枝叶卡片（宽度方向水平），再加一张竖直的交叉片，侧面看才有厚度
        const a = (i / n) * TAU + t * 0.9 + rr(-0.25, 0.25), dr = rr(0.45, 0.72), ca = cos(a), sa = sin(a), dx = ca * cos(dr), dy = -sin(dr), dz = sa * cos(dr);
        const tn = [rr(0.5, 0.72), rr(0.82, 1), rr(0.5, 0.66)], hs = R * 0.5, cx = x + dx * hs, cy = yy + dy * hs, cz = z + dz * hs;
        card(F, R0, cx, cy, cz, hs, 2, x, yy - 1.5, z, tn, 0.2 + k * 0.5, -sa, 0, ca, -dx, -dy, -dz);
        if (!lod) card(F, R0, cx, cy, cz, hs, 2, x, yy - 1.5, z, tn, 0.2 + k * 0.5, ca * sin(dr), cos(dr), sa * sin(dr), -dx, -dy, -dz);
      }
    }
    for (const [ux, uz] of [[1, 0], [0, 1]]) card(F, R0, x, y + h + 0.1 * s, z, 0.7 * s, 2, x, y + h - 1, z, [0.6, 0.95, 0.58], 0.8, ux, 0, uz, 0, 1, 0);
    g.m(0);
    return y + h * 0.26;
  }
  // 树干分两段，略微歪斜
  const h = rr(2.9, 3.8) * s, lx = straight ? 0 : rr(-0.28, 0.28) * s, lz = straight ? 0 : rr(-0.28, 0.28) * s, my = y + h * 0.55, tx = x + lx, tz = z + lz, top = y + h, tips = [];
  seg(g, x, y - 0.2, z, x + lx * 0.35, my, z + lz * 0.35, 0.2 * s); seg(g, x + lx * 0.35, my - 0.05, z + lz * 0.35, tx, top, tz, 0.135 * s);
  const nb = 3 + ((R0() * 2) | 0);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rr(-0.4, 0.4), el = rr(0.5, 0.95), L = rr(1.6, 2.4) * s, bx = tx + cos(a) * cos(el) * L, by = top + sin(el) * L, bz = tz + sin(a) * cos(el) * L;
    seg(g, tx, top - 0.15, tz, bx, by, bz, 0.1 * s); tips.push([bx, by, bz, a]);
    for (let j = 0; j < 2; j++) {
      const a2 = a + rr(-1.1, 1.1), el2 = rr(0.2, 1.1), L2 = rr(0.9, 1.6) * s, k = rr(0.4, 0.8), sx = lerp(tx, bx, k), sy = lerp(top, by, k), sz = lerp(tz, bz, k);
      const ex = sx + cos(a2) * cos(el2) * L2, ey = sy + sin(el2) * L2, ez = sz + sin(a2) * cos(el2) * L2;
      if (!lod) seg(g, sx, sy, sz, ex, ey, ez, 0.048 * s);
      tips.push([ex, ey, ez, a2]);
    }
  }
  g.m(0);
  // 每个枝梢再发两根细枝（不建几何，藏在叶团里），叶片卡片围着枝梢成团
  if (!lod) for (let i = tips.length - 1; i >= 0; i--) for (let j = 0; j < 2; j++) { const t = tips[i], a = t[3] + rr(-1.3, 1.3), el = rr(-0.1, 1), L = rr(0.5, 0.95) * s; tips.push([t[0] + cos(a) * cos(el) * L, t[1] + sin(el) * L, t[2] + sin(a) * cos(el) * L]); }
  const oy = top + 1.5 * s, pal = kind == 1 ? [[1, 0.8, 0.87], [1, 0.9, 0.94], [0.96, 0.7, 0.8]] : [[0.62, 0.86, 0.42], [0.78, 1, 0.5], [0.5, 0.74, 0.36]];
  const tint = () => { const p = pal[(R0() * 3) | 0], k = rr(0.8, 1.15); return [p[0] * k, p[1] * k, p[2] * k]; };
  const per = lod ? 2 : 4, cs = lod ? 1.5 : 1;
  for (const t of tips) for (let k = 0; k < per; k++) card(F, R0, t[0] + rr(-0.42, 0.42) * s * cs, t[1] + rr(-0.3, 0.45) * s * cs, t[2] + rr(-0.42, 0.42) * s * cs, rr(0.52, 0.8) * s * cs, kind, tx, oy, tz, tint(), rr(0.5, 1));
  for (let k = 0; k < (lod ? 5 : 14); k++) { const a = rr(0, TAU), d = rr(0.2, 1.6) * s; card(F, R0, tx + cos(a) * d, oy + rr(-0.8, 1.2) * s, tz + sin(a) * d, rr(0.6, 0.9) * s * cs, kind, tx, oy, tz, tint(), rr(0.5, 1)); }
  return top;
}
// 灌木 / 花坛：一团低矮的叶片卡片
export function bush(F, R0, x, y, z, r, h, flower) {
  const rr = (a, b) => a + R0() * (b - a), n = max(8, (r * r * 14) | 0);
  for (let i = 0; i < n; i++) {
    const a = rr(0, TAU), d = Math.sqrt(R0()) * r, k = rr(0.75, 1.1), fl = flower && R0() < 0.3;
    card(F, R0, x + cos(a) * d, y + rr(0.3, 0.95) * h, z + sin(a) * d, rr(0.38, 0.6) * h, fl ? 1 : 3, x, y, z, fl ? [1, 0.85, 0.9] : [0.56 * k, 0.84 * k, 0.4 * k], 0.25);
  }
}
