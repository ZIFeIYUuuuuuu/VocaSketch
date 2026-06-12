/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { CharacterConfig, PaintLayer } from '../types';

type RedrawTarget = 'hair' | 'eyes' | 'expression' | 'outfit' | 'accessory' | 'background';

interface CanvasRendererProps {
  progress: number;
  config: CharacterConfig;
  layers: PaintLayer[];
  isPaused: boolean;
  onResize?: (width: number, height: number) => void;
  userSpeechSub?: string;
  aiSpeechSub?: string;
  systemState?: string;
  isListening?: boolean;
  isAwaitingConfirm?: boolean;
  onConfirmAction?: () => void;
  onCancelAction?: () => void;
  isLightMode?: boolean;
  lastRedrawTarget?: RedrawTarget | null;
}

type PathPoint = {
  x: number;
  y: number;
  cx1?: number;
  cy1?: number;
  cx2?: number;
  cy2?: number;
};

const LAYER_ALIASES: Record<string, string[]> = {
  'layer-bg': ['layer-bg', '背景层', 'background', 'bg'],
  'layer-sketch': ['layer-sketch', '草图层', 'sketch'],
  'layer-lineart': ['layer-lineart', '线稿层', 'lineart', 'ink'],
  'layer-flats': ['layer-flats', '基础色层', 'flats', 'base-color'],
  'layer-watercolor': ['layer-watercolor', '水彩层', 'watercolor'],
  'layer-details': ['layer-details', '细节层', 'details']
};

const STAGE_BOUNDARIES = {
  sketchDone: 25,
  lineDone: 50,
  flatsDone: 70,
  watercolorDone: 90
} as const;

