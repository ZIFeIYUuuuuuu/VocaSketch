import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackProcess, PlaybackProcessAction } from '../api/types';

interface ProcessPlaybackPlayerProps {
  process: PlaybackProcess;
  previewSrc?: string | null;
  finalSrc: string;
  elapsedMs: number;
  isLightMode: boolean;
}

interface CursorState {
  x: number;
  y: number;
  radius: number;
  tool: string;
  visible: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const easeOut = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 2);
const easeInOut = (value: number) => {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

export function ProcessPlaybackPlayer({ process, previewSrc, finalSrc, elapsedMs, isLightMode }: ProcessPlaybackPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const finalImageRef = useRef<HTMLImageElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const [imagesReady, setImagesReady] = useState(false);

  const sortedActions = useMemo(
    () => [...process.actions].sort((left, right) => left.startMs - right.startMs),
    [process.actions]
  );
  const activeAction = useMemo(
    () => sortedActions.find((action) => elapsedMs >= action.startMs && elapsedMs <= action.startMs + action.durationMs) ?? null,
    [elapsedMs, sortedActions]
  );
  const activePhase =
    process.phases.find((phase) => elapsedMs >= phase.startMs && elapsedMs <= phase.startMs + phase.durationMs) ??
    process.phases[process.phases.length - 1] ??
    null;

  useEffect(() => {
    let cancelled = false;
    setImagesReady(false);

    const loadImage = (src: string | null | undefined) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
      });

    void Promise.all([loadImage(finalSrc), loadImage(previewSrc)]).then(([finalImage, previewImage]) => {
      if (cancelled) {
        return;
      }
      finalImageRef.current = finalImage;
      previewImageRef.current = previewImage ?? finalImage;
      setImagesReady(!!finalImage);
    });

    return () => {
      cancelled = true;
    };
  }, [finalSrc, previewSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const finalImage = finalImageRef.current;
    const previewImage = previewImageRef.current ?? finalImage;
    if (!canvas || !imagesReady || !finalImage || !previewImage) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(480, Math.floor(rect.width || 720));
    const height = Math.max(360, Math.floor(rect.height || width * 0.75));
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawProcess(ctx, {
      actions: sortedActions,
      elapsedMs,
      finalImage,
      height,
      previewImage,
      isLightMode,
      width,
    });
  }, [elapsedMs, imagesReady, isLightMode, sortedActions]);

  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl border ${isLightMode ? 'bg-white border-slate-200' : 'bg-[#090a10] border-[#1f2230]'}`}>
      <canvas ref={canvasRef} className="h-full w-full" aria-label="VocaSketch process playback canvas" />
      {!imagesReady && (
        <div className={`absolute inset-0 grid place-items-center text-[11px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
          加载过程图像...
        </div>
      )}
      <div className={`pointer-events-none absolute left-3 top-3 rounded-lg border px-2.5 py-2 backdrop-blur ${isLightMode ? 'bg-white/82 border-slate-200 text-slate-700' : 'bg-slate-950/58 border-white/10 text-slate-200'}`}>
        <p className="text-[10px] font-mono uppercase">{activePhase?.label ?? 'Process'}</p>
        <p className={`mt-0.5 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
          {activeAction?.type ?? 'ready'} · {activeAction?.tool ?? process.style}
        </p>
      </div>
    </div>
  );
}

function drawProcess(
  ctx: CanvasRenderingContext2D,
  input: {
    actions: PlaybackProcessAction[];
    elapsedMs: number;
    finalImage: HTMLImageElement;
    height: number;
    previewImage: HTMLImageElement;
    isLightMode: boolean;
    width: number;
  }
) {
  const { actions, elapsedMs, finalImage, height, previewImage, isLightMode, width } = input;
  const maxDimension = Math.max(width, height);
  drawPaper(ctx, width, height, isLightMode);

  const cursor: CursorState = { x: width * 0.5, y: height * 0.5, radius: maxDimension * 0.018, tool: 'idle', visible: false };
  for (const action of actions) {
    const progress = actionProgress(action, elapsedMs);
    if (progress <= 0) {
      continue;
    }

    if (action.type === 'stroke') {
      drawStrokeAction(ctx, action, width, height, progress, cursor);
    } else if (action.type === 'fillRegion') {
      drawFillAction(ctx, action, resolveActionImage(action.sourceImage, previewImage, finalImage), width, height, progress, cursor);
    } else if (action.type === 'maskReveal') {
      drawMaskRevealAction(ctx, action, finalImage, width, height, progress, cursor);
    } else if (action.type === 'layerBadge') {
      drawLayerBadge(ctx, action, width, height, progress);
    } else if (action.type === 'finalReveal') {
      drawFinalReveal(ctx, action, finalImage, width, height, progress, cursor);
    } else if (action.type === 'eyeSpark') {
      drawEyeSpark(ctx, action, finalImage, width, height, progress, cursor);
    }
  }

  drawCursor(ctx, cursor, maxDimension, isLightMode);
}

function resolveActionImage(kind: 'preview' | 'final' | undefined, previewImage: HTMLImageElement, finalImage: HTMLImageElement) {
  return kind === 'final' ? finalImage : previewImage;
}

function actionProgress(action: PlaybackProcessAction, elapsedMs: number) {
  return clamp((elapsedMs - action.startMs) / action.durationMs, 0, 1);
}

function drawPaper(ctx: CanvasRenderingContext2D, width: number, height: number, isLightMode: boolean) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  if (isLightMode) {
    gradient.addColorStop(0, '#fffaf3');
    gradient.addColorStop(1, '#eef6ff');
  } else {
    gradient.addColorStop(0, '#0c0d12');
    gradient.addColorStop(1, '#111827');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawStrokeAction(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'stroke' }>,
  width: number,
  height: number,
  progress: number,
  cursor: CursorState
) {
  const maxDimension = Math.max(width, height);
  const points = action.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const eased = action.speedProfile === 'detail-slow' ? easeInOut(progress) : easeOut(progress);
  const visiblePoints = partialPolyline(points, eased);
  if (visiblePoints.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = action.color;
  ctx.globalAlpha = action.opacity;
  ctx.lineWidth = Math.max(1.2, action.strokeWidth * maxDimension);
  ctx.beginPath();
  ctx.moveTo(visiblePoints[0].x, visiblePoints[0].y);
  for (const point of visiblePoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();

  const lastPoint = visiblePoints[visiblePoints.length - 1];
  cursor.x = lastPoint.x;
  cursor.y = lastPoint.y;
  cursor.radius = Math.max(maxDimension * 0.013, action.strokeWidth * maxDimension * 2.2);
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function drawFillAction(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'fillRegion' }>,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  cursor: CursorState
) {
  const eased = easeOut(progress);
  const maxDimension = Math.max(width, height);
  const centerX = action.center.x * width;
  const centerY = action.center.y * height;
  const radiusX = action.radius.x * width * eased;
  const radiusY = action.radius.y * height * eased;
  const imageAlpha = action.imageAlpha ?? action.opacity;
  const tintAlpha = action.tintAlpha ?? 0.08;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, Math.max(2, radiusX), Math.max(2, radiusY), 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.filter = resolveFillFilter(action.filterStyle);
  ctx.globalAlpha = imageAlpha * (0.55 + eased * 0.45);
  drawImageCover(ctx, image, width, height);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = tintAlpha * eased;
  ctx.fillStyle = action.color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  cursor.x = centerX + radiusX * 0.34;
  cursor.y = centerY - radiusY * 0.18;
  cursor.radius = Math.max(maxDimension * 0.035, Math.min(radiusX, radiusY) * 0.18);
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function resolveFillFilter(style: string | undefined) {
  if (style === 'preview-flats') {
    return 'saturate(0.82) brightness(1.05) contrast(0.86) blur(0.2px)';
  }
  if (style === 'final-flats') {
    return 'saturate(1.08) brightness(1.02) contrast(0.9)';
  }
  return 'none';
}

function drawMaskRevealAction(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'maskReveal' }>,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  cursor: CursorState
) {
  const eased = easeInOut(progress);
  const maxDimension = Math.max(width, height);
  const radius = maxDimension * (0.18 + eased * 0.72);
  const centerX = action.phase === 'lighting' ? width * 0.55 : width * 0.47;
  const centerY = action.phase === 'lighting' ? height * 0.36 : height * 0.61;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radius * 0.95, radius * 0.72, -0.25, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = action.opacity * eased;
  ctx.globalCompositeOperation = action.blendMode === 'screen' ? 'screen' : 'multiply';
  ctx.filter =
    action.phase === 'lighting'
      ? 'brightness(1.38) contrast(1.04) saturate(1.12)'
      : 'brightness(0.64) contrast(1.16) saturate(0.94)';
  drawImageCover(ctx, image, width, height);
  ctx.restore();

  cursor.x = centerX + radius * 0.26;
  cursor.y = centerY - radius * 0.18;
  cursor.radius = maxDimension * (action.phase === 'lighting' ? 0.05 : 0.06);
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function drawLayerBadge(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'layerBadge' }>,
  width: number,
  height: number,
  progress: number
) {
  const opacity = progress < 0.72 ? easeOut(progress / 0.24) : easeOut((1 - progress) / 0.28);
  if (opacity <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = opacity * 0.82;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  roundRect(ctx, width * 0.055, height * 0.84, width * 0.33, height * 0.062, Math.max(width, height) * 0.018);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `${Math.max(11, Math.max(width, height) * 0.022)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(action.label, width * 0.077, height * 0.88);
  ctx.restore();
}

function drawFinalReveal(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'finalReveal' }>,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  cursor: CursorState
) {
  const eased = easeOut(progress);
  ctx.save();
  ctx.globalAlpha = 0.22 + eased * 0.78;
  ctx.filter = `saturate(${1 + eased * 0.1}) brightness(${0.96 + eased * 0.05})`;
  drawImageCover(ctx, image, width, height);
  ctx.restore();
  cursor.x = width * (0.45 + eased * 0.14);
  cursor.y = height * (0.55 - eased * 0.14);
  cursor.radius = Math.max(width, height) * 0.024;
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function drawEyeSpark(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'eyeSpark' }>,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  cursor: CursorState
) {
  ctx.save();
  ctx.globalAlpha = 1;
  drawImageCover(ctx, image, width, height);
  const eased = easeOut(progress);
  for (const point of action.points) {
    const x = point.x * width;
    const y = point.y * height;
    const glowRadius = Math.max(width, height) * (0.015 + 0.04 * eased);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * action.opacity})`);
    gradient.addColorStop(0.38, 'rgba(125, 211, 252, 0.55)');
    gradient.addColorStop(1, 'rgba(125, 211, 252, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1, Math.max(width, height) * 0.002);
    ctx.beginPath();
    ctx.moveTo(x - glowRadius * 0.62, y);
    ctx.lineTo(x + glowRadius * 0.62, y);
    ctx.moveTo(x, y - glowRadius * 0.62);
    ctx.lineTo(x, y + glowRadius * 0.62);
    ctx.stroke();
  }
  ctx.restore();

  const target = action.points[Math.min(action.points.length - 1, Math.floor(eased * action.points.length))];
  cursor.x = target.x * width;
  cursor.y = target.y * height;
  cursor.radius = Math.max(width, height) * 0.018;
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function drawCursor(ctx: CanvasRenderingContext2D, cursor: CursorState, size: number, isLightMode: boolean) {
  if (!cursor.visible) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = isLightMode ? 'rgba(8, 145, 178, 0.86)' : 'rgba(103, 232, 249, 0.9)';
  ctx.fillStyle = isLightMode ? 'rgba(8, 145, 178, 0.14)' : 'rgba(103, 232, 249, 0.16)';
  ctx.lineWidth = Math.max(1, size * 0.003);
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, cursor.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cursor.x - cursor.radius * 1.5, cursor.y);
  ctx.lineTo(cursor.x - cursor.radius * 0.45, cursor.y);
  ctx.moveTo(cursor.x + cursor.radius * 0.45, cursor.y);
  ctx.lineTo(cursor.x + cursor.radius * 1.5, cursor.y);
  ctx.moveTo(cursor.x, cursor.y - cursor.radius * 1.5);
  ctx.lineTo(cursor.x, cursor.y - cursor.radius * 0.45);
  ctx.moveTo(cursor.x, cursor.y + cursor.radius * 0.45);
  ctx.lineTo(cursor.x, cursor.y + cursor.radius * 1.5);
  ctx.stroke();
  ctx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.72)' : 'rgba(226, 232, 240, 0.88)';
  ctx.font = `${Math.max(9, size * 0.018)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(cursor.tool, cursor.x + cursor.radius * 1.7, cursor.y - cursor.radius * 1.2);
  ctx.restore();
}

function partialPolyline(points: Array<{ x: number; y: number }>, progress: number) {
  if (points.length <= 1) {
    return points;
  }
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(length);
    total += length;
  }

  const target = total * clamp(progress, 0, 1);
  const output = [points[0]];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = lengths[index - 1];
    if (walked + segmentLength <= target) {
      output.push(points[index]);
      walked += segmentLength;
      continue;
    }
    const ratio = segmentLength === 0 ? 0 : (target - walked) / segmentLength;
    const previous = points[index - 1];
    const current = points[index];
    output.push({
      x: previous.x + (current.x - previous.x) * ratio,
      y: previous.y + (current.y - previous.y) * ratio,
    });
    break;
  }
  return output;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
