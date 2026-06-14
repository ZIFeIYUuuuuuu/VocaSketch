from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SRC = REPO_ROOT / "backend" / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a VocaSketch playbackManifest.process to MP4.")
    parser.add_argument("--job", help="Drawing job id")
    parser.add_argument("--image", help="Render a standalone final image without a stored drawing job")
    parser.add_argument("--data-dir", default="backend/data", help="backend data dir")
    parser.add_argument("--output", required=True, help="Output mp4 path")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=960)
    args = parser.parse_args()
    if not args.job and not args.image:
        parser.error("one of --job or --image is required")

    data_dir = Path(args.data_dir)
    if args.image:
        final_path = Path(args.image)
        final = Image.open(final_path).convert("RGB")
        process = build_process_for_image(final_path, final)
        preview = None
    else:
        job = json.loads((data_dir / "jobs" / f"{args.job}.json").read_text(encoding="utf-8"))
        process = job["playbackManifest"]["process"]
        preview = load_optional_asset_image(data_dir, job.get("previewAssetId"))
        final_asset = json.loads((data_dir / "assets" / f"{job['finalAssetId']}.json").read_text(encoding="utf-8"))
        final_path = data_dir / "assets" / final_asset["storagePath"]
        final = Image.open(final_path).convert("RGB")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    render_process(process, final, output_path, fps=args.fps, width=args.width, height=args.height, preview=preview)
    print(output_path)


def build_process_for_image(image_path: Path, image: Image.Image) -> dict[str, Any]:
    from vocasketch_backend.models import AssetRecord, PlaybackManifest, PlaybackManifestStep
    from vocasketch_backend.providers.process_playback import enrich_manifest_with_process

    manifest = PlaybackManifest(
        manifestVersion="0.3.0",
        canvasSize={"width": image.width, "height": image.height},
        durationMs=28900,
        steps=[
            PlaybackManifestStep(stepId="step-sketch", order=1, role="sketch", label="10% 草图", startMs=0, durationMs=2200),
            PlaybackManifestStep(stepId="step-lineart", order=2, role="lineart", label="25% 线稿", startMs=2200, durationMs=17800),
            PlaybackManifestStep(stepId="step-flat-color", order=3, role="flat_color", label="45% 平涂", startMs=20000, durationMs=3200),
            PlaybackManifestStep(stepId="step-shadow", order=4, role="shadow", label="65% 阴影", startMs=23200, durationMs=2300),
            PlaybackManifestStep(stepId="step-lighting", order=5, role="lighting", label="85% 光照", startMs=25500, durationMs=1700),
            PlaybackManifestStep(stepId="step-details", order=6, role="details", label="100% 完成", startMs=27200, durationMs=1700),
        ],
    )
    final_asset = AssetRecord(
        assetId=f"standalone_{image_path.stem}",
        jobId="standalone",
        kind="final",
        role="final",
        mimeType="image/png",
        url=str(image_path),
        contentUrl=str(image_path),
        width=image.width,
        height=image.height,
        storagePath=str(image_path),
    )
    enriched = enrich_manifest_with_process(
        manifest,
        preview_asset=None,
        final_asset=final_asset,
        preview_content_path=None,
        final_content_path=image_path,
    )
    if not enriched.process:
        raise RuntimeError("failed to build process manifest for image")
    return enriched.process


def load_optional_asset_image(data_dir: Path, asset_id: str | None) -> Image.Image | None:
    if not asset_id:
        return None
    try:
        asset = json.loads((data_dir / "assets" / f"{asset_id}.json").read_text(encoding="utf-8"))
        storage_path = asset.get("storagePath")
        if not storage_path:
            return None
        asset_path = data_dir / "assets" / storage_path
        if not asset_path.is_file():
            return None
        return Image.open(asset_path).convert("RGB")
    except (OSError, json.JSONDecodeError, KeyError):
        return None


def render_process(
    process: dict[str, Any],
    final: Image.Image,
    output_path: Path,
    *,
    fps: int,
    width: int,
    height: int,
    preview: Image.Image | None = None,
) -> None:
    duration_ms = max(action["startMs"] + action["durationMs"] for action in process["actions"])
    frame_count = int(math.ceil(duration_ms / 1000 * fps))
    preview_cover = cover_image(preview or final, width, height)
    final_cover = cover_image(final, width, height)

    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for frame_index in range(frame_count + 1):
        elapsed_ms = int(frame_index * 1000 / fps)
        frame = draw_process_frame(process, preview_cover, final_cover, elapsed_ms, width, height)
        writer.write(cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR))
    writer.release()


