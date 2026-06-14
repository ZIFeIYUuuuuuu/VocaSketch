from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a smooth LineDrawer Lite style process video.")
    parser.add_argument("--manifest", help="Path to stroke_manifest.json")
    parser.add_argument("--auto-manifest", action="store_true", help="Build a stroke manifest from --source before rendering")
    parser.add_argument("--source", required=True, help="Final/source image used for color reveal")
    parser.add_argument("--output", required=True, help="Output mp4 path")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=960)
    parser.add_argument("--duration-ms", type=int, default=24000)
    parser.add_argument("--line-duration-ms", type=int, default=15000)
    args = parser.parse_args()

    if args.auto_manifest:
        manifest = build_manifest_from_source(Path(args.source))
        manifest_path = Path(args.output).with_suffix(".stroke_manifest.json")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    elif args.manifest:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    else:
        parser.error("--manifest is required unless --auto-manifest is set")
    strokes = schedule_strokes(manifest.get("strokes", []), line_duration_ms=args.line_duration_ms)
    source = Image.open(args.source).convert("RGB")
    render_video(
        source=source,
        strokes=strokes,
        output_path=Path(args.output),
        fps=args.fps,
        width=args.width,
        height=args.height,
        duration_ms=args.duration_ms,
        line_duration_ms=args.line_duration_ms,
    )
    print(args.output)


def schedule_strokes(raw_strokes: list[dict[str, Any]], *, line_duration_ms: int) -> list[dict[str, Any]]:
    strokes: list[dict[str, Any]] = []
    for index, item in enumerate(raw_strokes):
        points = [(float(x), float(y)) for x, y in item.get("points", []) if isinstance(x, (int, float)) and isinstance(y, (int, float))]
        if len(points) < 2:
            continue
        length = float(item.get("length") or polyline_length(points))
        tier = int(item.get("tier") or (0 if length > 260 else 1 if length > 120 else 2))
        strokes.append(
            {
                "strokeId": item.get("strokeId") or f"stroke_{index + 1:04d}",
                "points": points,
                "length": length,
                "tier": tier,
                "width": float(item.get("width") or (2.2 if tier == 0 else 1.8 if tier == 1 else 1.35)),
                "center": item.get("center") or center_of(points),
            }
        )

    # Keep the original tiered/spatial order, but stretch it over the full line
    # window. The old demo used very dense overlap; this version keeps overlap
    # without causing a visible burst of many strokes at once.
    latest_start = max(1, line_duration_ms - 720)
    total = max(1, len(strokes) - 1)
    for index, stroke in enumerate(strokes):
        ratio = index / total
        paced = ratio**1.08
        tier = stroke["tier"]
        length = stroke["length"]
        stroke["startMs"] = int(420 + paced * latest_start)
        stroke["durationMs"] = int((460 if tier == 0 else 360 if tier == 1 else 260) + min(760, length * 1.05))
    return strokes


def build_manifest_from_source(source_path: Path) -> dict[str, Any]:
    image = Image.open(source_path).convert("RGB")
    square = cover_image(image, 1024, 1024)
    edge_mask = build_line_edges(square)
    strokes = extract_strokes(edge_mask)
    ordered = order_strokes(strokes)
    return {
        "version": "linedrawer-lite-auto-0.2",
        "source": str(source_path),
        "canvasSize": {"width": 1024, "height": 1024},
        "strokeCount": len(ordered),
        "ordering": "tiered length + spatial scan heuristic",
        "strokes": ordered,
    }


