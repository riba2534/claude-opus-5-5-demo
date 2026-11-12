// 游戏流程：波次、掉落、强化、连击计分、状态机与主循环
import { G, saveOpt } from './state.js';
import { I, pollInput, endFrame, releaseLock, requestLock } from './input.js';
import { PI, TAU, sin, cos, hypot, min, max, atan2, clamp, lerp, damp, wrapPi, rnd, random, pick, m4, T, ident, translate, rotY, rotX, rotZ, scale } from './math.js';
import { Geo, SPH, CYL, BOX, lathe, torus } from './geo.js';
import { render, setCam, draw, mesh, addLight, fx as post, setQuality, qName, cv, markDirty, pip, setGrassOn } from './gfx.js';
import { W, findSpot, groundH, zone } from './world.js';
import { env, updateEnv } from './env.js';
import { newPlayer, updatePlayer, hurtPlayer, WEAPONS, magOf } from './player.js';
import { updateEnemies, spawnEnemy, clearEnemies, KIND } from './enemies.js';
import { drawDoubao, drawBike, headPos, headCam, tube, E } from './doubao.js';
import * as FX from './fx.js';
import { S, initAudio, updateAudio, updateMusic, setIntensity, setListener, setVol, toggleMusic } from './audio.js';
import { $, show, banner, popup, say, updateHud } from './hud.js';

const PK = {};
export function buildPickups() {
  let g = new Geo();
  g.add(lathe([[0, 0], [0.22, 0.02], [0.34, 0.13], [0.3, 0.3], [0.17, 0.4], [0.05, 0.44], [0, 0.45]], 18), null, 0xfffaf0, 0.12, 0.4);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; tube(g, [cos(a) * 0.04, 0.45, sin(a) * 0.04], [cos(a + 0.5) * 0.27, 0.34, sin(a + 0.5) * 0.27], 0.016, 0xeadfc8, 0, 0.3, 0); }
  PK[0] = mesh(g, 0, 16);
  g = new Geo(); g.add(CYL, T(0, 0, 0, 0, 0, 0, 0.17, 0.5, 0.17), 0x2a3142, 0, 0.7, 3); g.add(CYL, T(0, 0.06, 0, 0, 0, 0, 0.18, 0.36, 0.18), 0x3fd0ff, 1, 0.5); g.add(CYL, T(0, 0.5, 0, 0, 0, 0, 0.07, 0.06, 0.07), 0xdfe5ee, 0, 0.8, 3);
  PK[1] = mesh(g, 0, 16);
  g = new Geo(); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; g.add(SPH, T(sin(a) * 0.16, 0.3 + cos(a) * 0.16, 0, 0, 0, -a, 0.09, 0.2, 0.07), 0xffd24a, 1, 0.6); } E(g, 0, 0.3, 0, 0.14, 0.14, 0.09, 0xffe680, 1, 0.6);
  PK[2] = mesh(g, 0, 8);
  g = new Geo(); g.add(SPH, null, 0xffffff, 1, 0.5); PK.lamp = mesh(g, 0, 16);
  g = new Geo(); E(g, 0, 0, 0, 0.09, 0.07, 0.24, 0x2a2c30, 0, 0.3); PK.bird = mesh(g, 0, 16);
  g = new Geo(); g.add(BOX, T(0.3, 0, 0, 0, 0, 0, 0.6, 0.015, 0.2), 0x33363b, 0, 0.3); PK.wing = mesh(g, 0, 32);
}