def draw_process_frame(
    process: dict[str, Any],
    preview_cover: Image.Image,
    final_cover: Image.Image,
    elapsed_ms: int,
    width: int,
    height: int,
) -> Image.Image:
    frame = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(frame, "RGBA")
    cursor: dict[str, Any] = {"visible": False, "x": width * 0.5, "y": height * 0.5, "radius": 12, "tool": "idle"}

    for action in sorted(process["actions"], key=lambda item: item["startMs"]):
        progress = clamp((elapsed_ms - action["startMs"]) / action["durationMs"], 0, 1)
        if progress <= 0:
            continue
        if action["type"] == "stroke":
            draw_stroke(draw, action, progress, width, height, cursor)
        elif action["type"] == "fillRegion":
            source = final_cover if action.get("sourceImage") == "final" else preview_cover
            draw_fill(frame, source, action, progress, width, height, cursor)
        elif action["type"] == "maskReveal":
            draw_mask(frame, final_cover, action, progress, width, height, cursor)
        elif action["type"] == "layerBadge":
            draw_badge(draw, action, progress, width, height)
        elif action["type"] == "finalReveal":
            overlay = Image.blend(frame, final_cover, 0.08 + ease_out(progress) * 0.92)
            frame.paste(overlay)
            cursor.update({"visible": progress < 1, "x": width * (0.45 + progress * 0.14), "y": height * (0.55 - progress * 0.14), "radius": 18, "tool": action["tool"]})

    draw_cursor(draw, cursor)
    return frame


