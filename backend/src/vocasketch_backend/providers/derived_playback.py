from __future__ import annotations

from html import escape

from ..models import AssetRecord, PlaybackManifest, PlaybackManifestStep
from .base import GeneratedAssetSpec


DERIVED_PLAYBACK_ROLES = ("sketch", "lineart", "flat_color", "shadow", "lighting", "details")


def can_derive_playback_frames(final_asset: AssetRecord | None) -> bool:
    return (
        final_asset is not None
        and final_asset.contentUrl is not None
        and final_asset.mimeType in {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
        and (final_asset.width or 0) > 0
        and (final_asset.height or 0) > 0
    )


def build_derived_playback_frame_specs(
    *,
    final_asset: AssetRecord,
    provider_name: str,
    model: str | None,
) -> list[GeneratedAssetSpec]:
    width = final_asset.width or 1024
    height = final_asset.height or 1024

    specs: list[GeneratedAssetSpec] = []
    for frame in _frame_specs():
        specs.append(
            GeneratedAssetSpec(
                kind="layer",
                role=frame["role"],
                label=frame["label"],
                mime_type="image/svg+xml",
                width=width,
                height=height,
                order=frame["order"],
                opacity=1.0,
                blend_mode="normal",
                source_final_asset_id=final_asset.assetId,
                content_bytes=_build_derived_frame_svg(
                    final_content_url=final_asset.contentUrl or "",
                    width=width,
                    height=height,
                    role=frame["role"],
                    label=frame["label"],
                    progress=frame["progress"],
                    filter_id=frame["filterId"],
                    overlay=frame["overlay"],
                ),
                file_extension="svg",
                metadata={
                    "provider": provider_name,
                    "model": model,
                    "mode": "derived-final-playback-frame",
                    "order": frame["order"],
                    "progressPercent": frame["progress"],
                    "opacity": 1.0,
                    "blendMode": "normal",
                    "sourceFinalAssetId": final_asset.assetId,
                    "note": "This playback frame is derived from the same final asset, so character and composition stay stable.",
                },
            )
        )
    return specs


def build_derived_playback_manifest(*, final_asset: AssetRecord | None, layer_assets: list) -> PlaybackManifest:
    layer_refs = [layer.assetId for layer in layer_assets]
    layer_by_role = {layer.role: layer for layer in layer_assets}
    width = final_asset.width if final_asset and final_asset.width else 1024
    height = final_asset.height if final_asset and final_asset.height else 1024

    cursor_ms = 0
    steps: list[PlaybackManifestStep] = []
    for frame in _frame_specs():
        layer = layer_by_role.get(frame["role"])
        duration_ms = frame["durationMs"]
        steps.append(
            PlaybackManifestStep(
                stepId=f"step-{frame['role']}",
                order=frame["order"],
                role=frame["role"],
                label=frame["label"],
                assetId=layer.assetId if layer else None,
                contentUrl=layer.contentUrl if layer else None,
                startMs=cursor_ms,
                durationMs=duration_ms,
                opacityFrom=0.0,
                opacityTo=1.0,
                blendMode="normal",
                easing="ease-out",
                transition="replace-frame",
                step=frame["order"],
                phase=frame["role"],
                assetRole=frame["role"],
            )
        )
        cursor_ms += duration_ms

    return PlaybackManifest(
        manifestVersion="0.3.0",
        canvasSize={"width": width, "height": height},
        durationMs=cursor_ms,
        layerRefs=layer_refs,
        finalCompositeAssetId=final_asset.assetId if final_asset else None,
        steps=steps,
    )


def _frame_specs() -> list[dict[str, object]]:
    return [
        {
            "role": "sketch",
            "label": "10% 草图",
            "order": 1,
            "progress": 10,
            "durationMs": 900,
            "filterId": "sketchFilter",
            "overlay": "sketch",
        },
        {
            "role": "lineart",
            "label": "25% 线稿",
            "order": 2,
            "progress": 25,
            "durationMs": 850,
            "filterId": "lineartFilter",
            "overlay": "lineart",
        },
        {
            "role": "flat_color",
            "label": "45% 平涂",
            "order": 3,
            "progress": 45,
            "durationMs": 950,
            "filterId": "flatColorFilter",
            "overlay": "flat_color",
        },
        {
            "role": "shadow",
            "label": "65% 阴影",
            "order": 4,
            "progress": 65,
            "durationMs": 850,
            "filterId": "shadowFilter",
            "overlay": "shadow",
        },
        {
            "role": "lighting",
            "label": "85% 光照",
            "order": 5,
            "progress": 85,
            "durationMs": 820,
            "filterId": "lightingFilter",
            "overlay": "lighting",
        },
        {
            "role": "details",
            "label": "100% 完成",
            "order": 6,
            "progress": 100,
            "durationMs": 900,
            "filterId": "finalFilter",
            "overlay": "details",
        },
    ]


def _build_derived_frame_svg(
    *,
    final_content_url: str,
    width: int,
    height: int,
    role: str,
    label: str,
    progress: int,
    filter_id: str,
    overlay: str,
) -> bytes:
    safe_url = escape(final_content_url, quote=True)
    safe_label = escape(label)
    safe_role = escape(role)
    overlay_markup = _overlay_markup(overlay, width=width, height=height)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <filter id="sketchFilter">
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.45" intercept="-0.18"/>
        <feFuncG type="linear" slope="1.45" intercept="-0.18"/>
        <feFuncB type="linear" slope="1.45" intercept="-0.18"/>
      </feComponentTransfer>
    </filter>
    <filter id="lineartFilter">
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.9" intercept="-0.36"/>
        <feFuncG type="linear" slope="1.9" intercept="-0.36"/>
        <feFuncB type="linear" slope="1.9" intercept="-0.36"/>
      </feComponentTransfer>
    </filter>
    <filter id="flatColorFilter">
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.82" intercept="0.08"/>
        <feFuncG type="linear" slope="0.82" intercept="0.08"/>
        <feFuncB type="linear" slope="0.82" intercept="0.08"/>
      </feComponentTransfer>
    </filter>
    <filter id="shadowFilter">
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.72" intercept="0.02"/>
        <feFuncG type="linear" slope="0.72" intercept="0.02"/>
        <feFuncB type="linear" slope="0.72" intercept="0.02"/>
      </feComponentTransfer>
    </filter>
    <filter id="lightingFilter">
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.08" intercept="0.04"/>
        <feFuncG type="linear" slope="1.08" intercept="0.04"/>
        <feFuncB type="linear" slope="1.08" intercept="0.04"/>
      </feComponentTransfer>
    </filter>
    <filter id="finalFilter">
      <feComponentTransfer>
        <feFuncR type="linear" slope="1"/>
        <feFuncG type="linear" slope="1"/>
        <feFuncB type="linear" slope="1"/>
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="{width}" height="{height}" fill="#fffaf3"/>
  <image href="{safe_url}" x="0" y="0" width="{width}" height="{height}" preserveAspectRatio="xMidYMid slice" filter="url(#{filter_id})"/>
  {overlay_markup}
  <g opacity="0.76">
    <rect x="24" y="24" width="168" height="44" rx="12" fill="#ffffff"/>
    <text x="42" y="53" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#111827">{safe_label}</text>
    <text x="42" y="85" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#475569">{safe_role} · {progress}% · same final asset</text>
  </g>
</svg>"""
    return svg.encode("utf-8")


def _overlay_markup(overlay: str, *, width: int, height: int) -> str:
    if overlay == "sketch":
        return f"""
  <rect width="{width}" height="{height}" fill="#eff6ff" opacity="0.54"/>
  <path d="M{width * 0.18:.0f} {height * 0.76:.0f} C{width * 0.34:.0f} {height * 0.58:.0f}, {width * 0.54:.0f} {height * 0.55:.0f}, {width * 0.72:.0f} {height * 0.70:.0f}" fill="none" stroke="#64748b" stroke-width="{max(width, height) * 0.008:.1f}" stroke-linecap="round" opacity="0.34"/>
  <path d="M{width * 0.22:.0f} {height * 0.24:.0f} L{width * 0.82:.0f} {height * 0.18:.0f}" fill="none" stroke="#94a3b8" stroke-width="{max(width, height) * 0.004:.1f}" stroke-linecap="round" opacity="0.26"/>"""
    if overlay == "lineart":
        return f"""
  <rect width="{width}" height="{height}" fill="#ffffff" opacity="0.22"/>
  <rect x="{width * 0.08:.0f}" y="{height * 0.08:.0f}" width="{width * 0.84:.0f}" height="{height * 0.84:.0f}" fill="none" stroke="#0f172a" stroke-width="{max(width, height) * 0.003:.1f}" opacity="0.18"/>"""
    if overlay == "flat_color":
        return f'<rect width="{width}" height="{height}" fill="#fff7ed" opacity="0.16"/>'
    if overlay == "shadow":
        return f"""
  <linearGradient id="shadowWash" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0f172a" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="#1e293b" stop-opacity="0.30"/>
  </linearGradient>
  <rect width="{width}" height="{height}" fill="url(#shadowWash)" opacity="0.46"/>"""
    if overlay == "lighting":
        return f"""
  <radialGradient id="lightWash" cx="38%" cy="22%" r="62%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.46"/>
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <rect width="{width}" height="{height}" fill="url(#lightWash)"/>"""
    return ""
