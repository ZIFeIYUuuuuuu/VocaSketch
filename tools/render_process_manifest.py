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
    parser = argparse.ArgumentParser(description="Render a VocaSketch playbackManifest.process to MP4.")
    parser.add_argument("--job", required=True, help="Drawing job id")
    parser.add_argument("--data-dir", default="backend/data", help="backend data dir")
    parser.add_argument("--output", required=True, help="Output mp4 path")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=960)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    job = json.loads((data_dir / "jobs" / f"{args.job}.json").read_text(encoding="utf-8"))
    process = job["playbackManifest"]["process"]
    final_asset = json.loads((data_dir / "assets" / f"{job['finalAssetId']}.json").read_text(encoding="utf-8"))
    final_path = data_dir / "assets" / final_asset["storagePath"]
    final = Image.open(final_path).convert("RGB")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    render_process(process, final, output_path, fps=args.fps, width=args.width, height=args.height)
    print(output_path)


def render_process(process: dict[str, Any], final: Image.Image, output_path: Path, *, fps: int, width: int, height: int) -> None:
    duration_ms = max(action["startMs"] + action["durationMs"] for action in process["actions"])
    frame_count = int(math.ceil(duration_ms / 1000 * fps))
    final_cover = cover_image(final, width, height)

    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for frame_index in range(frame_count + 1):
        elapsed_ms = int(frame_index * 1000 / fps)
        frame = draw_process_frame(process, final_cover, elapsed_ms, width, height)
        writer.write(cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR))
    writer.release()


def draw_process_frame(process: dict[str, Any], final_cover: Image.Image, elapsed_ms: int, width: int, height: int) -> Image.Image:
    frame = Image.new("RGB", (width, height), (255, 250, 243))
    draw = ImageDraw.Draw(frame, "RGBA")
    cursor: dict[str, Any] = {"visible": False, "x": width * 0.5, "y": height * 0.5, "radius": 12, "tool": "idle"}

    for action in sorted(process["actions"], key=lambda item: item["startMs"]):
        progress = clamp((elapsed_ms - action["startMs"]) / action["durationMs"], 0, 1)
        if progress <= 0:
            continue
        if action["type"] == "stroke":
            draw_stroke(draw, action, progress, width, height, cursor)
        elif action["type"] == "fillRegion":
            draw_fill(frame, final_cover, action, progress, width, height, cursor)
        elif action["type"] == "maskReveal":
            draw_mask(frame, final_cover, action, progress, width, height, cursor)
        elif action["type"] == "layerBadge":
            draw_badge(draw, action, progress, width, height)
        elif action["type"] == "finalReveal":
            overlay = Image.blend(frame, final_cover, 0.22 + ease_out(progress) * 0.78)
            frame.paste(overlay)
            cursor.update({"visible": progress < 1, "x": width * (0.45 + progress * 0.14), "y": height * (0.55 - progress * 0.14), "radius": 18, "tool": action["tool"]})
        elif action["type"] == "eyeSpark":
            frame.paste(final_cover)
            draw_eye_spark(draw, action, progress, width, height, cursor)

    draw_cursor(draw, cursor)
    return frame


def draw_stroke(draw: ImageDraw.ImageDraw, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    points = [(point["x"] * width, point["y"] * height) for point in action["points"]]
    visible = partial_polyline(points, ease_in_out(progress) if action.get("speedProfile") == "detail-slow" else ease_out(progress))
    if len(visible) < 2:
        return
    color = hex_to_rgba(action["color"], action["opacity"])
    line_width = max(1, int(action["strokeWidth"] * max(width, height)))
    draw.line(visible, fill=color, width=line_width, joint="curve")
    cursor.update({"visible": progress < 1, "x": visible[-1][0], "y": visible[-1][1], "radius": max(10, line_width * 2.2), "tool": action["tool"]})


def draw_fill(frame: Image.Image, final_cover: Image.Image, action: dict[str, Any], progress: float, width: int, height: int, cursor: dict[str, Any]) -> None:
    eased = ease_out(progress)
    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    cx, cy = action["center"]["x"] * width, action["center"]["y"] * height
    rx, ry = action["radius"]["x"] * width * eased, action["radius"]["y"] * height * eased
    mask_draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=int(255 * action["opacity"]))
    frame.paste(final_cover, mask=mask.filter(ImageFilter.GaussianBlur(max(1, int(min(width, height) * 0.012)))))
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
    draw.text((x + radius * 1.7, y - radius * 1.2), cursor["tool"], fill=(15, 23, 42, 190), font=load_font(16))


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


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    except Exception:
        return ImageFont.load_default()


if __name__ == "__main__":
    main()