// ---------- 强化 ----------
const PERKS = [
  ['🔥', '火力增幅', '所有武器伤害 +22%', m => (m.dmg *= 1.22)],
  ['⚡', '快速扳机', '射速 +16%', m => (m.rof *= 1.16)],
  ['📦', '扩容弹匣', '弹匣容量 +35%，换弹加快 15%', m => { m.mag *= 1.35; m.rel *= 0.85; }],
  ['❤️', '钛合金车架', '生命上限 +30 并立即回复 30', (m, p) => { p.mhp += 30; p.hp = min(p.mhp, p.hp + 30); }],
  ['🚴', '碳纤维车轮', '车速 +9%，转向更灵活', m => { m.spd *= 1.09; m.turn *= 1.12; }],
  ['🧛', '吸取算力', '每次击杀回复 2 点生命', m => (m.steal += 2)],
  ['💥', '爆裂弹头', '子弹命中时 +9% 概率引发小爆炸', m => (m.boom += 0.09)],
  ['🔔', '车铃超频', '车铃冷却 -30%，范围 +30%', m => { m.bellCd *= 0.7; m.bellR *= 1.3; }],
  ['🧠', '思考加速', '深度思考充能速度 +45%', m => (m.skill *= 1.45)],
  ['🛡️', '冲撞装甲', '冲撞伤害 ×2，撞击几乎不掉速', m => (m.ram *= 2)],
  ['🪂', '空中杀手', '腾空时伤害 +50%，并获得二段跳', m => { m.air += 0.5; m.djump = 1; }],
  ['🔧', '自动修复', '脱战 4 秒后每秒回复 2.5 点生命', m => (m.regen += 2.5)],
  ['🧲', '掉落磁铁', '拾取范围 ×2，受到伤害 -10%', m => { m.magnet *= 2; m.armor *= 0.9; }],
];
let perkPick = null;
function offerPerks() {
  const pool = PERKS.slice().sort(() => random() - 0.5).slice(0, 3);
  G.state = 'perk'; releaseLock();
  $('pkt').textContent = `第 ${G.wave} 波已清空 · 按 1 / 2 / 3 或点击卡片`;
  $('pk').innerHTML = pool.map((p, i) => `<div class="pc card" data-i="${i}"><kbd>${i + 1}</kbd><em>${p[0]}</em><b>${p[1]}</b><span>${p[2]}</span></div>`).join('');
  perkPick = i => {
    const p = pool[i]; if (!p) return;
    p[3](G.pl.mods, G.pl); S.perk(); perkPick = null; show('perk', 0); G.state = 'play'; requestLock(cv);
    for (let w = 0; w < 4; w++) G.pl.ammo[w] = magOf(w);
    say(pick(['升级完成，我感觉自己更聪明了。', '收到！参数已更新。', '这个强化不错，继续修 Bug！'])); nextWave();
  };
  show('perk', 1);
}

// ---------- 波次 ----------
function compose(w) {
  if (w % 5 == 0) { const q = [5]; for (let i = 0; i < 3 + w / 5; i++) q.push(0, 0, i % 2 ? 1 : 2); return q; }
  let b = 5 + w * 3.2; const q = [], ws = [[0, 6, 1], [1, 3, 2], [2, 3, 3], [3, 2, 4], [4, 1.2, 6]].filter(t => w >= t[2]);
  while (b >= 1) {
    let r = random() * ws.reduce((s, t) => s + t[1], 0), k = 0;
    for (const t of ws) { r -= t[1]; if (r <= 0) { k = t[0]; break; } }
    if (KIND[k].cost > b) k = 0;
    q.push(k); b -= KIND[k].cost;
  }
  return q;
}
function nextWave() {
  const w = ++G.wave, boss = w % 5 == 0;
  G.queue = compose(w); G.spawnT = w == 1 ? 3.4 : 1.6; G.clearT = 0; G.cluster = null;
  banner(boss ? '⚠ 幻觉之王' : `第 ${w} 波`, boss ? '巨型幻觉正在逼近，瞄准它的眼睛！' : pick(['Bug 正在涌入街区', '保持移动，别被包围', '起跳台可以帮你甩开追兵', '绕到防火墙背后再开火']));
  S.wave(); if (boss) { S.roar(0, 10, 0); say('这个幻觉有点大……我会盯着它的弱点！'); G.pl.hp = min(G.pl.mhp, G.pl.hp + 30); } else if (w == 1) say(G.touch ? '你好，我是豆包！左侧摇杆骑车，右侧滑动瞄准，按住开火。' : '你好，我是豆包！W A S D 骑车，鼠标瞄准开火。');
  else if (w == 2) say('小心会开枪的乱码兵，骑起来它们就打不准。'); else if (w == 4) say(G.touch ? '有骑手追上来了，试试 🔔 车铃把它们震开！' : '有骑手追上来了，试试 F 键车铃把它们震开！'); else if (w == 6) say('防火墙正面有护盾，绕到背后打。');
}
function updateWaves(dt) {
  const p = G.pl, alive = G.enemies.filter(e => !e.dead).length;
  if (G.noWave) return;
  if (G.queue.length) {
    G.spawnT -= dt;
    if (G.spawnT <= 0 && alive < min(9 + G.wave * 2, 36)) {
      const k = G.queue.shift();
      let x, z;
      // Bug 成群从同一个点位冒出来
      if (k == 0 && G.cluster && G.cluster.n > 0) { G.cluster.n--; x = G.cluster.x + rnd(-3, 3); z = G.cluster.z + rnd(-3, 3); }
      else { [x, z] = KIND[k].boss ? findSpot(0, 0, 30, 50, 4) : findSpot(p.x, p.z, 30, 60, KIND[k].r + 0.6); if (k == 0) G.cluster = { x, z, n: 3 }; }
      spawnEnemy(k, x, z); G.spawnT = KIND[k].boss ? 2 : k == 0 ? 0.22 : 0.55;
    }
  } else if (!alive && !p.dead) {
    if (!G.clearT) { G.clearT = 0.001; S.clear(); banner('区域已清空', `波次奖励 +${G.wave * 100}`); G.score += G.wave * 100; p.hp = min(p.mhp, p.hp + 18); G.shots.length = 0; if (G.wave % 5 == 0) say('幻觉已消除！这才是事实核查的力量。'); }
    G.clearT += dt; if (G.clearT > 2.6) offerPerks();
  }
}

