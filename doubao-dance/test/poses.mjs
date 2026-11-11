// 姿势检查表：冻结节拍，把指定动作在各个拍点的样子逐格截图，拼成一张图。
// 用法：node test/poses.mjs <输出目录> <机位> <动作1,动作2,...> [拍点列表，如 0,1,2,3]
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
const [outDir = '/tmp/dd-shots/poses', shot = 'body', movesArg = 'idle,step', beatsArg = '0,1,2,3'] = process.argv.slice(2);
const exe = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const W = 300, H = 380;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`file://${root}/dist/index.html?mute=1&nohud=1&q=low&shot=${shot}&freeze=0`);
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
const beats = beatsArg.split(',').map(Number);
const files = [];
for (const mv of movesArg.split(',')) {
  for (const b of beats) {
    await page.evaluate(([mv, b]) => { window.__freeze(b + 7); window.__game.animators[0].setMove(mv, 0.0001); }, [mv, b]);
    await page.waitForTimeout(120);
    await page.evaluate((b) => window.__freeze(b + 8), b);
    await page.waitForTimeout(160);
    const f = `${outDir}/${mv}-${String(b).replace('.', '_')}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
}
console.log(JSON.stringify({ files, cols: beats.length, errs }));
await browser.close();
