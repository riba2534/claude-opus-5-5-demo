// 把图生 3D 得到的豆包胸像 GLB 重新采样成游戏用的头模数据（只解析数据，不执行模型文件里的任何内容）
// 用法：node tools/prep-head.mjs <输入.glb> [--debug <目录>]
// 输出：assets/doubao-head.bin（规则网格上的半径图 + 头发/皮肤分区）、assets/doubao-head.json（与官方图的对齐参数）
//
// 生成模型的三角网表面坑洼、布线杂乱，直接用会有折痕和色块。这里只取它的"形状"：
// 从头部中轴向外发射射线，记录最外层表面的距离，得到一张规则的半径图；
// 头发与皮肤分开做平滑，再把每一列的下沿对齐到发梢 / 下颌线。运行时由这张图重建出布线规整的光滑网格。
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2), glbPath = args[0], dbg = args.includes('--debug') ? args[args.indexOf('--debug') + 1] : null;
const YCUT = -0.275; // 脖子最细处略偏下：以上是头，以下的肩膀丢弃，由游戏里的身体代替
// 参数化：上半部分是以 (0,YC,0) 为球心的半球（ND+1 行，极角 0..90°），下半部分是绕竖直中轴的圆柱（水平射线）
const NU = 288, ND = 52, NC = 38, NV = ND + 1 + NC, YC = 0.1, DY = 0.01, NC2 = 36, RMAX = 0.45;
const PI = Math.PI, clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const buf = readFileSync(glbPath), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (dv.getUint32(0, true) != 0x46546c67) throw Error('不是 GLB 文件');
let off = 12, json, bin;
while (off < buf.length) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), d = buf.subarray(off + 8, off + 8 + len); if (type == 0x4e4f534a) json = JSON.parse(d.toString('utf8')); else if (type == 0x004e4942) bin = d; off += 8 + len; }
const view = (i, C, n) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], o = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0); return new C(bin.buffer.slice(o, o + a.count * n * C.BYTES_PER_ELEMENT)); };
const pr = json.meshes[0].primitives[0];
const pos = view(pr.attributes.POSITION, Float32Array, 3), uv = view(pr.attributes.TEXCOORD_0, Float32Array, 2), idx0 = view(pr.indices, Uint32Array, 1);
const ibv = json.bufferViews[json.images[0].bufferView], png = bin.subarray(ibv.byteOffset || 0, (ibv.byteOffset || 0) + ibv.byteLength);

// ---- 1. 裁掉肩膀 ----
const keep = [];
for (let t = 0; t < idx0.length; t += 3) { const a = idx0[t], b = idx0[t + 1], c = idx0[t + 2]; if ((pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3 > YCUT) keep.push(a, b, c); }
const idx = new Uint32Array(keep), nt = idx.length / 3;

// ---- 2. 贴图与官方头像解码 ----
const tex = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), TW = tex.info.width, TH = tex.info.height;
const off_ = await sharp('assets/doubao-official.webp').ensureAlpha().raw().toBuffer({ resolveWithObject: true }), OW = off_.info.width, OH = off_.info.height, od = off_.data;
// 官方图抠图：从四周泛洪去掉白底与浅蓝圆底（与运行时 buildHead 里的规则一致）
const bg = new Uint8Array(OW * OH), st = [];
const isBg = i => { const R = od[i * 4], G = od[i * 4 + 1], B = od[i * 4 + 2]; return (R > 240 && G > 240 && B > 240) || (B > 228 && B - R > 14 && G > 196 && R > 150); };
for (let i = 0; i < OW; i++) st.push(i, (OH - 1) * OW + i); for (let i = 0; i < OH; i++) st.push(i * OW, i * OW + OW - 1);
while (st.length) { const i = st.pop(); if (bg[i] || !isBg(i)) continue; bg[i] = 1; const x = i % OW; if (x > 0) st.push(i - 1); if (x < OW - 1) st.push(i + 1); if (i >= OW) st.push(i - OW); if (i < OW * (OH - 1)) st.push(i + OW); }

