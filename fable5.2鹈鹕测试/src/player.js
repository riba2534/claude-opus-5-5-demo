// 玩家：单车物理（加速、转向压弯、坡道起跳、平台骑行、碰撞滑移）、武器射击、技能、第三人称相机
import { G } from './state.js';
import { I } from './input.js';
import { PI, TAU, sin, cos, abs, hypot, min, max, atan2, clamp, lerp, damp, dampAng, wrapPi, rnd, random, ceil, sqrt, smooth, m4, ident, translate, rotY, rotX } from './math.js';
import { groundH, resolve, raycast, rayN } from './world.js';
import * as FX from './fx.js';
import { S } from './audio.js';
import { drawDoubao, muzzle } from './doubao.js';
import { addLight, fx as post, setCam, draw } from './gfx.js';
import { damageEnemy, rayEnemies, meshOf } from './enemies.js';
import { env } from './env.js';

const GRAV = 20, VMAX = 13.2, SPRINT = 1.42, ACC = 11, JUMP = 7.6, WR = 0.29;
export const WEAPONS = [
  { n: '豆豆冲锋枪', s: 'SMG', dmg: 13, rof: 12.5, mag: 40, rel: 1.25, spr: 0.016, pel: 1, col: [0.3, 0.85, 1], kick: 0.011, heat: 0.09, range: 150, w: 0.07 },
  { n: '爆米花霰弹枪', s: '霰弹', dmg: 10, rof: 1.4, mag: 6, rel: 1.7, spr: 0.07, pel: 10, col: [1, 0.72, 0.28], kick: 0.05, heat: 0.4, range: 70, w: 0.06, fall: 1 },
  { n: '深度思考磁轨炮', s: '磁轨', dmg: 150, rof: 0.95, mag: 4, rel: 2, spr: 0.001, pel: 1, col: [0.72, 0.45, 1], kick: 0.07, heat: 0.5, range: 240, w: 0.3, pierce: 1 },
  { n: '灵感火箭筒', s: '火箭', dmg: 130, rof: 0.85, mag: 3, rel: 2.3, spr: 0.004, pel: 1, col: [1, 0.82, 0.3], kick: 0.08, heat: 0.5, range: 200, w: 0, rocket: 1 },
];
export const magOf = w => Math.round(WEAPONS[w].mag * G.pl.mods.mag);

export function newPlayer() {
  return (G.pl = {
    x: 0, y: 0, z: 10, yaw: 0, spd: 0, vy: 0, gnd: 1, lean: 0, pitch: 0, steer: 0, wheel: 0, crank: 0, coast: 1, airT: 0, jumps: 0, squash: 0, sprint: 0, nx: 0, nz: 0,
    hp: 100, mhp: 100, stam: 100, stamT: 0, tired: 0, wpn: 0, ammo: WEAPONS.map(w => w.mag), rel: 0, fireT: 0, recoil: 0, heat: 0, ads: 0,
    aimY: 0, aimP: 0, target: null, aimD: 50, inv: 0, hurtT: 0, hurtA: 0, skill: 0, bell: 0, boost: 0, dead: 0, blinkT: 2, blink: 1, bonkT: 0, regenT: 0, turn: 0, nod: 0,
    mods: { dmg: 1, rof: 1, mag: 1, rel: 1, spd: 1, turn: 1, steal: 0, regen: 0, ram: 1, air: 1, bellR: 1, bellCd: 1, skill: 1, boom: 0, djump: 0, magnet: 1, armor: 1 },
  });
}

// 玩家受伤（sx,sz 为伤害来源位置，用于方向指示）
export function hurtPlayer(dmg, sx, sz, inv = 0) {
  const p = G.pl;
  if (p.dead || p.inv > 0 || G.state != 'play') return;
  dmg *= p.mods.armor;
  p.hp -= dmg; p.hurtT = 1; p.hurtA = atan2(sx - p.x, sz - p.z); p.inv = inv; p.regenT = 4;
  G.cam.shake = max(G.cam.shake, 0.5); S.hurt(); G.combo = max(0, G.combo - 2);
  FX.sparks(p.x, p.y + 1, p.z, 0, 0.5, 0, 6, 1, 0.3, 0.3, 6);
  if (p.hp <= 0) { p.hp = 0; p.dead = 0.001; G.cam.shake = 1.2; FX.boom(p.x, p.y + 0.6, p.z, 0.8, 0.4, 0.7, 1); S.boom(p.x, p.y, p.z, 0.8); G.onDeath && G.onDeath(); }
  else if (p.hp < 30 && G.say && random() < 0.5) G.say('我有点撑不住了，快去捡个豆包回血！');
}

