<h1 align="center">claude-opus-5-5-demo</h1>

<p align="center">
  <b>一句话提示词 · One Shot —— Claude Opus 5.5 代码生成能力实测</b>
  <br />
  三个可玩的 3D 网页游戏，每个游戏只给一句提示词，单会话生成，代码零人工改动，直接部署上线。
</p>

<p align="center">
  <a href="https://www.anthropic.com/claude/opus"><img src="https://img.shields.io/badge/Claude-Opus%205.5-D97757?style=for-the-badge" alt="Claude Opus 5.5" /></a>
  <img src="https://img.shields.io/badge/Three.js-r186-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js r186" />
  <img src="https://img.shields.io/badge/esbuild-%E2%89%A50.28-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black" alt="esbuild" />
  <a href="https://pages.cloudflare.com/"><img src="https://img.shields.io/badge/部署-Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages" /></a>
  <img src="https://img.shields.io/badge/提示词-每游戏%201%20句-8A2BE2?style=for-the-badge" alt="One-shot" />
</p>

<p align="center">
  <a href="#这个仓库是什么">介绍</a> ·
  <a href="#三个游戏">三个游戏</a> ·
  <a href="#提示词原文">提示词原文</a> ·
  <a href="#在线体验">在线体验</a> ·
  <a href="#本地构建">本地构建</a> ·
  <a href="#仓库结构">仓库结构</a> ·
  <a href="#生成过程与验证">生成过程与验证</a>
</p>

---

## 这个仓库是什么