// ---- 3. 正面剪影对齐：求 模型(x,y) → 官方图归一化坐标 的缩放与平移 ----
const M = 512, mm = new Uint8Array(M * M), toM = v => (v + 0.5) * M;
for (let t = 0; t < idx.length; t += 3) { // 正交投影光栅化（+X 向右，+Y 向上）
  const [ax, ay, bx, by, cx, cy] = [0, 1, 2].flatMap(k => [toM(pos[idx[t + k] * 3]), toM(-pos[idx[t + k] * 3 + 1])]);
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(M - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(M - 1, Math.ceil(Math.max(ay, by, cy)));
  const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(det) < 1e-9) continue;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / det, w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / det;
    if (w0 >= -0.01 && w1 >= -0.01 && w0 + w1 <= 1.01) mm[y * M + x] = 1;
  }
}
const modelAt = (x, y) => { const i = toM(x) | 0, j = toM(-y) | 0; return i >= 0 && j >= 0 && i < M && j < M ? mm[j * M + i] : 0; };
const G = 160, iou = (s, a, cx, cy) => { // 只比较脖子切口以上的区域
  let inter = 0, uni = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const u = (i + 0.5) / G, v = (j + 0.5) / G, x = (u - cx) / s, y = -(v - cy) / (s * a);
    if (y < YCUT + 0.03) continue;
    const o = bg[((v * OH) | 0) * OW + ((u * OW) | 0)] ? 0 : 1, m = modelAt(x, y);
    inter += o & m; uni += o | m;
  }
  return inter / (uni || 1);
};
let best = [0.9, 1, 0.5, 0.45], bs = 0;
for (const [ds, da, dc, n] of [[0.06, 0, 0.04, 4], [0.02, 0.02, 0.012, 3], [0.006, 0.008, 0.004, 3], [0.002, 0.003, 0.0015, 2]]) {
  const [s0, a0, x0, y0] = best;
  for (let i = -n; i <= n; i++) for (let k = da ? -2 : 0; k <= (da ? 2 : 0); k++) for (let p = -n; p <= n; p++) for (let q = -n; q <= n; q++) {
    const c = [s0 + i * ds, a0 + k * da, x0 + p * dc, y0 + q * dc], v = iou(...c); if (v > bs) { bs = v; best = c; }
  }
}
const [S, A, CX, CY] = best;
console.log('对齐：scale', S.toFixed(4), 'aspect', A.toFixed(4), 'cx', CX.toFixed(4), 'cy', CY.toFixed(4), 'IoU', bs.toFixed(4));