const cf = [0, 0, 1], cs = [0, 0, 0]; // 相机前向、射线起点
function camBasis() { const c = G.cam, cp = cos(c.pitch + c.kick); cf[0] = sin(c.yaw) * cp; cf[1] = sin(c.pitch + c.kick); cf[2] = cos(c.yaw) * cp; }

function explode(x, y, z, dmg, R = 6.5) {
  const p = G.pl; let any = 0;
  FX.boom(x, y, z, 1.1, 1, 0.75, 0.25); S.boom(x, y, z, 1); G.cam.shake = max(G.cam.shake, clamp(1.3 - hypot(p.x - x, p.z - z) / 25, 0, 1));
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - x, dy = e.y + (e.K.fly ? 0 : e.r) - y, dz = e.z - z, d = hypot(dx, dy, dz), rr = R + e.r;
    if (d < rr) { const h = hypot(dx, dz) || 1; any = 1; damageEnemy(e, dmg * (0.35 + 0.65 * (1 - d / rr)), 0, e.x, e.y + e.r, e.z, dx / h, dz / h, 1); }
  }
  if (any && R > 5) { G.stat.hits++; G.hitMark = 1; }
  for (const s of G.shots) if (hypot(s.x - x, s.y - y, s.z - z) < R) s.life = 0, s.hp = 0;
  // 火箭跳：离爆点近会被掀飞，只受少量伤害
  const d = hypot(p.x - x, p.y + 0.6 - y, p.z - z);
  if (d < 4.2 && !p.dead) { p.vy = max(p.vy, 0) + 9.5 * (1 - d / 5); p.gnd = 0; p.spd += 4 * (1 - d / 4.2); hurtPlayer(6 * (1 - d / 4.2), x, z); G.popup && G.popup('火箭跳', '#ffd24a'); }
}

