from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Any

from ..models import AssetRecord, PlaybackManifest


PROCESS_PLAYBACK_VERSION = "process-v16"
PROCESS_VIDEO_WIDTH = 960
PROCESS_VIDEO_HEIGHT = 720
PROCESS_VIDEO_FPS = 24


def enrich_manifest_with_process(
    manifest: PlaybackManifest,
    *,
    preview_asset: AssetRecord | None = None,
    final_asset: AssetRecord | None,
    lineart_asset: AssetRecord | None = None,
    preview_content_path: Path | None = None,
    final_content_path: Path | None = None,
    lineart_content_path: Path | None = None,
) -> PlaybackManifest:
    if final_asset is None or not final_asset.contentUrl:
        return manifest
    if _is_current_process(manifest.process, preview_asset=preview_asset):
        return manifest

    width = final_asset.width or (preview_asset.width if preview_asset else None) or manifest.canvasSize.get("width") or 1024
    height = final_asset.height or (preview_asset.height if preview_asset else None) or manifest.canvasSize.get("height") or 1024
    steps = _timeline_steps(width=width, height=height)
    process_mode = "final-image-stable-process"
    actions = _process_actions(
        steps,
        preview_content_path=preview_content_path,
        final_content_path=final_content_path,
        lineart_content_path=lineart_content_path,
    )
    stroke_count = len([action for action in actions if action["type"] == "stroke"])
    process = {
        "version": PROCESS_PLAYBACK_VERSION,
        "style": "linedrawer-lite-vector",
        "renderer": "canvas-stroke-manifest-process",
        "source": {
            "previewAssetId": preview_asset.assetId if preview_asset else None,
            "previewContentUrl": preview_asset.contentUrl if preview_asset else None,
            "finalAssetId": final_asset.assetId,
            "finalContentUrl": final_asset.contentUrl,
            "lineartAssetId": lineart_asset.assetId if lineart_asset else None,
            "lineartContentUrl": lineart_asset.contentUrl if lineart_asset else None,
            "mimeType": final_asset.mimeType,
            "width": width,
            "height": height,
            "mode": process_mode,
            "strokeCount": stroke_count,
        },
        "phases": [
            {
                "role": step["role"],
                "label": step["label"],
                "progressPercent": step["progressPercent"],
                "startMs": step["startMs"],
                "durationMs": step["durationMs"],
            }
            for step in steps
        ],
        "actions": actions,
        "ui": {
            "cursor": True,
            "layerBadges": ["Layer: Multiply", "Layer: Add / Glow"],
            "rightRailSync": True,
        },
    }
    duration_ms = max(manifest.durationMs, steps[-1]["startMs"] + steps[-1]["durationMs"])
    return manifest.model_copy(update={"durationMs": duration_ms, "process": process})


def render_process_video_bytes(
    process: dict[str, Any],
    *,
    final_content_path: Path,
    preview_content_path: Path | None = None,
    width: int = PROCESS_VIDEO_WIDTH,
    height: int = PROCESS_VIDEO_HEIGHT,
    fps: int = PROCESS_VIDEO_FPS,
) -> bytes | None:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
    except Exception:
        return None

    try:
        final_image = _open_process_source_image(Image, final_content_path)
        preview_image = _open_process_source_image(Image, preview_content_path) if preview_content_path else final_image
    except Exception:
        return None

    actions = [action for action in process.get("actions", []) if isinstance(action, dict)]
    if not actions:
        return None

    duration_ms = max(int(action.get("startMs", 0)) + int(action.get("durationMs", 0)) for action in actions)
    frame_count = int(math.ceil(duration_ms / 1000 * fps))
    final_cover = _cover_image(final_image, width, height)
    preview_cover = _cover_image(preview_image, width, height)

    with tempfile.TemporaryDirectory(prefix="vocasketch_process_video_") as tempdir:
        output_path = Path(tempdir) / "process.mp4"
        writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        if not writer.isOpened():
            return None
        for frame_index in range(frame_count + 1):
            elapsed_ms = int(frame_index * 1000 / fps)
            frame = _draw_process_video_frame(
                Image=Image,
                ImageChops=ImageChops,
                ImageDraw=ImageDraw,
                ImageFilter=ImageFilter,
                ImageFont=ImageFont,
                process=process,
                preview_cover=preview_cover,
                final_cover=final_cover,
                elapsed_ms=elapsed_ms,
                width=width,
                height=height,
            )
            writer.write(cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR))
        writer.release()
        payload = output_path.read_bytes()
        return payload or None


def _open_process_source_image(Image: Any, path: Path | None) -> Any:
    if path is None:
        raise FileNotFoundError("missing process source image")
    if path.suffix.lower() == ".svg":
        from svglib.svglib import svg2rlg  # type: ignore[import-not-found]
        from reportlab.graphics import renderPM  # type: ignore[import-not-found]

        drawing = svg2rlg(str(path))
        png_bytes = renderPM.drawToString(drawing, fmt="PNG")
        from io import BytesIO

        return Image.open(BytesIO(png_bytes)).convert("RGB")
    return Image.open(path).convert("RGB")