// ---------- 击杀结算与掉落 ----------
let lastKill = 0, multi = 0;
function onKill(e, kind, crit) {
  const p = G.pl, K = e.K;
  G.kills++; G.combo++; G.comboT = 4.5; G.mult = 1 + min(G.combo, 40) * 0.1;
  if (G.rt - (G.lookAt || -9) > 7 && (K.cost >= 3 || G.combo % 5 == 0)) { G.lookAt = G.rt; p.lookT = 1.25; }
  let sc = K.sc * G.mult, tag = '';
  if (!p.gnd && p.airT > 0.25) { sc *= 1.5; tag = '空中击杀'; G.stat.air++; }
  if (kind == 2) { sc += 25; tag = tag || '单车冲撞'; }
  if (G.rt - lastKill < 0.7) { multi++; if (multi == 2) tag = '三连击'; else if (multi == 4) tag = '五连击！'; else if (multi == 7) tag = '清场大师！'; } else multi = 0;
  lastKill = G.rt;
  if (tag) popup(`${tag} +${sc | 0}`, '#ffd84a');
  G.score += sc; p.skill = min(100, p.skill + (K.boss ? 100 : 6 + K.cost * 2.5) * p.mods.skill);
  if (p.mods.steal) p.hp = min(p.mhp, p.hp + p.mods.steal);
  if (K.cost >= 4 || K.boss) { G.hitstop = K.boss ? 0.25 : 0.07; G.cam.shake = max(G.cam.shake, K.boss ? 1.4 : 0.5); }
  S.kill(K.cost >= 3);
  const drop = (k, n = 1) => { for (let i = 0; i < n; i++) G.pickups.push({ k, x: e.x + rnd(-1, 1) * (n > 1 ? 4 : 0.5), z: e.z + rnd(-1, 1) * (n > 1 ? 4 : 0.5), y: 0, t: 0, vy: 6 }); };
  if (K.boss) { drop(0, 4); drop(1, 2); drop(2, 1); popup('幻觉之王 已消除 +' + (sc | 0), '#ff7ab8'); }
  else {
    const r = random();
    if (r < 0.12 + (p.hp < p.mhp * 0.4 ? 0.13 : 0) + (e.k == 4 ? 0.6 : 0)) drop(0); else if (r > 0.9) drop(1); else if (r > 0.865 && r < 0.9) drop(2);
  }
  if (G.kills == 1) say('已修复 1 个 Bug ✅ 保持这个节奏！'); else if (G.combo == 10) say('连击 ×10！你的手感比我的推理还稳。'); else if (G.combo == 25) say('连击 ×25，这段可以写进最佳实践了。');
}
const pm = m4();
function updatePickups(dt, rdt) {
  const p = G.pl, A = G.pickups;
  for (let i = A.length - 1; i >= 0; i--) {
    const k = A[i]; k.t += dt;
    const gh = groundH(k.x, k.z), dx = p.x - k.x, dz = p.z - k.z, d = hypot(dx, dz);
    k.vy -= 18 * dt; k.y = max(gh, k.y + k.vy * dt); if (k.y <= gh && k.vy < -1) k.vy *= -0.4;
    if (d < 5.5 * p.mods.magnet && !p.dead) { const v = min(26, 60 / (d + 0.5)) * dt; k.x += (dx / d) * v; k.z += (dz / d) * v; }
    if (d < 1.4 && abs_(p.y - k.y) < 2.5 && !p.dead) {
      if (k.k == 0) { p.hp = min(p.mhp, p.hp + 22); FX.text(p.x, p.y + 2, p.z, '+22', '#7dff9a', 20, 0.9); }
      else if (k.k == 1) { p.skill = min(100, p.skill + 34); FX.text(p.x, p.y + 2, p.z, '充能', '#7fd0ff', 18, 0.9); }
      else { p.boost = 9; popup('火力全开：双倍伤害 9 秒', '#ffd84a'); say('火力全开！趁现在清场。'); }
      S.pick(k.k); FX.ring(p.x, p.y + 1, p.z, 0.4, 3, k.k == 0 ? 0.4 : 0.5, k.k == 0 ? 2 : 1.3, k.k == 2 ? 0.3 : 2.4, 0.35);
      A.splice(i, 1); continue;
    }
    if (k.t > 26) { A.splice(i, 1); continue; }
    if (k.t > 21 && sin(k.t * 16) > 0) continue;
    ident(pm); translate(pm, k.x, k.y + 0.45 + sin(k.t * 3) * 0.12, k.z); rotY(pm, k.t * 2); scale(pm, 1.5, 1.5, 1.5);
    draw(PK[k.k], pm, 1, 1, 1, 0);
    const c = k.k == 0 ? [1.2, 1, 0.7] : k.k == 1 ? [0.3, 1, 2] : [2, 1.5, 0.3];
    if (random() < rdt * 6) FX.spawn(k.x + rnd(-0.3, 0.3), k.y + 0.4, k.z + rnd(-0.3, 0.3), 0, rnd(1, 2.5), 0, 0.7, 0.16, 0.02, c[0] * 2, c[1] * 2, c[2] * 2);
    if (i < 4) addLight(k.x, k.y + 0.8, k.z, 4.5, c[0], c[1], c[2]);
  }
}
const abs_ = Math.abs;