const REDRAW_LABELS: Record<RedrawTarget, string> = {
  hair: '头发',
  eyes: '眼睛',
  expression: '表情',
  outfit: '服装',
  accessory: '配饰',
  background: '背景'
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = (value: number) => 1 - Math.pow(1 - clamp(value), 3);

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const numberValue = Number.parseInt(value, 16);
  const r = (numberValue >> 16) & 255;
  const g = (numberValue >> 8) & 255;
  const b = numberValue & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getHairColorHex = (colorName: string) => {
  switch (colorName.toLowerCase()) {
    case 'pink':
      return { primary: '#ff8fab', shadow: '#8b4f64', highlight: '#ffe5ec' };
    case 'purple':
      return { primary: '#9d4edd', shadow: '#401f5c', highlight: '#e0aaff' };
    case 'gold':
    case 'yellow':
      return { primary: '#fcc21b', shadow: '#90650d', highlight: '#fff2b2' };
    case 'black':
      return { primary: '#2b2d42', shadow: '#14151f', highlight: '#8d99ae' };
    case 'white':
      return { primary: '#f8fafc', shadow: '#94a3b8', highlight: '#ffffff' };
    case 'brown':
      return { primary: '#9c6644', shadow: '#5f3f2d', highlight: '#e6ccb2' };
    case 'blue':
    default:
      return { primary: '#4ea8de', shadow: '#31446b', highlight: '#ade8f4' };
  }
};

const getEyeColorHex = (colorName: string) => {
  switch (colorName.toLowerCase()) {
    case 'purple':
      return { iris: '#9d4edd', pupil: '#3c096c', glow: '#e0aaff' };
    case 'pink':
      return { iris: '#ff4d6d', pupil: '#590d22', glow: '#ffccd5' };
    case 'green':
      return { iris: '#38b000', pupil: '#0f4c10', glow: '#ccff33' };
    case 'gold':
      return { iris: '#fb8500', pupil: '#5a2200', glow: '#ffb703' };
    case 'red':
      return { iris: '#ef233c', pupil: '#590d22', glow: '#ffccd5' };
    case 'brown':
      return { iris: '#8b5e34', pupil: '#3c2415', glow: '#ffd6a5' };
    case 'blue':
    default:
      return { iris: '#0077b6', pupil: '#03045e', glow: '#90e0ef' };
  }
};

export const CanvasRenderer: React.FC<CanvasRendererProps> = ({
  progress,
  config,
  layers,
  isPaused,
  onResize,
  userSpeechSub = '',
  aiSpeechSub = '',
  systemState = '等待指令',
  isListening = false,
  isAwaitingConfirm = false,
  onConfirmAction,
  onCancelAction,
  isLightMode = false,
  lastRedrawTarget = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const paperTextureRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });
  const [redrawClock, setRedrawClock] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      const size = Math.min(width, height, 800) || 500;
      setDimensions({ width: size, height: size });
      onResize?.(size, size);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [onResize]);

  useEffect(() => {
    if (!lastRedrawTarget) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setRedrawClock((performance.now() - startedAt) / 2000);
    }, 50);
    return () => window.clearInterval(timer);
  }, [lastRedrawTarget]);

  const getPaperTexture = (width: number, height: number, lightMode: boolean) => {
    const key = `${Math.round(width)}x${Math.round(height)}-${lightMode ? 'light' : 'dark'}`;
    if (paperTextureRef.current?.key === key) {
      return paperTextureRef.current.canvas;
    }

    const texture = document.createElement('canvas');
    texture.width = Math.max(1, Math.round(width));
    texture.height = Math.max(1, Math.round(height));
    const textureCtx = texture.getContext('2d');
    if (!textureCtx) {
      return texture;
    }

    const random = createSeededRandom(lightMode ? 4217 : 9321);
    textureCtx.fillStyle = lightMode ? '#fffdf8' : '#111216';
    textureCtx.fillRect(0, 0, width, height);

    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const noise = random();
        if (noise > 0.72) {
          textureCtx.fillStyle = lightMode ? 'rgba(30, 41, 59, 0.035)' : 'rgba(255, 255, 255, 0.045)';
          textureCtx.fillRect(x, y, 1, 1);
        } else if (noise < 0.08) {
          textureCtx.fillStyle = lightMode ? 'rgba(255, 255, 255, 0.75)' : 'rgba(0, 0, 0, 0.12)';
          textureCtx.fillRect(x, y, 1, 1);
        }
      }
    }

    textureCtx.globalAlpha = lightMode ? 0.05 : 0.08;
    textureCtx.strokeStyle = lightMode ? '#334155' : '#e2e8f0';
    for (let y = 0; y < height; y += 18) {
      textureCtx.beginPath();
      textureCtx.moveTo(0, y + random() * 2);
      textureCtx.lineTo(width, y + random() * 2);
      textureCtx.stroke();
    }

    paperTextureRef.current = { key, canvas: texture };
    return texture;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = dimensions.width;
    const h = dimensions.height;
    const cx = w / 2;
    const cy = h / 2 - 18;
    const scaleFactor = w / 500;
    const hairColors = getHairColorHex(config.hairColor);
    const eyeColors = getEyeColorHex(config.eyeColor);
    const sketchT = clamp(progress / STAGE_BOUNDARIES.sketchDone);
    const lineT = clamp((progress - STAGE_BOUNDARIES.sketchDone) / (STAGE_BOUNDARIES.lineDone - STAGE_BOUNDARIES.sketchDone));
    const flatT = clamp((progress - STAGE_BOUNDARIES.lineDone) / (STAGE_BOUNDARIES.flatsDone - STAGE_BOUNDARIES.lineDone));
    const watercolorT = clamp((progress - STAGE_BOUNDARIES.flatsDone) / (STAGE_BOUNDARIES.watercolorDone - STAGE_BOUNDARIES.flatsDone));
    const detailT = clamp((progress - STAGE_BOUNDARIES.watercolorDone) / (100 - STAGE_BOUNDARIES.watercolorDone));
    const redrawPulse = lastRedrawTarget ? Math.max(0, 1 - clamp(redrawClock)) : 0;

    ctx.clearRect(0, 0, w, h);

    const toCanvas = (point: PathPoint) => ({
      x: cx + point.x * scaleFactor,
      y: cy + point.y * scaleFactor
    });

    const getLayer = (idOrName: string): PaintLayer | undefined => {
      const aliases = LAYER_ALIASES[idOrName] ?? [idOrName];
      return layers.find((layer) =>
        aliases.some((alias) => layer.id === alias || layer.name === alias)
      );
    };

    const isLayerVisible = (layerIdOrName: string) => getLayer(layerIdOrName)?.visible ?? true;
    const getLayerOpacity = (layerIdOrName: string) => clamp(getLayer(layerIdOrName)?.opacity ?? 1);
    const withLayer = (layerIdOrName: string, drawFn: (opacity: number) => void) => {
      if (!isLayerVisible(layerIdOrName)) return;
      const opacity = getLayerOpacity(layerIdOrName);
      if (opacity <= 0) return;
      ctx.save();
      ctx.globalAlpha *= opacity;
      drawFn(opacity);
      ctx.restore();
    };

    const buildPath = (points: PathPoint[]) => {
      if (points.length < 2) return;
      const first = toCanvas(points[0]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        const end = toCanvas(point);
        if (
          point.cx1 !== undefined &&
          point.cy1 !== undefined &&
          point.cx2 !== undefined &&
          point.cy2 !== undefined
        ) {
          ctx.bezierCurveTo(
            cx + point.cx1 * scaleFactor,
            cy + point.cy1 * scaleFactor,
            cx + point.cx2 * scaleFactor,
            cy + point.cy2 * scaleFactor,
            end.x,
            end.y
          );
        } else if (point.cx1 !== undefined && point.cy1 !== undefined) {
          ctx.quadraticCurveTo(cx + point.cx1 * scaleFactor, cy + point.cy1 * scaleFactor, end.x, end.y);
        } else {
          ctx.lineTo(end.x, end.y);
        }
      }
    };

    const drawStroke = (
      points: PathPoint[],
      color: string,
      lineWidth: number,
      dash: number[] = [],
      alpha = 1
    ) => {
      if (points.length < 2 || alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha *= alpha;
      buildPath(points);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash.map((value) => value * scaleFactor));
      ctx.stroke();
      ctx.restore();
    };

    const drawStrokeGroup = (items: Array<() => void>, t: number) => {
      const visible = clamp(t) * items.length;
      items.forEach((drawItem, index) => {
        const alpha = clamp(visible - index);
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha *= alpha;
        drawItem();
        ctx.restore();
      });
    };

    const drawFill = (points: PathPoint[], fillColor: string | CanvasGradient, alpha = 1) => {
      if (points.length < 2 || alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha *= alpha;
      buildPath(points);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();
    };

    const drawEllipse = (
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      color: string | CanvasGradient,
      alpha = 1,
      rotation = 0
    ) => {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx + x * scaleFactor, cy + y * scaleFactor, radiusX * scaleFactor, radiusY * scaleFactor, rotation, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const facePoints: PathPoint[] = [
      { x: -60, y: -30 },
      { x: -62, y: 10, cx1: -60, cy1: -10, cx2: -65, cy2: 0 },
      { x: 0, y: 55, cx1: -58, cy1: 25, cx2: -35, cy2: 50 },
      { x: 62, y: 10, cx1: 35, cy1: 50, cx2: 58, cy2: 25 },
      { x: 60, y: -30, cx1: 65, cy1: 0, cx2: 60, cy2: -10 }
    ];
    const earL: PathPoint[] = [
      { x: -61, y: -10 },
      { x: -72, y: -18, cx1: -68, cy1: -12, cx2: -72, cy2: -15 },
      { x: -63, y: 1, cx1: -72, cy1: -2, cx2: -68, cy2: 0 }
    ];
    const earR: PathPoint[] = [
      { x: 61, y: -10 },
      { x: 72, y: -18, cx1: 68, cy1: -12, cx2: 72, cy2: -15 },
      { x: 63, y: 1, cx1: 72, cy1: -2, cx2: 68, cy2: 0 }
    ];
    const neckPoints: PathPoint[] = [
      { x: -25, y: 25 },
      { x: -28, y: 70 },
      { x: 28, y: 70 },
      { x: 25, y: 25 }
    ];
    const collarLeft: PathPoint[] = [
      { x: -24, y: 70 },
      { x: -55, y: 110, cx1: -32, cy1: 85, cx2: -45, cy2: 100 },
      { x: -10, y: 115, cx1: -38, cy1: 115, cx2: -25, cy2: 115 },
      { x: -6, y: 92, cx1: -8, cy1: 102, cx2: -7, cy2: 95 }
    ];
    const collarRight: PathPoint[] = [
      { x: 24, y: 70 },
      { x: 55, y: 110, cx1: 32, cy1: 85, cx2: 45, cy2: 100 },
      { x: 10, y: 115, cx1: 38, cy1: 115, cx2: 25, cy2: 115 },
      { x: 6, y: 92, cx1: 8, cy1: 102, cx2: 7, cy2: 95 }
    ];
    const outfitBody: PathPoint[] = [
      { x: -88, y: 120 },
      { x: -104, y: 165, cx1: -94, cy1: 135, cx2: -100, cy2: 150 },
      { x: 104, y: 165 },
      { x: 88, y: 120, cx1: 100, cy1: 150, cx2: 94, cy2: 135 }
    ];
    const hairBackLong: PathPoint[] = [
      { x: -60, y: -30 },
      { x: -110, y: 40, cx1: -95, cy1: -10, cx2: -110, cy2: 15 },
      { x: -120, y: 160, cx1: -110, cy1: 80, cx2: -125, cy2: 120 },
      { x: -90, y: 175, cx1: -115, cy1: 175, cx2: -100, cy2: 175 },
      { x: -40, y: 70, cx1: -80, cy1: 140, cx2: -60, cy2: 95 },
      { x: 40, y: 70 },
      { x: 90, y: 175, cx1: 60, cy1: 95, cx2: 80, cy2: 140 },
      { x: 120, y: 160, cx1: 100, cy1: 175, cx2: 115, cy2: 175 },
      { x: 110, y: 40, cx1: 125, cy1: 120, cx2: 110, cy2: 80 },
      { x: 60, y: -30, cx1: 110, cy1: 15, cx2: 95, cy2: -10 }
    ];
    const hairBackShort: PathPoint[] = [
      { x: -60, y: -30 },
      { x: -85, y: 15, cx1: -80, cy1: -15, cx2: -85, cy2: 0 },
      { x: -65, y: 42, cx1: -85, cy1: 25, cx2: -75, cy2: 35 },
      { x: -35, y: 25 },
      { x: 35, y: 25 },
      { x: 65, y: 42 },
      { x: 85, y: 15, cx1: 75, cy1: 35, cx2: 85, cy2: 25 },
      { x: 60, y: -30, cx1: 85, cy1: 0, cx2: 80, cy2: -15 }
    ];
    const bangs: PathPoint[] = [
      { x: -65, y: -45 },
      { x: -45, y: -2, cx1: -65, cy1: -25, cx2: -52, cy2: -12 },
      { x: -38, y: -18, cx1: -42, cy1: -10, cx2: -40, cy2: -15 },
      { x: -15, y: 5, cx1: -30, cy1: -10, cx2: -20, cy2: -2 },
      { x: -6, y: -22, cx1: -10, cy1: -5, cx2: -8, cy2: -15 },
      { x: 8, y: 8, cx1: -2, cy1: -12, cx2: 4, cy2: -2 },
      { x: 14, y: -22, cx1: 10, cy1: -5, cx2: 12, cy2: -15 },
      { x: 45, y: -2, cx1: 20, cy1: -10, cx2: 35, cy2: -2 },
      { x: 65, y: -45, cx1: 52, cy1: -12, cx2: 65, cy2: -25 },
      { x: 0, y: -80, cx1: 60, cy1: -75, cx2: 35, cy2: -85 },
      { x: -65, y: -45, cx1: -35, cy1: -85, cx2: -60, cy2: -75 }
    ];
    const bowL: PathPoint[] = [
      { x: 0, y: 95 },
      { x: -30, y: 84, cx1: -12, cy1: 88, cx2: -22, cy2: 80 },
      { x: -24, y: 114, cx1: -34, cy1: 96, cx2: -31, cy2: 106 },
      { x: 0, y: 102, cx1: -12, cy1: 110, cx2: -5, cy2: 104 }
    ];
    const bowR: PathPoint[] = [
      { x: 0, y: 95 },
      { x: 30, y: 84, cx1: 12, cy1: 88, cx2: 22, cy2: 80 },
      { x: 24, y: 114, cx1: 34, cy1: 96, cx2: 31, cy2: 106 },
      { x: 0, y: 102, cx1: 12, cy1: 110, cx2: 5, cy2: 104 }
    ];
    const bowStreamL: PathPoint[] = [
      { x: -6, y: 102 },
      { x: -30, y: 145, cx1: -15, cy1: 115, cx2: -25, cy2: 130 },
      { x: -12, y: 142, cx1: -20, cy1: 148, cx2: -15, cy2: 145 },
      { x: -2, y: 104, cx1: -5, cy1: 120, cx2: -3, cy2: 112 }
    ];
    const bowStreamR: PathPoint[] = [
      { x: 6, y: 102 },
      { x: 30, y: 145, cx1: 15, cy1: 115, cx2: 25, cy2: 130 },
      { x: 12, y: 142, cx1: 20, cy1: 148, cx2: 15, cy2: 145 },
      { x: 2, y: 104, cx1: 5, cy1: 120, cx2: 3, cy2: 112 }
    ];
    const hairBack = config.hairLength === 'short' ? hairBackShort : hairBackLong;
    const eyeCenterL = { x: -32, y: -6 };
    const eyeCenterR = { x: 32, y: -6 };
    const eyeRadius = 14;

    const drawPaper = (alpha: number) => {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(getPaperTexture(w, h, isLightMode), 0, 0, w, h);
      ctx.restore();
    };

    const drawWaterBloom = (x: number, y: number, r: number, colors: string[], alpha: number) => {
      const grad = ctx.createRadialGradient(cx + x * scaleFactor, cy + y * scaleFactor, 4 * scaleFactor, cx + x * scaleFactor, cy + y * scaleFactor, r * scaleFactor);
      colors.forEach((color, index) => grad.addColorStop(index / Math.max(colors.length - 1, 1), color));
      drawEllipse(x, y, r, r * 0.72, grad, alpha, -0.2);
      ctx.save();
      ctx.globalAlpha *= alpha * 0.8;
      ctx.strokeStyle = colors[0];
      ctx.lineWidth = 1.4 * scaleFactor;
      ctx.beginPath();
      ctx.ellipse(cx + x * scaleFactor, cy + y * scaleFactor, r * 0.84 * scaleFactor, r * 0.56 * scaleFactor, -0.2, -Math.PI * 0.8, Math.PI * 0.35);
      ctx.stroke();
      ctx.restore();
    };

    const drawBackgroundDecorations = (stageAlpha: number) => {
      if (config.backgroundStyle === 'cherry') {
        const petals = [
          { x: -135, y: -105, r: 7, rot: 0.5 },
          { x: -120, y: 28, r: 5, rot: -0.3 },
          { x: 125, y: -115, r: 8, rot: 0.9 },
          { x: 142, y: 28, r: 5, rot: -0.8 },
          { x: -80, y: 145, r: 6, rot: 0.25 }
        ];
        petals.forEach((petal, index) => drawEllipse(petal.x, petal.y, petal.r, petal.r * 0.5, '#f9a8d4', stageAlpha * clamp(watercolorT * 1.3 - index * 0.08), petal.rot));
        return;
      }

      if (config.backgroundStyle === 'stars') {
        const stars = [
          { x: -142, y: -130, s: 5 },
          { x: 138, y: -108, s: 7 },
          { x: -152, y: 80, s: 4 },
          { x: 148, y: 135, s: 6 }
        ];
        stars.forEach((star, index) => {
          const alpha = stageAlpha * clamp(watercolorT * 1.4 - index * 0.1);
          ctx.save();
          ctx.globalAlpha *= alpha;
          ctx.fillStyle = '#fde68a';
          const x = cx + star.x * scaleFactor;
          const y = cy + star.y * scaleFactor;
          const s = star.s * scaleFactor;
          ctx.beginPath();
          ctx.moveTo(x, y - s);
          ctx.quadraticCurveTo(x, y, x + s, y);
          ctx.quadraticCurveTo(x, y, x, y + s);
          ctx.quadraticCurveTo(x, y, x - s, y);
          ctx.quadraticCurveTo(x, y, x, y - s);
          ctx.fill();
          ctx.restore();
        });
        return;
      }

      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, config.backgroundStyle === 'gradient' ? 'rgba(125, 211, 252, 0.20)' : 'rgba(14, 165, 233, 0.18)');
      grad.addColorStop(0.48, 'rgba(244, 114, 182, 0.14)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.save();
      ctx.globalAlpha *= stageAlpha;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    };

    withLayer('layer-bg', () => {
      drawPaper(1);
      if (progress === 0) {
        drawWaterBloom(0, -10, 145, ['rgba(14, 165, 233, 0.18)', 'rgba(244, 114, 182, 0.08)', 'rgba(255,255,255,0)'], 1);
        drawStroke([{ x: -86, y: -5 }, { x: 86, y: -5 }], 'rgba(14, 116, 144, 0.22)', 1, [4, 6]);
        drawStroke([{ x: 0, y: -92 }, { x: 0, y: 102 }], 'rgba(185, 28, 28, 0.18)', 1, [4, 6]);
        drawStroke(facePoints, isLightMode ? 'rgba(15, 23, 42, 0.18)' : 'rgba(226, 232, 240, 0.18)', 1.2, [3, 4]);
        ctx.save();
        ctx.fillStyle = isLightMode ? '#0f172a' : '#f8fafc';
        ctx.font = `600 ${15 * scaleFactor}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('VocaSketch 语音驱动数位画板', cx, cy + 150 * scaleFactor);
        ctx.fillStyle = isLightMode ? '#0284c7' : '#7dd3fc';
        ctx.font = `700 ${10 * scaleFactor}px monospace`;
        ctx.fillText('等待你的创作指令', cx, cy + 170 * scaleFactor);
        ctx.restore();
      }
    });

    if (progress === 0) return;

    withLayer('layer-watercolor', (opacity) => {
      if (watercolorT <= 0) return;
      const alpha = easeOut(watercolorT);
      drawBackgroundDecorations(alpha);
      if (config.backgroundStyle === 'stars') {
        drawWaterBloom(0, -5, 185, ['rgba(15, 23, 42, 0.18)', 'rgba(59, 130, 246, 0.10)', 'rgba(255,255,255,0)'], alpha);
      } else if (config.backgroundStyle === 'cherry') {
        drawWaterBloom(-18, -8, 178, ['rgba(244, 114, 182, 0.22)', 'rgba(251, 207, 232, 0.16)', 'rgba(255,255,255,0)'], alpha);
      } else {
        drawWaterBloom(-18, -10, 176, ['rgba(14, 165, 233, 0.22)', 'rgba(168, 85, 247, 0.12)', 'rgba(255,255,255,0)'], alpha);
        drawWaterBloom(75, 72, 96, ['rgba(244, 114, 182, 0.18)', 'rgba(255,255,255,0)'], alpha * 0.8);
      }
    });

    withLayer('layer-sketch', () => {
      if (sketchT <= 0) return;
      const baseAlpha = progress >= 55 ? 0.36 : 0.88;
      const pencil = isLightMode ? 'rgba(71, 85, 105, 0.62)' : 'rgba(186, 230, 253, 0.58)';
      const bluePencil = isLightMode ? 'rgba(14, 116, 144, 0.42)' : 'rgba(125, 211, 252, 0.42)';
      const coralPencil = 'rgba(244, 63, 94, 0.32)';

      drawStrokeGroup([
        () => {
          drawStroke([{ x: 0, y: -94 }, { x: 0, y: 108 }], bluePencil, 1.1, [5, 7], baseAlpha);
          drawStroke([{ x: -96, y: -6 }, { x: 96, y: -6 }], coralPencil, 1.1, [5, 7], baseAlpha);
          ctx.save();
          ctx.globalAlpha *= baseAlpha * 0.55;
          ctx.strokeStyle = pencil;
          ctx.lineWidth = 1.1 * scaleFactor;
          ctx.setLineDash([7 * scaleFactor, 6 * scaleFactor]);
          ctx.beginPath();
          ctx.arc(cx, cy - 24 * scaleFactor, 72 * scaleFactor, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        },
        () => {
          drawStroke(facePoints, pencil, 1.35, [3, 3], baseAlpha);
          drawStroke(earL, pencil, 1.1, [3, 3], baseAlpha);
          drawStroke(earR, pencil, 1.1, [3, 3], baseAlpha);
        },
        () => {
          drawStroke(neckPoints, pencil, 1.2, [3, 4], baseAlpha);
          drawStroke(outfitBody, pencil, 1.2, [4, 4], baseAlpha);
          drawStroke(collarLeft, pencil, 1.1, [3, 3], baseAlpha);
          drawStroke(collarRight, pencil, 1.1, [3, 3], baseAlpha);
        },
        () => {
          drawStroke(hairBack, pencil, 1.25, [4, 4], baseAlpha);
          drawStroke(bangs, pencil, 1.2, [3, 3], baseAlpha);
          drawStroke([{ x: -42, y: -8 }, { x: -20, y: -8 }], bluePencil, 1, [3, 3], baseAlpha);
          drawStroke([{ x: 20, y: -8 }, { x: 42, y: -8 }], bluePencil, 1, [3, 3], baseAlpha);
        }
      ], sketchT);
    });

    withLayer('layer-flats', () => {
      if (flatT <= 0) return;
      const flatEase = easeOut(flatT);
      const skinAlpha = clamp(flatEase * 3);
      const hairAlpha = clamp(flatEase * 3 - 1);
      const eyesAlpha = clamp(flatEase * 3 - 1.7);
      const outfitAlpha = clamp(flatEase * 3 - 2.1);

      drawFill(facePoints, '#fdf0ed', skinAlpha);
      drawFill(earL, '#f7d8cf', skinAlpha);
      drawFill(earR, '#f7d8cf', skinAlpha);
      drawFill(neckPoints, '#f1d6cf', skinAlpha);

      const hairGrad = ctx.createLinearGradient(cx, cy - 88 * scaleFactor, cx, cy + 172 * scaleFactor);
      hairGrad.addColorStop(0, hairColors.highlight);
      hairGrad.addColorStop(0.25, hairColors.primary);
      hairGrad.addColorStop(1, hairColors.shadow);
      drawFill(hairBack, hairGrad, hairAlpha);
      drawFill(bangs, hairColors.primary, hairAlpha);

      drawFill(outfitBody, config.outfit === 'hoodie' ? '#64748b' : config.outfit === 'shirt' ? '#e2e8f0' : '#3d5a80', outfitAlpha);
      drawFill(collarLeft, config.outfit === 'hoodie' ? '#94a3b8' : '#f4f1de', outfitAlpha);
      drawFill(collarRight, config.outfit === 'hoodie' ? '#94a3b8' : '#f4f1de', outfitAlpha);

      if (config.accessory === 'butterfly_knot') {
        drawFill(bowL, '#e63946', outfitAlpha);
        drawFill(bowR, '#e63946', outfitAlpha);
        drawFill(bowStreamL, '#c31622', outfitAlpha);
        drawFill(bowStreamR, '#c31622', outfitAlpha);
      }

      const drawEye = (eye: { x: number; y: number }) => {
        const eyeGrad = ctx.createRadialGradient(
          cx + (eye.x - 3) * scaleFactor,
          cy + (eye.y - 4) * scaleFactor,
          2 * scaleFactor,
          cx + eye.x * scaleFactor,
          cy + eye.y * scaleFactor,
          eyeRadius * scaleFactor
        );
        eyeGrad.addColorStop(0, eyeColors.glow);
        eyeGrad.addColorStop(0.48, eyeColors.iris);
        eyeGrad.addColorStop(1, eyeColors.pupil);
        drawEllipse(eye.x, eye.y, eyeRadius * 0.78, eyeRadius * 0.95, eyeGrad, eyesAlpha);
      };
      drawEye(eyeCenterL);
      drawEye(eyeCenterR);
    });

    withLayer('layer-watercolor', () => {
      if (watercolorT <= 0) return;
      const alpha = easeOut(watercolorT);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      drawFill(neckPoints, 'rgba(226, 154, 140, 0.16)', alpha);
      drawEllipse(-38, 14, 18, 10, 'rgba(244, 114, 182, 0.16)', alpha);
      drawEllipse(38, 14, 18, 10, 'rgba(244, 114, 182, 0.16)', alpha);
      drawFill(bangs, hexToRgba(hairColors.shadow, 0.16), alpha);
      drawFill(hairBack, hexToRgba(hairColors.primary, 0.12), alpha);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha *= alpha * 0.22;
      ctx.drawImage(getPaperTexture(w, h, isLightMode), 0, 0, w, h);
      ctx.restore();
    });

    withLayer('layer-lineart', () => {
      if (lineT <= 0) return;
      const ink = isLightMode ? '#1d1a1a' : '#14151f';
      const mutedInk = 'rgba(29, 26, 26, 0.52)';
      drawStrokeGroup([
        () => {
          drawStroke(facePoints, ink, 1.8);
          drawStroke(earL, ink, 1.45);
          drawStroke(earR, ink, 1.45);
          drawStroke(neckPoints, ink, 1.65);
        },
        () => {
          drawStroke(hairBack, ink, 2.1);
          drawStroke(bangs, ink, 1.9);
          drawStroke([{ x: -46, y: -56 }, { x: -70, y: 72, cx1: -66, cy1: -10, cx2: -78, cy2: 28 }], mutedInk, 0.95);
          drawStroke([{ x: 48, y: -56 }, { x: 72, y: 72, cx1: 66, cy1: -10, cx2: 78, cy2: 28 }], mutedInk, 0.95);
        },
        () => {
          drawStroke([{ x: -44, y: -10 }, { x: -32, y: -12, cx1: -42, cy1: -14, cx2: -35, cy2: -14 }, { x: -18, y: -8, cx1: -28, cy1: -10, cx2: -20, cy2: -8 }], ink, 3.2);
          drawStroke([{ x: 18, y: -8 }, { x: 32, y: -12, cx1: 20, cy1: -8, cx2: 28, cy2: -10 }, { x: 44, y: -10, cx1: 35, cy1: -14, cx2: 42, cy2: -14 }], ink, 3.2);
          drawStroke([{ x: -45, y: -25 }, { x: -25, y: -23, cx1: -35, cy1: -28, cx2: -30, cy2: -26 }], '#3a2d2d', 1.5);
          drawStroke([{ x: 25, y: -23 }, { x: 45, y: -25, cx1: 30, cy1: -26, cx2: 35, cy2: -28 }], '#3a2d2d', 1.5);
        },
        () => {
          drawStroke(outfitBody, ink, 1.9);
          drawStroke(collarLeft, ink, 1.55);
          drawStroke(collarRight, ink, 1.55);
          if (config.accessory === 'butterfly_knot') {
            drawStroke(bowL, ink, 1.55);
            drawStroke(bowR, ink, 1.55);
            drawStroke(bowStreamL, ink, 1.45);
            drawStroke(bowStreamR, ink, 1.45);
          }
        },
        () => {
          drawStroke([{ x: 0, y: 14 }, { x: 1, y: 14.5 }], ink, 2);
          if (config.expression === '惊讶') {
            drawEllipse(0, 32, 6, 10, '#ffb3c1');
            ctx.save();
            ctx.strokeStyle = ink;
            ctx.lineWidth = 1.7 * scaleFactor;
            ctx.beginPath();
            ctx.ellipse(cx, cy + 32 * scaleFactor, 6 * scaleFactor, 10 * scaleFactor, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          } else if (config.expression === '冷淡') {
            drawStroke([{ x: -9, y: 32 }, { x: 9, y: 32 }], ink, 2);
          } else if (config.expression === '害羞') {
            drawStroke([{ x: -8, y: 32 }, { x: 8, y: 32, cx1: -3, cy1: 35, cx2: 3, cy2: 35 }], ink, 1.8);
          } else {
            drawStroke([{ x: -12, y: 32 }, { x: 12, y: 32, cx1: -6, cy1: 37, cx2: 6, cy2: 37 }], ink, 2);
          }
          if (config.accessory === 'glasses') {
            const frame = 'rgba(230, 57, 70, 0.95)';
            drawStroke([{ x: -44, y: -7 }, { x: -44, y: 4 }, { x: -18, y: 4 }, { x: -18, y: -7 }, { x: -44, y: -7 }], frame, 2);
            drawStroke([{ x: 18, y: -7 }, { x: 18, y: 4 }, { x: 44, y: 4 }, { x: 44, y: -7 }, { x: 18, y: -7 }], frame, 2);
            drawStroke([{ x: -18, y: -4 }, { x: 18, y: -4 }], frame, 2.2);
            drawStroke([{ x: -44, y: -4 }, { x: -62, y: -8 }], frame, 1.8);
            drawStroke([{ x: 44, y: -4 }, { x: 62, y: -8 }], frame, 1.8);
          }
        }
      ], lineT);
    });

    withLayer('layer-details', () => {
      if (detailT <= 0) return;
      const alpha = easeOut(detailT);
      drawEllipse(-42, 13, 18, 10, 'rgba(255, 77, 109, 0.32)', alpha);
      drawEllipse(42, 13, 18, 10, 'rgba(255, 77, 109, 0.32)', alpha);
      if (config.expression === '害羞') {
        [-48, -42, -36, 34, 40, 46].forEach((x) => drawStroke([{ x, y: 8 }, { x: x + 4, y: 15 }], 'rgba(230, 57, 70, 0.62)', 1, [], alpha));
      }

      [eyeCenterL, eyeCenterR].forEach((eye) => {
        drawEllipse(eye.x - 4, eye.y - 5, 3.2, 3.2, '#ffffff', alpha);
        drawEllipse(eye.x + 4, eye.y + 5, 1.8, 1.8, '#ffffff', alpha);
        drawEllipse(eye.x - 1, eye.y + 6, 1.1, 1.1, 'rgba(255,255,255,0.5)', alpha);
      });

      drawStroke([{ x: -52, y: -52 }, { x: -76, y: 110, cx1: -74, cy1: -2, cx2: -84, cy2: 42 }], hexToRgba(hairColors.highlight, 0.8), 1.05, [], alpha);
      drawStroke([{ x: -18, y: -62 }, { x: -28, y: 28, cx1: -28, cy1: -24, cx2: -35, cy2: 3 }], hexToRgba(hairColors.highlight, 0.7), 0.9, [], alpha);
      drawStroke([{ x: 50, y: -52 }, { x: 74, y: 110, cx1: 72, cy1: -2, cx2: 84, cy2: 42 }], hexToRgba(hairColors.highlight, 0.8), 1.05, [], alpha);

      ctx.save();
      ctx.globalAlpha *= alpha * 0.7;
      ctx.strokeStyle = hairColors.highlight;
      ctx.lineWidth = 3.4 * scaleFactor;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy - 42 * scaleFactor, 54 * scaleFactor, -Math.PI * 0.7, -Math.PI * 0.32);
      ctx.stroke();
      ctx.restore();

      if (config.accessory === 'glasses') {
        drawStroke([{ x: -40, y: -5 }, { x: -26, y: 1 }], 'rgba(255,255,255,0.75)', 1.2, [], alpha);
        drawStroke([{ x: 24, y: -5 }, { x: 38, y: 1 }], 'rgba(255,255,255,0.75)', 1.2, [], alpha);
      }
      if (config.accessory === 'butterfly_knot') {
        drawStroke([{ x: -20, y: 92 }, { x: -5, y: 100 }, { x: -22, y: 108 }], 'rgba(99, 15, 24, 0.45)', 1, [], alpha);
        drawStroke([{ x: 20, y: 92 }, { x: 5, y: 100 }, { x: 22, y: 108 }], 'rgba(99, 15, 24, 0.45)', 1, [], alpha);
      }
    });

    if (lastRedrawTarget && redrawPulse > 0) {
      const regions: Record<RedrawTarget, { x: number; y: number; rx: number; ry: number }> = {
        hair: { x: 0, y: -24, rx: 135, ry: 180 },
        eyes: { x: 0, y: -6, rx: 76, ry: 34 },
        expression: { x: 0, y: 26, rx: 58, ry: 32 },
        outfit: { x: 0, y: 116, rx: 122, ry: 70 },
        accessory: { x: 0, y: config.accessory === 'butterfly_knot' ? 105 : -5, rx: config.accessory === 'butterfly_knot' ? 66 : 82, ry: config.accessory === 'butterfly_knot' ? 44 : 30 },
        background: { x: 0, y: 0, rx: 210, ry: 210 }
      };
      const region = regions[lastRedrawTarget];
      ctx.save();
      ctx.fillStyle = `rgba(15, 23, 42, ${0.10 * redrawPulse})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 28 * scaleFactor * redrawPulse;
      ctx.strokeStyle = `rgba(14, 165, 233, ${0.85 * redrawPulse})`;
      ctx.lineWidth = 3 * scaleFactor;
      ctx.setLineDash([8 * scaleFactor, 6 * scaleFactor]);
      ctx.beginPath();
      ctx.ellipse(cx + region.x * scaleFactor, cy + region.y * scaleFactor, region.rx * scaleFactor, region.ry * scaleFactor, 0, 0, Math.PI * 2);
      ctx.stroke();
      const scanY = region.y - region.ry + region.ry * 2 * (1 - redrawPulse);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * redrawPulse})`;
      ctx.lineWidth = 1.4 * scaleFactor;
      ctx.setLineDash([]);
      ctx.moveTo(cx + (region.x - region.rx * 0.78) * scaleFactor, cy + scanY * scaleFactor);
      ctx.lineTo(cx + (region.x + region.rx * 0.78) * scaleFactor, cy + scanY * scaleFactor);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.drawImage(getPaperTexture(w, h, isLightMode), 0, 0, w, h);
    ctx.restore();

    withLayer('layer-watercolor', () => {
      if (watercolorT <= 0) return;
      ctx.save();
      ctx.globalAlpha *= 0.08 * easeOut(watercolorT);
      ctx.drawImage(getPaperTexture(w, h, isLightMode), 0, 0, w, h);
      ctx.restore();
    });
  }, [dimensions, progress, config, layers, isLightMode, lastRedrawTarget, redrawClock]);

  const stageLabel =
    progress === 0
      ? '待绘制'
      : progress < STAGE_BOUNDARIES.sketchDone
      ? '草图'
      : progress < STAGE_BOUNDARIES.lineDone
      ? '线稿'
      : progress < STAGE_BOUNDARIES.flatsDone
      ? '铺色'
      : progress < STAGE_BOUNDARIES.watercolorDone
      ? '水彩'
      : progress < 100
      ? '细节'
      : '完成';

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col items-center justify-center w-full h-full min-h-[300px] border ${isLightMode ? 'border-slate-200 bg-white shadow-lg' : 'border-[#2d2d38] bg-[#0c0c10] shadow-2xl'} rounded-xl overflow-hidden aspect-square select-none`}
      id="main-canvas-container"
    >
      <div className={`absolute top-2 left-2 flex items-center gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-[#7b8190]'} z-10`}>
        <span>{Math.round(dimensions.width)} x {Math.round(dimensions.height)} px</span>
        <span className={`px-1.5 py-0.5 rounded border ${isLightMode ? 'bg-white/80 border-slate-200' : 'bg-black/30 border-white/10'}`}>
          {stageLabel} {Math.round(progress)}%
        </span>
      </div>
      <div className={`absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-[#7b8190]'} z-10`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>CANVAS LAYERS</span>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-crosshair"
        style={{ maxWidth: '100%', maxHeight: '100%' }}
        id="digital-painting-canvas"
      />

      <div className={`absolute left-3 top-8 flex flex-wrap gap-1.5 max-w-[72%] text-[9px] font-mono pointer-events-none z-10 ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
        {layers.map((layer) => (
          <span
            key={layer.id}
            className={`px-1.5 py-0.5 rounded border ${layer.visible ? (isLightMode ? 'bg-white/70 border-slate-200' : 'bg-black/30 border-white/10') : 'bg-rose-500/10 border-rose-500/20 text-rose-500 line-through'}`}
          >
            {layer.name}:{Math.round((layer.visible ? layer.opacity : 0) * 100)}%
          </span>
        ))}
      </div>

      {lastRedrawTarget && (
        <div className={`absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full border text-[11px] font-bold font-mono z-20 animate-pulse ${isLightMode ? 'bg-cyan-50/90 border-cyan-200 text-cyan-800' : 'bg-cyan-950/70 border-cyan-400/30 text-cyan-200'}`}>
          局部重绘: {REDRAW_LABELS[lastRedrawTarget]}
        </div>
      )}

      {isPaused && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 backdrop-blur-xs transition-opacity duration-300 z-30">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/50 flex items-center justify-center text-amber-400 animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
            </svg>
          </div>
          <span className="text-amber-400 text-xs font-mono font-medium tracking-widest bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            DRAFTING PAUSED · 绘画已暂停
          </span>
        </div>
      )}

      {progress > 0 && progress < 100 && !isPaused && (
        <div className="absolute bottom-4 left-4 right-4 bg-[#14141a]/95 border border-[#2d2d38] p-2.5 rounded-lg flex items-center gap-3 backdrop-blur-md shadow-lg pointer-events-none z-10">
          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-mono mb-1">
              <span className="text-[#969ba8]">
                {progress < STAGE_BOUNDARIES.sketchDone && '草图结构线'}
                {progress >= STAGE_BOUNDARIES.sketchDone && progress < STAGE_BOUNDARIES.lineDone && '线稿描线'}
                {progress >= STAGE_BOUNDARIES.lineDone && progress < STAGE_BOUNDARIES.flatsDone && '基础色铺设'}
                {progress >= STAGE_BOUNDARIES.flatsDone && progress < STAGE_BOUNDARIES.watercolorDone && '水彩晕染'}
                {progress >= STAGE_BOUNDARIES.watercolorDone && '细节刻画'}
              </span>
              <span className="text-[#5fbfff] font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-[#20202a] h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0" />
        </div>
      )}

      {(isListening || userSpeechSub || aiSpeechSub || isAwaitingConfirm || systemState === '思考中') && (
        <div className={`absolute left-3.5 right-3.5 bottom-3.5 ${isLightMode ? 'bg-white/95 border-[#e2e8f0]/90 text-slate-800 shadow-xl' : 'bg-[#0b0b10]/95 border-[#2d2d3c]/80 text-[#f1f5f9]'} p-3 rounded-lg flex flex-col gap-2 backdrop-blur-md shadow-2xl animate-fade-in pointer-events-auto z-20`}>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-1.5 text-[10px] font-mono tracking-wider font-extrabold ${isLightMode ? 'text-slate-500' : 'text-neutral-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isListening ? 'bg-rose-500 animate-pulse' :
                systemState === '思考中' ? 'bg-indigo-400 animate-pulse' :
                isAwaitingConfirm ? 'bg-amber-400 animate-bounce' :
                'bg-emerald-400 font-bold'
              }`} />
              <span>
                {isListening ? '智能画板声麦录入中...' :
                 systemState === '思考中' ? '正在拆解人设语义属性...' :
                 isAwaitingConfirm ? '语义解析就绪 · 请求指令确认' :
                 '语音指令辅助总线在线'}
              </span>
            </div>

            {(isListening || systemState === '思考中') && (
              <div className="flex items-end gap-0.5 h-2 my-0.5">
                <span className="w-[1.5px] bg-cyan-400 animate-[bounce_0.6s_infinite_50ms] h-full" />
                <span className="w-[1.5px] bg-cyan-500 animate-[bounce_0.6s_infinite_150ms] h-1/2" />
                <span className="w-[1.5px] bg-indigo-400 animate-[bounce_0.6s_infinite_250ms] h-2/3" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5 text-[11px] md:text-xs">
            {userSpeechSub && (
              <div className="flex items-start gap-1.5">
                <span className={`text-[8px] ${isLightMode ? 'bg-sky-100 border-sky-200 text-sky-800 font-bold' : 'bg-sky-500/10 border-sky-400/20 text-[#7dd3fc]'} font-mono font-semibold px-1.5 py-0.2 rounded shrink-0 mt-0.5 uppercase`}>
                  实时语音
                </span>
                <p className={`font-sans italic leading-snug ${isLightMode ? 'text-slate-800' : 'text-slate-100'}`}>“{userSpeechSub}”</p>
              </div>
            )}

            {aiSpeechSub && (
              <div className={`flex items-start gap-1.5 border-t ${isLightMode ? 'border-slate-200/60' : 'border-white/[0.04]'} pt-1.5`}>
                <span className={`text-[8px] ${isLightMode ? 'bg-purple-100 border-purple-200 text-purple-800 font-bold' : 'bg-purple-500/10 border-purple-400/20 text-purple-300'} font-mono font-semibold px-1.5 py-0.2 rounded shrink-0 mt-0.5 uppercase`}>
                  特征理解
                </span>
                <p className={`font-sans font-medium leading-relaxed ${isLightMode ? 'text-indigo-950' : 'text-purple-200'}`}>{aiSpeechSub}</p>
              </div>
            )}
          </div>

          {isAwaitingConfirm && (
            <div className={`flex items-center justify-end gap-1.5 border-t ${isLightMode ? 'border-slate-200/60' : 'border-white/[0.04]'} pt-1.5`}>
              <button
                onClick={onCancelAction}
                className={`px-2.5 py-1 ${isLightMode ? 'bg-rose-50 hover:bg-rose-100 text-red-700 border-rose-300' : 'bg-red-950/20 hover:bg-rose-900/35 text-red-300 border-rose-500/25'} font-bold border rounded text-[10px] transition-colors cursor-pointer`}
              >
                放弃此次改动
              </button>
              <button
                onClick={onConfirmAction}
                className="px-3.5 py-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-[#000] font-extrabold shadow-md rounded text-[10px] transition-all flex items-center gap-1 active:scale-95 cursor-pointer animate-pulse"
              >
                <span>确认画笔渲染</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
