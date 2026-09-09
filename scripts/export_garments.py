#!/usr/bin/env python3
"""Re-export catalog garment art into the shape FASHN VTON v1.6 wants.

The model is fed a flat-lay packshot. Three things about the source art broke
that contract, and this script fixes all three in one pass:

  * inconsistent size      -- 540x360 through 2000x2667 across the catalog
  * inconsistent aspect    -- one landscape, one square, one portrait
  * inconsistent framing   -- garments sat at wildly different scales in-frame

The output is a uniform 864x1152 portrait PNG with the garment trimmed to its
own bounding box, scaled to a fixed share of the canvas, and centred on white.
White, not transparent: VTON encoders are trained on white packshots, and an
alpha channel just gets composited onto black somewhere downstream.

macOS only -- it shells out to sips for the resampling, which is the one piece
worth not writing by hand. Bounding-box detection is done here because sips
crops from the centre only. Run it with `npm run garments`; the PNGs it writes
are committed, so a fresh clone never needs to.
"""

import os
import struct
import subprocess
import sys
import tempfile

# Canvas the app and the model both expect. 3:4 portrait, long edge >= 864.
CANVAS_W, CANVAS_H = 864, 1152

# Fraction of the canvas the garment itself may occupy. The remainder is white
# margin, which keeps every catalog thumbnail optically the same size and gives
# the encoder the packshot framing it was trained on.
CONTENT_FRACTION = 0.90

# A pixel counts as garment if any channel is this far below white. Source art
# is JPEG, so the background sits around 248-255 with ringing near edges; 238
# clears the noise without eating genuine light-coloured fabric.
WHITE_CUTOFF = 238

# Ignore rows/columns with fewer than this many content pixels, so a stray
# compression artefact can't drag the bounding box out to the frame edge.
MIN_RUN = 3

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public", "garments")

# source basename -> output id. Only upper-body garments: FASHN runs with
# category='tops', so bottoms and full-length dresses have no place here.
GARMENTS = [
    ("M1-tracksuit.jpeg", "M1-track-jacket"),
    ("M2-Business.jpg", "M2-navy-blazer"),
    ("W2-Business.jpg", "W2-blue-blazer"),
]