// ---- 4. 最外层表面采样 ----
const rowRay = j => j <= ND ? { oy: YC, sp: Math.sin((j / ND) * PI / 2), cp: Math.cos((j / ND) * PI / 2) } : { oy: YC - (j - ND) * DY, sp: 1, cp: 0 };
const rho = new Float32Array(NU * NV), col = new Uint8Array(NU * NV * 3), miss = new Uint8Array(NU * NV);
{
  const ymin = new Float32Array(nt), ymax = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { const a = pos[idx[t * 3] * 3 + 1], b = pos[idx[t * 3 + 1] * 3 + 1], c = pos[idx[t * 3 + 2] * 3 + 1]; ymin[t] = Math.min(a, b, c); ymax[t] = Math.max(a, b, c); }
  for (let j = 0; j < NV; j++) {
    const { oy, sp, cp } = rowRay(j), cand = [];
    for (let t = 0; t < nt; t++) if (j <= ND ? ymax[t] > YC - 0.02 : ymin[t] <= oy && ymax[t] >= oy) cand.push(t);
    for (let i = 0; i < NU; i++) {
      const th = (i / NU) * PI * 2, dx = sp * Math.sin(th), dy = cp, dz = sp * Math.cos(th);
      let bt = 0, bi = -1, bu = 0, bv = 0;
      for (const t of cand) { // Möller–Trumbore，取最远的交点
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2], e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = -pos[a], ty = oy - pos[a + 1], tz = -pos[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-4 || u > 1.0001) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-4 || u + v > 1.0001) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > bt) { bt = tt; bi = t; bu = u; bv = v; }
      }
      const k = j * NU + i; rho[k] = bt;
      if (bi < 0) { miss[k] = 1; continue; }
      const a = idx[bi * 3], b = idx[bi * 3 + 1], c = idx[bi * 3 + 2], w = 1 - bu - bv;
      const U = uv[a * 2] * w + uv[b * 2] * bu + uv[c * 2] * bv, V = uv[a * 2 + 1] * w + uv[b * 2 + 1] * bu + uv[c * 2 + 1] * bv;
      const o = (clamp((V * TH) | 0, 0, TH - 1) * TW + clamp((U * TW) | 0, 0, TW - 1)) * 4;
      col[k * 3] = tex.data[o]; col[k * 3 + 1] = tex.data[o + 1]; col[k * 3 + 2] = tex.data[o + 2];
    }
  }
}
const W = i => ((i % NU) + NU) % NU, at = (a, i, j) => a[clamp(j, 0, NV - 1) * NU + W(i)];
// 补洞：射线从三角形缝隙里漏出去的格子，取周围有效值的平均
for (let it = 0; it < 8; it++) for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
  const k = j * NU + i; if (!miss[k]) continue;
  let s = 0, n = 0, c = [0, 0, 0];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const jj = j + dj; if (jj < 0 || jj >= NV) continue; const q = jj * NU + W(i + di); if (!miss[q]) { s += rho[q]; n++; for (let e = 0; e < 3; e++) c[e] += col[q * 3 + e]; } }
  if (n > 1) { rho[k] = s / n; for (let e = 0; e < 3; e++) col[k * 3 + e] = c[e] / n; miss[k] = 0; }
}

// ---- 5. 下沿：每一列从上往下，半径掉到脖子粗细之前的最后一行（发梢或下颌线）----
const jB = new Float32Array(NU);
for (let i = 0; i < NU; i++) { let j = ND + 8; while (j < NV - 1 && rho[(j + 1) * NU + i] >= 0.15) j++; jB[i] = j; }
const blur1 = (a, sig) => { const r = Math.ceil(sig * 3), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, w = 0; for (let d = -r; d <= r; d++) { const g = Math.exp(-d * d / (2 * sig * sig)); s += a[(i + d + a.length) % a.length] * g; w += g; } o[i] = s / w; } return o; };
// 先取邻域最小值再平滑：得到一条光滑、又不越过任何一列悬崖的下沿
const jBs = blur1(jB.map((_, i) => { let m = 1e9; for (let d = -3; d <= 3; d++) m = Math.min(m, jB[W(i + d)]); return m; }), 2.5).map(v => v - 0.3);
const inside = (i, j) => j <= jB[W(i)];