def draw_stroke(draw: ImageDraw.ImageDraw, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    points = [(point["x"] * width, point["y"] * height) for point in action["points"]]
    visible = partial_polyline(points, ease_in_out(progress) if action.get("speedProfile") == "detail-slow" else ease_out(progress))
    if len(visible) < 2:
        return
    stroke_opacity = action["opacity"]
    if action.get("phase") == "sketch":
        stroke_opacity *= 0.26
    color = hex_to_rgba(action["color"], stroke_opacity)
    line_width = max(1, int(action["strokeWidth"] * max(width, height)))
    draw.line(visible, fill=color, width=line_width, joint="curve")
    cursor.update({"visible": progress < 1, "x": visible[-1][0], "y": visible[-1][1], "radius": max(10, line_width * 2.2), "tool": action["tool"]})


def draw_fill(frame: Image.Image, final_cover: Image.Image, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    eased = ease_out(progress)
    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    cx, cy = action["center"]["x"] * width, action["center"]["y"] * height
    rx, ry = action["radius"]["x"] * width * eased, action["radius"]["y"] * height * eased
    mask_draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=int(255 * (action.get("imageAlpha") or action["opacity"]) * (0.55 + eased * 0.45)))
    filtered = apply_fill_filter(final_cover, action.get("filterStyle"))
    blurred_mask = mask.filter(ImageFilter.GaussianBlur(max(1, int(min(width, height) * 0.012))))
    frame.paste(filtered, mask=blurred_mask)
    tint_alpha = action.get("tintAlpha") or 0.08
    tint = Image.new("RGB", (width, height), hex_to_rgb(action["color"]))
    tint_mask = Image.new("L", (width, height), int(255 * tint_alpha * eased))
    tint_mask = ImageChops.multiply(tint_mask, blurred_mask)
    frame.paste(tint, mask=tint_mask)
    cursor.update({"visible": progress < 1, "x": cx + rx * 0.34, "y": cy - ry * 0.18, "radius": max(18, min(rx, ry) * 0.18), "tool": action["tool"]})


def draw_mask(frame: Image.Image, final_cover: Image.Image, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    eased = ease_in_out(progress)
    radius = max(width, height) * (0.18 + eased * 0.72)
    cx = width * (0.55 if action["phase"] == "lighting" else 0.47)
    cy = height * (0.36 if action["phase"] == "lighting" else 0.61)
    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((cx - radius * 0.95, cy - radius * 0.72, cx + radius * 0.95, cy + radius * 0.72), fill=int(255 * action["opacity"] * eased))
    source = final_cover.point(lambda value: min(255, int(value * 1.25)) if action["phase"] == "lighting" else max(0, int(value * 0.70)))
    frame.paste(source, mask=mask.filter(ImageFilter.GaussianBlur(max(1, int(min(width, height) * 0.018)))))
    cursor.update({"visible": progress < 1, "x": cx + radius * 0.26, "y": cy - radius * 0.18, "radius": width * 0.04, "tool": action["tool"]})


def draw_badge(draw: ImageDraw.ImageDraw, action: dict[str, Any], progress: float, width: int, height: int) -> None:
    opacity = ease_out(progress / 0.24) if progress < 0.72 else ease_out((1 - progress) / 0.28)
    if opacity <= 0:
        return
    box = (int(width * 0.055), int(height * 0.84), int(width * 0.38), int(height * 0.90))
    draw.rounded_rectangle(box, radius=12, fill=(15, 23, 42, int(200 * opacity)))
    draw.text((box[0] + 22, box[1] + 14), action["label"], fill=(226, 232, 240, int(255 * opacity)), font=load_font(22))


def draw_eye_spark(draw: ImageDraw.ImageDraw, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    eased = ease_out(progress)
    for point in action["points"]:
        x, y = point["x"] * width, point["y"] * height
        radius = 10 + 30 * eased
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(125, 211, 252, 92))
        draw.line((x - radius * 0.62, y, x + radius * 0.62, y), fill=(255, 255, 255, 230), width=2)
        draw.line((x, y - radius * 0.62, x, y + radius * 0.62), fill=(255, 255, 255, 230), width=2)
    target = action["points"][min(len(action["points"]) - 1, int(eased * len(action["points"])))]
    cursor.update({"visible": progress < 1, "x": target["x"] * width, "y": target["y"] * height, "radius": 18, "tool": action["tool"]})


def draw_cursor(draw: ImageDraw.ImageDraw, cursor: dict[str, Any]) -> None:
    if not cursor["visible"]:
        return
    x, y, radius = cursor["x"], cursor["y"], cursor["radius"]
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(8, 145, 178, 230), width=3, fill=(8, 145, 178, 32))
    draw.line((x - radius * 1.5, y, x - radius * 0.45, y), fill=(8, 145, 178, 230), width=2)
    draw.line((x + radius * 0.45, y, x + radius * 1.5, y), fill=(8, 145, 178, 230), width=2)
    draw.line((x, y - radius * 1.5, x, y - radius * 0.45), fill=(8, 145, 178, 230), width=2)
    draw.line((x, y + radius * 0.45, x, y + radius * 1.5), fill=(8, 145, 178, 230), width=2)


def build_lineart_image(image: Image.Image) -> Image.Image:
    array = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    smooth = cv2.bilateralFilter(gray, 9, 70, 70)
    edges_fine = cv2.Canny(smooth, 24, 96)
    edges_broad = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 38, 132)
    adaptive = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (5, 5), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        7,
    )
    adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, np.ones((2, 2), dtype=np.uint8), iterations=1)
    edges = cv2.bitwise_or(cv2.bitwise_or(edges_fine, edges_broad), cv2.bitwise_and(adaptive, edges_broad))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((2, 2), dtype=np.uint8), iterations=1)
    edges = cv2.dilate(edges, np.ones((2, 2), dtype=np.uint8), iterations=1)
    edges = cv2.GaussianBlur(edges, (3, 3), 0)
    ink = 255 - edges
    ink_rgb = cv2.cvtColor(ink, cv2.COLOR_GRAY2RGB)
    lineart = Image.fromarray(ink_rgb)
    paper = Image.new("RGB", image.size, (255, 255, 255))
    return Image.blend(paper, lineart, 0.96)