def _is_current_process(process: dict[str, Any] | None, *, preview_asset: AssetRecord | None) -> bool:
    del preview_asset
    if not process:
        return False
    source = process.get("source") if isinstance(process.get("source"), dict) else {}
    return process.get("version") == PROCESS_PLAYBACK_VERSION and source.get("mode") == "final-image-stable-process"


def _timeline_steps(*, width: int, height: int) -> list[dict[str, Any]]:
    del width, height
    return [
        {"role": "sketch", "label": "10% 草图", "progressPercent": 10, "startMs": 0, "durationMs": 1000},
        {"role": "lineart", "label": "25% 线稿", "progressPercent": 25, "startMs": 1000, "durationMs": 14000},
        {"role": "flat_color", "label": "45% 平涂", "progressPercent": 45, "startMs": 15000, "durationMs": 3600},
        {"role": "shadow", "label": "65% 阴影", "progressPercent": 65, "startMs": 18600, "durationMs": 2300},
        {"role": "lighting", "label": "85% 光照", "progressPercent": 85, "startMs": 20900, "durationMs": 1400},
        {"role": "details", "label": "100% 完成", "progressPercent": 100, "startMs": 22300, "durationMs": 1700},
    ]


def _process_actions(
    steps: list[dict[str, Any]],
    *,
    preview_content_path: Path | None = None,
    final_content_path: Path | None = None,
    lineart_content_path: Path | None = None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    image_strokes = _image_derived_stroke_actions(
        preview_content_path=preview_content_path,
        final_content_path=final_content_path,
        lineart_content_path=lineart_content_path,
        steps=steps,
    )
    if image_strokes:
        actions.extend(image_strokes)
    else:
        actions.extend(_template_stroke_actions(_step(steps, "sketch"), prefix="sketch", color="#7b8794", width=0.006, opacity=0.54))
        actions.extend(_template_stroke_actions(_step(steps, "lineart"), prefix="lineart", color="#111827", width=0.0045, opacity=0.9))
    actions.extend(_fill_actions(_step(steps, "flat_color"), source_image="final"))
    actions.extend(_mask_actions(_step(steps, "shadow"), role="shadow", blend_mode="multiply", badge="Layer: Multiply"))
    actions.extend(_mask_actions(_step(steps, "lighting"), role="lighting", blend_mode="screen", badge="Layer: Add / Glow"))
    actions.extend(_finish_actions(_step(steps, "details")))
    return actions


def _step(steps: list[dict[str, Any]], role: str) -> dict[str, Any]:
    for step in steps:
        if step["role"] == role:
            return step
    raise ValueError(f"missing process step: {role}")


def _image_derived_stroke_actions(
    *,
    preview_content_path: Path | None,
    final_content_path: Path | None,
    lineart_content_path: Path | None,
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if preview_content_path is None and final_content_path is None and lineart_content_path is None:
        return []

    # Keep the visible drawing process locked to the final image whenever it is
    # available. The lineart stroke manifest is derived from the same generated
    # image that the user sees at the end, so the process does not drift between
    # preview and final model calls.
    sketch_source = lineart_content_path or final_content_path or preview_content_path
    lineart_source = lineart_content_path or preview_content_path or final_content_path
    if sketch_source is None or lineart_source is None:
        return []

    sketch_contours = _extract_normalized_contours(sketch_source, variant="sketch")
    lineart_contours = _extract_normalized_contours(lineart_source, variant="lineart")
    sketch_source_label = _stroke_source_label(sketch_source, final_content_path=final_content_path, preview_content_path=preview_content_path, lineart_content_path=lineart_content_path)
    lineart_source_label = _stroke_source_label(lineart_source, final_content_path=final_content_path, preview_content_path=preview_content_path, lineart_content_path=lineart_content_path)
    if not sketch_contours and not lineart_contours:
        return []

    sketch_step = _step(steps, "sketch")
    lineart_step = _step(steps, "lineart")
    return [
        *_contours_to_stroke_actions(
            sketch_contours[: min(64, len(sketch_contours))],
            step=sketch_step,
            prefix="sketch-edge",
            color="#8b96a6",
            stroke_width=0.00275,
            opacity=0.58,
            tool="pencil",
            source=sketch_source_label,
        ),
        *_contours_to_stroke_actions(
            lineart_contours,
            step=lineart_step,
            prefix="lineart-edge",
            color="#101318",
            stroke_width=0.00305,
            opacity=0.99,
            tool="inking-pen",
            source=lineart_source_label,
        ),
    ]


def _stroke_source_label(
    source: Path,
    *,
    final_content_path: Path | None,
    preview_content_path: Path | None,
    lineart_content_path: Path | None,
) -> str:
    if lineart_content_path is not None and source == lineart_content_path:
        return "model-clean-lineart-vector"
    if preview_content_path is not None and source == preview_content_path:
        return "preview-lineart-vector"
    if final_content_path is not None and source == final_content_path:
        return "final-lineart-vector"
    return "image-lineart-vector"


def _extract_normalized_contours(image_path: Path, *, variant: str = "lineart") -> list[list[tuple[float, float]]]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        from PIL import Image
    except Exception:
        return []

    try:
        with Image.open(image_path) as image:
            rgb = image.convert("RGB")
            cropped = _center_crop_to_square(rgb)
            canvas_size = 1024 if variant == "lineart" else 512
            resized = cropped.resize((canvas_size, canvas_size))
            array = np.array(resized)
    except Exception:
        return []

    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    if variant == "sketch":
        gray = cv2.GaussianBlur(gray, (7, 7), 0)
        edges = cv2.Canny(gray, 42, 128)
    else:
        edges = _lineart_mask_from_rgb(cv2, np, array)
    canvas_size = int(array.shape[0])
    edges = cv2.dilate(edges, np.ones((2, 2), dtype=np.uint8), iterations=1 if variant == "sketch" else 0)
    if variant == "sketch":
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8), iterations=1)
    edges = cv2.bitwise_and(edges, _subject_focus_mask(np, size=canvas_size, variant=variant))
    if variant == "lineart":
        strokes = _trace_lineart_strokes(cv2, np, edges)
    else:
        found = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        contours = found[0] if len(found) == 2 else found[1]
        strokes = []
        for contour in contours:
            arc_length = cv2.arcLength(contour, closed=False)
            if arc_length < 30:
                continue
            epsilon = max(1.5, arc_length * 0.012)
            approx = cv2.approxPolyDP(contour, epsilon, closed=False)
            strokes.append([(float(point[0][0]), float(point[0][1])) for point in approx])

    normalized: list[list[tuple[float, float]]] = []
    for stroke in strokes:
        points = [(float(x) / canvas_size, float(y) / canvas_size) for x, y in stroke]
        points = _smooth_points(points, iterations=1 if variant == "lineart" else 0)
        points = _simplify_points(points, max_points=22 if variant == "sketch" else 72)
        if len(points) >= 2 and _is_subject_contour(points, variant=variant):
            normalized.append(points)

    def contour_key(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        length = _polyline_length(points)
        center_y = sum(point[1] for point in points) / len(points)
        center_x = sum(point[0] for point in points) / len(points)
        focus = abs(center_x - 0.52) + abs(center_y - 0.50)
        # LineDrawer Lite feel: big silhouette first, then scan facial and
        # clothing details. Short hair specks are delayed instead of dropped.
        tier = 0 if length > 0.20 else 1 if length > 0.085 else 2
        facial_detail_bonus = -0.10 if 0.28 <= center_x <= 0.74 and 0.28 <= center_y <= 0.66 else 0.14
        scan = center_y * 0.42 + center_x * 0.18
        return (tier, focus + facial_detail_bonus, scan, -min(length, 0.42))

    normalized.sort(key=contour_key)
    if variant == "lineart":
        normalized = _split_paths_into_lineart_strokes(normalized)
    return normalized[:64] if variant == "sketch" else normalized


def _lineart_mask_from_rgb(cv2: Any, np: Any, array: Any) -> Any:
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    smooth = cv2.bilateralFilter(gray, 9, 70, 70)
    fine = cv2.Canny(smooth, 16, 72)
    broad = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 26, 104)
    color_edges = np.zeros(gray.shape, dtype=np.uint8)
    lab = cv2.cvtColor(array, cv2.COLOR_RGB2LAB)
    for channel_index in range(3):
        channel = cv2.GaussianBlur(lab[:, :, channel_index], (3, 3), 0)
        color_edges = cv2.bitwise_or(color_edges, cv2.Canny(channel, 16, 70))
    dog_small = cv2.GaussianBlur(gray, (0, 0), 1.1)
    dog_large = cv2.GaussianBlur(gray, (0, 0), 3.4)
    dog = cv2.absdiff(dog_small, dog_large)
    _, dog_edges = cv2.threshold(dog, 5, 255, cv2.THRESH_BINARY)
    laplacian = cv2.convertScaleAbs(cv2.Laplacian(cv2.GaussianBlur(gray, (3, 3), 0), cv2.CV_16S, ksize=3))
    _, lap_edges = cv2.threshold(laplacian, 11, 255, cv2.THRESH_BINARY)
    adaptive = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (5, 5), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        7,
    )
    gradient_edges = cv2.bitwise_or(color_edges, cv2.bitwise_or(dog_edges, lap_edges))
    edges = cv2.bitwise_or(fine, cv2.bitwise_or(broad, cv2.bitwise_and(adaptive, gradient_edges)))
    edges = cv2.bitwise_or(edges, cv2.bitwise_and(gradient_edges, cv2.dilate(fine, np.ones((3, 3), dtype=np.uint8), iterations=1)))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((2, 2), dtype=np.uint8), iterations=1)
    edges = _remove_small_components(cv2, np, edges, min_area=6)
    return edges


