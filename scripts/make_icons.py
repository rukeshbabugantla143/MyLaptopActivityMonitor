"""Generates the app icon (app.ico + PNGs) with pure Python - no external libraries or downloads."""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def render(n):
    """Rounded dark tile, three rising bars (blue -> violet) and a green 'live' dot. Anti-aliased by 4x4 supersampling."""
    px = bytearray(n * n * 4)
    ss = 4
    r = 0.22  # corner radius (fraction)
    bars = [(0.20, 0.36, 0.62), (0.42, 0.58, 0.44), (0.64, 0.80, 0.26)]  # x0, x1, top (fraction); bottom = 0.78

    def sample(x, y):
        # rounded square
        cx = min(max(x, r), 1 - r); cy = min(max(y, r), 1 - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
            return None
        col = (14, 18, 27)
        for i, (x0, x1, top) in enumerate(bars):
            if x0 <= x <= x1 and top <= y <= 0.78:
                t = i / 2
                col = (int(124 + (167 - 124) * t), int(156 + (139 - 156) * t), int(255 + (250 - 255) * t))
        if (x - 0.76) ** 2 + (y - 0.20) ** 2 <= 0.075 ** 2:
            col = (74, 222, 128)
        return col

    for py in range(n):
        for pxl in range(n):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = sample((pxl + (sx + 0.5) / ss) / n, (py + (sy + 0.5) / ss) / n)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 1
            k = (py * n + pxl) * 4
            if acc[3]:
                px[k:k + 4] = bytes((acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], 255 * acc[3] // (ss * ss)))
    return bytes(px)


def png(n, rgba):
    raw = b"".join(b"\x00" + rgba[y * n * 4:(y + 1) * n * 4] for y in range(n))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico(images):
    head = struct.pack("<HHH", 0, 1, len(images))
    off = 6 + 16 * len(images)
    dirs, data = b"", b""
    for n, p in images:
        dirs += struct.pack("<BBBBHHII", n % 256, n % 256, 0, 0, 1, 32, len(p), off + len(data))
        data += p
    return head + dirs + data


if __name__ == "__main__":
    out = os.path.join(ROOT, "assets"); os.makedirs(out, exist_ok=True)
    pngs = {n: png(n, render(n)) for n in (16, 32, 48, 64, 192, 256, 512)}
    open(os.path.join(out, "app.ico"), "wb").write(ico([(n, pngs[n]) for n in (16, 32, 48, 64, 256)]))
    pub = os.path.join(ROOT, "dashboard", "public"); os.makedirs(pub, exist_ok=True)
    for n in (192, 512):
        open(os.path.join(pub, f"icon-{n}.png"), "wb").write(pngs[n])
    open(os.path.join(ROOT, "dashboard", "app", "icon.png"), "wb").write(pngs[64])  # favicon / window icon
    for n in (16, 48, 128):
        p = png(n, render(n)); open(os.path.join(ROOT, "chrome-extension", f"icon-{n}.png"), "wb").write(p)
    print("icons written")