def build_linedrawer_strokes(image: Image.Image) -> list[list[tuple[float, float]]]:
    lineart = build_lineart_image(image)
    gray = np.array(lineart.convert("L"))
    line_mask = cv2.threshold(gray, 244, 255, cv2.THRESH_BINARY_INV)[1]
    line_mask = remove_small_components(line_mask, min_area=max(3, int(image.width * image.height * 0.000003)))
    width, height = image.size
    strokes = contour_strokes_from_mask(line_mask, width=width, height=height)

    def stroke_key(points: list[tuple[float, float]]) -> tuple[float, float, float]:
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        center_x = sum(xs) / len(xs) / width
        center_y = sum(ys) / len(ys) / height
        length = pixel_polyline_length(points) / max(width, height)
        structure_tier = 0 if length > 0.22 else 1 if length > 0.11 else 2
        subject_focus = abs(center_x - 0.50) * 0.35 + abs(center_y - 0.52) * 0.20
        hair_fragment_penalty = 0.18 if length < 0.075 and center_y < 0.34 else 0
        return (structure_tier, subject_focus + hair_fragment_penalty, -length)

    strokes.sort(key=stroke_key)
    return strokes[:260]


def contour_strokes_from_mask(mask: Any, *, width: int, height: int) -> list[list[tuple[float, float]]]:
    found = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]
    strokes: list[list[tuple[float, float]]] = []
    for contour in contours:
        arc_length = cv2.arcLength(contour, closed=False)
        if arc_length < max(7, min(width, height) * 0.008):
            continue
        epsilon = max(0.8, arc_length * 0.0065)
        approx = cv2.approxPolyDP(contour, epsilon, closed=False)
        points = [(float(point[0][0]), float(point[0][1])) for point in approx]
        points = smooth_stroke_points(points)
        points = simplify_pixel_points(points, max_points=96)
        if len(points) < 2:
            continue
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        if min(xs) <= 1 or min(ys) <= 1 or max(xs) >= width - 2 or max(ys) >= height - 2:
            continue
        strokes.append(points)
    return strokes


