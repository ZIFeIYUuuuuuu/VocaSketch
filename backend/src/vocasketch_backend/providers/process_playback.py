from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from ..models import AssetRecord, PlaybackManifest


PROCESS_PLAYBACK_VERSION = "process-v2"


def enrich_manifest_with_process(
    manifest: PlaybackManifest,
    *,
    final_asset: AssetRecord | None,
    final_content_path: Path | None = None,
) -> PlaybackManifest:
    if final_asset is None or not final_asset.contentUrl:
        return manifest
    if manifest.process and manifest.process.get("version") == PROCESS_PLAYBACK_VERSION:
        return manifest

    width = final_asset.width or manifest.canvasSize.get("width") or 1024
    height = final_asset.height or manifest.canvasSize.get("height") or 1024
    steps = _timeline_steps(width=width, height=height)
    actions = _process_actions(steps, final_content_path=final_content_path)
    stroke_count = len([action for action in actions if action["type"] == "stroke"])
    process = {
        "version": PROCESS_PLAYBACK_VERSION,
        "style": "linedrawer-color-derived",
        "renderer": "canvas-final-image-luma-strokes",
        "source": {
            "finalAssetId": final_asset.assetId,
            "finalContentUrl": final_asset.contentUrl,
            "mimeType": final_asset.mimeType,
            "width": width,
            "height": height,
            "mode": "final-image-edge-color-process",
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
            "layerBadges": ["Layer: Multiply", "Layer: Add / Glow", "Final: Eye Spark"],
            "rightRailSync": True,
        },
    }
    duration_ms = max(manifest.durationMs, steps[-1]["startMs"] + steps[-1]["durationMs"])
    return manifest.model_copy(update={"durationMs": duration_ms, "process": process})


def _timeline_steps(*, width: int, height: int) -> list[dict[str, Any]]:
    del width, height
    return [
        {"role": "sketch", "label": "10% 草图", "progressPercent": 10, "startMs": 0, "durationMs": 1700},
        {"role": "lineart", "label": "25% 线稿", "progressPercent": 25, "startMs": 1700, "durationMs": 1800},
        {"role": "flat_color", "label": "45% 平涂", "progressPercent": 45, "startMs": 3500, "durationMs": 2300},
        {"role": "shadow", "label": "65% 阴影", "progressPercent": 65, "startMs": 5800, "durationMs": 1800},
        {"role": "lighting", "label": "85% 光照", "progressPercent": 85, "startMs": 7600, "durationMs": 1700},
        {"role": "details", "label": "100% 完成", "progressPercent": 100, "startMs": 9300, "durationMs": 1900},
    ]


def _process_actions(steps: list[dict[str, Any]], *, final_content_path: Path | None = None) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    image_strokes = _image_derived_stroke_actions(final_content_path, steps=steps)
    if image_strokes:
        actions.extend(image_strokes)
    else:
        actions.extend(_template_stroke_actions(_step(steps, "sketch"), prefix="sketch", color="#7b8794", width=0.006, opacity=0.54))
        actions.extend(_template_stroke_actions(_step(steps, "lineart"), prefix="lineart", color="#111827", width=0.0045, opacity=0.9))
    actions.extend(_fill_actions(_step(steps, "flat_color")))
    actions.extend(_mask_actions(_step(steps, "shadow"), role="shadow", blend_mode="multiply", badge="Layer: Multiply"))
    actions.extend(_mask_actions(_step(steps, "lighting"), role="lighting", blend_mode="screen", badge="Layer: Add / Glow"))
    actions.extend(_finish_actions(_step(steps, "details")))
    return actions


def _step(steps: list[dict[str, Any]], role: str) -> dict[str, Any]:
    for step in steps:
        if step["role"] == role:
            return step
    raise ValueError(f"missing process step: {role}")