用 [Claude Opus 5.5](https://www.anthropic.com/claude/opus)（Claude Code CLI，1M 上下文，xhigh 推理强度）做的一次代码生成能力实测：**每个游戏只给一句话提示词，单会话 one-shot 生成，全程零人工改动代码，生成后直接部署上线可玩。**

规则很简单：

- **一句话提示词** — 每个游戏的需求描述只有一句话，不写需求文档、不给参考代码、不做多轮追问
- **单会话生成** — 每个游戏在一个会话内完成：查资料、搭工程、写代码、构建、测试、部署全部由模型自主进行
- **零人工改动** — 仓库里的源码就是模型写出的原样，人工没有改过一行；连本 README 也是模型写的
- **真实部署** — 三个游戏都部署在 Cloudflare Pages 上，点开链接即可玩

三个游戏全部是单文件 HTML（esbuild 打包内联，无外部资源依赖）：模型、纹理、动画、音效全部由代码程序化生成，不引用任何图片、音频或第三方素材。

## 三个游戏

| 游戏 | 类型 | 源码目录 | 模块数 | 构建产物 | 在线体验 |
| --- | --- | --- | --- | --- | --- |
| 🚲 鹈鹕骑自行车 | 海岸公路休闲骑行 | `pelican-bike/` | 11 个 JS 模块 | ~800 KB | [claude-opus-5-5.riba2534.cn](https://claude-opus-5-5.riba2534.cn/) |
| 🔫 穿越火线·运输船 | FPS 团队枪战 | `cf-transport-ship/` | 18 个 JS 模块 + HTML/CSS | ~840 KB | [claude-opus-5-5-cf-transport-ship.pages.dev](https://claude-opus-5-5-cf-transport-ship.pages.dev) |
| 🏎️ QQ 飞车 | 竞速漂移 racing | `qq-speed/` | 15 个 JS 模块 + HTML | ~700 KB | [claude-opus-5-5-qqfeiche3d.pages.dev](https://claude-opus-5-5-qqfeiche3d.pages.dev/) |

### 🚲 鹈鹕骑自行车

戴头盔墨镜、脖子系红围巾的鹈鹕在海岸公路上骑车抓鱼。围巾是布料物理模拟，昼夜循环从黄昏到星空月夜，海面有波浪与岸边碎浪。W/S 加减速、A/D 变道抓鱼、空格跳跃、T 展翅抬前轮；14 个成就、5 种镜头（含电影运镜和鹈鹕视角）、浏览器实时合成的音效音乐（节奏跟随踏频）、触屏按钮与按帧率自适应画质。不操作时它会自动驾驶去追鱼。

### 🔫 穿越火线·运输船

还原《穿越火线》经典地图「运输船」：模型先检索了官方布局图与攻略核对地图结构（长条形甲板、两端船舱出生点、中部 V 形斜放集装箱、两侧单向管道），再按考据结果搭建。完整的 FPS 玩法：枪械弹道与后坐力、 bots AI 对战、命中反馈与击杀播报、程序化合成的枪声与音效、触屏支持。

### 🏎️ QQ 飞车

还原《QQ 飞车》的键位与漂移玩法（Shift 漂移、Ctrl 氮气、小喷与双喷、复位键），内置四张按官方地图风格设计的赛道：十一城（城市夜景 11 处弯 + 发卡弯）、情迷爱琴海（爬坡连续弯）、法老金字塔（直道末端跳台）、雪地大冒险（8 字形立交）。赛道形状先用脚本生成俯视图检查弯道与交叉点，再进入正式开发。

## 提示词原文

每个游戏的完整输入就下面这一句话，一字未改：

### 🚲 鹈鹕骑自行车

> 生成一个鹈鹕骑自行车的 3D 页面，尽可能把你所有的能力全部都用上. 然后上传到 CDN 上, 把访问链接给我

### 🔫 穿越火线·运输船

> 尽可能真实的还原穿越火线中的运输船地图，我需要一个真实的枪战游戏，生成一个3d页面，尽可能发挥你的所有能力
> 做完之后上传到 CDN 上 把链接发给我

### 🏎️ QQ 飞车

> 尽可能真实地还原 QQ 飞车中的游戏地图。我需要一个真实的 QQ 飞车游戏，包括游戏的各种键位以及漂移玩法,生成一个3D 页面，尽可能发挥你的所有能力。
> 做完之后上传到 CDN 上 把链接发给我

## 在线体验

| 游戏 | 地址 |
| --- | --- |
| 鹈鹕骑自行车 | <https://claude-opus-5-5.riba2534.cn/> |
| 穿越火线·运输船 | <https://claude-opus-5-5-cf-transport-ship.pages.dev> |
| QQ 飞车 | <https://claude-opus-5-5-qqfeiche3d.pages.dev/> |

## 本地构建

三个工程结构相同：`src/` 源码经 esbuild 打包内联进单个 HTML，无运行时外部依赖。

```bash
# 任选一个游戏目录
cd pelican-bike   # 或 cf-transport-ship / qq-speed

npm install       # 安装依赖（three、esbuild 等）
node build.mjs    # 构建产物输出到 dist/index.html

# 直接用浏览器打开 dist/index.html 即可游玩
```

## 仓库结构

```
├── pelican-bike/          # 鹈鹕骑自行车
│   ├── src/               # 11 个模块：pelican / bicycle / ocean / fish / sky / effects / audio ...
│   ├── index.template.html# 页面模板（构建时注入 og:image 与打包后的 JS）
│   ├── build.mjs          # esbuild 构建脚本
│   └── package.json
├── cf-transport-ship/     # 穿越火线·运输船
│   ├── src/               # 18 个模块：map / guns / weapons / bots / player / physics / viewmodel ...
│   ├── build.mjs
│   └── package.json
├── qq-speed/              # QQ 飞车
│   ├── src/               # 15 个模块：vehicle / track / layouts / ai / maps / items ...
│   ├── build.mjs
│   ├── wrangler.jsonc     # Cloudflare Pages 部署配置
│   └── package.json
└── README.md
```

仓库只保存源码；`node_modules/`、`dist/` 构建产物不入库，克隆后执行上面的构建命令即可完整还原。

## 生成过程与验证

生成过程中模型自主完成的事情（摘录自各会话记录）：

- **资料考据** — 穿越火线与 QQ 飞车在动手前先联网检索官方地图布局图、键位表与攻略核对细节（运输船的集装箱摆位、QQ 飞车的 Shift 漂移 / Ctrl 氮气键位），不是凭印象瞎写
- **自测** — 全部用无头浏览器实测：加载运行无报错、模拟按键跑完整对局；鹈鹕骑车做了 320 秒快进浸泡测试（跑完一整个昼夜循环，几何体 / 纹理数量恒定，JS 堆 16–26 MB 平稳无泄漏），并专门跨过 36 km 里程取模边界验证
- **自我审查** — 鹈鹕工程在交付前派子代理独立审查代码，找出 12 个问题并全部修复（如长时间骑行后海面跳变、切换画质漏显存）
- **线上修复** — 鹈鹕上线后偶发黑屏，模型通过人为注入 NaN 复现定位（Bloom 遇无效像素扩散成黑块），加了泛光前清理 pass 并修了海面菲涅尔等两处源头，重新部署
- **部署运维** — 三个游戏分别完成 CDN 上传与缓存刷新、Cloudflare Pages 项目创建、域名绑定与证书等待、旧项目清理核对

## 追加：Fable 5.2 · 豆包单车大作战

2026-11 用 Claude Fable 5.2 追加的一个同类实测，放在 [`fable5.2鹈鹕测试/`](fable5.2鹈鹕测试/)：骑自行车的豆包对抗满城 Bug 的第三人称 3D 枪战游戏。

- 在线体验：<https://fable-5-2-doubao.riba2534.cn/>
- 同样是单会话生成、单文件 HTML、零外部资源；Three.js r186 + PBR 注入材质 + 自建后处理链（AO、体积光、运动模糊、Bloom、自动曝光、FXAA），音效与配乐由 Web Audio 实时合成
- 提示词原文、玩法、技术细节与自测记录见该目录下的 [README](fable5.2鹈鹕测试/README.md)

## 追加：Fable 5.2 · 豆包炫舞

2026-11 用 Claude Fable 5.2 追加的另一个实测，放在 [`doubao-dance/`](doubao-dance/)：和豆包同台的 3D 节奏舞蹈游戏，敲方向键序列、踩重拍、打下落音符，和三位 AI 对手比分。

- 在线体验：<https://fable-5-2-doubao-dance.riba2534.cn/>
- 单文件 HTML；Three.js r186 卡通渲染 + LED 舞台 + Bloom 后处理，三首原创曲和全部音效由 Web Audio 实时合成，判定以音频时钟为准
- 豆包的头取自官方应用图标，运行时鼓成立体的浮雕头；这是本仓库里唯一用到外部素材的地方，其余仍是程序化生成
- 两轮提示词：第一轮生成并上线，第二轮派五个代理找素材和做审查（代码缺陷、画面布局、玩法数值），按结论迭代后重新上线
- 提示词原文、形象来源、审查结论与自测记录见该目录下的 [README](doubao-dance/README.md)

## 说明

- 本仓库由 Claude Opus 5.5 在 Claude Code 中生成（2026-09）；三个游戏的源码、README 均为模型输出原样，人工未做改动
- 游戏为能力测试用途的致敬作品，与《穿越火线》《QQ 飞车》原厂无关