def trace_skeleton_strokes(skeleton: Any, *, width: int, height: int) -> list[list[tuple[float, float]]]:
    points = set(zip(*np.where(skeleton > 0)))
    if not points:
        return []

    def neighbors(point: tuple[int, int]) -> list[tuple[int, int]]:
        y, x = point
        result: list[tuple[int, int]] = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                candidate = (y + dy, x + dx)
                if candidate in points:
                    result.append(candidate)
        return result

    nodes = {point for point in points if len(neighbors(point)) != 2}
    visited_edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    strokes: list[list[tuple[float, float]]] = []

    def edge_key(left: tuple[int, int], right: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
        return (left, right) if left <= right else (right, left)

    def add_path(path: list[tuple[int, int]]) -> None:
        if len(path) < 2:
            return
        pixel_points = [(float(x), float(y)) for y, x in path]
        pixel_points = smooth_stroke_points(pixel_points)
        pixel_points = simplify_pixel_points(pixel_points, max_points=96)
        if pixel_polyline_length(pixel_points) < max(5, min(width, height) * 0.006):
            return
        strokes.append(pixel_points)

    for node in sorted(nodes):
        for neighbor in neighbors(node):
            key = edge_key(node, neighbor)
            if key in visited_edges:
                continue
            path = [node, neighbor]
            visited_edges.add(key)
            previous = node
            current = neighbor
            while current not in nodes:
                next_candidates = [item for item in neighbors(current) if item != previous]
                if not next_candidates:
                    break
                next_point = next_candidates[0]
                next_key = edge_key(current, next_point)
                if next_key in visited_edges:
                    break
                path.append(next_point)
                visited_edges.add(next_key)
                previous, current = current, next_point
            add_path(path)

    for point in sorted(points):
        for neighbor in neighbors(point):
            key = edge_key(point, neighbor)
            if key in visited_edges:
                continue
            path = [point, neighbor]
            visited_edges.add(key)
            previous = point
            current = neighbor
            for _ in range(len(points)):
                next_candidates = [item for item in neighbors(current) if item != previous and edge_key(current, item) not in visited_edges]
                if not next_candidates:
                    break
                next_point = next_candidates[0]
                path.append(next_point)
                visited_edges.add(edge_key(current, next_point))
                previous, current = current, next_point
                if current == point:
                    break
            add_path(path)

    return strokes


def draw_linedrawer_strokes(
    draw: ImageDraw.ImageDraw,
    strokes: list[list[tuple[float, float]]],
    elapsed_ms: int,
    width: int,
    height: int,
    cursor: dict[str, Any],
) -> None:
    if not strokes or elapsed_ms < 80:
        return
    line_start_ms = 80
    line_duration_ms = 7600
    global_progress = clamp((elapsed_ms - line_start_ms) / line_duration_ms, 0, 1)
    active_cursor: tuple[float, float] | None = None
    max_dimension = max(width, height)

    for index, points in enumerate(strokes):
        length = pixel_polyline_length(points) / max_dimension
        start = index / max(1, len(strokes))
        tier = 0 if length > 0.22 else 1 if length > 0.09 else 2
        overlap_window = 0.13 if tier == 0 else 0.08 if tier == 1 else 0.055
        local = clamp((ease_out(global_progress) - start) / overlap_window, 0, 1)
        if local <= 0:
            continue
        visible = partial_polyline(points, ease_in_out(local))
        if len(visible) < 2:
            continue
        line_width = max(1, int(1.65 + min(1.25, length * 1.6)))
        alpha = 238 if local >= 1 else 210
        draw.line(visible, fill=(16, 22, 32, alpha), width=line_width, joint="curve")
        if local < 1:
            active_cursor = visible[-1]

    if active_cursor is not None:
        cursor.update({"visible": True, "x": active_cursor[0], "y": active_cursor[1], "radius": max(9, max_dimension * 0.012), "tool": "pen"})


def draw_linedrawer_lineart_reveal(frame: Image.Image, lineart: Image.Image, elapsed_ms: int) -> None:
    reveal_mask = build_lineart_reveal_mask(frame.size[0], frame.size[1], elapsed_ms)
    if reveal_mask.getbbox():
        frame.paste(lineart, mask=reveal_mask)


def draw_linedrawer_color(
    frame: Image.Image,
    final_cover: Image.Image,
    lineart_cover: Image.Image,
    elapsed_ms: int,
    width: int,
    height: int,
    cursor: dict[str, Any],
) -> None:
    flat_progress = clamp((elapsed_ms - 20000) / 3200, 0, 1)
    if flat_progress > 0:
        color_mask = build_color_reveal_mask(width, height, elapsed_ms, start_ms=20000, duration_ms=3200)
        if color_mask.getbbox():
            flats = final_cover.filter(ImageFilter.GaussianBlur(0.45))
            frame.paste(flats, mask=color_mask)
            cursor.update({"visible": flat_progress < 1, "x": width * (0.35 + 0.32 * flat_progress), "y": height * (0.36 + 0.34 * flat_progress), "radius": max(18, width * 0.035), "tool": "brush"})

    shadow_progress = clamp((elapsed_ms - 23200) / 2300, 0, 1)
    if shadow_progress > 0:
        shadow_mask = build_luma_mask(final_cover, dark=True).point(lambda value: int(value * ease_out(shadow_progress) * 0.50))
        shadow_source = final_cover.point(lambda value: max(0, int(value * 0.68)))
        frame.paste(shadow_source, mask=shadow_mask.filter(ImageFilter.GaussianBlur(max(2, int(width * 0.006)))))
        cursor.update({"visible": shadow_progress < 1, "x": width * (0.42 + 0.15 * shadow_progress), "y": height * (0.42 + 0.24 * shadow_progress), "radius": max(20, width * 0.045), "tool": "multiply"})

    lighting_progress = clamp((elapsed_ms - 25500) / 1700, 0, 1)
    if lighting_progress > 0:
        light_mask = build_luma_mask(final_cover, dark=False).point(lambda value: int(value * ease_out(lighting_progress) * 0.34))
        light_source = final_cover.point(lambda value: min(255, int(value * 1.18 + 12)))
        frame.paste(light_source, mask=light_mask.filter(ImageFilter.GaussianBlur(max(2, int(width * 0.005)))))
        cursor.update({"visible": lighting_progress < 1, "x": width * (0.59 - 0.14 * lighting_progress), "y": height * (0.27 + 0.16 * lighting_progress), "radius": max(18, width * 0.035), "tool": "glow"})

def overlay_lineart_ink(frame: Image.Image, lineart: Image.Image, *, opacity: float) -> None:
    gray = lineart.convert("L")
    ink_mask = gray.point(lambda value: int(max(0, 245 - value) * opacity))
    ink = Image.new("RGB", frame.size, (15, 23, 42))
    frame.paste(ink, mask=ink_mask)


def build_luma_mask(image: Image.Image, *, dark: bool) -> Image.Image:
    gray = image.convert("L")
    if dark:
        return gray.point(lambda value: 255 if value < 116 else max(0, int((168 - value) * 2.2)) if value < 168 else 0)
    return gray.point(lambda value: 255 if value > 220 else max(0, int((value - 172) * 2.4)) if value > 172 else 0)


def remove_small_components(binary: Any, *, min_area: int) -> Any:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((binary > 0).astype(np.uint8), connectivity=8)
    cleaned = np.zeros(binary.shape, dtype=np.uint8)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == label] = 255
    return cleaned


