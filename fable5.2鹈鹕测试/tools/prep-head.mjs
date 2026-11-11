// 把图生 3D 得到的豆包胸像 GLB 处理成游戏用的头模资源（只解析数据，不执行模型文件里的任何内容）
// 用法：node tools/prep-head.mjs <输入.glb> [目标三角形数]
// 输出：assets/doubao-head.bin（量化后的几何）、assets/doubao-head.webp（模型自带贴图）、assets/doubao-head.json（对齐参数）
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , glbPath, triArg] = process.argv, TARGET = +(triArg || 11000);
const YCUT = -0.275; // 脖子最细处略偏下：以上保留（头 + 脖子），以下的肩膀丢弃，由游戏里的身体代替
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
let idx = new Uint32Array(keep);

// ---- 2. 贴图与官方头像解码 ----
const tex = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), TW = tex.info.width, TH = tex.info.height;
const texAt = (u, v) => { const x = Math.min(TW - 1, Math.max(0, (u * TW) | 0)), y = Math.min(TH - 1, Math.max(0, (v * TH) | 0)), o = (y * TW + x) * 4; return [tex.data[o], tex.data[o + 1], tex.data[o + 2]]; };
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

// ---- 4. 模型贴图与官方图的色差（按头发区域求增益），以及模型多补出来的右耳位置 ----
const sum = [0, 0, 0, 0, 0, 0]; let ear = [0, 0, 0, 0];
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], P = k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], [pa, pb, pc] = [P(a), P(b), P(c)];
  const nx = (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]), nz = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]), ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]), nl = Math.hypot(nx, ny, nz) || 1;
  const x = (pa[0] + pb[0] + pc[0]) / 3, y = (pa[1] + pb[1] + pc[1]) / 3, z = (pa[2] + pb[2] + pc[2]) / 3, g = texAt((uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3);
  if (nz / nl > 0.6) { const u = CX + S * x, v = CY - S * A * y, i = ((v * OH) | 0) * OW + ((u * OW) | 0); if (u > 0 && u < 1 && v > 0 && v < 1 && !bg[i] && od[i * 4] < 110 && g[0] < 130) for (let k = 0; k < 3; k++) { sum[k] += od[i * 4 + k]; sum[3 + k] += g[k]; } }
  // 官方形象只露出她的左耳（+X）；-X 一侧肤色的凸起就是模型多补的耳朵
  if (x < -0.26 && nx / nl < -0.2 && g[0] > 150 && g[0] - g[2] > 25) { ear[0] += x; ear[1] += y; ear[2] += z; ear[3]++; }
}
const gain = [0, 1, 2].map(k => +(sum[k] / (sum[3 + k] || 1)).toFixed(3));
ear = ear[3] ? ear.slice(0, 3).map(v => +(v / ear[3]).toFixed(4)) : null;
console.log('头发色差增益', gain, '多余的耳朵中心', ear);

// ---- 5. 平滑后脑：图生 3D 在头顶后方留下一道折痕，对耳后的头发做拉普拉斯平滑（脸和正面的发型不动）----
await MeshoptSimplifier.ready;
{
  const weld = MeshoptSimplifier.generatePositionRemap(pos, 3), nb = new Map();
  const link = (a, b) => { if (a == b) return; let s = nb.get(a); if (!s) nb.set(a, (s = new Set())); s.add(b); };
  for (let t = 0; t < idx.length; t += 3) { const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]]; link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a); }
  const wgt = v => Math.min(1, Math.max(0, (-0.03 - pos[v * 3 + 2]) / 0.09)) * 0.6; // z 越靠后权重越大
  for (let it = 0; it < 24; it++) {
    const nx = new Map();
    for (const [v, s] of nb) { const w = wgt(v); if (w <= 0) continue; let x = 0, y = 0, z = 0; for (const u of s) { x += pos[u * 3]; y += pos[u * 3 + 1]; z += pos[u * 3 + 2]; } const n = s.size; nx.set(v, [pos[v * 3] + (x / n - pos[v * 3]) * w, pos[v * 3 + 1] + (y / n - pos[v * 3 + 1]) * w, pos[v * 3 + 2] + (z / n - pos[v * 3 + 2]) * w]); }
    for (const [v, p] of nx) { pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2]; }
  }
  for (let v = 0; v < weld.length; v++) if (weld[v] != v) { pos[v * 3] = pos[weld[v] * 3]; pos[v * 3 + 1] = pos[weld[v] * 3 + 1]; pos[v * 3 + 2] = pos[weld[v] * 3 + 2]; }
}

// ---- 6. 简化 + 压实 + 量化 ----
const before = idx.length / 3;
[idx] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [0.5, 0.5], null, TARGET * 3, 0.02, ['Prune']);
const remap = new Int32Array(pos.length / 3).fill(-1), np = [], nu = [];
for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (remap[v] < 0) { remap[v] = np.length / 3; np.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); nu.push(uv[v * 2], uv[v * 2 + 1]); } idx[i] = remap[v]; }
const nv = np.length / 3; if (nv > 65535) throw Error('顶点数超过 16 位索引上限');
const mn = [9, 9, 9], mx = [-9, -9, -9]; for (let i = 0; i < np.length; i++) { mn[i % 3] = Math.min(mn[i % 3], np[i]); mx[i % 3] = Math.max(mx[i % 3], np[i]); }
const out = Buffer.alloc(8 + 24 + nv * 10 + idx.length * 2); let o = 0;
out.writeUInt32LE(nv, o); o += 4; out.writeUInt32LE(idx.length, o); o += 4;
for (let k = 0; k < 3; k++) { out.writeFloatLE(mn[k], o); o += 4; } for (let k = 0; k < 3; k++) { out.writeFloatLE(mx[k] - mn[k], o); o += 4; }
for (let i = 0; i < np.length; i++) { out.writeUInt16LE(Math.round(((np[i] - mn[i % 3]) / (mx[i % 3] - mn[i % 3])) * 65535), o); o += 2; }
for (let i = 0; i < nu.length; i++) { out.writeUInt16LE(Math.round(Math.min(1, Math.max(0, i % 2 ? 1 - nu[i] : nu[i])) * 65535), o); o += 2; } // v 翻转成 flipY 贴图的习惯
for (let i = 0; i < idx.length; i++) { out.writeUInt16LE(idx[i], o); o += 2; }
writeFileSync('assets/doubao-head.bin', out);
const webp = await sharp(png).resize(512, 512).webp({ quality: 82 }).toBuffer();
writeFileSync('assets/doubao-head.webp', webp);
writeFileSync('assets/doubao-head.json', JSON.stringify({ align: [+CX.toFixed(4), +CY.toFixed(4), +S.toFixed(4), +(S * A).toFixed(4)], gain, ear, ycut: YCUT, iou: +bs.toFixed(3) }) + '\n');
console.log(`三角形 ${before} → ${idx.length / 3}，顶点 ${nv}；bin ${out.length} 字节，贴图 ${webp.length} 字节`);