def _trace_lineart_strokes(cv2: Any, np: Any, mask: Any) -> list[list[tuple[float, float]]]:
    found = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]
    strokes: list[list[tuple[float, float]]] = []
    for contour in contours:
        arc_length = cv2.arcLength(contour, closed=False)
        if arc_length < 10:
            continue
        epsilon = max(0.65, arc_length * 0.0048)
        approx = cv2.approxPolyDP(contour, epsilon, closed=False)
        points = [(float(point[0][0]), float(point[0][1])) for point in approx]
        if _pixel_polyline_length(points) >= 8:
            strokes.append(points)

    if len(strokes) >= 32:
        return strokes

    skeleton = _morphological_skeleton(cv2, np, mask)
    return _trace_skeleton_paths(np, skeleton)


def _remove_small_components(cv2: Any, np: Any, binary: Any, *, min_area: int) -> Any:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((binary > 0).astype(np.uint8), connectivity=8)
    cleaned = np.zeros(binary.shape, dtype=np.uint8)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == label] = 255
    return cleaned


def _morphological_skeleton(cv2: Any, np: Any, binary: Any) -> Any:
    image = (binary > 0).astype(np.uint8) * 255
    skeleton = np.zeros(image.shape, dtype=np.uint8)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while cv2.countNonZero(image) > 0:
        eroded = cv2.erode(image, element)
        opened = cv2.dilate(eroded, element)
        skeleton = cv2.bitwise_or(skeleton, cv2.subtract(image, opened))
        image = eroded
    return skeleton


