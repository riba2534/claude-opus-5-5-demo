// 昼夜循环：由一天中的时刻推导太阳/月亮方向、天空与雾的颜色、主光与环境光强度
import { sin, cos, smooth, lerp, PI, hypot, max } from './math.js';

export const env = {
  tod: 0.14, L: [0, 1, 0], LC: [3, 3, 3], as: [1, 1, 1], ag: [0.3, 0.3, 0.3], hor: [0.5, 0.7, 0.95], zen: [0.1, 0.25, 0.7], glow: [0, 0, 0],
  sun: [0, 1, 0], moon: [-0.42, 0.72, -0.55], cl: [1, 1, 1], sunK: [1, 1, 1], fog: 0.004, night: 0, day: 1, exp: 1, envI: 0.7,
};
const m3 = (o, a, b, t) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; };
const k3 = (o, a, k) => { o[0] = a[0] * k; o[1] = a[1] * k; o[2] = a[2] * k; return o; };
const tA = [0, 0, 0], tB = [0, 0, 0];
// tod ∈ [0,1)：0 日出 → 0.34 正午 → 0.68 日落 → 夜晚（白天占 68%）
export function updateEnv(tod) {
  const e = env, ang = tod < 0.68 ? (tod / 0.68) * PI : PI + ((tod - 0.68) / 0.32) * PI;
  let sx = cos(ang) * 0.85, sy = sin(ang), sz = 0.45, l = hypot(sx, sy, sz);
  e.tod = tod; e.sun[0] = sx / l; e.sun[1] = sy / l; e.sun[2] = sz / l;
  const el = e.sun[1], day = smooth(-0.1, 0.14, el), gold = (1 - smooth(0.04, 0.5, el)) * day;
  e.day = day; e.night = 1 - smooth(-0.14, 0.05, el);
  m3(e.zen, [0.003, 0.006, 0.026], m3(tA, [0.07, 0.22, 0.68], [0.1, 0.13, 0.36], gold), day);
  m3(e.hor, [0.012, 0.02, 0.06], m3(tA, [0.42, 0.62, 0.92], [0.95, 0.46, 0.22], gold), day);
  k3(e.glow, m3(tA, [0.3, 0.24, 0.12], [1.5, 0.6, 0.16], gold), day);
  m3(e.cl, [0.03, 0.045, 0.1], m3(tA, [1.25, 1.25, 1.3], [1.3, 0.8, 0.55], gold), day);
  const sunC = m3(tB, [1, 0.94, 0.84], [1, 0.52, 0.22], gold);
  k3(e.sunK, sunC, day);
  if (el > -0.06) {
    // 太阳主光；方向的仰角有下限，避免阴影被拉得过长
    const k = smooth(-0.06, 0.1, el) * lerp(3.9, 3.2, gold), y = max(el, 0.24), q = hypot(e.sun[0], y, e.sun[2]);
    k3(e.LC, sunC, k); e.L[0] = e.sun[0] / q; e.L[1] = y / q; e.L[2] = e.sun[2] / q;
  } else { k3(e.LC, [0.4, 0.56, 1], 0.62 * smooth(-0.06, -0.24, el)); e.L[0] = e.moon[0]; e.L[1] = e.moon[1]; e.L[2] = e.moon[2]; }
  m3(e.as, [0.05, 0.075, 0.17], m3(tA, [0.62, 0.78, 1.1], [0.75, 0.55, 0.6], gold), day);
  m3(e.ag, [0.02, 0.028, 0.06], m3(tA, [0.3, 0.27, 0.22], [0.34, 0.2, 0.14], gold), day);
  e.fog = lerp(0.0046, lerp(0.003, 0.0042, gold), day);
  e.envI = lerp(1.1, 0.75, day);
}