def morphological_skeleton(binary: Any) -> Any:
    image = (binary > 0).astype(np.uint8) * 255
    skeleton = np.zeros(image.shape, dtype=np.uint8)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while cv2.countNonZero(image) > 0:
        eroded = cv2.erode(image, element)
        opened = cv2.dilate(eroded, element)
        skeleton = cv2.bitwise_or(skeleton, cv2.subtract(image, opened))
        image = eroded
    return skeleton


def smooth_stroke_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points
    smoothed = points
    for _ in range(2):
        next_points: list[tuple[float, float]] = [smoothed[0]]
        for index in range(len(smoothed) - 1):
            p0 = smoothed[index]
            p1 = smoothed[index + 1]
            next_points.append((p0[0] * 0.72 + p1[0] * 0.28, p0[1] * 0.72 + p1[1] * 0.28))
            next_points.append((p0[0] * 0.28 + p1[0] * 0.72, p0[1] * 0.28 + p1[1] * 0.72))
        next_points.append(smoothed[-1])
        smoothed = next_points
    return smoothed


def is_closed_tiny_island(points: list[tuple[float, float]], *, width: int, height: int) -> bool:
    if len(points) < 6:
        return True
    first = points[0]
    last = points[-1]
    closed_distance = math.hypot(first[0] - last[0], first[1] - last[1])
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    bbox = max(max(xs) - min(xs), max(ys) - min(ys))
    return closed_distance < max(width, height) * 0.010 and bbox < max(width, height) * 0.060


def draw_lineart_underlay(frame: Image.Image, lineart: Image.Image, final_cover: Image.Image, elapsed_ms: int) -> None:
    reveal_mask = build_lineart_reveal_mask(frame.size[0], frame.size[1], elapsed_ms)
    if reveal_mask.getbbox():
        frame.paste(lineart, mask=reveal_mask)

    if 2700 <= elapsed_ms < 5800:
        color_mask = build_color_reveal_mask(frame.size[0], frame.size[1], elapsed_ms)
        if color_mask.getbbox():
            color_alpha = int(255 * (0.08 + 0.22 * ease_out((elapsed_ms - 2700) / 3100)))
            color_mask = color_mask.point(lambda value: min(value, color_alpha))
            frame.paste(final_cover.filter(ImageFilter.GaussianBlur(0.8)), mask=color_mask)