def _trace_skeleton_paths(np: Any, skeleton: Any) -> list[list[tuple[float, float]]]:
    pixels = set(zip(*np.where(skeleton > 0)))
    if not pixels:
        return []

    def neighbors(pixel: tuple[int, int]) -> list[tuple[int, int]]:
        y, x = pixel
        result: list[tuple[int, int]] = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                candidate = (y + dy, x + dx)
                if candidate in pixels:
                    result.append(candidate)
        return result

    nodes = {pixel for pixel in pixels if len(neighbors(pixel)) != 2}
    visited_edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    paths: list[list[tuple[float, float]]] = []

    def edge_key(left: tuple[int, int], right: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
        return (left, right) if left <= right else (right, left)

    def add_path(path: list[tuple[int, int]]) -> None:
        if len(path) < 2:
            return
        points = [(float(x), float(y)) for y, x in path]
        if _pixel_polyline_length(points) < 5:
            return
        paths.append(points)

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
                candidates = [item for item in neighbors(current) if item != previous]
                if not candidates:
                    break
                next_pixel = min(candidates, key=lambda item: (item[0], item[1]))
                next_key = edge_key(current, next_pixel)
                if next_key in visited_edges:
                    break
                path.append(next_pixel)
                visited_edges.add(next_key)
                previous, current = current, next_pixel
            add_path(path)

    for pixel in sorted(pixels):
        for neighbor in neighbors(pixel):
            key = edge_key(pixel, neighbor)
            if key in visited_edges:
                continue
            path = [pixel, neighbor]
            visited_edges.add(key)
            previous = pixel
            current = neighbor
            for _ in range(512 * 512):
                candidates = [item for item in neighbors(current) if item != previous and edge_key(current, item) not in visited_edges]
                if not candidates:
                    break
                next_pixel = min(candidates, key=lambda item: (item[0], item[1]))
                path.append(next_pixel)
                visited_edges.add(edge_key(current, next_pixel))
                previous, current = current, next_pixel
                if current == pixel:
                    break
            add_path(path)

    return paths


def _subject_focus_mask(np: Any, *, size: int = 512, variant: str = "lineart") -> Any:
    mask = np.zeros((size, size), dtype=np.uint8)
    ellipses = (
        [
            (0.51, 0.28, 0.35, 0.27),
            (0.52, 0.52, 0.31, 0.40),
            (0.52, 0.80, 0.42, 0.23),
        ]
        if variant == "sketch"
        else [
            (0.51, 0.29, 0.42, 0.31),
            (0.52, 0.53, 0.36, 0.43),
            (0.52, 0.80, 0.48, 0.27),
        ]
    )
    yy, xx = np.ogrid[:size, :size]
    for center_x, center_y, radius_x, radius_y in ellipses:
        normalized = (((xx / float(size)) - center_x) / radius_x) ** 2 + (((yy / float(size)) - center_y) / radius_y) ** 2
        mask[normalized <= 1.0] = 255
    return mask


def _is_subject_contour(points: list[tuple[float, float]], *, variant: str = "lineart") -> bool:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    min_x = min(xs)
    max_x = max(xs)
    min_y = min(ys)
    max_y = max(ys)
    width = max_x - min_x
    height = max_y - min_y
    center_x = sum(xs) / len(xs)
    center_y = sum(ys) / len(ys)
    length = _polyline_length(points)

    if min_x < 0.03 or min_y < 0.03 or max_x > 0.97 or max_y > 0.97:
        return False
    if width > 0.82 or height > 0.82:
        return False
    if length < (0.055 if variant == "sketch" else 0.012):
        return False
    if max(width, height) < (0.024 if variant == "sketch" else 0.006):
        return False
    if center_x < 0.08 or center_x > 0.94 or center_y < 0.04 or center_y > 0.98:
        return False
    if variant == "sketch" and (center_x < 0.16 or center_x > 0.88 or center_y < 0.08 or center_y > 0.94):
        return False
    return True


def _center_crop_to_square(image: Any) -> Any:
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def _simplify_points(points: list[tuple[float, float]], *, max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    step = (len(points) - 1) / (max_points - 1)
    return [points[round(index * step)] for index in range(max_points)]


def _smooth_points(points: list[tuple[float, float]], *, iterations: int = 2) -> list[tuple[float, float]]:
    if iterations <= 0 or len(points) < 4:
        return points
    smoothed = points
    for _ in range(iterations):
        next_points: list[tuple[float, float]] = [smoothed[0]]
        for index in range(len(smoothed) - 1):
            p0 = smoothed[index]
            p1 = smoothed[index + 1]
            next_points.append((p0[0] * 0.70 + p1[0] * 0.30, p0[1] * 0.70 + p1[1] * 0.30))
            next_points.append((p0[0] * 0.30 + p1[0] * 0.70, p0[1] * 0.30 + p1[1] * 0.70))
        next_points.append(smoothed[-1])
        smoothed = next_points
    return smoothed


def _polyline_length(points: list[tuple[float, float]]) -> float:
    return sum(math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points)))