def _image_derived_stroke_actions(final_content_path: Path | None, *, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if final_content_path is None:
        return []

    contours = _extract_normalized_contours(final_content_path)
    if not contours:
        return []

    sketch_step = _step(steps, "sketch")
    lineart_step = _step(steps, "lineart")
    sketch_contours = contours[: min(70, len(contours))]
    lineart_contours = contours[: min(130, len(contours))]
    return [
        *_contours_to_stroke_actions(
            sketch_contours,
            step=sketch_step,
            prefix="sketch-edge",
            color="#8b96a6",
            stroke_width=0.0028,
            opacity=0.48,
            tool="pencil",
        ),
        *_contours_to_stroke_actions(
            lineart_contours,
            step=lineart_step,
            prefix="lineart-edge",
            color="#101318",
            stroke_width=0.0022,
            opacity=0.92,
            tool="inking-pen",
        ),
    ]


def _extract_normalized_contours(final_content_path: Path) -> list[list[tuple[float, float]]]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        from PIL import Image
    except Exception:
        return []

    try:
        with Image.open(final_content_path) as image:
            rgb = image.convert("RGB")
            cropped = _center_crop_to_square(rgb)
            resized = cropped.resize((512, 512))
            array = np.array(resized)
    except Exception:
        return []

    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 48, 132)
    edges = cv2.dilate(edges, np.ones((2, 2), dtype=np.uint8), iterations=1)
    found = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]

    normalized: list[list[tuple[float, float]]] = []
    for contour in contours:
        arc_length = cv2.arcLength(contour, closed=False)
        if arc_length < 14:
            continue
        epsilon = max(1.2, arc_length * 0.006)
        approx = cv2.approxPolyDP(contour, epsilon, closed=False)
        points = [(float(point[0][0]) / 512.0, float(point[0][1]) / 512.0) for point in approx]
        points = _simplify_points(points, max_points=18)
        if len(points) >= 2:
            normalized.append(points)

    def contour_key(points: list[tuple[float, float]]) -> tuple[float, float, float]:
        length = _polyline_length(points)
        center_y = sum(point[1] for point in points) / len(points)
        center_x = sum(point[0] for point in points) / len(points)
        # Long expressive strokes first, then top-to-bottom spatial scan.
        tier = 0 if length > 0.17 else 1 if length > 0.07 else 2
        return (tier, center_y, center_x)

    normalized.sort(key=contour_key)
    return normalized[:160]


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


def _polyline_length(points: list[tuple[float, float]]) -> float:
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
) -> list[dict[str, Any]]:
    if not contours:
        return []

    actions: list[dict[str, Any]] = []
    duration_window = max(1, int(step["durationMs"] * 0.94))
    for index, points in enumerate(contours):
        length = _polyline_length(points)
        start_ratio = index / max(1, len(contours))
        start_ms = int(step["startMs"] + start_ratio * duration_window)
        duration_ms = int(130 + min(620, length * 1500))
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
                "source": "final-image-contour",
            }
        )
    return actions


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


def _fill_actions(step: dict[str, Any]) -> list[dict[str, Any]]:
    regions = [
        ("hair-base", 0.47, 0.32, 0.43, 0.34, "#6fb7df", 0.78),
        ("face-base", 0.48, 0.47, 0.24, 0.20, "#ffd9cf", 0.72),
        ("coat-base", 0.50, 0.75, 0.52, 0.30, "#334155", 0.66),
        ("accent-base", 0.57, 0.58, 0.18, 0.16, "#f6a3bc", 0.56),
    ]
    actions: list[dict[str, Any]] = []
    for index, (name, x, y, rx, ry, color, opacity) in enumerate(regions):
        actions.append(
            {
                "id": f"flat-fill-{name}",
                "type": "fillRegion",
                "phase": step["role"],
                "label": step["label"],
                "startMs": int(step["startMs"] + index * 410),
                "durationMs": 1050,
                "tool": "soft-brush",
                "center": {"x": x, "y": y},
                "radius": {"x": rx, "y": ry},
                "color": color,
                "opacity": opacity,
                "edgeFeather": 0.18,
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
            "durationMs": 1100,
            "tool": "detail-brush",
        },
        {
            "id": "details-eye-spark-left",
            "type": "eyeSpark",
            "phase": step["role"],
            "label": "Final: Eye Spark",
            "startMs": int(step["startMs"] + 1180),
            "durationMs": 520,
            "tool": "highlight-pen",
            "points": [{"x": 0.43, "y": 0.45}, {"x": 0.57, "y": 0.45}],
            "color": "#ffffff",
            "opacity": 0.95,
        },
    ]