def read_bmp(path):
    """Return (width, height, rows) for a 24/32-bit uncompressed BMP.

    rows is a list of bytearrays in top-to-bottom order, each pixel BGR(A).
    """
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:2] != b"BM":
        raise ValueError(f"{path}: not a BMP")
    offset = struct.unpack_from("<I", data, 10)[0]
    width, height = struct.unpack_from("<ii", data, 18)
    bpp = struct.unpack_from("<H", data, 28)[0]
    compression = struct.unpack_from("<I", data, 30)[0]
    if bpp not in (24, 32) or compression != 0:
        raise ValueError(f"{path}: need uncompressed 24/32-bit, got {bpp}bpp comp={compression}")

    bottom_up = height > 0
    height = abs(height)
    stride = ((bpp * width + 31) // 32) * 4
    step = bpp // 8

    rows = []
    for y in range(height):
        start = offset + y * stride
        rows.append(data[start : start + width * step])
    if bottom_up:
        rows.reverse()
    return width, height, rows, step


def content_bbox(width, height, rows, step):
    """Bounding box of non-white pixels, as (left, top, right, bottom) inclusive."""
    col_hits = [0] * width
    row_hits = [0] * height

    for y, row in enumerate(rows):
        hits = 0
        for x in range(width):
            base = x * step
            # BGR order; a garment pixel is anything meaningfully off-white.
            if (
                row[base] < WHITE_CUTOFF
                or row[base + 1] < WHITE_CUTOFF
                or row[base + 2] < WHITE_CUTOFF
            ):
                hits += 1
                col_hits[x] += 1
        row_hits[y] = hits

    rows_with = [y for y, n in enumerate(row_hits) if n >= MIN_RUN]
    cols_with = [x for x, n in enumerate(col_hits) if n >= MIN_RUN]
    if not rows_with or not cols_with:
        raise ValueError("no garment found -- is the background actually white?")
    return cols_with[0], rows_with[0], cols_with[-1], rows_with[-1]


def write_bmp(path, width, height, rows, step):
    """Write a 24-bit uncompressed BMP, top-down."""
    stride = ((24 * width + 31) // 32) * 4
    pad = stride - width * 3
    body = bytearray()
    for row in rows:
        if step == 3:
            body += row
        else:
            for x in range(width):
                body += row[x * step : x * step + 3]
        body += b"\x00" * pad

    header = bytearray(54)
    header[0:2] = b"BM"
    struct.pack_into("<I", header, 2, 54 + len(body))
    struct.pack_into("<I", header, 10, 54)
    struct.pack_into("<I", header, 14, 40)
    struct.pack_into("<ii", header, 18, width, -height)  # negative => top-down
    struct.pack_into("<HH", header, 26, 1, 24)
    struct.pack_into("<I", header, 34, len(body))
    with open(path, "wb") as fh:
        fh.write(header)
        fh.write(body)


def sips(*args):
    subprocess.run(["sips", *args], check=True, capture_output=True)


def export(src, out_id, tmp):
    stem = os.path.join(tmp, out_id)
    raw, cropped = stem + "-raw.bmp", stem + "-crop.bmp"
    out = os.path.join(OUT_DIR, out_id + ".png")

    sips("-s", "format", "bmp", src, "--out", raw)
    width, height, rows, step = read_bmp(raw)
    left, top, right, bottom = content_bbox(width, height, rows, step)

    cw, ch = right - left + 1, bottom - top + 1
    crop_rows = [row[left * step : (right + 1) * step] for row in rows[top : bottom + 1]]
    write_bmp(cropped, cw, ch, crop_rows, step)

    # Contain the trimmed garment inside the content box, preserving aspect.
    box_w, box_h = CANVAS_W * CONTENT_FRACTION, CANVAS_H * CONTENT_FRACTION
    if cw / ch > box_w / box_h:
        sips("--resampleWidth", str(int(round(box_w))), cropped)
    else:
        sips("--resampleHeight", str(int(round(box_h))), cropped)

    # Centre on white. sips pads symmetrically, which is what we want.
    sips("--padToHeightWidth", str(CANVAS_H), str(CANVAS_W), "--padColor", "FFFFFF", cropped)
    sips("-s", "format", "png", cropped, "--out", out)

    # Contain scale is the smaller ratio -- that's the one actually applied.
    scale = min(box_w / cw, box_h / ch)
    note = f"  (UPSCALED {scale:.2f}x -- re-source this one)" if scale > 1.05 else ""
    print(f"  {os.path.basename(src):22s} {width}x{height} -> trim {cw}x{ch} -> {CANVAS_W}x{CANVAS_H}{note}")


def main():
    if sys.platform != "darwin":
        sys.exit("export_garments.py needs macOS (sips). Output PNGs are committed; "
                 "you only need this when adding or replacing catalog art.")

    src_dir = os.environ.get(
        "GARMENT_SRC",
        os.path.join(os.path.dirname(REPO), "Youfit", "Garments"),
    )
    if not os.path.isdir(src_dir):
        sys.exit(f"source art not found: {src_dir}\nSet GARMENT_SRC to the folder holding the packshots.")

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"source: {src_dir}\noutput: {OUT_DIR}")

    with tempfile.TemporaryDirectory() as tmp:
        for filename, out_id in GARMENTS:
            src = os.path.join(src_dir, filename)
            if not os.path.exists(src):
                print(f"  {filename:22s} MISSING -- skipped")
                continue
            export(src, out_id, tmp)

    print("done. Add new garments to GARMENTS above and to src/garments.js.")


if __name__ == "__main__":
    main()