function fire(p, w) {
  const m = p.mods, c = G.cam, W = WEAPONS[w];
  p.ammo[w]--; p.fireT = 1 / (W.rof * m.rof * (p.boost > 0 ? 1.25 : 1)); p.recoil = 1; c.kick += W.kick; G.stat.shots++;
  c.shake = max(c.shake, W.kick * 4);
  S.shoot(w);
  const [mx, my, mz] = muzzle, C = W.col;
  FX.flash(mx, my, mz, 8, C[0] * 4, C[1] * 4, C[2] * 4, 0.06);
  FX.spawn(mx, my, mz, 0, 0, 0, 0.05, 0.55 + W.kick * 6, 0.2, C[0] * 5, C[1] * 5, C[2] * 5, 0, 4);
  if (w < 2) FX.debris(mx - cf[0] * 0.2, my, mz - cf[2] * 0.2, -cf[2] * 2 + rnd(-1, 1), 3 + rnd(2), cf[0] * 2 + rnd(-1, 1), 0.09, 1, 1, 1, 2, 1.2);
  const spr = W.spr * (1 + p.heat * 1.6) * (1 - p.ads * 0.5) * (1 + min(p.spd / 20, 1) * 0.25);
  p.heat = min(p.heat + W.heat, 1);
  const base = W.dmg * m.dmg * (p.gnd ? 1 : m.air) * (p.boost > 0 ? 2 : 1);
  if (W.rocket) {
    const tx = cs[0] + cf[0] * p.aimD - mx, ty = cs[1] + cf[1] * p.aimD - my, tz = cs[2] + cf[2] * p.aimD - mz, l = hypot(tx, ty, tz) || 1;
    G.rockets.push({ x: mx, y: my, z: mz, vx: (tx / l) * 48, vy: (ty / l) * 48, vz: (tz / l) * 48, life: 3.5, dmg: base });
    return;
  }
  // 以相机的右/上向量构造散布
  const rx = -cos(c.yaw), rz = sin(c.yaw), ux = -cf[1] * sin(c.yaw), uy = hypot(cf[0], cf[2]), uz = -cf[1] * cos(c.yaw);
  let any = 0;
  for (let i = 0; i < W.pel; i++) {
    const a = rnd(TAU), q = sqrt(random()) * spr, sx = cos(a) * q, sy = sin(a) * q;
    let dx = cf[0] + rx * sx + ux * sy, dy = cf[1] + uy * sy, dz = cf[2] + rz * sx + uz * sy; const l = hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const wd = raycast(cs[0], cs[1], cs[2], dx, dy, dz, W.range), nx = rayN[0], ny = rayN[1], nz = rayN[2];
    const hits = rayEnemies(cs[0], cs[1], cs[2], dx, dy, dz, wd, G.touch ? 0.35 : 0.06);
    let end = wd;
    if (W.pierce) {
      for (const h of hits) { any = 1; hitTarget(h, base, dx, dy, dz, W); }
    } else {
      let b = null; for (const h of hits) if (!b || h.t < b.t) b = h;
      if (b) { end = b.t; any = 1; hitTarget(b, base * (W.fall ? clamp(1.25 - b.t / 42, 0.35, 1) : 1), dx, dy, dz, W); }
    }
    const ex = cs[0] + dx * end, ey = cs[1] + dy * end, ez = cs[2] + dz * end;
    if (end >= wd - 0.01 && wd < W.range) { FX.sparks(ex, ey, ez, nx, ny + 0.3, nz, W.pierce ? 12 : 3, C[0], C[1], C[2], W.pierce ? 12 : 6); if (random() < 0.5) FX.dust(ex, ey, ez, 1); if (m.boom && random() < m.boom) explode(ex, ey, ez, 30 * m.dmg, 3.2); }
    if (W.pierce) {
      FX.tracer(mx, my, mz, ex, ey, ez, 0.34, C[0] * 6, C[1] * 6, C[2] * 6, 0.5, 1); FX.tracer(mx, my, mz, ex, ey, ez, 0.09, 8, 8, 9, 0.3, 1);
      for (let k = 0, n = min(end / 3, 24); k < n; k++) { const t = rnd(end); FX.spawn(mx + (ex - mx) * t / end, my + (ey - my) * t / end, mz + (ez - mz) * t / end, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(0.3, 0.7), 0.3, 0.02, C[0] * 3, C[1] * 3, C[2] * 3); }
    } else FX.tracer(mx, my, mz, ex, ey, ez, W.w, C[0] * 5, C[1] * 5, C[2] * 5, 0.07 + (W.pel > 1 ? 0.03 : 0), 0);
  }
  if (any) G.stat.hits++;
}
function hitTarget(h, dmg, dx, dy, dz, W) {
  const x = cs[0] + dx * h.t, y = cs[1] + dy * h.t, z = cs[2] + dz * h.t, C = W.col, l = hypot(dx, dz) || 1;
  if (h.s) { h.s.hp -= dmg; FX.sparks(x, y, z, -dx, 0.5, -dz, 5, 1, 0.6, 0.2); G.hitMark = 1; return; }
  const r = damageEnemy(h.e, dmg, h.c, x, y, z, dx / l, dz / l, 0);
  FX.sparks(x, y, z, -dx, -dy + 0.4, -dz, h.c ? 8 : 4, C[0], C[1], C[2], 8);
  if (r > 0) { G.hitMark = h.e.hp <= 0 ? 2 : h.c ? 1.5 : 1; S.hit(h.c); if (h.c) G.stat.crit++; if (G.pl.mods.boom && random() < G.pl.mods.boom) explode(x, y, z, 30 * G.pl.mods.dmg, 3.2); }
}

const rm = m4();
function updateRockets(dt) {
  const A = G.rockets;
  for (let i = A.length - 1; i >= 0; i--) {
    const r = A[i], sp = hypot(r.vx, r.vy, r.vz), dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp, st = sp * dt;
    let t = raycast(r.x, r.y, r.z, dx, dy, dz, st), hit = t < st;
    for (const h of rayEnemies(r.x, r.y, r.z, dx, dy, dz, t, 0.35)) { if (h.t <= t) { t = h.t; hit = 1; } }
    r.x += dx * t; r.y += dy * t; r.z += dz * t; r.life -= dt;
    if (hit || r.life <= 0) { explode(r.x, r.y, r.z, r.dmg); A.splice(i, 1); continue; }
    FX.spawn(r.x - dx * 0.4, r.y - dy * 0.4, r.z - dz * 0.4, rnd(-0.6, 0.6), rnd(-0.2, 0.8), rnd(-0.6, 0.6), 0.7, 0.22, 0.9, 0.5, 0.48, 0.46, 0.5, 1, 1, -0.6);
    FX.spawn(r.x - dx * 0.5, r.y - dy * 0.5, r.z - dz * 0.5, 0, 0, 0, 0.08, 0.6, 0.1, 5, 3, 1);
    addLight(r.x, r.y, r.z, 9, 4, 2.4, 0.8);
    ident(rm); translate(rm, r.x, r.y, r.z); rotY(rm, atan2(dx, dz)); rotX(rm, -atan2(dy, hypot(dx, dz)));
    draw(meshOf('rocket'), rm, 1, 1, 1, 0);
  }
}

