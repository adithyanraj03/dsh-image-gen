"""Render the 'picture being made' water/reveal animation to an animated GIF.

A numpy port of the WebGL fragment shader in src/client/generating-panel.ts
(amber water sheet + ripple rings + star mesh + radial ripple-reveal), so the
README GIF matches the real loading animation. Prints base64 GIF to stdout
(the bundled runtime cannot write files); the caller decodes it to disk.

Usage: python make-generating-gif.py <target-image> [width] [height]
"""
import base64
import io
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TINT = (1.0, 0.66, 0.36, 0.85)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def h(qx, qy):
    return np.mod(np.sin(qx * 127.1 + qy * 311.7) * 43758.5453, 1.0)


def hs(a, b):
    return math.modf(math.sin(a * 127.1 + b * 311.7) * 43758.5453)[0] % 1.0


def n(qx, qy):
    ix, iy = np.floor(qx), np.floor(qy)
    fx, fy = qx - ix, qy - iy
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = h(ix, iy)
    b = h(ix + 1, iy)
    c = h(ix, iy + 1)
    d = h(ix + 1, iy + 1)
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy


def fbm(qx, qy):
    s = np.zeros_like(qx)
    a = 0.5
    for _ in range(4):
        s += a * n(qx, qy)
        qx = qx * 2.03 + 1.7
        qy = qy * 2.03 + 9.2
        a *= 0.5
    return s


def bilinear(tex, sx, sy):
    H, W = tex.shape[:2]
    x = np.clip(sx * W - 0.5, 0, W - 1.001)
    y = np.clip(sy * H - 0.5, 0, H - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, W - 1), np.minimum(y0 + 1, H - 1)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    top = tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx
    bot = tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx
    return top * (1 - fy) + bot * fy


def words_texture(W, H, pct, stage, secs, bar):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        f_icon = ImageFont.truetype('C:/Windows/Fonts/seguiemj.ttf', 17)
    except Exception:
        f_icon = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
    f_pct = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 30)
    f_stage = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 13)
    f_time = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 12)
    rows = [
        ('✦', f_icon, (246, 244, 255, 217), 26),
        (pct, f_pct, (250, 248, 255, 247), 38),
        (stage, f_stage, (246, 244, 255, 224), 20),
        (f'{secs // 60}:{secs % 60:02d}', f_time, (246, 244, 255, 140), 18),
    ]
    y = H / 2 - sum(r[3] for r in rows) / 2
    for text, font, color, lh in rows:
        d.text((W / 2, y + lh / 2), text, font=font, fill=color, anchor='mm')
        y += lh
    # progress bar along the bottom, like the panel's nm-gen-bar
    d.rectangle([0, H - 5, W, H], fill=(255, 255, 255, 26))
    d.rectangle([0, H - 5, W * bar, H], fill=(255, 196, 110, 200))
    a = np.asarray(img).astype(np.float64) / 255.0
    a[..., :3] *= a[..., 3:4]  # premultiplied, as the shader expects
    return a


