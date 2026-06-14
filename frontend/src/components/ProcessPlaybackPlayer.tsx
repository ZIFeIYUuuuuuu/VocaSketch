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

interface DrawFrame {
  x: number;
  y: number;
  width: number;
  height: number;
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
      const useFinalAsProcessSource = process.source?.mode === 'final-image-stable-process';
      finalImageRef.current = finalImage;
      previewImageRef.current = useFinalAsProcessSource ? finalImage : previewImage ?? finalImage;
      setImagesReady(!!finalImage);
    });

    return () => {
      cancelled = true;
    };
  }, [finalSrc, previewSrc, process.source?.mode]);

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
  const finalFrame = imageContainFrame(finalImage, width, height);
  const previewFrame = imageContainFrame(previewImage, width, height);
  const finalCropFrame = centerCropFrame(finalImage, finalFrame);
  const previewCropFrame = centerCropFrame(previewImage, previewFrame);
  drawProcessUnderlay(ctx, finalImage, finalFrame, elapsedMs, actions);
  drawPaintedColorFoundation(ctx, finalImage, finalFrame, elapsedMs, actions);

  const cursor: CursorState = { x: width * 0.5, y: height * 0.5, radius: maxDimension * 0.018, tool: 'idle', visible: false };
  const colorActions = actions.filter((action) => action.type === 'fillRegion' || action.type === 'maskReveal');
  const strokeActions = actions.filter((action) => action.type === 'stroke');
  const overlayActions = actions.filter((action) => action.type === 'layerBadge' || action.type === 'finalReveal' || action.type === 'eyeSpark');

  for (const action of colorActions) {
    const progress = actionProgress(action, elapsedMs);
    if (progress <= 0) {
      continue;
    }

    if (action.type === 'fillRegion') {
      const image = resolveActionImage(action.sourceImage, previewImage, finalImage);
      const frame = action.sourceImage === 'final' ? finalFrame : previewFrame;
      drawFillAction(ctx, action, image, frame, progress, cursor);
    } else if (action.type === 'maskReveal') {
      drawMaskRevealAction(ctx, action, finalImage, finalFrame, progress, cursor);
    }
  }

  for (const action of strokeActions) {
    const progress = actionProgress(action, elapsedMs);
    if (progress <= 0) {
      continue;
    }
    const frame = action.source?.startsWith('preview') ? previewCropFrame : finalCropFrame;
    drawStrokeAction(ctx, action, frame, progress, cursor);
  }

  for (const action of overlayActions) {
    const progress = actionProgress(action, elapsedMs);
    if (progress <= 0) {
      continue;
    }
    if (action.type === 'layerBadge') {
      drawLayerBadge(ctx, action, width, height, progress);
    } else if (action.type === 'finalReveal') {
      drawFinalReveal(ctx, action, finalImage, finalFrame, progress, cursor);
    } else if (action.type === 'eyeSpark') {
      // Older manifests may still contain an eyeSpark action. The current product
      // direction keeps the finish clean, so use it only to move the cursor.
      updateCursorFromPoints(action.points, finalCropFrame, progress, action.tool, cursor);
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
  if (isLightMode) {
    ctx.fillStyle = '#ffffff';
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0c0d12');
    gradient.addColorStop(1, '#111827');
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
}

function imageContainFrame(image: HTMLImageElement, width: number, height: number): DrawFrame {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function centerCropFrame(image: HTMLImageElement, frame: DrawFrame): DrawFrame {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = frame.width / sourceWidth;
  const side = Math.min(sourceWidth, sourceHeight) * scale;
  return {
    x: frame.x + (frame.width - side) / 2,
    y: frame.y + (frame.height - side) / 2,
    width: side,
    height: side,
  };
}

function drawImageInFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, frame: DrawFrame) {
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);
}

function drawProcessUnderlay(
  ctx: CanvasRenderingContext2D,
  finalImage: HTMLImageElement,
  finalFrame: DrawFrame,
  elapsedMs: number,
  actions: PlaybackProcessAction[]
) {
  const finalReveal = actions.find((action) => action.type === 'finalReveal');
  if (!finalReveal || elapsedMs < finalReveal.startMs) {
    return;
  }

  ctx.save();
  const progress = clamp((elapsedMs - finalReveal.startMs) / finalReveal.durationMs, 0, 1);
  ctx.globalAlpha = 0.16 + easeOut(progress) * 0.24;
  ctx.filter = 'saturate(0.9) brightness(1.02)';
  drawImageInFrame(ctx, finalImage, finalFrame);
  ctx.restore();
}

function drawPaintedColorFoundation(
  ctx: CanvasRenderingContext2D,
  finalImage: HTMLImageElement,
  finalFrame: DrawFrame,
  elapsedMs: number,
  actions: PlaybackProcessAction[]
) {
  const fillActions = actions
    .filter((action): action is Extract<PlaybackProcessAction, { type: 'fillRegion' }> => action.type === 'fillRegion')
    .sort((left, right) => left.startMs - right.startMs);
  const firstFill = fillActions[0];
  if (!firstFill || elapsedMs < firstFill.startMs) {
    return;
  }

  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(finalFrame.width));
  layer.height = Math.max(1, Math.ceil(finalFrame.height));
  const layerCtx = layer.getContext('2d');
  const mask = document.createElement('canvas');
  mask.width = layer.width;
  mask.height = layer.height;
  const maskCtx = mask.getContext('2d');
  if (!layerCtx || !maskCtx) {
    return;
  }

  layerCtx.save();
  layerCtx.filter = 'saturate(1.05) contrast(0.76) brightness(1.05) blur(0.35px)';
  layerCtx.globalAlpha = 0.92;
  layerCtx.drawImage(finalImage, 0, 0, layer.width, layer.height);
  layerCtx.restore();

  for (const action of fillActions) {
    const progress = actionProgress(action, elapsedMs);
    if (progress <= 0) {
      continue;
    }
    paintSoftMaskBlob(maskCtx, {
      centerX: action.center.x * layer.width,
      centerY: action.center.y * layer.height,
      radiusX: action.radius.x * layer.width,
      radiusY: action.radius.y * layer.height,
      progress,
      rotation: -0.16,
      opacity: 0.82,
    });
  }

  const flatProgress = easeOut(clamp((elapsedMs - firstFill.startMs) / 3900, 0, 1));
  if (flatProgress > 0.28) {
    const washProgress = clamp((flatProgress - 0.28) / 0.72, 0, 1);
    paintSoftMaskBlob(maskCtx, {
      centerX: layer.width * 0.50,
      centerY: layer.height * 0.46,
      radiusX: layer.width * 0.27,
      radiusY: layer.height * 0.31,
      progress: washProgress,
      rotation: -0.08,
      opacity: 0.34,
    });
    paintSoftMaskBlob(maskCtx, {
      centerX: layer.width * 0.54,
      centerY: layer.height * 0.70,
      radiusX: layer.width * 0.25,
      radiusY: layer.height * 0.22,
      progress: washProgress * 0.9,
      rotation: 0.18,
      opacity: 0.26,
    });
  }

  layerCtx.save();
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.drawImage(mask, 0, 0);
  layerCtx.restore();

  ctx.save();
  ctx.globalAlpha = 0.84;
  ctx.drawImage(layer, finalFrame.x, finalFrame.y, finalFrame.width, finalFrame.height);
  ctx.restore();
}