def build_lineart_reveal_mask(width: int, height: int, elapsed_ms: int) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    if elapsed_ms < 160:
        return mask

    passes = [
        [(0.45, 0.08), (0.58, 0.05), (0.72, 0.11), (0.82, 0.24)],
        [(0.42, 0.10), (0.32, 0.18), (0.27, 0.32), (0.31, 0.46)],
        [(0.55, 0.12), (0.49, 0.28), (0.44, 0.43), (0.48, 0.56)],
        [(0.64, 0.22), (0.59, 0.34), (0.54, 0.44), (0.57, 0.58)],
        [(0.36, 0.37), (0.47, 0.34), (0.59, 0.35), (0.72, 0.40)],
        [(0.38, 0.46), (0.48, 0.55), (0.59, 0.55), (0.70, 0.47)],
        [(0.41, 0.58), (0.46, 0.69), (0.55, 0.74), (0.64, 0.67)],
        [(0.28, 0.62), (0.22, 0.78), (0.29, 0.91), (0.45, 0.95)],
        [(0.70, 0.58), (0.80, 0.72), (0.82, 0.90), (0.64, 0.95)],
        [(0.45, 0.70), (0.48, 0.84), (0.54, 0.96)],
        [(0.34, 0.75), (0.47, 0.80), (0.61, 0.80), (0.75, 0.75)],
    ]
    draw = ImageDraw.Draw(mask)
    total_ms = 2350
    progress = clamp((elapsed_ms - 160) / total_ms, 0, 1)
    eased = ease_out(progress)
    brush_width = max(42, int(min(width, height) * 0.105))
    feather = max(3, int(min(width, height) * 0.006))

    for index, normalized_path in enumerate(passes):
        start = index / len(passes)
        span = 0.30
        local = clamp((eased - start) / span, 0, 1)
        if local <= 0:
            continue
        points = [(x * width, y * height) for x, y in normalized_path]
        visible = partial_polyline(points, ease_in_out(local))
        if len(visible) >= 2:
            draw.line(visible, fill=255, width=brush_width, joint="curve")
        if visible:
            x, y = visible[-1]
            radius = brush_width * (0.48 + 0.18 * math.sin(index))
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)

    # After the line pass finishes, keep the full lineart visible. The mask is
    # spatial, not an opacity fade, so it still reads as "drawn from zero".
    if progress >= 1:
        mask.paste(255, (0, 0, width, height))
    return mask.filter(ImageFilter.GaussianBlur(feather))


def build_color_reveal_mask(width: int, height: int, elapsed_ms: int, *, start_ms: int = 14500, duration_ms: int = 4000) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    progress = clamp((elapsed_ms - start_ms) / duration_ms, 0, 1)
    if progress <= 0:
        return mask
    draw = ImageDraw.Draw(mask)
    centers = [
        (0.50, 0.44, 0.22, 0.18),
        (0.50, 0.26, 0.34, 0.23),
        (0.50, 0.74, 0.42, 0.30),
        (0.32, 0.76, 0.23, 0.24),
        (0.70, 0.76, 0.23, 0.24),
    ]
    eased = ease_out(progress)
    for index, (cx, cy, rx, ry) in enumerate(centers):
        local = clamp((eased - index * 0.10) / 0.64, 0, 1)
        if local <= 0:
            continue
        x = cx * width
        y = cy * height
        radius_x = rx * width * local
        radius_y = ry * height * local
        draw.ellipse((x - radius_x, y - radius_y, x + radius_x, y + radius_y), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(12, int(min(width, height) * 0.026))))


def cover_image(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def partial_polyline(points: list[tuple[float, float]], progress: float) -> list[tuple[float, float]]:
    if len(points) <= 1:
        return points
    lengths = [math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points))]
    target = sum(lengths) * clamp(progress, 0, 1)
    output = [points[0]]
    walked = 0.0
    for index in range(1, len(points)):
        segment_length = lengths[index - 1]
        if walked + segment_length <= target:
            output.append(points[index])
            walked += segment_length
            continue
        ratio = 0 if segment_length == 0 else (target - walked) / segment_length
        previous = points[index - 1]
        current = points[index]
        output.append((previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio))
        break
    return output


def simplify_pixel_points(points: list[tuple[float, float]], *, max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    step = (len(points) - 1) / (max_points - 1)
    return [points[round(index * step)] for index in range(max_points)]


def pixel_polyline_length(points: list[tuple[float, float]]) -> float:
    return sum(math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points)))


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def ease_out(value: float) -> float:
    value = clamp(value, 0, 1)
    return 1 - (1 - value) ** 2


def ease_in_out(value: float) -> float:
    value = clamp(value, 0, 1)
    return 2 * value * value if value < 0.5 else 1 - ((-2 * value + 2) ** 2) / 2


def hex_to_rgba(value: str, opacity: float) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), int(255 * opacity))


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def apply_fill_filter(image: Image.Image, style: str | None) -> Image.Image:
    if style == "preview-flats":
        return image.filter(ImageFilter.GaussianBlur(1.1))
    if style == "final-flats":
        return image.filter(ImageFilter.GaussianBlur(0.4))
    return image


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    except Exception:
        return ImageFont.load_default()


if __name__ == "__main__":
    main()
