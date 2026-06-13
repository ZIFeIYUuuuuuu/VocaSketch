from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from ..models import AssetRecord, PlaybackManifest


PROCESS_PLAYBACK_VERSION = "process-v3"


def enrich_manifest_with_process(
    manifest: PlaybackManifest,
    *,
    preview_asset: AssetRecord | None = None,
    final_asset: AssetRecord | None,
    preview_content_path: Path | None = None,
    final_content_path: Path | None = None,
) -> PlaybackManifest:
    if final_asset is None or not final_asset.contentUrl:
        return manifest
    if _is_current_process(manifest.process, preview_asset=preview_asset):
        return manifest

    width = final_asset.width or (preview_asset.width if preview_asset else None) or manifest.canvasSize.get("width") or 1024
    height = final_asset.height or (preview_asset.height if preview_asset else None) or manifest.canvasSize.get("height") or 1024
    steps = _timeline_steps(width=width, height=height)
    actions = _process_actions(
        steps,
        preview_content_path=preview_content_path,
        final_content_path=final_content_path,
    )
    stroke_count = len([action for action in actions if action["type"] == "stroke"])
    process = {
        "version": PROCESS_PLAYBACK_VERSION,
        "style": "linedrawer-color-derived",
        "renderer": "canvas-preview-guided-process",
        "source": {
            "previewAssetId": preview_asset.assetId if preview_asset else None,
            "previewContentUrl": preview_asset.contentUrl if preview_asset else None,
            "finalAssetId": final_asset.assetId,
            "finalContentUrl": final_asset.contentUrl,
            "mimeType": final_asset.mimeType,
            "width": width,
            "height": height,
            "mode": "preview-guided-final-refined-process" if preview_asset else "final-image-edge-color-process",
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


def _is_current_process(process: dict[str, Any] | None, *, preview_asset: AssetRecord | None) -> bool:
    if not process:
        return False
    expected_mode = "preview-guided-final-refined-process" if preview_asset else "final-image-edge-color-process"
    source = process.get("source") if isinstance(process.get("source"), dict) else {}
    return process.get("version") == PROCESS_PLAYBACK_VERSION and source.get("mode") == expected_mode


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


def _process_actions(
    steps: list[dict[str, Any]],
    *,
    preview_content_path: Path | None = None,
    final_content_path: Path | None = None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    image_strokes = _image_derived_stroke_actions(
        preview_content_path=preview_content_path,
        final_content_path=final_content_path,
        steps=steps,
    )
    if image_strokes:
        actions.extend(image_strokes)
    else:
        actions.extend(_template_stroke_actions(_step(steps, "sketch"), prefix="sketch", color="#7b8794", width=0.006, opacity=0.54))
        actions.extend(_template_stroke_actions(_step(steps, "lineart"), prefix="lineart", color="#111827", width=0.0045, opacity=0.9))
    actions.extend(_fill_actions(_step(steps, "flat_color"), source_image="preview" if preview_content_path else "final"))
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
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if preview_content_path is None and final_content_path is None:
        return []

    sketch_source = preview_content_path or final_content_path
    lineart_source = final_content_path or preview_content_path
    if sketch_source is None or lineart_source is None:
        return []

    sketch_contours = _extract_normalized_contours(sketch_source, variant="sketch")
    lineart_contours = _extract_normalized_contours(lineart_source, variant="lineart")
    if not sketch_contours and not lineart_contours:
        return []

    sketch_step = _step(steps, "sketch")
    lineart_step = _step(steps, "lineart")
    return [
        *_contours_to_stroke_actions(
            sketch_contours[: min(28, len(sketch_contours))],
            step=sketch_step,
            prefix="sketch-edge",
            color="#8b96a6",
            stroke_width=0.0024,
            opacity=0.34,
            tool="pencil",
            source="preview-image-contour" if preview_content_path else "final-image-contour",
        ),
        *_contours_to_stroke_actions(
            lineart_contours[: min(54, len(lineart_contours))],
            step=lineart_step,
            prefix="lineart-edge",
            color="#101318",
            stroke_width=0.0019,
            opacity=0.84,
            tool="inking-pen",
            source="final-image-contour" if final_content_path else "preview-image-contour",
        ),
    ]


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
            resized = cropped.resize((512, 512))
            array = np.array(resized)
    except Exception:
        return []

    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    blur_kernel = (5, 5) if variant == "sketch" else (3, 3)
    gray = cv2.GaussianBlur(gray, blur_kernel, 0)
    low_threshold = 76 if variant == "sketch" else 52
    high_threshold = 180 if variant == "sketch" else 148
    edges = cv2.Canny(gray, low_threshold, high_threshold)
    edges = cv2.dilate(edges, np.ones((2, 2), dtype=np.uint8), iterations=1)
    if variant == "sketch":
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8), iterations=1)
    edges = cv2.bitwise_and(edges, _subject_focus_mask(np, variant=variant))
    found = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]

    normalized: list[list[tuple[float, float]]] = []
    for contour in contours:
        arc_length = cv2.arcLength(contour, closed=False)
        min_arc_length = 28 if variant == "sketch" else 20
        if arc_length < min_arc_length:
            continue
        epsilon = max(1.5 if variant == "sketch" else 1.2, arc_length * (0.012 if variant == "sketch" else 0.006))
        approx = cv2.approxPolyDP(contour, epsilon, closed=False)
        points = [(float(point[0][0]) / 512.0, float(point[0][1]) / 512.0) for point in approx]
        points = _simplify_points(points, max_points=10 if variant == "sketch" else 18)
        if len(points) >= 2 and _is_subject_contour(points, variant=variant):
            normalized.append(points)

    def contour_key(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        length = _polyline_length(points)
        center_y = sum(point[1] for point in points) / len(points)
        center_x = sum(point[0] for point in points) / len(points)
        focus = abs(center_x - 0.54) + abs(center_y - 0.54)
        # Prefer long, subject-centric strokes before smaller details.
        tier = 0 if length > 0.14 else 1 if length > 0.075 else 2
        return (tier, focus, center_y, center_x)

    normalized.sort(key=contour_key)
    return normalized[: 34 if variant == "sketch" else 72]


def _subject_focus_mask(np: Any, *, variant: str = "lineart") -> Any:
    mask = np.zeros((512, 512), dtype=np.uint8)
    ellipses = (
        [
            (0.52, 0.28, 0.17, 0.16),
            (0.53, 0.56, 0.23, 0.34),
            (0.58, 0.48, 0.10, 0.09),
        ]
        if variant == "sketch"
        else [
            (0.53, 0.28, 0.20, 0.18),
            (0.54, 0.56, 0.28, 0.38),
            (0.59, 0.48, 0.12, 0.10),
        ]
    )
    yy, xx = np.ogrid[:512, :512]
    for center_x, center_y, radius_x, radius_y in ellipses:
        normalized = (((xx / 512.0) - center_x) / radius_x) ** 2 + (((yy / 512.0) - center_y) / radius_y) ** 2
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
    if width > 0.72 or height > 0.72:
        return False
    if length < (0.048 if variant == "sketch" else 0.03):
        return False
    if center_x < 0.18 or center_x > 0.9 or center_y < 0.08 or center_y > 0.96:
        return False
    if variant == "sketch" and (center_x < 0.28 or center_x > 0.82 or center_y < 0.14 or center_y > 0.88):
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
    source: str = "final-image-contour",
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
                "source": source,
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