// ---------- 状态切换 ----------
export function startGame() {
  initAudio(); clearEnemies(); FX.clearFx(); G.pickups.length = 0;
  Object.assign(G, { wave: 0, score: 0, combo: 0, comboT: 0, kills: 0, mult: 1, bt: 0, hitstop: 0, t: 0, queue: [], clearT: 0 });
  G.stat = { shots: 0, hits: 0, air: 0, ram: 0, crit: 0, dmg: 0, time: 0 };
  const p = newPlayer(); p.x = 0; p.z = 12; p.yaw = 0; G.cam.yaw = 0; G.cam.pitch = -0.12; G.cam.dist = 5.3;
  G.tod = 0.12; G.state = 'play'; G.cine = 2.8; G.orb = PI * 0.95; G.orbT = PI * 0.95;
  show('menu', 0); show('over', 0); show('pause', 0); show('perk', 0); show('hud', 1);
  requestLock(cv); nextWave();
}
function gameOver() {
  G.state = 'over'; releaseLock(); S.over(); setIntensity(0);
  const s = G.stat, acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0, nb = G.score > G.best;
  if (nb) { G.best = G.score | 0; saveOpt(); }
  $('ot').textContent = nb ? '新纪录！豆包为你鼓掌 👏' : '豆包需要充会儿电…';
  $('osay').textContent = G.wave >= 10 ? '太强了，这座城市的 Bug 基本被你修完了。要不要再挑战一次更高分？' : G.wave >= 5 ? '你已经见过幻觉之王了！下次试试绕着它骑，激光可以跳过去。' : '小提示：一直骑着别停，敌人的子弹就很难打中你；F 键车铃可以清掉弹幕。';
  $('os').innerHTML = [['到达波次', G.wave], ['得分', (G.score | 0).toLocaleString()], ['修复 Bug', G.kills], ['命中率', acc + '%'], ['弱点命中', s.crit], ['空中击杀 / 冲撞', s.air + ' / ' + s.ram], ['存活时间', (s.time | 0) + ' 秒'], ['历史最高', (G.best | 0).toLocaleString()]].map(a => `<div>${a[0]}<b>${a[1]}</b></div>`).join('');
  $('best').textContent = (G.best | 0).toLocaleString();
  G.overT = 0;
}
export function toMenu() {
  G.state = 'menu'; releaseLock(); clearEnemies(); FX.clearFx(); G.pickups.length = 0; newPlayer(); setIntensity(0);
  show('menu', 1); show('over', 0); show('pause', 0); show('perk', 0); show('hud', 0); $('best').textContent = (G.best | 0).toLocaleString(); post.dmg = post.bt = post.spd = 0;
}
function pause(on) {
  if (on && G.state == 'play') { G.state = 'pause'; releaseLock(); show('pause', 1); }
  else if (!on && G.state == 'pause') { G.state = 'play'; show('pause', 0); requestLock(cv); }
}
export function bindUI() {
  const o = G.opt;
  $('go').onclick = () => { S.ui(); startGame(); }; $('again').onclick = () => startGame(); $('home').onclick = $('quit').onclick = () => toMenu(); $('res').onclick = () => pause(0);
  $('pk').onclick = e => { const c = e.target.closest('.pc'); if (c && perkPick) perkPick(+c.dataset.i); };
  $('oq').value = o.q; $('os1').value = o.sens; $('ov').value = o.vol; $('om').value = o.mus; $('oa').checked = !!o.autofire;
  $('oq').onchange = e => { o.q = e.target.value; applyQuality(); saveOpt(); };
  $('os1').oninput = e => { o.sens = +e.target.value; saveOpt(); }; $('ov').oninput = e => { o.vol = +e.target.value; setVol(); saveOpt(); };
  $('om').oninput = e => { o.mus = +e.target.value; setVol(); saveOpt(); }; $('oa').onchange = e => { o.autofire = e.target.checked ? 1 : 0; saveOpt(); };
  G.onKill = onKill; G.onHurt = hurtPlayer; G.onDeath = null; G.say = say; G.popup = popup;
  G.onAir = t => { const s = (t * 40) | 0; G.score += s; popup(`大跳 ${t.toFixed(1)} 秒 +${s}`, '#7fd0ff'); };
  addEventListener('resize', markDirty);
  document.addEventListener('visibilitychange', () => document.hidden && pause(1));
}
// 自动画质：从"高"开始，帧时间持续偏高就逐级下调
let autoQ = 'high', slow = 0, fps = 60;
export const setAutoQ = q => (autoQ = q);
export function applyQuality() { setQuality(G.opt.q == 'auto' ? autoQ : G.opt.q); }
function adapt(rdt) {
  fps = lerp(fps, 1 / max(rdt, 0.001), 0.05);
  if (G.opt.q != 'auto' || G.debug) return;
  slow = fps < 44 ? slow + rdt : max(0, slow - rdt * 0.5);
  if (slow > 2.5) { slow = 0; const o = ['ultra', 'high', 'medium', 'low'], i = o.indexOf(qName); if (i < 3) { autoQ = o[i + 1]; applyQuality(); } }
}
export const getFps = () => fps;