function paintSoftMaskBlob(
  ctx: CanvasRenderingContext2D,
  input: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    progress: number;
    rotation: number;
    opacity: number;
  }
) {
  const { centerX, centerY, radiusX, radiusY, progress, rotation, opacity } = input;
  const eased = easeInOut(progress);
  const maxRadius = Math.max(radiusX, radiusY) * (0.16 + eased * 1.06);
  const alpha = Math.round(255 * opacity * eased);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.scale(Math.max(0.02, radiusX / Math.max(radiusX, radiusY)), Math.max(0.02, radiusY / Math.max(radiusX, radiusY)));
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(2, maxRadius));
  gradient.addColorStop(0, `rgba(0, 0, 0, ${alpha / 255})`);
  gradient.addColorStop(0.58, `rgba(0, 0, 0, ${(alpha / 255) * 0.62})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, maxRadius), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStrokeAction(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'stroke' }>,
  frame: DrawFrame,
  progress: number,
  cursor: CursorState
) {
  const maxDimension = Math.max(frame.width, frame.height);
  const points = action.points.map((point) => ({
    x: frame.x + point.x * frame.width,
    y: frame.y + point.y * frame.height,
  }));
  const eased = action.speedProfile === 'detail-slow' ? easeInOut(progress) : easeOut(progress);
  const visiblePoints = partialPolyline(points, eased);
  if (visiblePoints.length < 2) {
    return;
  }

  const derivedContour = action.source?.includes('image-contour') || action.source?.includes('lineart-vector') || false;
  const isLineartContour = derivedContour && action.id.startsWith('lineart');
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = derivedContour ? (isLineartContour ? 'rgba(15, 23, 42, 0.96)' : 'rgba(71, 85, 105, 0.46)') : action.color;
  ctx.globalAlpha = derivedContour ? Math.min(action.opacity, isLineartContour ? 0.92 : 0.18) : action.opacity;
  ctx.lineWidth = derivedContour ? Math.max(isLineartContour ? 1.15 : 0.75, action.strokeWidth * maxDimension * (isLineartContour ? 1.12 : 0.78)) : Math.max(1.2, action.strokeWidth * maxDimension);
  if (derivedContour) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.shadowBlur = 1.2;
  }
  ctx.beginPath();
  ctx.moveTo(visiblePoints[0].x, visiblePoints[0].y);
  for (const point of visiblePoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();

  const lastPoint = visiblePoints[visiblePoints.length - 1];
  if (progress < 1) {
    cursor.x = lastPoint.x;
    cursor.y = lastPoint.y;
    cursor.radius = Math.max(maxDimension * 0.013, action.strokeWidth * maxDimension * 2.2);
    cursor.tool = action.tool;
    cursor.visible = true;
  }
}

function drawFillAction(
  ctx: CanvasRenderingContext2D,
  action: Extract<PlaybackProcessAction, { type: 'fillRegion' }>,
  image: HTMLImageElement,
  frame: DrawFrame,
  progress: number,
  cursor: CursorState
) {
  const eased = easeOut(progress);
  const maxDimension = Math.max(frame.width, frame.height);
  const centerX = frame.x + action.center.x * frame.width;
  const centerY = frame.y + action.center.y * frame.height;
  const radiusX = action.radius.x * frame.width * eased;
  const radiusY = action.radius.y * frame.height * eased;
  const imageAlpha = action.imageAlpha ?? action.opacity;
  const tintAlpha = action.tintAlpha ?? 0.08;

  drawImageWithSoftEllipse(ctx, {
    color: action.color,
    frame,
    image,
    imageAlpha: imageAlpha * (0.44 + eased * 0.44),
    radiusX: Math.max(2, radiusX),
    radiusY: Math.max(2, radiusY),
    rotation: -0.08,
    centerX,
    centerY,
    tintAlpha: tintAlpha * eased,
    filter: resolveFillFilter(action.filterStyle),
  });

  if (progress < 1) {
    cursor.x = centerX + radiusX * 0.34;
    cursor.y = centerY - radiusY * 0.18;
    cursor.radius = Math.max(maxDimension * 0.035, Math.min(radiusX, radiusY) * 0.18);
    cursor.tool = action.tool;
    cursor.visible = true;
  }
}

function drawImageWithSoftEllipse(
  ctx: CanvasRenderingContext2D,
  input: {
    color: string;
    centerX: number;
    centerY: number;
    filter: string;
    frame: DrawFrame;
    image: HTMLImageElement;
    imageAlpha: number;
    radiusX: number;
    radiusY: number;
    rotation: number;
    tintAlpha: number;
  }
) {
  const { color, centerX, centerY, filter, frame, image, imageAlpha, radiusX, radiusY, rotation, tintAlpha } = input;
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(frame.width));
  layer.height = Math.max(1, Math.ceil(frame.height));
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) {
    return;
  }

  layerCtx.save();
  layerCtx.filter = filter;
  layerCtx.globalAlpha = imageAlpha;
  layerCtx.drawImage(image, 0, 0, layer.width, layer.height);
  layerCtx.restore();

  layerCtx.save();
  layerCtx.globalCompositeOperation = 'source-atop';
  layerCtx.globalAlpha = tintAlpha;
  layerCtx.fillStyle = color;
  layerCtx.fillRect(0, 0, layer.width, layer.height);
  layerCtx.restore();

  const localCenterX = centerX - frame.x;
  const localCenterY = centerY - frame.y;
  const gradient = layerCtx.createRadialGradient(localCenterX, localCenterY, 0, localCenterX, localCenterY, Math.max(radiusX, radiusY));
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
  gradient.addColorStop(0.64, 'rgba(0, 0, 0, 0.66)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  layerCtx.save();
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.translate(localCenterX, localCenterY);
  layerCtx.rotate(rotation);
  layerCtx.scale(Math.max(0.01, radiusX / Math.max(radiusX, radiusY)), Math.max(0.01, radiusY / Math.max(radiusX, radiusY)));
  layerCtx.fillStyle = gradient;
  layerCtx.fillRect(-Math.max(radiusX, radiusY), -Math.max(radiusX, radiusY), Math.max(radiusX, radiusY) * 2, Math.max(radiusX, radiusY) * 2);
  layerCtx.restore();

  ctx.drawImage(layer, frame.x, frame.y, frame.width, frame.height);
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
  frame: DrawFrame,
  progress: number,
  cursor: CursorState
) {
  const eased = easeInOut(progress);
  const maxDimension = Math.max(frame.width, frame.height);
  const radius = maxDimension * (0.12 + eased * 0.58);
  const centerX = frame.x + frame.width * (action.phase === 'lighting' ? 0.56 : 0.48);
  const centerY = frame.y + frame.height * (action.phase === 'lighting' ? 0.38 : 0.62);

  drawImageWithSoftEllipse(ctx, {
    color: action.phase === 'lighting' ? 'rgba(255, 244, 200, 0.7)' : 'rgba(38, 26, 55, 0.72)',
    frame,
    image,
    imageAlpha: action.opacity * (action.phase === 'lighting' ? 0.3 : 0.36) * (0.55 + eased * 0.45),
    radiusX: radius * (action.phase === 'lighting' ? 1.05 : 0.88),
    radiusY: radius * (action.phase === 'lighting' ? 0.68 : 0.78),
    rotation: action.phase === 'lighting' ? -0.22 : 0.16,
    centerX,
    centerY,
    tintAlpha: action.phase === 'lighting' ? 0.05 * eased : 0.08 * eased,
    filter:
      action.phase === 'lighting'
        ? 'brightness(1.12) contrast(1.02) saturate(1.08)'
        : 'brightness(0.72) contrast(1.08) saturate(0.96)',
  });

  if (progress < 1) {
    cursor.x = centerX + radius * 0.26;
    cursor.y = centerY - radius * 0.18;
    cursor.radius = maxDimension * (action.phase === 'lighting' ? 0.05 : 0.06);
    cursor.tool = action.tool;
    cursor.visible = true;
  }
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
  frame: DrawFrame,
  progress: number,
  cursor: CursorState
) {
  const eased = easeOut(progress);
  ctx.save();
  ctx.globalAlpha = 0.06 + eased * 0.94;
  ctx.filter = `saturate(${1 + eased * 0.1}) brightness(${0.96 + eased * 0.05})`;
  drawImageInFrame(ctx, image, frame);
  ctx.restore();
  cursor.x = frame.x + frame.width * (0.45 + eased * 0.14);
  cursor.y = frame.y + frame.height * (0.55 - eased * 0.14);
  cursor.radius = Math.max(frame.width, frame.height) * 0.024;
  cursor.tool = action.tool;
  cursor.visible = progress < 1;
}

function updateCursorFromPoints(
  points: Array<{ x: number; y: number }>,
  frame: DrawFrame,
  progress: number,
  tool: string,
  cursor: CursorState
) {
  const eased = easeOut(progress);
  const target = points[Math.min(points.length - 1, Math.floor(eased * points.length))];
  if (!target) {
    return;
  }
  cursor.x = frame.x + target.x * frame.width;
  cursor.y = frame.y + target.y * frame.height;
  cursor.radius = Math.max(frame.width, frame.height) * 0.018;
  cursor.tool = tool;
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