def build_line_edges(image: Image.Image) -> np.ndarray:
    array = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    smooth = cv2.bilateralFilter(gray, 9, 70, 70)
    fine = cv2.Canny(smooth, 18, 78)
    broad = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 28, 110)
    lab = cv2.cvtColor(array, cv2.COLOR_RGB2LAB)
    color_edges = np.zeros(gray.shape, dtype=np.uint8)
    for channel_index in range(3):
        channel = cv2.GaussianBlur(lab[:, :, channel_index], (3, 3), 0)
        color_edges = cv2.bitwise_or(color_edges, cv2.Canny(channel, 18, 76))
    dog = cv2.absdiff(cv2.GaussianBlur(gray, (0, 0), 1.0), cv2.GaussianBlur(gray, (0, 0), 3.2))
    _, dog_edges = cv2.threshold(dog, 5, 255, cv2.THRESH_BINARY)
    adaptive = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (5, 5), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        7,
    )
    edges = cv2.bitwise_or(fine, cv2.bitwise_or(broad, cv2.bitwise_and(adaptive, cv2.bitwise_or(color_edges, dog_edges))))
    edges = cv2.bitwise_or(edges, cv2.bitwise_and(color_edges, cv2.dilate(fine, np.ones((3, 3), dtype=np.uint8), iterations=1)))
    edges = cv2.bitwise_and(edges, subject_mask(1024, 1024))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((2, 2), dtype=np.uint8), iterations=1)
    return remove_small_components(edges, min_area=6)


def subject_mask(width: int, height: int) -> np.ndarray:
    yy, xx = np.ogrid[:height, :width]
    mask = np.zeros((height, width), dtype=np.uint8)
    ellipses = [
        (0.50, 0.32, 0.40, 0.30),
        (0.50, 0.55, 0.36, 0.34),
        (0.50, 0.78, 0.42, 0.24),
    ]
    for cx, cy, rx, ry in ellipses:
        normalized = (((xx / width) - cx) / rx) ** 2 + (((yy / height) - cy) / ry) ** 2
        mask[normalized <= 1] = 255
    return mask


def remove_small_components(binary: np.ndarray, *, min_area: int) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((binary > 0).astype(np.uint8), connectivity=8)
    cleaned = np.zeros(binary.shape, dtype=np.uint8)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == label] = 255
    return cleaned


def extract_strokes(mask: np.ndarray) -> list[list[tuple[float, float]]]:
    found = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]
    strokes: list[list[tuple[float, float]]] = []
    for contour in contours:
        arc_length = cv2.arcLength(contour, closed=False)
        if arc_length < 10:
            continue
        epsilon = max(0.7, arc_length * 0.0048)
        approx = cv2.approxPolyDP(contour, epsilon, closed=False)
        points = [(float(point[0][0]), float(point[0][1])) for point in approx]
        points = smooth_points(points)
        for chunk in split_path(points):
            if len(chunk) >= 2 and is_subject_stroke(chunk):
                strokes.append(chunk)
    return strokes


def smooth_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points
    smoothed = points
    for _ in range(1):
        next_points: list[tuple[float, float]] = [smoothed[0]]
        for index in range(len(smoothed) - 1):
            p0 = smoothed[index]
            p1 = smoothed[index + 1]
            next_points.append((p0[0] * 0.7 + p1[0] * 0.3, p0[1] * 0.7 + p1[1] * 0.3))
            next_points.append((p0[0] * 0.3 + p1[0] * 0.7, p0[1] * 0.3 + p1[1] * 0.7))
        next_points.append(smoothed[-1])
        smoothed = next_points
    return smoothed