// ---------- 自动驾驶（调试/演示用）：绕圈骑行并射击最近的敌人 ----------
function bot() {
  const p = G.pl, c = G.cam; let best = null, bd = 1e9;
  for (const e of G.enemies) { if (e.dead) continue; const d = hypot(e.x - p.x, e.z - p.z) - (e.K.boss ? 20 : 0); if (d < bd) { bd = d; best = e; } }
  I.mz = 1; I.mx = sin(G.rt * 0.5) > 0 ? 0.9 : -0.9; I.sprint = bd < 9 ? 1 : 0; I.fire = 0;
  if (hypot(p.x, p.z) > 95) { const a = wrapPi(atan2(-p.x, -p.z) - c.yaw); I.mz = cos(a); I.mx = -sin(a); }
  if (best) {
    const ty = best.y + (best.K.fly ? 0 : best.r) - c.y, d = hypot(best.x - c.x, best.z - c.z);
    c.yaw = wrapPi(c.yaw + wrapPi(atan2(best.x - c.x, best.z - c.z) - c.yaw) * 0.3); c.pitch += (atan2(ty, d) - c.pitch) * 0.3;
    I.fire = 1; const w = G.botW != null ? G.botW : bd > 30 ? 2 : bd < 12 ? 1 : 0; if (p.wpn != w) I.wsel = w;
  }
  if (random() < 0.01) I.jump = 1; if (bd < 6) I.bell = 1; if (p.skill >= 100) I.skill = 1;
}

