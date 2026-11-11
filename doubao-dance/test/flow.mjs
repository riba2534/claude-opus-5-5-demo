// 流程自测：模拟真实点击与按键，走一遍 标题→选歌→开局→手动输入→暂停→继续→重开→返回→再开局→结算。
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
const exe = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 300)); });
await page.goto(`file://${root}/dist/index.html?q=low`);
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
const st = () => page.evaluate('({s: window.__game.state(), beat: +window.__game.clock.beat().toFixed(1), mode: window.__game.clock.mode, score: window.__game.game.me ? window.__game.game.me.score : 0, ctx: window.__game.audio.ctx && window.__game.audio.ctx.state})');
const log = async (label) => console.log(label.padEnd(26), JSON.stringify(await st()));
const waitBeat = (b) => page.evaluate((b) => new Promise((r) => { const iv = setInterval(() => { if (window.__game.clock.beat() >= b) { clearInterval(iv); r(); } }, 20); }), b);
let ok = true;
const expect = async (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } };

await log('标题');
await page.click('#btnHelp'); await page.waitForTimeout(200);
await expect(await page.isVisible('#help'), '玩法说明没有打开');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await expect(await page.isVisible('#title'), 'Esc 没有回到标题');
await page.click('#btnStart'); await page.waitForTimeout(600);
await log('选歌（大厅音乐）');
await page.click('#songList .song:nth-child(1)');
await page.click('#modeSeg button:nth-child(1)');   // 舞步
await page.click('#diffSeg button:nth-child(1)');   // 简单
await page.click('#btnGo'); await page.waitForTimeout(500);
await log('开局');
await expect((await st()).s === 'playing', '没有进入对局');

// 第一回合：按谱面敲方向键，再在重拍上按空格
const KEYS = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'];
for (let n = 0; n < 3; n++) {
  const r = await page.evaluate(() => new Promise((res) => { const iv = setInterval(() => { const r = window.__game.game.round; if (r && !r.judged && r.progress === 0) { clearInterval(iv); res({ hit: r.hitBeat, arrows: r.arrows.map((a) => (a.rev ? 3 - a.dir : a.dir)) }); } }, 20); }));
  for (const d of r.arrows) { await page.keyboard.press(KEYS[d]); await page.waitForTimeout(60); }
  await waitBeat(r.hit - 0.02);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const last = await page.evaluate('window.__game.game.me.last');
  console.log(`  手动回合 ${n + 1}: 箭头 ${r.arrows.length} 个 → 判定 ${last}`);
  await expect(last && last !== 'miss', `手动回合 ${n + 1} 被判 miss`);
}
await log('手动打了三回合');

// 敲错键应当重置进度
const r2 = await page.evaluate(() => new Promise((res) => { const iv = setInterval(() => { const r = window.__game.game.round; if (r && !r.judged && r.progress === 0) { clearInterval(iv); res({ need: r.arrows[0].rev ? 3 - r.arrows[0].dir : r.arrows[0].dir }); } }, 20); }));
await page.keyboard.press(KEYS[(r2.need + 1) % 4]); await page.waitForTimeout(80);
await expect((await page.evaluate('window.__game.game.round ? window.__game.game.round.progress : -1')) === 0, '敲错键后进度没有归零');

await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const b1 = (await st()).beat;
await page.waitForTimeout(900);
const b2 = (await st()).beat;
await log('暂停');
await expect((await st()).s === 'paused' && Math.abs(b2 - b1) < 0.05, `暂停期间节拍还在走 ${b1}→${b2}`);
await page.click('#btnResume'); await page.waitForTimeout(500);
await expect((await st()).s === 'resuming', '继续时没有进入倒数');
await page.keyboard.press('Escape'); await page.waitForTimeout(100);   // 倒数期间按 Esc 不应有反应
await expect((await st()).s === 'resuming', '倒数期间 Esc 不该改变状态');
await page.waitForTimeout(1500);
await log('继续（倒数结束）');
await expect((await st()).s === 'playing' && (await st()).beat > b2 + 0.3, '继续后节拍没有前进');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#btnRestart');
await page.keyboard.press('Escape');   // 重开的同时再按 Esc：以前会把状态搅乱
await page.waitForTimeout(700);
await log('重新开始');
await expect((await st()).beat < 2 && (await st()).score === 0, '重开后节拍/分数没有清零');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#btnQuit'); await page.waitForTimeout(800);
await log('返回选歌');
await expect((await st()).s === 'select', '没有回到选歌');
await expect(!(await page.isVisible('#top')) && !(await page.isVisible('#pause')), '回到选歌后对局界面或暂停面板还在');

// WASD 与 HJKL 在节拍玩法里都应当对应到正确的轨道
await page.click('#modeSeg button:nth-child(2)');
await page.click('#btnGo'); await page.waitForTimeout(600);
const lanes = await page.evaluate(() => {
  const g = window.__game.game; const seen = []; const orig = g.arrow;
  g.arrow = (dir, b) => { seen.push(dir); return orig(dir, b); };
  for (const code of ['KeyA', 'KeyS', 'KeyW', 'KeyD', 'KeyH', 'KeyJ', 'KeyK', 'KeyL']) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  g.arrow = orig; return seen.join('');
});
console.log('  节拍玩法键位 WASD+HJKL →', lanes);
await expect(lanes === '01230123', '节拍玩法下 WASD / HJKL 键位不对');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#btnQuit'); await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/dd-shots/flow-select.jpg', type: 'jpeg', quality: 60 });
console.log(errs.length ? '报错：\n' + errs.join('\n') : '无报错');
console.log(ok ? '流程检查通过' : '流程检查有失败项');
await browser.close();
process.exit(ok && !errs.length ? 0 : 1);
