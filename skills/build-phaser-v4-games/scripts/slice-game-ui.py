#!/usr/bin/env python3
"""Cut and preview an untrimmed game UI texture as a Phaser nine-slice."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageChops
except ImportError as error:
    raise SystemExit(
        "slice-game-ui.py requires Pillow. In Codex desktop, load workspace "
        "dependencies and run the script with the returned Python executable."
    ) from error


SLICE_NAMES = (
    ("top-left", "top", "top-right"),
    ("left", "center", "right"),
    ("bottom-left", "bottom", "bottom-right"),
)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return parsed


def preview_size(value: str) -> tuple[int, int]:
    try:
        width_text, height_text = value.lower().split("x", 1)
        return positive_int(width_text), positive_int(height_text)
    except (ValueError, argparse.ArgumentTypeError) as error:
        raise argparse.ArgumentTypeError("preview size must use WIDTHxHEIGHT") from error


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cut a UI bitmap into nine cells and render Phaser-style previews."
    )
    parser.add_argument("input", type=Path, help="Untrimmed source bitmap")
    parser.add_argument(
        "--insets",
        type=positive_int,
        nargs=4,
        metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"),
        required=True,
        help="Fixed border sizes in source pixels",
    )
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--preview",
        type=preview_size,
        action="append",
        default=[],
        metavar="WIDTHxHEIGHT",
        help="Target size to render; repeat for multiple acceptance sizes",
    )
    parser.add_argument("--tile-x", action="store_true")
    parser.add_argument("--tile-y", action="store_true")
    parser.add_argument(
        "--filter", choices=("nearest", "linear"), default="linear"
    )
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_empty_output(path: Path) -> None:
    if path.exists():
        if not path.is_dir():
            raise ValueError(f"Output path is not a directory: {path}")
        if any(path.iterdir()):
            raise ValueError(f"Output directory must be empty: {path}")
    else:
        path.mkdir(parents=True)


def split_edges(length: int, first: int, last: int) -> tuple[int, int, int, int]:
    if first + last >= length:
        raise ValueError(
            f"Insets {first}+{last} leave no scalable pixels in source length {length}"
        )
    return 0, first, length - last, length


def partition(length: int, count: int) -> list[int]:
    return [round(index * length / count) for index in range(count + 1)]


def render_region(
    source: Image.Image,
    size: tuple[int, int],
    tile_x: bool,
    tile_y: bool,
    resampling: Image.Resampling,
) -> Image.Image:
    width, height = size
    repeat_x = max(1, math.floor(width / source.width)) if tile_x else 1
    repeat_y = max(1, math.floor(height / source.height)) if tile_y else 1
    x_edges = partition(width, repeat_x)
    y_edges = partition(height, repeat_y)
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    for row in range(repeat_y):
        for column in range(repeat_x):
            left, right = x_edges[column], x_edges[column + 1]
            top, bottom = y_edges[row], y_edges[row + 1]
            tile = source.resize((right - left, bottom - top), resampling)
            result.alpha_composite(tile, (left, top))
    return result


def render_preview(
    cells: list[list[Image.Image]],
    size: tuple[int, int],
    insets: tuple[int, int, int, int],
    tile_x: bool,
    tile_y: bool,
    resampling: Image.Resampling,
) -> Image.Image:
    width, height = size
    left, top, right, bottom = insets
    x_edges = (0, left, width - right, width)
    y_edges = (0, top, height - bottom, height)
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    for row in range(3):
        for column in range(3):
            target = (
                x_edges[column + 1] - x_edges[column],
                y_edges[row + 1] - y_edges[row],
            )
            if target[0] == 0 or target[1] == 0:
                continue
            region = render_region(
                cells[row][column],
                target,
                tile_x and column == 1,
                tile_y and row == 1,
                resampling,
            )
            result.alpha_composite(region, (x_edges[column], y_edges[row]))
    return result


def fixed_corners_match(
    cells: list[list[Image.Image]], preview: Image.Image
) -> bool:
    width, height = preview.size
    corners = (
        (cells[0][0], (0, 0)),
        (cells[0][2], (width - cells[0][2].width, 0)),
        (cells[2][0], (0, height - cells[2][0].height)),
        (
            cells[2][2],
            (width - cells[2][2].width, height - cells[2][2].height),
        ),
    )
    return all(
        all(
            channel.getbbox() is None
            for channel in ImageChops.difference(
                corner,
                preview.crop((x, y, x + corner.width, y + corner.height)),
            ).split()
        )
        for corner, (x, y) in corners
    )


def main(argv: list[str]) -> int:
    options = parse_args(argv)
    source_path = options.input.resolve()
    if not source_path.is_file():
        raise ValueError(f"Input image does not exist: {source_path}")

    output = options.out_dir.resolve()
    with Image.open(source_path) as opened:
        source_mode = opened.mode
        source = opened.convert("RGBA")
    width, height = source.size
    left, top, right, bottom = options.insets
    x_edges = split_edges(width, left, right)
    y_edges = split_edges(height, top, bottom)

    previews = options.preview or [
        (width, height),
        (left + (width - left - right) * 2 + right, height),
        (
            left + (width - left - right) * 2 + right,
            top + (height - top - bottom) * 2 + bottom,
        ),
    ]
    previews = list(dict.fromkeys(previews))
    for preview_width, preview_height in previews:
        if preview_width < left + right or preview_height < top + bottom:
            raise ValueError(
                f"Preview {preview_width}x{preview_height} is smaller than fixed borders "
                f"{left + right}x{top + bottom}"
            )

    require_empty_output(output)
    slices_dir = output / "slices"
    slices_dir.mkdir()

    cells: list[list[Image.Image]] = []
    slice_records: list[dict[str, object]] = []
    for row in range(3):
        cell_row = []
        for column in range(3):
            box = (
                x_edges[column],
                y_edges[row],
                x_edges[column + 1],
                y_edges[row + 1],
            )
            cell = source.crop(box)
            name = SLICE_NAMES[row][column]
            relative = Path("slices") / f"{name}.png"
            file = output / relative
            cell.save(file, format="PNG", optimize=False)
            cell_row.append(cell)
            slice_records.append(
                {
                    "name": name,
                    "file": relative.as_posix(),
                    "x": box[0],
                    "y": box[1],
                    "width": cell.width,
                    "height": cell.height,
                    "sha256": sha256(file),
                }
            )
        cells.append(cell_row)

    guide = source.copy()
    draw = ImageDraw.Draw(guide)
    for x in (left, width - right):
        draw.line((x, 0, x, height - 1), fill=(255, 0, 255, 255), width=1)
    for y in (top, height - bottom):
        draw.line((0, y, width - 1, y), fill=(0, 255, 255, 255), width=1)
    guide_file = output / "slice-guide.png"
    guide.save(guide_file, format="PNG", optimize=False)

    resampling = (
        Image.Resampling.NEAREST
        if options.filter == "nearest"
        else Image.Resampling.BILINEAR
    )
    preview_records = []
    for preview_width, preview_height in previews:
        preview = render_preview(
            cells,
            (preview_width, preview_height),
            (left, top, right, bottom),
            options.tile_x,
            options.tile_y,
            resampling,
        )
        preview_file = output / f"preview-{preview_width}x{preview_height}.png"
        preview.save(preview_file, format="PNG", optimize=False)
        verified = fixed_corners_match(cells, preview)
        if not verified:
            raise RuntimeError(
                f"Fixed-corner verification failed for {preview_width}x{preview_height}"
            )
        preview_records.append(
            {
                "file": preview_file.name,
                "width": preview_width,
                "height": preview_height,
                "fixedCornersVerified": True,
                "sha256": sha256(preview_file),
            }
        )

    manifest = {
        "schemaVersion": 1,
        "source": {
            "file": source_path.name,
            "width": width,
            "height": height,
            "mode": source_mode,
            "sha256": sha256(source_path),
        },
        "insets": {
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
        },
        "scale9Borders": {
            "x": left,
            "y": top,
            "w": width - left - right,
            "h": height - top - bottom,
        },
        "phaser": {
            "factory": "this.add.nineslice",
            "renderer": "Phaser.WEBGL",
            "untrimmedFrameRequired": True,
            "resizeMethod": "setSize",
            "tileX": options.tile_x,
            "tileY": options.tile_y,
            "filter": options.filter,
        },
        "guide": {
            "file": guide_file.name,
            "sha256": sha256(guide_file),
        },
        "acceptance": {
            "fixedCornersVerifiedAutomatically": True,
            "visualReviewRequired": True,
            "review": [
                "scalable regions contain no distorted motifs",
                "edges and center contain no seams or texture bleeding",
                "sampling matches the runtime texture filter",
                "content remains inside the authored content rectangle",
            ],
        },
        "slices": slice_records,
        "previews": preview_records,
    }
    manifest_file = output / "slice-manifest.json"
    manifest_file.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(json.dumps({"manifest": str(manifest_file), **manifest}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (OSError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
