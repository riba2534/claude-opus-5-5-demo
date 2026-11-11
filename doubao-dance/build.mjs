import * as esbuild from 'esbuild';
import fs from 'fs';

const dev = process.argv.includes('--dev');
const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: !dev,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  // 豆包的头部贴图和网格内联进脚本，产物仍是单个 HTML
  loader: { '.webp': 'dataurl', '.bin': 'binary' },
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/style.css', 'utf8');
const html = fs
  .readFileSync('src/index.html', 'utf8')
  .replace('/*APP_STYLE*/', () => css)
  .replace('<!--APP_SCRIPT-->', () => `<script>${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
