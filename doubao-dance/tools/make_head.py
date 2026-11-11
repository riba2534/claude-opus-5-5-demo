#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""从豆包官方应用图标生成游戏用的头部贴图。

输入：App Store 上「豆包」(com.bot.doubao) 的 1024×1024 应用图标 PNG，
      可通过 https://itunes.apple.com/lookup?bundleId=com.bot.doubao&country=cn 查到地址。
输出（写到 src/assets/）：
  doubao-head.webp     去掉背景和肩膀的头部，带透明通道
  eye-{l,r}-{closed,happy}.webp  闭眼 / 笑眼的眼部补丁，运行时叠在头部贴图上做表情
  doubao-avatar.webp   HUD 里用的小头像
  head.json            尺寸、脖子位置、补丁偏移、取样颜色

用法：tools/make_head.py <icon-1024.png> [输出目录]
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets')
os.makedirs(OUT, exist_ok=True)
HEAD_H = 640


# ---------------------------------------------------------------- 1. 抠掉背景
def cutout(im):
    """背景只有两种颜色（圆外的白、圆内的浅蓝）。人物内部的近白像素（眼白、高光）
    不与背景连通，所以用"颜色接近背景 + 与背景种子连通"来判定背景。"""
    W, H = im.size
    a = np.asarray(im).astype(np.float32)
    white = np.array([255, 255, 255], np.float32)
    blue = np.mean([a[int(H * fy), int(W * fx)] for fx, fy in [(0.13, 0.5), (0.87, 0.5), (0.15, 0.62), (0.86, 0.38)]], axis=0)
    d_white = np.linalg.norm(a - white, axis=2)
    d_blue = np.linalg.norm(a - blue, axis=2)
    # 白与蓝之间的过渡带（圆的抗锯齿边缘）也算背景
    ab = blue - white
    t = np.clip(((a - white) @ ab) / (ab @ ab), 0, 1)
    d_line = np.linalg.norm(a - (white + t[..., None] * ab), axis=2)
    d_bg = np.minimum(np.minimum(d_white, d_blue), d_line)

    cand = d_bg < 26.0
    seen = np.zeros((H, W), bool)
    q = deque()

    def seed(x, y):
        if 0 <= x < W and 0 <= y < H and cand[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((x, y))

    for x in range(W):
        seed(x, 0)
        seed(x, H - 1)
    for y in range(H):
        seed(0, y)
        seed(W - 1, y)
    for fx, fy in [(0.13, 0.5), (0.87, 0.5), (0.15, 0.62), (0.86, 0.38), (0.84, 0.66), (0.36, 0.7), (0.68, 0.66)]:
        seed(int(W * fx), int(H * fy))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((nx, ny))
    bg = seen

    # 边缘一圈按颜色距离给软 alpha，并把混进来的背景色减掉
    near = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
    edge = near & ~bg
    alpha = np.where(bg, 0.0, 1.0).astype(np.float32)
    alpha[edge] = np.clip((d_bg - 10.0) / 60.0, 0, 1)[edge]
    B = np.where((d_white < d_blue)[..., None], white, blue)
    al = np.clip(alpha, 0.05, 1)[..., None]
    rgb = np.clip(np.where(edge[..., None], (a - (1 - al) * B) / al, a), 0, 255)
    return rgb, alpha


# ---------------------------------------------------------------- 2. 切出头部
def bleed(rgb, alpha, rounds=24):
    """透明区域的 RGB 用邻近的不透明颜色填充，避免贴图过滤时边缘渗出杂色。"""
    rgb = rgb.copy()
    known = alpha > 0.5
    for _ in range(rounds):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(rgb, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        new = (~known) & (cnt > 0)
        rgb[new] = acc[new] / cnt[new][:, None]
        known |= new
    return rgb


def head_crop(rgb, alpha):
    H, W = alpha.shape
    S = W / 640.0  # 下面的坐标是在 640 宽的图上量的
    y_hair, y_neck = 436 * S, 458 * S
    neck_cx, neck_hw = 340 * S, 62 * S
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    keep = (yy < y_hair).astype(np.float32)
    # 下巴下面留一小截底边为半椭圆的脖子
    bottom = y_hair + (y_neck - y_hair) * np.sqrt(np.clip(1 - ((xx - neck_cx) / neck_hw) ** 2, 0, 1))
    keep = np.maximum(keep, np.clip((bottom - yy) / (4 * S), 0, 1) * (np.abs(xx - neck_cx) < neck_hw))
    alpha = alpha * keep
    ys, xs = np.where(alpha > 0.02)
    pad = int(6 * S)
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(W, xs.max() + 1 + pad), min(H, ys.max() + 1 + pad)
    rgb = bleed(rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1])
    img = Image.fromarray(np.dstack([rgb, alpha[y0:y1, x0:x1] * 255]).astype(np.uint8), 'RGBA')
    k = HEAD_H / img.size[1]
    img = img.resize((round(img.size[0] * k), HEAD_H), Image.LANCZOS)

    def to_head(px, py):  # 640 坐标 → 头部图的归一化坐标
        return [round(float((px * S - x0) / (x1 - x0)), 4), round(float((py * S - y0) / (y1 - y0)), 4)]

    # crop：头部图在原图标里的位置（归一化），运行时把官方图投影到 3D 头模上要用
    crop = [round(float(v), 5) for v in (x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H)]
    return img, {'neck': to_head(340, 446), 'chin': to_head(343, 424), 'crop': crop}


# ---------------------------------------------------------------- 3. 表情补丁
# 以下坐标都在 576×640 的头部图上量得。眼部遮罩是沿着上眼线外扩一圈的多边形：
# 上边不碰眉毛，左眼不越过左侧发际，右眼不越过耳前的那缕头发。
EYES = {
    'l': {
        'poly': [(134, 332), (148, 316), (178, 307), (210, 305), (242, 313), (266, 329), (280, 352), (280, 400), (262, 417), (210, 423), (160, 417), (139, 400), (134, 372)],
        'closed': {'curve': [(143, 371), (203, 414), (267, 383)], 'wing': (134, 360)},
        'happy': {'curve': [(143, 393), (204, 336), (267, 394)], 'wing': None},
    },
    'r': {
        'poly': [(365, 364), (379, 346), (410, 330), (445, 323), (476, 331), (500, 347), (510, 362), (510, 420), (482, 435), (410, 437), (371, 425), (365, 400)],
        'closed': {'curve': [(374, 391), (441, 434), (500, 386)], 'wing': (508, 376)},
        'happy': {'curve': [(374, 405), (437, 348), (501, 401)], 'wing': None},
    },
}
LASH = (40, 27, 27)


def poly_mask(size, poly, feather, ss=4):
    m = Image.new('L', (size[0] * ss, size[1] * ss), 0)
    ImageDraw.Draw(m).polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    m = m.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(2))  # 先把折角磨圆
    m = m.point(lambda v: 255 if v > 127 else 0)
    if feather:
        m = m.filter(ImageFilter.MinFilter(2 * feather + 1)).filter(ImageFilter.GaussianBlur(feather * 0.6))
    return np.asarray(m).astype(np.float32) / 255.0