// ---- 6. 头发 / 皮肤分区（按模型贴图的颜色）：偏粉的亮色是皮肤，其余是头发；被皮肤包围的深色块（眼睛、眉毛）并入皮肤 ----
const skin = new Uint8Array(NU * NV);
for (let k = 0; k < NU * NV; k++) { const r = col[k * 3], g = col[k * 3 + 1], b = col[k * 3 + 2]; skin[k] = r > 135 && r - b > 22 && r >= g ? 1 : 0; }
{ // 从头顶泛洪头发，没被淹到的非皮肤格子就是五官
  const hair = new Uint8Array(NU * NV), q = []; for (let i = 0; i < NU; i++) q.push(i);
  // 泛洪不许从高处的头发跨下"悬崖"流到脸上：左眉和眼睛紧挨着垂下来的鬓发，颜色相近但低了好几厘米
  const go = (k, q2) => { if (!hair[q2] && !skin[q2] && rho[q2] > rho[k] - 0.012) q.push(q2); };
  for (let i = 0; i < NU; i++) hair[i] = 0;
  while (q.length) { const k = q.pop(); if (hair[k] || skin[k]) continue; hair[k] = 1; const i = k % NU, j = (k / NU) | 0; go(k, j * NU + W(i + 1)); go(k, j * NU + W(i - 1)); if (j > 0) go(k, k - NU); if (j < NV - 1 && inside(i, j + 1)) go(k, k + NU); }
  for (let k = 0; k < NU * NV; k++) skin[k] = hair[k] ? 0 : 1;
  // 去掉头发里零星的"皮肤"噪点：3x3 多数表决两轮
  for (let it = 0; it < 2; it++) { const o = skin.slice(); for (let j = 1; j < NV - 1; j++) for (let i = 0; i < NU; i++) { let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += o[(j + dj) * NU + W(i + di)]; skin[j * NU + i] = s >= 5 ? 1 : 0; } }
}

// ---- 7. 平滑：头发和皮肤各自在自己的区域里做高斯平滑（头发大幅平滑去掉鼓包，皮肤只轻微平滑保住鼻子嘴唇），互不串色 ----
function smooth(sigU, sigV, mask) { // mask(k) 返回权重；按物理尺度换算每一行的角向核宽
  const tmp = new Float32Array(NU * NV), wt = new Float32Array(NU * NV), out = new Float32Array(NU * NV);
  for (let j = 0; j < NV; j++) {
    const rr = 0.3 * rowRay(j).sp, cell = Math.max(rr, 0.02) * 2 * PI / NU, sg = Math.min(sigU / cell, NU / 6), r = Math.ceil(sg * 3);
    for (let i = 0; i < NU; i++) { let s = 0, w = 0; for (let d = -r; d <= r; d++) { const k = j * NU + W(i + d), m = mask(k) * Math.exp(-d * d / (2 * sg * sg)); s += rho[k] * m; w += m; } tmp[j * NU + i] = s; wt[j * NU + i] = w; }
  }
  const sv = sigV / DY, rv = Math.ceil(sv * 3);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { let s = 0, w = 0; for (let d = -rv; d <= rv; d++) { const jj = j + d; if (jj < 0 || jj >= NV) continue; const g = Math.exp(-d * d / (2 * sv * sv)); s += tmp[jj * NU + i] * g; w += wt[jj * NU + i] * g; } out[j * NU + i] = w > 1e-6 ? s / w : rho[j * NU + i]; }
  return out;
}
const valid = k => inside(k % NU, (k / NU) | 0) ? 1 : 0;
const rH = smooth(0.05, 0.045, k => valid(k) * (1 - skin[k])), rS = smooth(0.008, 0.008, k => valid(k) * skin[k]);
const rho2 = new Float32Array(NU * NV); for (let k = 0; k < NU * NV; k++) rho2[k] = skin[k] ? rS[k] : rH[k];
// 发际线上再做一次不分区的轻微平滑，把头发和皮肤之间的台阶变成缓坡（官方图的发际线和模型的未必重合，硬台阶会露馅）
for (let k = 0; k < NU * NV; k++) rho[k] = rho2[k];
const rF = smooth(0.011, 0.011, valid);

