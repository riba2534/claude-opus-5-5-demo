// 音频自测：用 OfflineAudioContext 把每首歌离线渲染出来，按段落统计峰值与响度，检查削波和静音。
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
const exe = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`file://${root}/dist/index.html?mute=1&q=low`);
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
const res = await page.evaluate(async () => {
  const { lib, SONGS } = window.__game;
  const out = [];
  for (const song of SONGS) {
    const sr = 22050;
    const spb = 60 / song.bpm;
    const bars = song.bars;
    const sec = bars * 4 * spb + 1.5;
    const off = new OfflineAudioContext(2, Math.ceil(sec * sr), sr);
    const audio = lib.createAudio({ context: off });
    audio.setVolumes({ music: 0.8, sfx: 0.85 });
    const seq = lib.createSequencer(audio);
    const t0 = performance.now();
    seq.scheduleRange(song, 0.1, 0, bars * 16);
    const buf = await off.startRendering();
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const secs = [];
    for (const s of song.secs) {
      const a = Math.floor((0.1 + s.start * 4 * spb) * sr);
      const b = Math.min(L.length, Math.floor((0.1 + (s.start + s.bars) * 4 * spb) * sr));
      let peak = 0, sum = 0, clip = 0, nan = 0, lo = 0, hi = 0, lp1 = 0, lp2 = 0;
      const k1 = 1 - Math.exp((-2 * Math.PI * 200) / sr);
      const k2 = 1 - Math.exp((-2 * Math.PI * 2000) / sr);
      for (let i = a; i < b; i++) {
        const v = (L[i] + R[i]) * 0.5;
        lp1 += (v - lp1) * k1;
        lp2 += (v - lp2) * k2;
        lo += lp1 * lp1;
        hi += (v - lp2) * (v - lp2);
        if (v !== v) nan++;
        const av = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (av > peak) peak = av;
        if (av >= 0.999) clip++;
        sum += v * v;
      }
      secs.push({ sec: s.label + '(' + s.bars + ')', peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(sum / (b - a) + 1e-12)).toFixed(1), clipPct: +((clip / (b - a)) * 100).toFixed(3), nan, lo: Math.round((lo / sum) * 100), hi: Math.round((hi / sum) * 100) });
    }
    out.push({ song: song.title, renderMs: Math.round(performance.now() - t0), secs });
  }
  return out;
});
for (const s of res) {
  console.log(`\n${s.song}  （离线渲染 ${s.renderMs} ms）`);
  for (const x of s.secs) console.log(`  ${x.sec.padEnd(8)} 峰值 ${String(x.peak).padEnd(6)} 响度 ${String(x.rmsDb).padStart(6)} dB  削波 ${x.clipPct}%  低频 ${x.lo}%  高频 ${x.hi}%${x.nan ? '  NaN ' + x.nan : ''}`);
}
await browser.close();