def _pixel_polyline_length(points: list[tuple[float, float]]) -> float:
    return sum(math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points)))


def _contours_to_stroke_actions(
    contours: list[list[tuple[float, float]]],
    *,
    step: dict[str, Any],
    prefix: str,
    color: str,
    stroke_width: float,
    opacity: float,
    tool: str,
    source: str = "final-image-contour",
) -> list[dict[str, Any]]:
    if not contours:
        return []

    actions: list[dict[str, Any]] = []
    duration_window = max(1, int(step["durationMs"] * 0.96))
    latest_start_window = max(1, duration_window - 720)
    for index, points in enumerate(contours):
        length = _polyline_length(points)
        start_ratio = index / max(1, len(contours) - 1)
        paced_start_ratio = start_ratio**1.08
        start_ms = int(step["startMs"] + paced_start_ratio * latest_start_window)
        tier = 0 if length > 0.20 else 1 if length > 0.085 else 2
        duration_ms = int((460 if tier == 0 else 360 if tier == 1 else 260) + min(760, length * 1050))
        actions.append(
            {
                "id": f"{prefix}-{index + 1}",
                "type": "stroke",
                "phase": step["role"],
                "label": step["label"],
                "startMs": start_ms,
                "durationMs": duration_ms,
                "tool": tool,
                "points": [{"x": round(x, 4), "y": round(y, 4)} for x, y in points],
                "strokeWidth": stroke_width,
                "color": color,
                "opacity": opacity,
                "speedProfile": "long-fast-short-slow" if length > 0.17 else "detail-slow",
                "source": source,
                "strokeMeta": {
                    "length": round(length, 4),
                    "tier": tier,
                    "ordering": "tiered length + spatial scan heuristic",
                    "bbox": _stroke_bbox(points),
                },
            }
        )
    return actions


def _stroke_bbox(points: list[tuple[float, float]]) -> dict[str, float]:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {
        "x": round(min(xs), 4),
        "y": round(min(ys), 4),
        "width": round(max(xs) - min(xs), 4),
        "height": round(max(ys) - min(ys), 4),
    }