// ---- 8. 圆柱部分按列重采样：每一列的最后一行正好落在下沿上 ----
const NR = ND + 1 + NC2, outR = new Uint16Array(NU * NR), outH = new Uint8Array(NU * NR), outB = new Uint16Array(NU);
const hairF = new Float32Array(NU * NV); for (let k = 0; k < NU * NV; k++) hairF[k] = 1 - skin[k];
for (let i = 0; i < NU; i++) {
  outB[i] = Math.round(((YC - (jBs[i] - ND) * DY) + 0.5) * 65535);
  for (let j = 0; j < NR; j++) {
    const js = j <= ND ? j : ND + ((jBs[i] - ND) * (j - ND)) / NC2, j0 = Math.min(Math.floor(js), Math.floor(jB[i])), j1 = Math.min(j0 + 1, Math.floor(jB[i])), f = clamp(js - j0, 0, 1);
    outR[j * NU + i] = Math.round(clamp((rF[j0 * NU + i] * (1 - f) + rF[j1 * NU + i] * f) / RMAX, 0, 1) * 65535);
    outH[j * NU + i] = Math.round((hairF[j0 * NU + i] * (1 - f) + hairF[j1 * NU + i] * f) * 255);
  }
}
// 分区图在重采样后的网格上再柔化一格，边界不出锯齿
{ const o = outH.slice(); for (let j = 1; j < NR - 1; j++) for (let i = 0; i < NU; i++) { let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += o[(j + dj) * NU + W(i + di)] * (di || dj ? 1 : 2); outH[j * NU + i] = s / 10; } }

// ---- 9. 写出 ----
const head = Buffer.alloc(16); head.writeUInt16LE(NU, 0); head.writeUInt16LE(ND, 2); head.writeUInt16LE(NC2, 4); head.writeFloatLE(YC, 8); head.writeFloatLE(RMAX, 12);
const out = Buffer.concat([head, Buffer.from(outB.buffer), Buffer.from(outR.buffer), Buffer.from(outH.buffer)]);
writeFileSync('assets/doubao-head.bin', out);
// eyes：两只眼睛在官方图里的位置 [u, v, 半宽, 半高]（贴图坐标，v 向上），眨眼用；是对着官方图量出来的
const EYES = [[0.4268, 0.5654, 0.0742, 0.0547], [0.6563, 0.5488, 0.0684, 0.0508]];
writeFileSync('assets/doubao-head.json', JSON.stringify({ align: [+CX.toFixed(4), +CY.toFixed(4), +S.toFixed(4), +(S * A).toFixed(4)], ycut: YCUT, iou: +bs.toFixed(3), eyes: EYES }) + '\n');
console.log(`网格 ${NU}×${NR}，bin ${out.length} 字节；下沿高度 ${Math.min(...jBs).toFixed(1)}..${Math.max(...jBs).toFixed(1)} 行`);

if (dbg) {
  const img = async (name, w, h, f) => { const b = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f((x + NU / 2) % NU, y); b[(y * w + x) * 3] = c[0]; b[(y * w + x) * 3 + 1] = c[1]; b[(y * w + x) * 3 + 2] = c[2]; } await sharp(b, { raw: { width: w, height: h, channels: 3 } }).resize(w * 2, h * 4, { kernel: 'nearest', fit: 'fill' }).png().toFile(dbg + '/' + name + '.png'); };
  const g = v => { v = clamp(v, 0, 255); return [v, v, v]; };
  await img('raw', NU, NV, (x, y) => inside(x, y) ? g((rho2[y * NU + x] - 0.15) * 1200) : [60, 0, 0]);
  await img('skin', NU, NV, (x, y) => inside(x, y) ? (skin[y * NU + x] ? [240, 200, 185] : [70, 50, 44]) : [0, 0, 60]);
  await img('out', NU, NR, (x, y) => g((outR[y * NU + x] / 65535 * RMAX - 0.15) * 1200));
  await img('outH', NU, NR, (x, y) => g(outH[y * NU + x]));
  // 法线着色预览（沿网格差分）
  await img('shade', NU, NR, (x, y) => { const r = (i, j) => outR[clamp(j, 0, NR - 1) * NU + W(i)] / 65535 * RMAX; return g(128 + ((r(x + 1, y) - r(x - 1, y)) * 9000 + (r(x, y - 1) - r(x, y + 1)) * 9000)); });
}
