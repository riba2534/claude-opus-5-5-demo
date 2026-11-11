// 无头浏览器自测：载入构建产物，等待若干毫秒后截图，并打印运行状态与报错。
// 用法：node test/shot.mjs '<query>' <输出.jpg> [等待毫秒] [宽x高] [截图前执行的 JS]
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const [query = '', out = '/tmp/dd-shots/out.jpg', wait = '2500', size = '800x450', js = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const exe = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: process.env.TOUCH === '1', isMobile: process.env.TOUCH === '1' });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
// 设置 URL 环境变量可以改测线上地址
const base = process.env.URL || `file://${root}/dist/index.html`;
await page.goto(`${base}${query ? '?' + query : ''}`);
await page.waitForFunction('window.__ready === true || (window.__errors && window.__errors.length > 0)', null, { timeout: 60000 }).catch(() => logs.push('[timeout] 页面未就绪'));
await page.waitForTimeout(+wait);
if (js) { try { const r = await page.evaluate(js); if (r !== undefined) console.log('eval →', JSON.stringify(r)); } catch (e) { logs.push('[eval] ' + e.message); } await page.waitForTimeout(400); }
const stats = await page.evaluate('window.__stats ? window.__stats() : null').catch(() => null);
await page.screenshot({ path: out, type: 'jpeg', quality: 62 });
console.log('stats', JSON.stringify(stats));
const errs = await page.evaluate('window.__errors || []').catch(() => []);
for (const e of errs) console.log('ERR', String(e).slice(0, 600));
for (const l of logs.slice(0, 12)) console.log(l.slice(0, 500));
await browser.close();