def _split_paths_into_lineart_strokes(paths: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    segmented: list[list[tuple[float, float]]] = []
    for points in paths:
        if len(points) <= 18:
            segmented.append(points)
            continue

        length = _polyline_length(points)
        target_points = 24 if length > 0.31 else 20 if length > 0.16 else 15
        overlap = 3
        index = 0
        while index < len(points) - 1:
            end = min(len(points), index + target_points)
            chunk = points[index:end]
            if len(chunk) >= 2:
                segmented.append(chunk)
            if end >= len(points):
                break
            index = max(end - overlap, index + 1)

    return segmented


def _template_stroke_actions(step: dict[str, Any], *, prefix: str, color: str, width: float, opacity: float) -> list[dict[str, Any]]:
    paths = [
        [(0.38, 0.13), (0.34, 0.19), (0.31, 0.29), (0.28, 0.43), (0.27, 0.58)],
        [(0.45, 0.11), (0.47, 0.21), (0.49, 0.33), (0.51, 0.49), (0.52, 0.66)],
        [(0.57, 0.14), (0.62, 0.24), (0.66, 0.38), (0.68, 0.54), (0.66, 0.68)],
        [(0.30, 0.37), (0.38, 0.32), (0.48, 0.31), (0.59, 0.34), (0.68, 0.41)],
        [(0.35, 0.50), (0.43, 0.54), (0.52, 0.55), (0.62, 0.51)],
        [(0.25, 0.73), (0.39, 0.65), (0.52, 0.64), (0.69, 0.73)],
        [(0.36, 0.80), (0.45, 0.88), (0.56, 0.88), (0.67, 0.80)],
    ]
    stagger = step["durationMs"] / (len(paths) + 0.6)
    actions: list[dict[str, Any]] = []
    for index, points in enumerate(paths):
        duration_ms = int(stagger * (1.35 if index in {0, 2, 5} else 1.05))
        start_ms = int(step["startMs"] + index * stagger * 0.72)
        actions.append(
            {
                "id": f"{prefix}-stroke-{index + 1}",
                "type": "stroke",
                "phase": step["role"],
                "label": step["label"],
                "startMs": start_ms,
                "durationMs": duration_ms,
                "tool": "pencil" if prefix == "sketch" else "inking-pen",
                "points": [{"x": x, "y": y} for x, y in points],
                "strokeWidth": width,
                "color": color,
                "opacity": opacity,
                "speedProfile": "long-fast-short-slow" if index in {0, 2, 5} else "detail-slow",
            }
        )
    return actions


def _fill_actions(step: dict[str, Any], *, source_image: str) -> list[dict[str, Any]]:
    regions = [
        ("hair-left", 0.43, 0.28, 0.12, 0.11, "#8cc8e7", 0.42, 0.40, 0.08),
        ("hair-right", 0.58, 0.30, 0.11, 0.10, "#71b4e0", 0.4, 0.40, 0.08),
        ("face-base", 0.50, 0.41, 0.085, 0.075, "#ffd9cf", 0.36, 0.34, 0.05),
        ("upper-cloak", 0.55, 0.54, 0.14, 0.13, "#51658d", 0.38, 0.44, 0.08),
        ("dress-core", 0.54, 0.70, 0.17, 0.16, "#38517f", 0.42, 0.48, 0.08),
        ("accent-ribbon", 0.63, 0.60, 0.08, 0.065, "#f2a7c4", 0.32, 0.42, 0.06),
    ]
    actions: list[dict[str, Any]] = []
    for index, (name, x, y, rx, ry, color, opacity, image_alpha, tint_alpha) in enumerate(regions):
        actions.append(
            {
                "id": f"flat-fill-{name}",
                "type": "fillRegion",
                "phase": step["role"],
                "label": step["label"],
                "startMs": int(step["startMs"] + index * 290),
                "durationMs": 760,
                "tool": "soft-brush",
                "center": {"x": x, "y": y},
                "radius": {"x": rx, "y": ry},
                "color": color,
                "opacity": opacity,
                "sourceImage": source_image,
                "imageAlpha": image_alpha,
                "tintAlpha": tint_alpha,
                "filterStyle": "preview-flats" if source_image == "preview" else "final-flats",
                "edgeFeather": 0.22,
                "reveal": "center-out",
            }
        )
    return actions


def _mask_actions(step: dict[str, Any], *, role: str, blend_mode: str, badge: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"{role}-badge",
            "type": "layerBadge",
            "phase": role,
            "label": badge,
            "startMs": step["startMs"],
            "durationMs": 780,
            "blendMode": blend_mode,
        },
        {
            "id": f"{role}-mask-reveal",
            "type": "maskReveal",
            "phase": role,
            "label": step["label"],
            "startMs": int(step["startMs"] + 160),
            "durationMs": int(step["durationMs"] * 0.86),
            "tool": "airbrush",
            "blendMode": blend_mode,
            "opacity": 0.34 if role == "shadow" else 0.42,
            "direction": "upper-left-to-lower-right" if role == "shadow" else "eye-to-rim",
            "filter": "shadow-luma" if role == "shadow" else "highlight-luma",
        },
    ]


def _finish_actions(step: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": "details-final-reveal",
            "type": "finalReveal",
            "phase": step["role"],
            "label": step["label"],
            "startMs": step["startMs"],
            "durationMs": 1450,
            "tool": "detail-brush",
        },
    ]


def _draw_process_video_frame(
    *,
    Image: Any,
    ImageChops: Any,
    ImageDraw: Any,
    ImageFilter: Any,
    ImageFont: Any,
    process: dict[str, Any],
    preview_cover: Any,
    final_cover: Any,
    elapsed_ms: int,
    width: int,
    height: int,
) -> Any:
    frame = Image.new("RGB", (width, height), (238, 245, 249))
    draw = ImageDraw.Draw(frame, "RGBA")
    canvas_box = (24, 50, 874, 930)
    image_frame = _fit_frame(1024, 1024, 46, 84, 820, 820)
    final_source = _cover_image(final_cover, 1024, 1024).resize((image_frame["width"], image_frame["height"]))
    preview_source = _cover_image(preview_cover, 1024, 1024).resize((image_frame["width"], image_frame["height"]))

    draw.rounded_rectangle(canvas_box, radius=18, fill=(255, 255, 255, 255), outline=(214, 226, 236, 255), width=2)
    draw.text((42, 20), "LineDrawer Lite 完整绘画过程重建", fill=(30, 41, 59), font=_font(ImageFont, 22))
    draw.text((42, 54), "from 0 · backend rendered · same asset in web and export", fill=(100, 116, 139), font=_font(ImageFont, 13))

    phases = process.get("phases", [])
    line_phase = next((phase for phase in phases if phase.get("role") == "lineart"), None)
    line_end = int(line_phase["startMs"] + line_phase["durationMs"]) if line_phase else 15000
    duration_ms = max(int(action.get("startMs", 0)) + int(action.get("durationMs", 0)) for action in process.get("actions", []))

    color_layer = _build_process_color_layer(
        Image=Image,
        ImageChops=ImageChops,
        ImageDraw=ImageDraw,
        ImageFilter=ImageFilter,
        source=final_source,
        elapsed_ms=elapsed_ms,
        line_end_ms=line_end,
        duration_ms=duration_ms,
    )
    if color_layer is not None:
        frame.paste(color_layer["image"], (image_frame["x"], image_frame["y"]), color_layer["mask"])

    cursor = {"visible": False, "x": 0.0, "y": 0.0, "radius": 10.0}
    _draw_process_video_strokes(draw, process.get("actions", []), elapsed_ms, image_frame, cursor)
    _draw_process_video_cursor(draw, cursor)
    _draw_process_video_rail(draw, ImageFont, process, elapsed_ms, duration_ms, line_end)
    _draw_process_video_progress(draw, ImageFont, elapsed_ms, duration_ms)
    return frame