def render(W, H, t, reveal, words, frame):
    asp = W / H
    yy, xx = np.mgrid[0:H, 0:W]
    vx = (xx + 0.5) / W
    vy = (yy + 0.5) / H
    cx = (vx - 0.5) * asp
    cy = (vy - 0.5)
    ox = np.zeros_like(vx)
    oy = np.zeros_like(vx)
    crest = np.zeros_like(vx)
    wv = np.zeros_like(vx)
    for i in range(4):
        fi = float(i)
        P = 7 + fi * 2.3 + hs(fi, 3.1) * 3
        tt = t + hs(fi, 9.7) * P
        k = math.floor(tt / P)
        lt = tt - k * P - hs(k, fi + 0.5) * P * 0.45
        if lt <= 0:
            continue
        sx = (hs(k, fi + 1.3) - 0.5) * asp * 0.75
        sy = (hs(fi + 2.1, k) - 0.5) * 0.7
        if i == 0:
            sx *= 0.35
            sy *= 0.35
        speed = 0.11 + 0.07 * hs(k + 4, fi)
        amp = 0.55 + 0.45 * hs(fi, k + 7)
        dvx, dvy = cx - sx, cy - sy
        r = np.sqrt(dvx * dvx + dvy * dvy)
        R = lt * speed
        d = r - R
        fade = amp * np.exp(-R * 1.6) * smoothstep(0, 0.35, lt)
        env = np.exp(-d * d * 22)
        wave = np.sin(d * 30) * env * fade
        wv += wave
        ox += (dvx / np.maximum(r, 1e-4)) * wave * 0.024
        oy += (dvy / np.maximum(r, 1e-4)) * wave * 0.024
        crest += np.exp(-d * d * 700) * fade
    ox += (np.sin(cy * 3.1 + t * 0.42) + 0.7 * np.sin(cx * 2.3 - t * 0.31 + 1)) * 0.0042
    oy += (np.cos(cx * 2.7 + t * 0.37) + 0.7 * np.sin(cy * 3.7 - t * 0.27)) * 0.0042
    ux, uy = vx + ox / asp, vy + oy
    cux, cuy = (ux - 0.5) * asp, (uy - 0.5)
    m = smoothstep(-0.1, 1.1, uy)
    col = np.stack([0.55 + (0.26 - 0.55) * m, 0.565 + (0.275 - 0.565) * m, 0.665 + (0.35 - 0.665) * m], -1)
    wx = fbm(cux * 1.1 + t * 0.07, cuy * 1.1)
    wy = fbm(cux * 1.1 + 3.2, cuy * 1.1 - t * 0.06)
    s = fbm(cux * 1.25 + wx * 1.35 + t * 0.05, cuy * 1.25 + wy * 1.35 - t * 0.035)
    dark = smoothstep(0.4, 0.95, s + 0.5 - np.sqrt((cux * 0.8) ** 2 + cuy ** 2) * 0.85)
    col = col + (np.array([0.07, 0.075, 0.105]) - col) * (dark * 0.9)[..., None]
    gx, gy = cux * 46, cuy * 46
    fx, fy = np.mod(gx, 1) - 0.5, np.mod(gy, 1) - 0.5
    px = 46 / H * 0.9
    p1 = np.abs(fx + fy) * 0.7071
    p2 = np.abs(fx - fy) * 0.7071
    w1 = 0.13 + (0.03 - 0.13) * smoothstep(0, 0.62, p1)
    w2 = 0.13 + (0.03 - 0.13) * smoothstep(0, 0.62, p2)
    star = np.maximum(1 - smoothstep(w1 - px * 0.5, w1 + px * 0.5, p2), 1 - smoothstep(w2 - px * 0.5, w2 + px * 0.5, p1))
    e0 = np.minimum(np.minimum(vx, 1 - vx) * asp, np.minimum(vy, 1 - vy))
    mesh = np.minimum(0.12 + 0.38 * np.exp(-e0 * 6) + np.abs(wv) * 0.7, 1.1)
    lift = np.clip(1 + 3 * wv, 0, 3.4)
    col += np.array([0.88, 0.88, 1.0]) * (star * mesh * (0.07 + 0.03 * dark) * lift)[..., None]
    col += np.array([0.86, 0.83, 1.0]) * (crest * 0.2)[..., None]
    ex = np.minimum(vx, 1 - vx) * asp
    ey = np.minimum(vy, 1 - vy)
    e = -np.log(np.exp(-ex * 14) + np.exp(-ey * 14)) / 14
    col += np.array([0.92, 0.9, 1.0]) * (np.exp(-np.maximum(e, 0) * 11) * (0.24 + 0.08 * np.sin(t * 1.3)))[..., None]
    col += np.exp(-(1 - vx) * asp * 9)[..., None] * (0.1 + 0.1 * np.sin(t * 0.7))
    col += np.array([0.93, 0.9, 1.0]) * (np.exp(-vx * asp * 10) * (0.06 + 0.06 * np.sin(t * 0.55 + 1)))[..., None]
    lum = col @ np.array([0.299, 0.587, 0.114])
    col = col + (lum[..., None] * np.array(TINT[:3]) * 1.55 - col) * TINT[3]
    w = bilinear(words, vx + ox / asp * 1.1, vy + oy * 1.1)
    col = col * (1 - w[..., 3:4]) + w[..., :3]
    if reveal > 0:
        rv = np.sqrt(cx * cx + cy * cy)
        dirx, diry = cx / np.maximum(rv, 1e-4), cy / np.maximum(rv, 1e-4)
        dv2 = rv - reveal * 1.5
        inside = 1 - smoothstep(-0.22, 0.03, dv2)
        ring = np.sin(dv2 * 30) * np.exp(-dv2 * dv2 * 22) * 0.024 * (1 - reveal)
        fox = dirx * ring + ox * (1 - reveal)
        foy = diry * ring + oy * (1 - reveal)
        fr = bilinear(frame, vx + fox / asp, vy + foy)
        col = col + (fr - col) * inside[..., None]
        col += np.array([0.9, 0.88, 1.0]) * (np.exp(-dv2 * dv2 * 500) * 0.28 * (1 - reveal))[..., None]
    return np.clip(col, 0, 1)


def ease(x):
    return 2 * x * x if x < 0.5 else 1 - ((-2 * x + 2) ** 2) / 2


def main():
    src = sys.argv[1]
    W = int(sys.argv[2]) if len(sys.argv) > 2 else 480
    H = int(sys.argv[3]) if len(sys.argv) > 3 else 270
    frame = np.asarray(Image.open(src).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float64) / 255.0
    frames, durations = [], []
    NW, NR = 20, 16
    for i in range(NW):
        t = i * 0.08
        pct = 5 + i * 4.4
        words = words_texture(W, H, f'{int(pct)}%', 'Painting the picture…', int(t), pct / 100)
        frames.append(Image.fromarray((render(W, H, t, 0.0, words, frame) * 255).astype(np.uint8)))
        durations.append(80)
    for j in range(NR):
        x = j / (NR - 1)
        t = NW * 0.08 + j * 0.09
        words = words_texture(W, H, '100%', 'Revealing', int(t), 1.0)
        frames.append(Image.fromarray((render(W, H, t, ease(x), words, frame) * 255).astype(np.uint8)))
        durations.append(80)
    for _ in range(2):
        frames.append(Image.fromarray((frame * 255).astype(np.uint8)))
        durations.append(500)
    buf = io.BytesIO()
    frames[0].save(buf, format='GIF', save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
    sys.stdout.write(base64.b64encode(buf.getvalue()).decode())


if __name__ == '__main__':
    main()
