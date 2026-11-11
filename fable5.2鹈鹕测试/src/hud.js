// HUD：DOM 面板（血量/波次/分数/武器/技能）+ Canvas 2D 覆盖层（准星、伤害数字、血条、雷达、受击方向）
import { G } from './state.js';
import { project, pip, Q } from './gfx.js';
import { texts } from './fx.js';
import { WEAPONS, magOf } from './player.js';
import { avatarURL } from './signs.js';
import { ARENA, RING, PLAZA } from './world.js';
import { sin, cos, min, max, PI, TAU, hypot, clamp, abs } from './math.js';

export const $ = id => document.getElementById(id);
const cache = {}, set = (k, v, f) => { if (cache[k] !== v) { cache[k] = v; f(v); } };
let oc, c, dpr = 1, W = 1, H = 1, sayT = 0, hit = 0, hitK = 0;
const pr = [0, 0];

let pipN = 0;
export function initHud(img) {
  oc = $('o'); c = oc.getContext('2d');
  const a = avatarURL(img, 256);
  $('av').src = $('mav').src = a; document.querySelector('#say img').src = a;
  const l = document.createElement('link'); l.rel = 'icon'; l.href = avatarURL(img, 64); document.head.appendChild(l);
  $('ws').innerHTML = WEAPONS.map((w, i) => `<span>${i + 1} ${w.s}</span>`).join('');
}
export const show = (id, on) => $(id).classList.toggle('hide', !on);
export function banner(t, s = '') { const b = $('ban'); b.firstChild.textContent = t; b.lastChild.textContent = s; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
export function popup(t, col = '#fff') { const d = document.createElement('div'); d.textContent = t; d.style.color = col; const p = $('pop'); p.appendChild(d); while (p.children.length > 5) p.firstChild.remove(); setTimeout(() => d.remove(), 1650); }
export function say(t) { const s = $('say'); s.lastChild.textContent = t; s.classList.add('on'); sayT = 3.6; }

function resize() {
  dpr = min(window.devicePixelRatio || 1, 2);
  const w = oc.clientWidth, h = oc.clientHeight;
  if (w != W || h != H || oc.width != ((w * dpr) | 0)) { W = w; H = h; oc.width = (w * dpr) | 0; oc.height = (h * dpr) | 0; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function updateHud(rdt) {
  const p = G.pl;
  resize(); c.clearRect(0, 0, W, H);
  if (sayT > 0) { sayT -= rdt; if (sayT <= 0) $('say').classList.remove('on'); }
  if (G.state != 'play' && G.state != 'over' && G.state != 'perk') return;
  // 画中画的位置跟随 HUD 里的圆形头像框；画质不支持画中画时退回静态官方头像
  if (pipN++ % 12 == 0 || cache.pipon !== pip.on) { cache.pipon = pip.on; const r = $('cam').getBoundingClientRect(); pip.x = r.left + r.width / 2; pip.y = r.top + r.height / 2; pip.r = r.width / 2 - 3; set('pipimg', Q.pip && pip.on ? 1 : 0, v => ($('av').style.opacity = v ? 0 : 1)); }
  // ---- DOM ----
  set('hp', Math.ceil(p.hp), v => { $('hpn').textContent = v; $('hp').firstChild.style.transform = `scaleX(${max(p.hp / p.mhp, 0)})`; });
  set('st', (p.stam / 2) | 0, v => ($('st').firstChild.style.transform = `scaleX(${v / 50})`));
  set('buff', (p.boost > 0 ? '⚡ 火力全开 ' + p.boost.toFixed(0) + 's  ' : '') + (G.bt > 0 ? '🧠 深度思考' : ''), v => ($('buff').textContent = v));
  set('wv', G.wave, v => ($('wv').children[0].textContent = v));
  const alive = G.enemies.filter(e => !e.dead).length + (G.queue ? G.queue.length : 0);
  set('en', alive, v => ($('en').textContent = v ? `剩余 Bug：${v}` : '区域已清空'));
  const b = G.enemies.find(e => e.K.boss && !e.dead);
  set('boss', b ? ((b.hp / b.mhp) * 200) | 0 : -1, v => { show('boss', v >= 0); if (v >= 0) $('boss').querySelector('i').style.transform = `scaleX(${v / 200})`; });
  set('sc', G.score | 0, v => ($('sc').lastChild.textContent = v.toLocaleString()));
  set('cb', G.combo, v => { const e = $('cb'); e.textContent = v > 1 ? `连击 ×${v}　倍率 ${G.mult.toFixed(1)}` : ''; e.style.transform = 'scale(1.25)'; setTimeout(() => (e.style.transform = ''), 90); });
  $('cbb').style.transform = `scaleX(${G.combo > 1 ? clamp(G.comboT / 4.5, 0, 1) : 0})`;
  const w = p.wpn, W_ = WEAPONS[w];
  set('wn', w, () => { $('wn').textContent = W_.n; [...$('ws').children].forEach((e, i) => e.classList.toggle('on', i == w)); });
  set('am', p.rel > 0 ? -1 : p.ammo[w] * 100 + magOf(w), v => ($('am').innerHTML = v < 0 ? '<small>装填中…</small>' : `${p.ammo[w]}<small> / ${magOf(w)}</small>`));
  const ring = (id, k) => set(id, (k * 60) | 0, v => { const e = $(id); e.querySelector('circle').style.strokeDashoffset = 182.2 * (1 - v / 60); e.classList.toggle('rdy', v >= 60); });
  ring('sk1', 1 - clamp(p.bell / (7 * p.mods.bellCd), 0, 1)); ring('sk2', p.skill / 100);
  if (G.touch) { set('tb1', p.bell <= 0, v => $('tbe').classList.toggle('on', v)); set('tb2', p.skill >= 100, v => $('tsk').classList.toggle('on', v)); }
  // ---- 覆盖层 ----
  const cx = W / 2, cy = H / 2, cam = G.cam;
  // 伤害飘字
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  for (const t of texts) {
    if (!project(t.x, t.y, t.z, pr)) continue;
    const k = t.t / t.life, s = t.size * (k < 0.12 ? 0.6 + k * 5 : 1.2 - k * 0.3);
    c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1; c.font = `900 ${s}px system-ui,sans-serif`;
    c.lineWidth = 3.5; c.strokeStyle = 'rgba(10,18,40,.85)'; c.strokeText(t.s, pr[0], pr[1]); c.fillStyle = t.col; c.fillText(t.s, pr[0], pr[1]);
  }
  c.globalAlpha = 1;
  // 敌人血条
  for (const e of G.enemies) {
    if (e.dead || e.K.boss || e.hb <= 0 || !project(e.x, e.y + (e.K.fly ? e.r + 0.3 : e.r * 2 + 0.5), e.z, pr)) continue;
    const bw = 30 + e.r * 22, k = e.hp / e.mhp;
    c.fillStyle = 'rgba(10,18,40,.7)'; c.fillRect(pr[0] - bw / 2 - 1, pr[1] - 1, bw + 2, 6);
    c.fillStyle = k > 0.5 ? '#ff5d7d' : '#ffb020'; c.fillRect(pr[0] - bw / 2, pr[1], bw * k, 4);
    if (e.sh > 0) { c.fillStyle = '#ffb060'; c.fillRect(pr[0] - bw / 2, pr[1] - 4, bw * min(e.sh / 140, 1), 2.5); }
  }
  if (!p.dead && G.state == 'play' && !(G.cine > 0)) {
    // 准星：随连射热度与车速扩散；瞄到敌人变红
    const g = 7 + p.heat * 16 + min(p.spd / 20, 1) * 4 - p.ads * 3, tc = p.target ? '#ff4d6d' : '#fff';
    c.strokeStyle = 'rgba(10,18,40,.6)'; c.lineWidth = 4; c.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      c.beginPath();
      for (let i = 0; i < 4; i++) { const a = (i * PI) / 2, x = cos(a), y = sin(a); c.moveTo(cx + x * g, cy + y * g); c.lineTo(cx + x * (g + 7), cy + y * (g + 7)); }
      c.stroke(); c.strokeStyle = tc; c.lineWidth = 2;
    }
    c.fillStyle = tc; c.beginPath(); c.arc(cx, cy, 1.6, 0, TAU); c.fill();
    // 命中标记
    if (G.hitMark) { hit = 1; hitK = G.hitMark; G.hitMark = 0; }
    if (hit > 0) {
      hit -= rdt * 5; c.globalAlpha = max(hit, 0); c.strokeStyle = hitK >= 2 ? '#ff3d6e' : hitK > 1 ? '#ffd84a' : '#fff'; c.lineWidth = hitK >= 2 ? 3.5 : 2.5;
      const a = 9 + (1 - hit) * 5, b = a + (hitK >= 2 ? 10 : 7);
      c.beginPath(); for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { c.moveTo(cx + x * a, cy + y * a); c.lineTo(cx + x * b, cy + y * b); } c.stroke(); c.globalAlpha = 1;
    }
    // 换弹进度环
    if (p.rel > 0) { const k = 1 - p.rel / (WEAPONS[w].rel * p.mods.rel); c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 24, 0, TAU); c.stroke(); c.strokeStyle = '#7fd0ff'; c.beginPath(); c.arc(cx, cy, 24, -PI / 2, -PI / 2 + TAU * k); c.stroke(); }
    else if (p.ammo[w] <= magOf(w) * 0.25) { c.font = '800 12px system-ui'; c.fillStyle = '#ffd84a'; c.fillText(p.ammo[w] ? '弹药不足 · R 换弹' : '', cx, cy + 44); }
    // 受击方向
    if (p.hurtT > 0) {
      const a = cam.yaw - p.hurtA - PI / 2;
      c.strokeStyle = `rgba(255,60,90,${p.hurtT})`; c.lineWidth = 7; c.beginPath(); c.arc(cx, cy, 86, a - 0.35, a + 0.35); c.stroke();
    }
  }
  // ---- 雷达 ----
  const R = W < 760 || H < 520 ? 50 : 74, mx = 18 + R + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl')) || 0), my = H - 18 - R, s = R / 62;
  const fy = sin(cam.yaw), fz = cos(cam.yaw), mp = (x, z) => { const dx = x - p.x, dz = z - p.z; pr[0] = mx + (-dx * fz + dz * fy) * s; pr[1] = my - (dx * fy + dz * fz) * s; };
  c.save(); c.beginPath(); c.arc(mx, my, R, 0, TAU); c.fillStyle = 'rgba(12,24,54,.62)'; c.fill(); c.clip();
  mp(0, 0); const ox = pr[0], oy = pr[1];
  c.strokeStyle = 'rgba(160,200,255,.2)'; c.lineWidth = 10 * s; c.beginPath(); c.arc(ox, oy, RING * s, 0, TAU);
  for (const [x, z] of [[ARENA, 0], [0, ARENA]]) { mp(-x, -z); c.moveTo(pr[0], pr[1]); mp(x, z); c.lineTo(pr[0], pr[1]); } c.stroke();
  c.fillStyle = 'rgba(127,196,255,.3)'; c.beginPath(); c.arc(ox, oy, PLAZA * s, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(89,182,255,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(ox, oy, ARENA * s, 0, TAU); c.stroke();
  for (const k of G.pickups) { mp(k.x, k.z); c.fillStyle = k.k == 0 ? '#fff' : k.k == 1 ? '#7fd0ff' : '#ffd84a'; c.fillRect(pr[0] - 2, pr[1] - 2, 4, 4); }
  for (const e of G.enemies) {
    if (e.dead) continue; mp(e.x, e.z);
    const dx = pr[0] - mx, dy = pr[1] - my, d = hypot(dx, dy); if (d > R - 4) { pr[0] = mx + (dx / d) * (R - 4); pr[1] = my + (dy / d) * (R - 4); }
    c.fillStyle = e.K.boss ? '#ff2d9a' : e.k == 4 ? '#ff9a2a' : e.k == 0 ? '#ff6b8a' : '#ff3d4d'; c.beginPath(); c.arc(pr[0], pr[1], e.K.boss ? 6 : e.k == 4 ? 4 : e.k ? 3 : 2.2, 0, TAU); c.fill();
  }
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2; c.beginPath(); c.arc(mx, my, R, 0, TAU); c.stroke();
  // 玩家箭头（车头相对镜头的朝向）
  const ra = p.yaw - cam.yaw; c.save(); c.translate(mx, my); c.rotate(-ra);
  c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.restore();
}
