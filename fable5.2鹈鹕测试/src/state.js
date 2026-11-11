// 全局游戏状态：各模块共享同一个对象，避免循环依赖
export const G = {
  state: 'boot', // boot | menu | play | perk | pause | over
  t: 0, // 游戏时间（受时间缩放影响）
  rt: 0, // 真实时间
  ts: 1, // 世界时间缩放（子弹时间 / 顿帧）
  wave: 0, score: 0, best: 0, combo: 0, comboT: 0, kills: 0, mult: 1,
  enemies: [], shots: [], rockets: [], pickups: [],
  pl: null, cam: { yaw: 0, pitch: 0.1, dist: 5.2, x: 0, y: 3, z: 0, fov: 1.05, shake: 0, kick: 0, tx: 0, ty: 0, tz: 0 },
  tod: 0.14, // 一天中的时刻 0..1
  bt: 0, // 子弹时间剩余
  hitstop: 0,
  opt: { sens: 1, vol: 0.8, mus: 0.55, q: 'auto', autofire: 0 },
  touch: false, debug: false, auto: false,
  stat: { shots: 0, hits: 0, air: 0, ram: 0, crit: 0, dmg: 0, time: 0 },
  // 回调槽：由 game.js 填充
  onKill: null, onHurt: null, say: null, popup: null,
};
export const OPT_KEY = 'doubao.bike.v1';
export function loadOpt() {
  try { const o = JSON.parse(localStorage.getItem(OPT_KEY) || '{}'); Object.assign(G.opt, o.opt || {}); G.best = o.best || 0; } catch (e) { /* 隐私模式下 localStorage 不可用 */ }
}
export function saveOpt() {
  try { localStorage.setItem(OPT_KEY, JSON.stringify({ opt: G.opt, best: G.best })); } catch (e) { /* 忽略 */ }
}