// ---------- 主循环 ----------
const IM = m4(), bm = m4(), dm = m4();
let menuA = 0;
// 场景里一直在动的东西：共享单车、红绿灯、喷泉、落樱、飞鸟、能量墙、纪念碑气泡
function ambient(rdt, p) {
  const c = G.cam, t = G.rt;
  for (const b of W.bikes) { if (b[7] === undefined) b[7] = groundH(b[0], b[1]); if (hypot(b[0] - c.x, b[1] - c.z) < 50) drawBike(b[0], b[7], b[1], b[2], b[3], b[4], b[5], b[6]); }
  // 红绿灯：14 秒一个周期，绿 → 黄 → 红
  for (const l of W.tl) {
    const k = (t / 14 + l.ph) % 1, st = k < 0.45 ? 0 : k < 0.52 ? 1 : 2;
    ident(dm); translate(dm, l.x, l.y + (st - 1) * 0.36, l.z); scale(dm, 0.12, 0.12, 0.12);
    draw(PK.lamp, dm, st == 0 ? 0.1 : 1, st == 2 ? 0.08 : st == 1 ? 0.7 : 1, st == 0 ? 0.35 : 0.05, 0);
  }
  // 喷泉水柱
  if (hypot(c.x, c.z) < 110) for (const j of W.jets) {
    if (random() < rdt * 26) { const a = atan2(-j[2], -j[0]) + rnd(-0.25, 0.25), v = rnd(0.9, 1.5); FX.spawn(j[0], j[1], j[2], cos(a) * v, rnd(6.6, 8), sin(a) * v, 1.35, 0.1, 0.3, 0.55, 0.7, 0.85, 0.35, 0, 0.15, 12); }
    if (random() < rdt * 5) FX.spawn(j[0] + rnd(-0.4, 0.4), 0.5, j[2] + rnd(-0.4, 0.4), rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3), 1.4, 0.4, 1.3, 0.8, 0.86, 0.92, 0.12, 1, 0.5, -0.2);
  }
  // 樱花花瓣：从附近的樱花树上飘落
  if (W.sak.length) for (let i = 0; i < 3; i++) {
    const s = W.sak[(random() * W.sak.length) | 0];
    if (hypot(s[0] - c.x, s[2] - c.z) < 55 && random() < rdt * 22) { const k = 1 - 0.75 * env.night; FX.spawn(s[0] + rnd(-2.6, 2.6), s[1] + rnd(-1.5, 1), s[2] + rnd(-2.6, 2.6), rnd(-0.9, 0.9), rnd(-0.6, 0), rnd(-0.9, 0.9), rnd(4, 6), 0.05, 0.05, 1 * k, 0.72 * k, 0.8 * k, 0.9, 3, 0.9, 0.5); }
  }
  // 飞鸟：绕着城市盘旋，翅膀上下扇动
  for (let i = 0; i < 9; i++) {
    const a = t * (0.1 + (i % 3) * 0.018) + i * 0.71, r = 46 + i * 7, x = cos(a) * r, z = sin(a) * r, y = 32 + sin(t * 0.3 + i) * 4 + (i % 4) * 3, fl = sin(t * 9 + i * 2) * 0.7;
    ident(dm); translate(dm, x, y, z); rotY(dm, -a); scale(dm, 1.6, 1.6, 1.6); draw(PK.bird, dm, 1, 1, 1, 0);
    for (const sd of [1, -1]) { ident(bm); translate(bm, x, y, z); rotY(bm, -a + (sd < 0 ? PI : 0)); rotZ(bm, fl * sd * (sd < 0 ? -1 : 1)); scale(bm, 1.6, 1.6, 1.6); draw(PK.wing, bm, 1, 1, 1, 0); }
  }
  draw(W.wall, IM, 1, 1, 1, 0.55 + 0.25 * env.night);
  ident(bm); translate(bm, 0, 7.7 + sin(t * 0.8) * 0.25, 0); rotY(bm, t * 0.35);
  draw(W.bubble, bm, 1, 1, 1, 0); W.bubbleSign.matrix.fromArray(bm); W.bubbleSign.matrixWorldNeedsUpdate = true;
  if (env.night > 0.2) addLight(0, 7.5, 0, 20, 0.6 * env.night, 1.2 * env.night, 2.4 * env.night);
  // 画中画镜头：固定在车头前方回看豆包
  pip.on = G.state == 'play' && !(G.cine > 0) && Math.abs(G.orb || 0) < 0.6 ? 1 : 0; // 主镜头已经在拍正面时（开场、选强化、结算）不用再画一遍
  // 相机 30 米内有草地分区才提交草丛
  let gr = 0; for (let i = 0; i < 17 && !gr; i++) { const a = i * 0.785, d = i ? (i > 8 ? 15 : 30) : 0, zn = zone(c.x + cos(a) * d, c.z + sin(a) * d); gr = zn == 1 || zn == 4; }
  setGrassOn(gr);
  const q = pip.cam;
  q[0] = headCam[0]; q[1] = headCam[1]; q[2] = headCam[2]; q[3] = headPos[0]; q[4] = headPos[1] - 0.02; q[5] = headPos[2];
}
export function step(rdt, sim) {
  G.rt += rdt;
  if (G.state == 'pause') { if (I.pause) pause(0); return 0; }
  if (G.state == 'perk') { if (I.wsel >= 0 && I.wsel < 3 && perkPick) perkPick(I.wsel); else if (G.auto && perkPick) perkPick(0); I.wsel = -1; I.wnext = 0; } // 选强化用掉的数字键不再当作切枪
  if (I.music) toggleMusic();
  G.tod = (G.tod + rdt / 400) % 1; updateEnv(G.debugTod ?? G.tod);
  const p = G.pl;
  if (G.state == 'menu') {
    // 待机画面：豆包绕着广场骑行，镜头环绕
    menuA += rdt * 0.42; const r = 15.5, v = 0.42 * r;
    p.x = sin(menuA) * r; p.z = cos(menuA) * r; p.y = 0; p.yaw = menuA + PI / 2; p.wheel += (v / 0.29) * rdt; p.crank += (v / 0.29 / 2.3) * rdt;
    const ca = p.yaw + sin(G.rt * 0.22) * 1.1 - 0.25, cx = p.x + sin(ca) * 3.6, cz = p.z + cos(ca) * 3.6;
    G.cam.x = cx; G.cam.z = cz;
    setCam(cx, 1.6 + sin(G.rt * 0.3) * 0.2, cz, p.x, 1.18, p.z, 0.8); post.mbNear = 9;
    drawDoubao({ x: p.x, y: 0, z: p.z, yaw: p.yaw, pitch: 0, lean: 0.11, steer: 0.06, wheel: p.wheel, crank: p.crank, aimY: 0.3, aimP: 0.1, recoil: 0, sprint: 0, wpn: ((G.rt / 6) | 0) % 4, look: 1, camY: wrapPi(atan2(cx - p.x, cz - p.z) - p.yaw) });
    FX.updateFx(rdt, rdt);
  } else if (G.state == 'perk') {
    // 选强化时场景继续运转，镜头绕到正面
    G.orbT = PI * 0.9 + sin(G.rt * 0.5) * 0.35; I.mx = I.mz = 0;
    // 场景继续运转，但增益倒计时和补给的过期时间在选择期间不走
    const b0 = p.boost; updatePlayer(rdt, rdt); p.boost = b0; updateEnemies(rdt); updatePickups(rdt, rdt);
    for (const k of G.pickups) k.t = min(k.t, 20);
    FX.updateFx(rdt, rdt);
    if (!sim) updateAudio(rdt, p.spd, p.coast, !p.gnd);
  } else {
    if (I.pause && G.state == 'play') { pause(1); return 0; }
    if (G.auto && G.state == 'play') bot();
    // 开场镜头先在正面停留，再甩到身后；倒地后绕回正面
    if (G.cine > 0) { G.cine -= rdt; G.orbT = G.cine > 1 ? PI * 0.95 : 0; if (G.cine > 1) I.mx = I.mz = 0; } else G.orbT = p.dead ? PI * 0.85 : 0;
    // 倒地约 1 秒后进入结算，再过 1.6 秒弹出结算面板（按模拟时间推进，不依赖定时器）
    if (G.state == 'play' && p.dead > 0.55) gameOver();
    if (G.state == 'over' && G.overT < 9 && (G.overT += rdt) > 1.6) { G.overT = 9; show('over', 1); }
    G.hitstop = max(0, G.hitstop - rdt);
    const hs = G.hitstop > 0 ? 0.06 : 1, slowmo = p.dead ? 0.35 : 1;
    if (G.bt > 0) { G.bt -= rdt; if (G.bt <= 0) S.skill(0); }
    const dt = rdt * hs * slowmo * (G.bt > 0 ? 0.3 : 1), pdt = rdt * hs * slowmo * (G.bt > 0 ? 0.78 : 1);
    G.t += dt; if (!p.dead) G.stat.time += rdt;
    updatePlayer(pdt, rdt);
    updateEnemies(dt);
    updatePickups(dt, rdt);
    if (G.state == 'play') updateWaves(dt);
    FX.updateFx(dt, rdt);
    if (G.combo && (G.comboT -= dt) <= 0) { G.combo = 0; G.mult = 1; }
    const boss = G.enemies.some(e => e.K.boss && !e.dead);
    setIntensity(G.state != 'play' ? 0 : boss ? 3 : G.enemies.length > 9 || G.wave > 3 ? 2 : 1);
    if (!sim) updateAudio(rdt, p.spd, p.coast, !p.gnd);
  }
  ambient(rdt, p);
  return 1;
}
export function frame(rdt) {
  pollInput(rdt);
  const live = step(rdt);
  if (live) {
    const p = G.pl, c = G.cam;
    // 调试：?headcam=角度,距离,高度[,注视点上移,视角,注视点前移,注视点左移] 让镜头绕着豆包看（0 为正前方）
    if (G.dbgCam) { const [a, d, h, ly = 0, fov = 0.6, lf = 0, ls = 0] = G.dbgCam, y = p.yaw + a, tx = headPos[0] + sin(p.yaw) * lf + cos(p.yaw) * ls, tz = headPos[2] + cos(p.yaw) * lf - sin(p.yaw) * ls; setCam(tx + sin(y) * d, headPos[1] + h + ly, tz + cos(y) * d, tx, headPos[1] - 0.03 + ly, tz, fov); }
    setListener(c.x, c.y, c.z, -cos(c.yaw), sin(c.yaw));
    render(env, G.rt, rdt, p.x, p.y, p.z);
    adapt(rdt);
  }
  updateMusic();
  updateHud(rdt);
  endFrame();
}
