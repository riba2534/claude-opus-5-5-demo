// 入口：按 渲染 → 世界 → 角色 → 敌人 → 特效 → HUD → 输入 的顺序装配，然后进入主循环
import { G, loadOpt } from './state.js';
import { initGfx, stats, glInfo, view, resetDraws, qName } from './gfx.js';
import { buildWorld } from './world.js';
import { buildDoubao } from './doubao.js';
import { buildEnemies, spawnEnemy } from './enemies.js';
import { buildFx } from './fx.js';
import { initHud, $ } from './hud.js';
import { initInput } from './input.js';
import { initAudio } from './audio.js';
import { bindUI, buildPickups, toMenu, startGame, frame, step, applyQuality, getFps, setAutoQ } from './game.js';
import { endFrame, I } from './input.js';
import { hurtPlayer } from './player.js';

const qs = new URLSearchParams(location.search);
window.__errors = []; window.__ready = false;
addEventListener('error', e => window.__errors.push(String(e.message)));
addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
const fail = m => { $('boot').innerHTML = `<div><b>启动失败</b>${m}</div>`; };

function boot() {
  loadOpt();
  if (qs.get('q')) G.opt.q = qs.get('q');
  G.debug = qs.has('debug') || qs.has('auto') || qs.has('start'); G.auto = qs.has('auto');
  if (qs.has('tod')) G.debugTod = +qs.get('tod');
  if (qs.has('botw')) G.botW = +qs.get('botw');
  if (!initGfx($('c'), 'high')) return fail('当前浏览器不支持 WebGL2，请换用新版 Chrome / Edge / Safari。');
  applyQuality();
  buildWorld(+qs.get('seed') || 4207);
  buildDoubao(); buildEnemies(); buildFx(); buildPickups();
  initHud(); initInput($('c'), initAudio); bindUI();
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { G.touch = matchMedia('(pointer:coarse)').matches; if (G.touch) { document.body.classList.add('t'); setAutoQ('medium'); applyQuality(); } }
  toMenu();
  if (qs.has('start')) {
    startGame();
    if (qs.has('wave')) G.wave = +qs.get('wave') - 1, (G.queue = []), (G.clearT = 9);
    if (qs.has('god')) G.onHurt = () => {};
    if (qs.has('spawn')) { G.queue = []; G.clearT = 0; G.noWave = 1; qs.get('spawn').split(',').forEach((k, i) => spawnEnemy(+k, Math.sin(i * 1.3) * 7, 26 + i * 3.5)); }
  }
  let last = performance.now(), n = 0;
  const loop = now => {
    const rdt = Math.min((now - last) / 1000, 0.05); last = now;
    try { frame(Math.max(rdt, 0.001)); } catch (e) { if (window.__errors.length < 5) { window.__errors.push(String((e && e.stack) || e)); console.error(e); } }
    if (++n == 3) { window.__ready = true; const b = $('boot'); b.style.opacity = 0; setTimeout(() => b.remove(), 520); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // 调试钩子
  window.__G = G;
  window.__stats = () => ({ ...stats, fps: +getFps().toFixed(1), q: qName, gl: glInfo(), W: view.W, H: view.H, state: G.state, wave: G.wave, score: G.score | 0, enemies: G.enemies.length, shots: G.shots.length, hp: G.pl.hp | 0 });
  // 快进模拟：不渲染，只推进逻辑（用于自动化浸泡测试）
  window.__sim = (sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) { step(dt, 1); resetDraws(); endFrame(); } return window.__stats(); };
  window.__hurt = d => hurtPlayer(d, 0, 0);
  window.__I = I;
}
try { boot(); } catch (e) { window.__errors.push(String((e && e.stack) || e)); console.error(e); fail(String(e && e.message || e)); }