def split_path(points: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    if len(points) <= 18:
        return [points]
    length = polyline_length(points)
    target = 24 if length > 320 else 20 if length > 160 else 15
    overlap = 3
    chunks: list[list[tuple[float, float]]] = []
    index = 0
    while index < len(points) - 1:
        end = min(len(points), index + target)
        chunks.append(points[index:end])
        if end >= len(points):
            break
        index = max(index + 1, end - overlap)
    return chunks


def is_subject_stroke(points: list[tuple[float, float]]) -> bool:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    if min(xs) <= 2 or min(ys) <= 2 or max(xs) >= 1022 or max(ys) >= 1022:
        return False
    if polyline_length(points) < 8:
        return False
    return True


def order_strokes(paths: list[list[tuple[float, float]]]) -> list[dict[str, Any]]:
    def key(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        length = polyline_length(points)
        center = center_of(points)
        center_x = center[0] / 1024
        center_y = center[1] / 1024
        tier = 0 if length > 230 else 1 if length > 96 else 2
        face_bonus = -0.14 if 0.26 <= center_x <= 0.76 and 0.25 <= center_y <= 0.66 else 0.08
        focus = abs(center_x - 0.5) * 0.35 + abs(center_y - 0.50) * 0.24
        scan = center_y * 0.44 + center_x * 0.18
        return (tier, focus + face_bonus, scan, -min(length, 480))

    ordered = sorted(paths, key=key)
    items: list[dict[str, Any]] = []
    for index, points in enumerate(ordered):
        length = polyline_length(points)
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        tier = 0 if length > 230 else 1 if length > 96 else 2
        items.append(
            {
                "strokeId": f"stroke_{index + 1:04d}",
                "points": [[round(x), round(y)] for x, y in points],
                "length": length,
                "bbox": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                "center": center_of(points),
                "width": 2.15 if tier == 0 else 1.75 if tier == 1 else 1.35,
                "tier": tier,
            }
        )
    return items[:420]


def render_video(
    *,
    source: Image.Image,
    strokes: list[dict[str, Any]],
    output_path: Path,
    fps: int,
    width: int,
    height: int,
    duration_ms: int,
    line_duration_ms: int,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    frame_count = math.ceil(duration_ms / 1000 * fps)
    source_square = cover_image(source, 1024, 1024)
    source_frame = fit_frame(1024, 1024, 46, 84, 820, 820)
    source_resized = source_square.resize((source_frame["width"], source_frame["height"]), Image.Resampling.LANCZOS)

    for frame_index in range(frame_count + 1):
        elapsed_ms = int(frame_index * 1000 / fps)
        frame = draw_frame(
            source_resized=source_resized,
            strokes=strokes,
            elapsed_ms=elapsed_ms,
            width=width,
            height=height,
            image_frame=source_frame,
            duration_ms=duration_ms,
            line_duration_ms=line_duration_ms,
        )
        writer.write(cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR))
    writer.release()


def draw_frame(
    *,
    source_resized: Image.Image,
    strokes: list[dict[str, Any]],
    elapsed_ms: int,
    width: int,
    height: int,
    image_frame: dict[str, int],
    duration_ms: int,
    line_duration_ms: int,
) -> Image.Image:
    frame = Image.new("RGB", (width, height), (238, 245, 249))
    draw = ImageDraw.Draw(frame, "RGBA")
    canvas_box = (24, 50, 874, 930)
    draw.rounded_rectangle(canvas_box, radius=18, fill=(255, 255, 255, 255), outline=(214, 226, 236, 255), width=2)
    draw.text((42, 20), "LineDrawer Lite 完整绘画过程重建", fill=(30, 41, 59), font=font(22))
    draw.text((42, 54), "from 0 · smooth stroke timeline · no jump-cut line burst", fill=(100, 116, 139), font=font(13))

    color_layer = build_color_layer(source_resized, elapsed_ms, image_frame, line_duration_ms, duration_ms)
    if color_layer is not None:
        frame.paste(color_layer["image"], (image_frame["x"], image_frame["y"]), color_layer["mask"])

    cursor = {"visible": False, "x": 0.0, "y": 0.0, "radius": 10.0}
    draw_strokes(draw, strokes, elapsed_ms, image_frame, cursor)
    draw_cursor(draw, cursor)
    draw_right_rail(draw, elapsed_ms, duration_ms, line_duration_ms, strokes)
    draw_progress(draw, elapsed_ms, duration_ms)
    return frame


def build_color_layer(
    source: Image.Image,
    elapsed_ms: int,
    image_frame: dict[str, int],
    line_duration_ms: int,
    duration_ms: int,
) -> dict[str, Image.Image] | None:
    flat_start = line_duration_ms
    shadow_start = line_duration_ms + 3600
    light_start = line_duration_ms + 5900
    final_start = duration_ms - 1700

    base = Image.new("RGB", source.size, (255, 255, 255))
    mask = Image.new("L", source.size, 0)
    if elapsed_ms >= flat_start:
        flat = clamp((elapsed_ms - flat_start) / 3600, 0, 1)
        mask = color_reveal_mask(source.size, flat)
        flats = source.filter(ImageFilter.GaussianBlur(1.0))
        base.paste(flats, mask=mask)
    if elapsed_ms >= shadow_start:
        shadow = ease_out(clamp((elapsed_ms - shadow_start) / 2300, 0, 1))
        shadow_mask = luma_mask(source, dark=True).point(lambda value: int(value * shadow * 0.42))
        shadow_source = source.point(lambda value: max(0, int(value * 0.76)))
        base.paste(shadow_source, mask=shadow_mask.filter(ImageFilter.GaussianBlur(4)))
        mask = Image.fromarray(np.maximum(np.array(mask), np.array(shadow_mask)).astype(np.uint8))
    if elapsed_ms >= light_start:
        light = ease_out(clamp((elapsed_ms - light_start) / 1700, 0, 1))
        light_mask = luma_mask(source, dark=False).point(lambda value: int(value * light * 0.34))
        light_source = source.point(lambda value: min(255, int(value * 1.16 + 10)))
        base.paste(light_source, mask=light_mask.filter(ImageFilter.GaussianBlur(3)))
        mask = Image.fromarray(np.maximum(np.array(mask), np.array(light_mask)).astype(np.uint8))
    if elapsed_ms >= final_start:
        final = ease_out(clamp((elapsed_ms - final_start) / 1500, 0, 1))
        final_mask = Image.new("L", source.size, int(255 * final))
        blended = Image.blend(base, source, final)
        return {"image": blended, "mask": final_mask}
    return {"image": base, "mask": mask} if mask.getbbox() else None


def draw_strokes(draw: ImageDraw.ImageDraw, strokes: list[dict[str, Any]], elapsed_ms: int, image_frame: dict[str, int], cursor: dict[str, Any]) -> None:
    active: tuple[float, float, float] | None = None
    for stroke in strokes:
        progress = clamp((elapsed_ms - stroke["startMs"]) / stroke["durationMs"], 0, 1)
        if progress <= 0:
            continue
        points = [
            (
                image_frame["x"] + point[0] / 1024 * image_frame["width"],
                image_frame["y"] + point[1] / 1024 * image_frame["height"],
            )
            for point in stroke["points"]
        ]
        visible = partial_polyline(points, ease_in_out(progress))
        if len(visible) < 2:
            continue
        tier = stroke["tier"]
        alpha = 238 if progress >= 1 else 202
        line_width = max(1, int(stroke["width"] * (image_frame["width"] / 820) * (1.15 if tier == 0 else 1.0)))
        draw.line(visible, fill=(15, 23, 42, alpha), width=line_width, joint="curve")
        if progress < 1:
            active = (visible[-1][0], visible[-1][1], max(9, line_width * 3.2))
    if active:
        cursor.update({"visible": True, "x": active[0], "y": active[1], "radius": active[2]})


def draw_right_rail(draw: ImageDraw.ImageDraw, elapsed_ms: int, duration_ms: int, line_duration_ms: int, strokes: list[dict[str, Any]]) -> None:
    x, y, w = 910, 84, 310
    draw.rounded_rectangle((x, y, x + w, y + 810), radius=16, fill=(248, 251, 253, 255), outline=(213, 225, 234, 255), width=2)
    completed_strokes = sum(1 for stroke in strokes if elapsed_ms >= stroke["startMs"] + stroke["durationMs"])
    draw.rounded_rectangle((x + 24, y + 22, x + 176, y + 52), radius=12, fill=(224, 247, 253, 255))
    draw.text((x + 38, y + 29), f"{completed_strokes}/{len(strokes)} strokes", fill=(8, 145, 178), font=font(14))

    steps = [
        ("10% 草图", "灰色辅助线扫入", 0, 1700),
        ("25% 线稿", "SVG 笔画逐条画出", 1700, line_duration_ms),
        ("45% 平涂", "颜色铺开", line_duration_ms, line_duration_ms + 3600),
        ("65% 阴影", "Multiply 暗部叠入", line_duration_ms + 3600, line_duration_ms + 5900),
        ("85% 光照", "Add / Glow 高光扩散", line_duration_ms + 5900, duration_ms - 1700),
        ("100% 完成", "原图收束", duration_ms - 1700, duration_ms),
    ]
    for index, (label, hint, start, end) in enumerate(steps):
        top = y + 88 + index * 94
        active = start <= elapsed_ms < end
        fill = (236, 253, 255, 255) if active else (255, 255, 255, 255)
        outline = (45, 212, 191, 255) if active else (226, 232, 240, 255)
        draw.rounded_rectangle((x + 24, top, x + w - 24, top + 72), radius=10, fill=fill, outline=outline, width=2 if active else 1)
        draw.text((x + 42, top + 14), label, fill=(15, 23, 42), font=font(15))
        draw.text((x + 42, top + 40), hint, fill=(100, 116, 139), font=font(12))


def draw_progress(draw: ImageDraw.ImageDraw, elapsed_ms: int, duration_ms: int) -> None:
    x, y, w, h = 934, 836, 246, 12
    progress = clamp(elapsed_ms / duration_ms, 0, 1)
    draw.rounded_rectangle((x, y, x + w, y + h), radius=6, fill=(226, 232, 240, 255))
    draw.rounded_rectangle((x, y, x + int(w * progress), y + h), radius=6, fill=(34, 211, 238, 255))
    draw.text((x, y + 22), f"整体进度 {int(progress * 100)}%", fill=(8, 145, 178), font=font(13))


def draw_cursor(draw: ImageDraw.ImageDraw, cursor: dict[str, Any]) -> None:
    if not cursor.get("visible"):
        return
    x, y, radius = cursor["x"], cursor["y"], cursor["radius"]
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(8, 145, 178, 230), width=3, fill=(8, 145, 178, 26))
    draw.line((x - radius * 1.45, y, x - radius * 0.45, y), fill=(8, 145, 178, 220), width=2)
    draw.line((x + radius * 0.45, y, x + radius * 1.45, y), fill=(8, 145, 178, 220), width=2)
    draw.line((x, y - radius * 1.45, x, y - radius * 0.45), fill=(8, 145, 178, 220), width=2)
    draw.line((x, y + radius * 0.45, x, y + radius * 1.45), fill=(8, 145, 178, 220), width=2)


def color_reveal_mask(size: tuple[int, int], progress: float) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    centers = [
        (0.50, 0.28, 0.34, 0.24),
        (0.50, 0.46, 0.24, 0.21),
        (0.51, 0.73, 0.42, 0.31),
        (0.28, 0.73, 0.22, 0.22),
        (0.72, 0.73, 0.22, 0.22),
    ]
    eased = ease_out(progress)
    for index, (cx, cy, rx, ry) in enumerate(centers):
        local = clamp((eased - index * 0.11) / 0.62, 0, 1)
        if local <= 0:
            continue
        x, y = cx * width, cy * height
        draw.ellipse((x - rx * width * local, y - ry * height * local, x + rx * width * local, y + ry * height * local), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(10, int(width * 0.025))))


