from __future__ import annotations

from typing import Any

from ..models import AssetRecord, PlaybackManifest


PROCESS_PLAYBACK_VERSION = "process-v1"


def enrich_manifest_with_process(manifest: PlaybackManifest, *, final_asset: AssetRecord | None) -> PlaybackManifest:
    if final_asset is None or not final_asset.contentUrl:
        return manifest
    if manifest.process and manifest.process.get("version") == PROCESS_PLAYBACK_VERSION:
        return manifest

    width = final_asset.width or manifest.canvasSize.get("width") or 1024
    height = final_asset.height or manifest.canvasSize.get("height") or 1024
    steps = _timeline_steps(width=width, height=height)
    process = {
        "version": PROCESS_PLAYBACK_VERSION,
        "style": "digital-immersive",
        "renderer": "canvas-final-image-derived",
        "source": {
            "finalAssetId": final_asset.assetId,
            "finalContentUrl": final_asset.contentUrl,
            "mimeType": final_asset.mimeType,
            "width": width,
            "height": height,
            "mode": "deterministic-derived-process",
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
        "actions": _process_actions(steps),
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


def _process_actions(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    actions.extend(_stroke_actions(_step(steps, "sketch"), prefix="sketch", color="#7b8794", width=0.006, opacity=0.54))
    actions.extend(_stroke_actions(_step(steps, "lineart"), prefix="lineart", color="#111827", width=0.0045, opacity=0.9))
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


def _stroke_actions(step: dict[str, Any], *, prefix: str, color: str, width: float, opacity: float) -> list[dict[str, Any]]:
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
