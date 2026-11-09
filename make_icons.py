#!/usr/bin/env python3
"""Draws the Floodlight app icons (no image libraries needed). Run: python3 make_icons.py"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
BG = (11, 17, 28)          # night-sky navy
PANEL = (232, 236, 243)    # floodlight frame
LAMP = (244, 197, 66)      # lamp yellow
GLOW = (244, 197, 66)


def png(path, w, h, pixels):
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def inside(x, y, s):
    """Colour of the logo at unit coordinates (0..1), drawn on a 32-unit grid like the header logo."""
    u, v = x * 32, y * 32
    # soft glow behind the lamps
    d = ((u - 16) ** 2 + (v - 11) ** 2) ** 0.5
    col = None
    # lamp head: rounded rectangle 5..27 x 6..16
    def rrect(x0, y0, x1, y1, r):
        cx, cy = min(max(u, x0 + r), x1 - r), min(max(v, y0 + r), y1 - r)
        return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
    if rrect(14.4, 14, 17.6, 27.5, .8):
        col = PANEL                                                      # pole
    if rrect(5, 5.5, 27, 16, 2.2):
        col = PANEL                                                      # head
    for cx in (10, 16, 22):
        if (u - cx) ** 2 + (v - 10.75) ** 2 <= 2.6 ** 2:
            col = LAMP
    if rrect(10, 26.5, 22, 28.2, .8):
        col = PANEL                                                      # base
    if col is None and d < 16:
        a = max(0.0, 1 - d / 16) ** 2 * .22
        col = tuple(round(BG[i] * (1 - a) + GLOW[i] * a) for i in range(3))
    return col or BG


def icon(size, pad):
    """pad: share of the canvas left empty around the logo (maskable icons need a safe zone)."""
    ss = 3  # supersampling for smooth edges
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + .5) / ss) / size
                    y = (py + (sy + .5) / ss) / size
                    lx, ly = (x - pad) / (1 - 2 * pad), (y - pad) / (1 - 2 * pad)
                    c = inside(lx, ly, size) if 0 <= lx <= 1 and 0 <= ly <= 1 else BG
                    for i in range(3):
                        acc[i] += c[i]
            row.append(tuple(round(a / ss / ss) for a in acc))
        rows.append(row)
    return rows


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, size, pad in (("icon-192.png", 192, .14), ("icon-512.png", 512, .14), ("apple-touch-icon.png", 180, .12),
                            ("maskable-512.png", 512, .22)):
        png(OUT / name, size, size, icon(size, pad))
        print("wrote", OUT / name)