def luma_mask(image: Image.Image, *, dark: bool) -> Image.Image:
    gray = image.convert("L")
    if dark:
        return gray.point(lambda value: 255 if value < 102 else max(0, int((164 - value) * 2.1)) if value < 164 else 0)
    return gray.point(lambda value: 255 if value > 222 else max(0, int((value - 172) * 2.4)) if value > 172 else 0)


def fit_frame(source_width: int, source_height: int, x: int, y: int, width: int, height: int) -> dict[str, int]:
    scale = min(width / source_width, height / source_height)
    draw_width = int(source_width * scale)
    draw_height = int(source_height * scale)
    return {"x": x + (width - draw_width) // 2, "y": y + (height - draw_height) // 2, "width": draw_width, "height": draw_height}


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
    total = sum(lengths)
    target = total * clamp(progress, 0, 1)
    output = [points[0]]
    walked = 0.0
    for index in range(1, len(points)):
        segment = lengths[index - 1]
        if walked + segment <= target:
            output.append(points[index])
            walked += segment
            continue
        ratio = 0 if segment == 0 else (target - walked) / segment
        previous = points[index - 1]
        current = points[index]
        output.append((previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio))
        break
    return output


def polyline_length(points: list[tuple[float, float]]) -> float:
    return sum(math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points)))


def center_of(points: list[tuple[float, float]]) -> list[float]:
    return [sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def ease_out(value: float) -> float:
    value = clamp(value, 0, 1)
    return 1 - (1 - value) ** 2


def ease_in_out(value: float) -> float:
    value = clamp(value, 0, 1)
    return 2 * value * value if value < 0.5 else 1 - ((-2 * value + 2) ** 2) / 2


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    except Exception:
        return ImageFont.load_default()


if __name__ == "__main__":
    main()