def inpaint(rgb, hole, iters=900):
    """用周围的皮肤颜色把 hole 区域平滑填满（解拉普拉斯方程）。深色像素（头发）不参与。"""
    out = rgb.copy()
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    valid = (~hole) & (lum > 150)
    usable = hole | valid
    out[hole] = rgb[valid].mean(axis=0)
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(hole.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            k = np.roll(usable, (dy, dx), (0, 1))
            acc += np.roll(out, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        upd = hole & (cnt > 0)
        out[upd] = acc[upd] / cnt[upd][:, None]
    return out


def lash_layer(size, spec, ss=4):
    """画一条两头细中间粗的睫毛弧线，返回 0..1 的覆盖度。"""
    layer = Image.new('L', (size[0] * ss, size[1] * ss), 0)
    d = ImageDraw.Draw(layer)
    (x0, y0), (cx, cy), (x1, y1) = spec['curve']
    n = 160
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1
        r = 1.7 + 2.9 * np.sin(np.pi * t) ** 0.8
        d.ellipse([(x - r) * ss, (y - r) * ss, (x + r) * ss, (y + r) * ss], fill=255)
    if spec['wing']:
        # 眼尾上挑的一小撇，和原图睁眼时的眼线呼应
        ox, oy = (x0, y0) if abs(spec['wing'][0] - x0) < abs(spec['wing'][0] - x1) else (x1, y1)
        wx, wy = spec['wing']
        for i in range(41):
            t = i / 40
            r = 2.6 * (1 - t) + 0.7
            x, y = ox + (wx - ox) * t, oy + (wy - oy) * t
            d.ellipse([(x - r) * ss, (y - r) * ss, (x + r) * ss, (y + r) * ss], fill=255)
    layer = layer.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    return np.asarray(layer).astype(np.float32) / 255.0


def eye_patches(head):
    arr = np.asarray(head).astype(np.float32)
    rgb = arr[..., :3]
    size = head.size
    patches = {}
    for side, e in EYES.items():
        poly = e['poly']
        box = (min(x for x, _ in poly), min(y for _, y in poly), max(x for x, _ in poly), max(y for _, y in poly))
        hole = poly_mask(size, poly, 0) > 0.5
        filled = inpaint(rgb, hole)
        soft = poly_mask(size, poly, 3)
        for name in ('closed', 'happy'):
            lash = lash_layer(size, e[name])
            # 眼线下方加一点很淡的阴影，让闭上的眼睑有厚度
            shade = np.asarray(Image.fromarray((lash * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255.0
            col = filled * (1 - 0.1 * shade[..., None])
            col = col * (1 - lash[..., None]) + np.array(LASH, np.float32) * lash[..., None]
            pad = 4
            x0, y0, x1, y1 = box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad
            patch = np.dstack([col[y0:y1, x0:x1], soft[y0:y1, x0:x1] * 255]).astype(np.uint8)
            patches[f'eye-{side}-{name}'] = (Image.fromarray(patch, 'RGBA'), [x0, y0])
    return patches


# ---------------------------------------------------------------- 主流程
icon = Image.open(SRC).convert('RGB')
if icon.size != (1024, 1024):
    icon = icon.resize((1024, 1024), Image.LANCZOS)
rgb, alpha = cutout(icon)
head, meta = head_crop(rgb, alpha)
head.save(os.path.join(OUT, 'doubao-head.webp'), quality=90, method=6, exact=True)
meta['size'] = list(head.size)

meta['patches'] = {}
for name, (img, off) in eye_patches(head).items():
    img.save(os.path.join(OUT, name + '.webp'), quality=88, method=6, exact=True)
    meta['patches'][name] = off

# HUD 小头像：以脸为中心的正方形
head.crop((84, 120, 548, 584)).resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, 'doubao-avatar.webp'), quality=86, method=6)

# 取样颜色，给身体材质配色用
px = np.asarray(head).astype(np.float32)[..., :3]


def sample(x, y, r=6):
    return '#%02x%02x%02x' % tuple(int(v) for v in px[y - r:y + r, x - r:x + r].reshape(-1, 3).mean(axis=0))


meta['colors'] = {
    'skin': sample(330, 250),
    'skinShade': sample(312, 600),
    'hair': sample(70, 300),
    'hairLight': sample(250, 80),
    'hairDark': sample(40, 480),
}
json.dump(meta, open(os.path.join(OUT, 'head.json'), 'w'), indent=1)
print(json.dumps(meta, ensure_ascii=False))
for f in sorted(os.listdir(OUT)):
    print(f'  {f:24s} {os.path.getsize(os.path.join(OUT, f)):7d} bytes')
