"""Generate ChatSweep toolbar icons (stdlib only): teal rounded square with a white broom.

Usage: python scripts/make-icons.py   → writes public/icon/{16,32,48,128}.png
"""
import math
import os
import struct
import zlib

TEAL = (13, 148, 136)
WHITE = (255, 255, 255)
SS = 4  # supersampling per axis


def rounded_square(x, y, r=0.22):
    # x,y in [0,1]
    dx = max(abs(x - 0.5) - (0.5 - r), 0)
    dy = max(abs(y - 0.5) - (0.5 - r), 0)
    return dx * dx + dy * dy <= r * r


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    cx, cy = ax + t * vx, ay + t * vy
    return math.hypot(px - cx, py - cy)


def in_poly(px, py, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# Broom: handle from top-right to centre, bristles fanning out to bottom-left with gaps.
_T = (0.48, 0.52)  # top of the bristles
_D = (-0.682, 0.731)  # handle direction (unit), pointing to bottom-left
_N = (0.731, 0.682)  # perpendicular
_LEN, _TOP_W, _BOT_W = 0.32, 0.075, 0.17
_B = (_T[0] + _D[0] * _LEN, _T[1] + _D[1] * _LEN)
HANDLE = (0.80, 0.18, _T[0], _T[1])
BRISTLES = [
    (_T[0] + _N[0] * _TOP_W, _T[1] + _N[1] * _TOP_W),
    (_B[0] + _N[0] * _BOT_W, _B[1] + _N[1] * _BOT_W),
    (_B[0] - _N[0] * _BOT_W, _B[1] - _N[1] * _BOT_W),
    (_T[0] - _N[0] * _TOP_W, _T[1] - _N[1] * _TOP_W),
]
GAPS = []
for k in (-0.085, 0.0, 0.085):
    gx, gy = _B[0] + _N[0] * k, _B[1] + _N[1] * k
    GAPS.append((gx, gy, gx - _D[0] * 0.15, gy - _D[1] * 0.15))


def is_white(x, y):
    if seg_dist(x, y, *HANDLE) < 0.05:
        return True
    if not in_poly(x, y, BRISTLES):
        return False
    return all(seg_dist(x, y, *g) > 0.016 for g in GAPS)


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type 0
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    if not rounded_square(x, y):
                        continue
                    c = WHITE if is_white(x, y) else TEAL
                    r += c[0]
                    g += c[1]
                    b += c[2]
                    a += 255
            n = SS * SS
            if a:
                cov = a / 255
                row += bytes([round(r / cov), round(g / cov), round(b / cov), round(a / n)])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icon")
    os.makedirs(root, exist_ok=True)
    for size in (16, 32, 48, 128):
        with open(os.path.join(root, f"{size}.png"), "wb") as f:
            f.write(render(size))
        print(f"wrote public/icon/{size}.png")


if __name__ == "__main__":
    main()