function bell(p) {
  const R = 10 * p.mods.bellR;
  p.bell = 7 * p.mods.bellCd; S.bell(); p.nod = 0.4;
  FX.ring(p.x, p.y + 0.3, p.z, 1, R * 2.1, 0.6, 1.6, 3, 0.55, 1); FX.ring(p.x, p.y + 1, p.z, 0.5, R * 1.6, 0.4, 1, 2, 0.4, 0); FX.flash(p.x, p.y + 1, p.z, 12, 1, 2.4, 4, 0.2);
  let n = 0;
  for (const e of G.enemies) {
    const dx = e.x - p.x, dz = e.z - p.z, d = hypot(dx, dz) || 1;
    if (d < R + e.r && !e.dead && !e.K.boss) { e.stun = e.k == 4 ? 0.6 : 1.5; const k = (16 * (1 - d / (R + e.r)) + 5) / (0.6 + e.r); e.vx += (dx / d) * k; e.vz += (dz / d) * k; e.fl = 0.6; n++; }
  }
  for (const s of G.shots) if (hypot(s.x - p.x, s.z - p.z) < R) { s.life = 0; s.hp = 0; n++; }
  if (n > 2 && G.popup) G.popup('叮铃铃！震退 ×' + n, '#7fd0ff');
}

export function updatePlayer(dt, rdt) {
  const p = G.pl, c = G.cam, m = p.mods;
  // ---- 视角 ----
  const sens = 0.0023 * G.opt.sens * lerp(1, 0.55, p.ads);
  c.yaw = wrapPi(c.yaw - I.lx * sens); c.pitch = clamp(c.pitch - I.ly * sens, -1.1, 0.8);
  p.ads = damp(p.ads, I.ads && !p.dead ? 1 : 0, 14, rdt);
  p.inv -= dt; p.hurtT = max(0, p.hurtT - rdt * 1.6); p.bell -= dt; p.boost -= dt; p.bonkT -= dt;
  p.recoil = max(0, p.recoil - dt * 9); p.heat = max(0, p.heat - dt * 1.5); p.squash = damp(p.squash, 0, 9, dt); p.nod = damp(p.nod, 0, 6, dt);
  p.blinkT -= dt; if (p.blinkT < 0) p.blinkT = rnd(1.5, 5); p.blink = p.blinkT < 0.12 ? 0.1 : 1;
  if (p.dead) {
    // 倒地：车倒向一侧滑行
    p.dead = min(1, p.dead + rdt * 0.6); p.lean = damp(p.lean, 1.35, 5, rdt); p.spd *= 1 - min(1, rdt * 2.5);
    p.x += sin(p.yaw) * p.spd * rdt; p.z += cos(p.yaw) * p.spd * rdt; resolve(p, 0.5, p.y);
    const gh = groundH(p.x, p.z, p.y + 0.1); if (p.y > gh) { p.vy -= GRAV * rdt; p.y = max(gh, p.y + p.vy * rdt); } else p.y = gh;
  } else {
    // ---- 骑行：输入方向相对相机，车头按限速转向 ----
    const il = hypot(I.mx, I.mz);
    let turn = 0, pedal = 0;
    p.stamT -= dt;
    if (p.tired && p.stam > 25) p.tired = 0;
    const sprint = I.sprint && il > 0.15 && !p.tired && p.stam > 0;
    if (sprint) { p.stam = max(0, p.stam - 19 * dt); p.stamT = 0.7; if (p.stam <= 0) p.tired = 1; } else if (p.stamT <= 0) p.stam = min(100, p.stam + 15 * dt);
    p.sprint = damp(p.sprint, sprint ? 1 : 0, 6, dt);
    const vmax = VMAX * m.spd * (sprint ? SPRINT : 1);
    if (il > 0.15) {
      const wx = sin(c.yaw) * I.mz - cos(c.yaw) * I.mx, wz = cos(c.yaw) * I.mz + sin(c.yaw) * I.mx, diff = wrapPi(atan2(wx, wz) - p.yaw);
      const rate = lerp(3.8, 2, min(p.spd / VMAX, 1)) * m.turn * (p.gnd ? 1 : 0.5);
      turn = clamp(diff * 6, -rate, rate);
      const tgt = vmax * min(il, 1) * (abs(diff) > 2.2 ? 0.4 : abs(diff) > 1.2 ? 0.72 : 1);
      if (p.gnd) { if (p.spd < tgt) { p.spd = min(p.spd + ACC * (sprint ? 1.35 : 1) * dt, tgt); pedal = 1; } else p.spd = max(p.spd - 8 * dt, tgt); }
    } else if (p.gnd) p.spd = max(p.spd - (2.6 + p.spd * 0.28) * dt, 0);
    p.turn = turn; p.yaw = wrapPi(p.yaw + turn * dt); p.coast = !pedal;
    if (I.jump) {
      if (p.gnd || p.airT < 0.13) { p.vy = JUMP + max(p.vy, 0) * 0.6; p.gnd = 0; p.jumps = 1; p.airT = 0.2; S.jump(); FX.dust(p.x, p.y, p.z, 4); }
      else if (p.jumps < 1 + m.djump) { p.vy = JUMP * 0.92; p.jumps++; S.jump(); FX.ring(p.x, p.y + 0.2, p.z, 0.3, 2.4, 0.5, 1.4, 2.4, 0.3, 1); }
    }
    const n = ceil(dt / 0.011), h = dt / n;
    for (let i = 0; i < n; i++) {
      const ox = p.x, oz = p.z, sy = sin(p.yaw), cy = cos(p.yaw), g0 = groundH(ox, oz, p.y + 0.02);
      if (g0 - p.y > 0.5) { p.y = g0; p.vy = 0; } // 被卡进凸起内部时直接顶到表面
      p.x += sy * p.spd * h; p.z += cy * p.spd * h;
      if (resolve(p, 0.5, p.y, 1.4)) {
        const vn = (sy * p.nx + cy * p.nz) * p.spd;
        if (vn < 0) {
          const vx = sy * p.spd - p.nx * vn, vz = cy * p.spd - p.nz * vn, ns = hypot(vx, vz);
          if (vn < -5.5 && p.bonkT < 0) { p.bonkT = 0.4; p.spd = ns * 0.55; S.bonk(); c.shake = max(c.shake, 0.45); FX.sparks(p.x - p.nx * 0.5, p.y + 0.5, p.z - p.nz * 0.5, p.nx, 0.5, p.nz, 8, 1, 0.9, 0.6); p.squash = 0.5; }
          else p.spd = ns;
          if (ns > 0.5) p.yaw = dampAng(p.yaw, atan2(vx, vz), 16, h);
        }
      }
      const gh = groundH(p.x, p.z, p.y + 0.02);
      if (p.gnd) {
        if (gh - p.y > 0.5) { p.x = ox; p.z = oz; if (p.bonkT < 0 && p.spd > 4) { S.bonk(); c.shake = max(c.shake, 0.4); p.bonkT = 0.4; } p.spd *= -0.3; }
        else {
          // 地面"掉下去"的速度变化超过重力所能提供的（坡道唇口、坡顶）就腾空，保留当前竖直速度
          const nv = (gh - p.y) / h;
          if (p.vy - nv > GRAV * h + 1 && p.vy > 0.8) { p.gnd = 0; p.y = max(gh, p.y + p.vy * h); p.vy -= GRAV * h; p.airT = 0; p.jumps = 0; }
          else { p.vy = nv; p.y = gh; }
        }
      } else {
        p.vy -= GRAV * h; p.y += p.vy * h; p.airT += h;
        if (p.y <= gh) {
          const imp = -p.vy; p.y = gh; p.gnd = 1; p.vy = 0;
          if (imp > 5) { FX.dust(p.x, p.y, p.z, 6 + imp * 0.5, sy * p.spd * 0.3, cy * p.spd * 0.3); S.land(min(imp / 12, 1)); c.shake = max(c.shake, min(imp / 30, 0.5)); p.squash = min(imp / 14, 1); }
          if (p.airT > 1.1 && G.onAir) G.onAir(p.airT);
          p.airT = 0;
        }
      }
    }
    // 上坡减速、下坡加速
    if (p.gnd) { const sl = (groundH(p.x + sin(p.yaw) * 0.5, p.z + cos(p.yaw) * 0.5, p.y + 0.3) - groundH(p.x - sin(p.yaw) * 0.5, p.z - cos(p.yaw) * 0.5, p.y + 0.3)); p.spd = max(0, p.spd - clamp(sl, -0.6, 0.6) * 9 * dt); }
    // ---- 冲撞 ----
    for (const e of G.enemies) {
      if (e.dead || e.sp > 0.5) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = hypot(dx, dz) || 1, rr = e.r + 0.55, ey = e.K.fly ? e.y - e.r : e.y;
      if (d > rr || p.y > ey + e.r * 2 + 0.3 || p.y + 1.5 < ey) continue;
      if (e.K.boss || e.k == 4) { p.x -= (dx / d) * (rr - d); p.z -= (dz / d) * (rr - d); if (p.spd > 6 && p.bonkT < 0) { p.spd *= 0.5; p.bonkT = 0.4; S.bonk(); } continue; }
      if (p.spd > 7 && e.ramT < 0) {
        e.ramT = 0.5; G.stat.ram++;
        damageEnemy(e, (14 + p.spd * 2.3) * m.ram, 0, e.x, e.y + e.r, e.z, sin(p.yaw), cos(p.yaw), 2);
        p.spd *= m.ram > 1 ? 0.94 : 0.74; S.ram(); c.shake = max(c.shake, 0.4); FX.sparks(e.x, e.y + 0.6, e.z, sin(p.yaw), 0.8, cos(p.yaw), 10, 1, 0.9, 0.5, 10);
        if (e.hp <= 0 && G.popup) G.popup('单车冲撞', '#ffb060');
      } else { e.x += (dx / d) * (rr - d) * 0.6; e.z += (dz / d) * (rr - d) * 0.6; }
    }
    // ---- 武器 ----
    if (I.wsel >= 0 && I.wsel != p.wpn) { p.wpn = I.wsel; p.rel = 0; p.fireT = max(p.fireT, 0.22); S.ui(); }
    if (I.wnext) { p.wpn = (p.wpn + I.wnext + 4) % 4; p.rel = 0; p.fireT = max(p.fireT, 0.22); S.ui(); }
    const w = p.wpn, W = WEAPONS[w];
    p.fireT -= dt;
    if (p.rel > 0) { p.rel -= dt * (p.boost > 0 ? 1.5 : 1); if (p.rel <= 0) { p.ammo[w] = magOf(w); S.reloaded(); } }
    else if ((I.reload && p.ammo[w] < magOf(w)) || p.ammo[w] <= 0) { p.rel = W.rel * m.rel; S.reload(); }
    const trig = I.fire || ((G.opt.autofire || G.touch) && p.target && p.target.K);
    if (trig && p.fireT <= 0 && p.rel <= 0 && p.ammo[w] > 0) fire(p, w);
    if (I.bell && p.bell <= 0) bell(p);
    if (I.skill && p.skill >= 100 && G.bt <= 0) { p.skill = 0; G.bt = 5.5; S.skill(1); G.say && G.say('深度思考中……世界慢下来了。'); FX.ring(p.x, p.y + 0.3, p.z, 1, 26, 0.12, 0.4, 0.8, 0.6, 1); }
    if (m.regen && p.hp < p.mhp) { p.regenT -= dt; if (p.regenT <= 0) p.hp = min(p.mhp, p.hp + m.regen * dt); }
  }
  // ---- 动画量 ----
  p.wheel += (p.spd / WR) * dt; if (!p.coast) p.crank += (p.spd / WR / 2.3) * dt;
  p.lean = p.dead ? p.lean : damp(p.lean, clamp(-p.turn * p.spd * 0.05, -0.62, 0.62), 8, dt);
  p.steer = damp(p.steer, clamp(p.turn * 0.22, -0.6, 0.6), 10, dt);
  const sl = p.gnd ? atan2(groundH(p.x + sin(p.yaw) * 0.5, p.z + cos(p.yaw) * 0.5, p.y + 0.3) - groundH(p.x - sin(p.yaw) * 0.5, p.z - cos(p.yaw) * 0.5, p.y + 0.3), 1) : clamp(p.vy * 0.045, -0.5, 0.5);
  p.pitch = damp(p.pitch, sl, p.gnd ? 14 : 5, dt);
  updateRockets(dt);
  // ---- 相机 ----
  c.kick = damp(c.kick, 0, 8, rdt); c.shake = damp(c.shake, 0, 5, rdt);
  camBasis();
  const side = 0.58, px = p.x - cos(c.yaw) * side, py = p.y + 1.42, pz = p.z + sin(c.yaw) * side, want = lerp(5.3, 3.1, p.ads) + min(p.spd / 20, 1) * 0.5;
  const cd = max(raycast(px, py, pz, -cf[0], -cf[1], -cf[2], want + 0.4) - 0.35, 0.8);
  c.dist = cd < c.dist ? cd : damp(c.dist, min(cd, want), 5, rdt);
  let cx = px - cf[0] * c.dist, cyy = py - cf[1] * c.dist, cz = pz - cf[2] * c.dist;
  cyy = max(cyy, groundH(cx, cz) + 0.3);
  const sh = c.shake * c.shake * 0.35;
  cx += rnd(-sh, sh); cyy += rnd(-sh, sh); cz += rnd(-sh, sh);
  c.x = cx; c.y = cyy; c.z = cz;
  c.fov = damp(c.fov, lerp(1.06, 0.68, p.ads) + p.sprint * 0.16 * min(p.spd / 16, 1) + (G.bt > 0 ? -0.06 : 0), 6, rdt);
  setCam(cx, cyy, cz, cx + cf[0], cyy + cf[1], cz + cf[2], c.fov);
  // ---- 瞄准点：相机射线越过玩家后与世界/敌人求交 ----
  const t0 = max((p.x - cx) * cf[0] + (p.y + 1.2 - cyy) * cf[1] + (p.z - cz) * cf[2] + 0.8, 0.5);
  cs[0] = cx + cf[0] * t0; cs[1] = cyy + cf[1] * t0; cs[2] = cz + cf[2] * t0;
  let ad = raycast(cs[0], cs[1], cs[2], cf[0], cf[1], cf[2], 160); p.target = null;
  for (const h of rayEnemies(cs[0], cs[1], cs[2], cf[0], cf[1], cf[2], ad, G.touch ? 0.6 : 0.1)) if (h.t < ad) { ad = h.t; p.target = h.e || h.s; }
  p.aimD = ad;
  const ax = cs[0] + cf[0] * ad - p.x, ay = cs[1] + cf[1] * ad - (p.y + 1.1), az = cs[2] + cf[2] * ad - p.z;
  p.aimY = p.dead ? damp(p.aimY, 0, 4, rdt) : wrapPi(atan2(ax, az) - p.yaw); p.aimP = atan2(ay, hypot(ax, az));
  // ---- 后处理参数 ----
  post.spd = damp(post.spd, p.sprint * smooth(11, 18, p.spd), 5, rdt); post.dmg = p.hurtT * 0.8 + (p.hp < 30 && !p.dead ? 0.18 + 0.1 * sin(G.rt * 6) : 0); post.bt = damp(post.bt, G.bt > 0 ? 1 : 0, 6, rdt);
  post.mbNear = c.dist + 2.2;
  // 夜间车灯
  if (env.night > 0.3) addLight(p.x + sin(p.yaw) * 4.5, p.y + 1.6, p.z + cos(p.yaw) * 4.5, 12, 2.2 * env.night, 2 * env.night, 1.5 * env.night);
  if (sin(G.rt * 40) > 0 || p.inv <= 0 || p.dead)
    drawDoubao({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, lean: p.lean, steer: p.steer, wheel: p.wheel, crank: p.crank, aimY: p.aimY, aimP: p.aimP, recoil: p.recoil, sprint: p.sprint, blink: p.dead ? 0.1 : p.blink, wpn: p.wpn, squash: p.squash, fl: p.hurtT > 0.75 ? 0.5 : 0, nod: p.nod });
}
export const camFwd = cf;