def _build_process_color_layer(
    *,
    Image: Any,
    ImageChops: Any,
    ImageDraw: Any,
    ImageFilter: Any,
    source: Any,
    elapsed_ms: int,
    line_end_ms: int,
    duration_ms: int,
) -> dict[str, Any] | None:
    import numpy as np  # type: ignore[import-not-found]

    flat_start = line_end_ms
    shadow_start = line_end_ms + 3600
    light_start = line_end_ms + 5900
    final_start = max(light_start + 900, duration_ms - 1700)
    base = Image.new("RGB", source.size, (255, 255, 255))
    mask = Image.new("L", source.size, 0)
    if elapsed_ms >= flat_start:
        flat = _clamp((elapsed_ms - flat_start) / 3600, 0, 1)
        mask = _process_color_reveal_mask(Image, ImageDraw, ImageFilter, source.size, flat)
        flats = source.filter(ImageFilter.GaussianBlur(1.0))
        base.paste(flats, mask=mask)
    if elapsed_ms >= shadow_start:
        shadow = _ease_out(_clamp((elapsed_ms - shadow_start) / 2300, 0, 1))
        shadow_mask = _process_luma_mask(source, dark=True).point(lambda value: int(value * shadow * 0.42))
        shadow_source = source.point(lambda value: max(0, int(value * 0.76)))
        base.paste(shadow_source, mask=shadow_mask.filter(ImageFilter.GaussianBlur(4)))
        mask = Image.fromarray(np.maximum(np.array(mask), np.array(shadow_mask)).astype("uint8"))
    if elapsed_ms >= light_start:
        light = _ease_out(_clamp((elapsed_ms - light_start) / 1700, 0, 1))
        light_mask = _process_luma_mask(source, dark=False).point(lambda value: int(value * light * 0.34))
        light_source = source.point(lambda value: min(255, int(value * 1.16 + 10)))
        base.paste(light_source, mask=light_mask.filter(ImageFilter.GaussianBlur(3)))
        mask = Image.fromarray(np.maximum(np.array(mask), np.array(light_mask)).astype("uint8"))
    if elapsed_ms >= final_start:
        final = _ease_out(_clamp((elapsed_ms - final_start) / 1500, 0, 1))
        final_mask = Image.new("L", source.size, int(255 * final))
        blended = Image.blend(base, source, final)
        return {"image": blended, "mask": final_mask}
    return {"image": base, "mask": mask} if mask.getbbox() else None


def _draw_process_video_strokes(draw: Any, actions: list[dict[str, Any]], elapsed_ms: int, image_frame: dict[str, int], cursor: dict[str, Any]) -> None:
    active: tuple[float, float, float] | None = None
    for action in sorted(actions, key=lambda item: int(item.get("startMs", 0))):
        if action.get("type") != "stroke":
            continue
        duration_ms = max(1, int(action.get("durationMs", 1)))
        progress = _clamp((elapsed_ms - int(action.get("startMs", 0))) / duration_ms, 0, 1)
        if progress <= 0:
            continue
        raw_points = action.get("points") or []
        points = [
            (
                image_frame["x"] + float(point["x"]) * image_frame["width"],
                image_frame["y"] + float(point["y"]) * image_frame["height"],
            )
            for point in raw_points
            if isinstance(point, dict) and "x" in point and "y" in point
        ]
        visible = _partial_polyline(points, _ease_in_out(progress))
        if len(visible) < 2:
            continue
        meta = action.get("strokeMeta") if isinstance(action.get("strokeMeta"), dict) else {}
        tier = int(meta.get("tier", 1))
        alpha = int(238 * float(action.get("opacity", 1.0))) if progress >= 1 else int(202 * float(action.get("opacity", 1.0)))
        alpha = max(30, min(255, alpha))
        line_width = max(1, int(float(action.get("strokeWidth", 0.002)) * max(image_frame["width"], image_frame["height"]) * (1.2 if tier == 0 else 1.0)))
        draw.line(visible, fill=(15, 23, 42, alpha), width=line_width, joint="curve")
        if progress < 1:
            active = (visible[-1][0], visible[-1][1], max(9, line_width * 3.2))
    if active:
        cursor.update({"visible": True, "x": active[0], "y": active[1], "radius": active[2]})


