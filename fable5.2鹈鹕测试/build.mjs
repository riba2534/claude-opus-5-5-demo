// 构建：esbuild 打包（含 three.js，按需摇树）→ 压缩 → 内联进单个 HTML，产物无任何外部请求
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dev = process.argv.includes('--dev');
// 压缩内联 GLSL：去注释、折叠空白（着色器里不含预处理指令行以外的换行敏感语法）
const glsl = {
  name: 'glsl-min',
  setup(b) {
    b.onLoad({ filter: /shaders\.js$/ }, a => {
      const src = readFileSync(a.path, 'utf8').replace(/`([^`]*)`/g, (_, s) => {
        const out = s.split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).map(l => (l.startsWith('#') ? '\n' + l + '\n' : l)).join(' ');
        return '`' + out.replace(/[ \t]+/g, ' ').replace(/ ?([{}();,=+*/<>?:]) ?/g, '$1').replace(/\n /g, '\n').replace(/ \n/g, '\n').replace(/\n+/g, '\n') + '`';
      });
      return { contents: src, loader: 'js' };
    });
  },
};
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !dev,
  write: false,
  target: ['es2022'],
  legalComments: 'none',
  logLevel: 'warning',
  plugins: dev ? [] : [glsl],
  // 内联的素材：官方豆包头像、头部 3D 模型的量化几何与贴图
  define: {
    __DOUBAO__: JSON.stringify('data:image/webp;base64,' + readFileSync('assets/doubao-official.webp').toString('base64')),
    __HEADBIN__: JSON.stringify(readFileSync('assets/doubao-head.bin').toString('base64')),
  },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('index.template.html', 'utf8').replace('/*APP_JS*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB (js ${(js.length / 1024).toFixed(1)} KB)`);