def _draw_process_video_rail(draw: Any, ImageFont: Any, process: dict[str, Any], elapsed_ms: int, duration_ms: int, line_end_ms: int) -> None:
    x, y, width = 910, 84, 310
    actions = process.get("actions", [])
    strokes = [action for action in actions if action.get("type") == "stroke"]
    completed_strokes = sum(1 for stroke in strokes if elapsed_ms >= int(stroke.get("startMs", 0)) + int(stroke.get("durationMs", 0)))
    draw.rounded_rectangle((x, y, x + width, y + 810), radius=16, fill=(248, 251, 253, 255), outline=(213, 225, 234, 255), width=2)
    draw.rounded_rectangle((x + 24, y + 22, x + 176, y + 52), radius=12, fill=(224, 247, 253, 255))
    draw.text((x + 38, y + 29), f"{completed_strokes}/{len(strokes)} strokes", fill=(8, 145, 178), font=_font(ImageFont, 14))
    steps = [
        ("10% 草图", "灰色辅助线扫入", 0, 1700),
        ("25% 线稿", "笔画逐条画出", 1700, line_end_ms),
        ("45% 平涂", "颜色铺开", line_end_ms, line_end_ms + 3600),
        ("65% 阴影", "Multiply 暗部叠入", line_end_ms + 3600, line_end_ms + 5900),
        ("85% 光照", "Add / Glow 高光扩散", line_end_ms + 5900, duration_ms - 1700),
        ("100% 完成", "原图收束", duration_ms - 1700, duration_ms),
    ]
    for index, (label, hint, start, end) in enumerate(steps):
        top = y + 88 + index * 94
        active = start <= elapsed_ms < end
        fill = (236, 253, 255, 255) if active else (255, 255, 255, 255)
        outline = (45, 212, 191, 255) if active else (226, 232, 240, 255)
        draw.rounded_rectangle((x + 24, top, x + width - 24, top + 72), radius=10, fill=fill, outline=outline, width=2 if active else 1)
        draw.text((x + 42, top + 14), label, fill=(15, 23, 42), font=_font(ImageFont, 15))
        draw.text((x + 42, top + 40), hint, fill=(100, 116, 139), font=_font(ImageFont, 12))


def _draw_process_video_progress(draw: Any, ImageFont: Any, elapsed_ms: int, duration_ms: int) -> None:
    x, y, width, height = 934, 836, 246, 12
    progress = _clamp(elapsed_ms / max(1, duration_ms), 0, 1)
    draw.rounded_rectangle((x, y, x + width, y + height), radius=6, fill=(226, 232, 240, 255))
    draw.rounded_rectangle((x, y, x + int(width * progress), y + height), radius=6, fill=(34, 211, 238, 255))
    draw.text((x, y + 22), f"整体进度 {int(progress * 100)}%", fill=(8, 145, 178), font=_font(ImageFont, 13))


def _draw_process_video_cursor(draw: Any, cursor: dict[str, Any]) -> None:
    if not cursor.get("visible"):
        return
    x = float(cursor["x"])
    y = float(cursor["y"])
    radius = float(cursor["radius"])
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(8, 145, 178, 230), width=3, fill=(8, 145, 178, 26))
    draw.line((x - radius * 1.45, y, x - radius * 0.45, y), fill=(8, 145, 178, 220), width=2)
    draw.line((x + radius * 0.45, y, x + radius * 1.45, y), fill=(8, 145, 178, 220), width=2)
    draw.line((x, y - radius * 1.45, x, y - radius * 0.45), fill=(8, 145, 178, 220), width=2)
    draw.line((x, y + radius * 0.45, x, y + radius * 1.45), fill=(8, 145, 178, 220), width=2)


def _process_color_reveal_mask(Image: Any, ImageDraw: Any, ImageFilter: Any, size: tuple[int, int], progress: float) -> Any:
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
    eased = _ease_out(progress)
    for index, (center_x, center_y, radius_x, radius_y) in enumerate(centers):
        local = _clamp((eased - index * 0.11) / 0.62, 0, 1)
        if local <= 0:
            continue
        x, y = center_x * width, center_y * height
        draw.ellipse((x - radius_x * width * local, y - radius_y * height * local, x + radius_x * width * local, y + radius_y * height * local), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(10, int(width * 0.025))))


def _process_luma_mask(image: Any, *, dark: bool) -> Any:
    gray = image.convert("L")
    if dark:
        return gray.point(lambda value: 255 if value < 102 else max(0, int((164 - value) * 2.1)) if value < 164 else 0)
    return gray.point(lambda value: 255 if value > 222 else max(0, int((value - 172) * 2.4)) if value > 172 else 0)


def _cover_image(image: Any, width: int, height: int) -> Any:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)))
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _fit_frame(source_width: int, source_height: int, x: int, y: int, width: int, height: int) -> dict[str, int]:
    scale = min(width / source_width, height / source_height)
    draw_width = int(source_width * scale)
    draw_height = int(source_height * scale)
    return {"x": x + (width - draw_width) // 2, "y": y + (height - draw_height) // 2, "width": draw_width, "height": draw_height}


def _partial_polyline(points: list[tuple[float, float]], progress: float) -> list[tuple[float, float]]:
    if len(points) <= 1:
        return points
    lengths = [math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) for index in range(1, len(points))]
    total = sum(lengths)
    target = total * _clamp(progress, 0, 1)
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


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _ease_out(value: float) -> float:
    value = _clamp(value, 0, 1)
    return 1 - (1 - value) ** 2


def _ease_in_out(value: float) -> float:
    value = _clamp(value, 0, 1)
    return 2 * value * value if value < 0.5 else 1 - ((-2 * value + 2) ** 2) / 2


def _font(ImageFont: Any, size: int) -> Any:
    try:
        return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    except Exception:
        return ImageFont.load_default()
