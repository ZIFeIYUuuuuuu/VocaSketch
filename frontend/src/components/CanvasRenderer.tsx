/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { CharacterConfig, PaintLayer } from '../types';

interface CanvasRendererProps {
  progress: number; // 0 to 100
  config: CharacterConfig;
  layers: PaintLayer[];
  isPaused: boolean;
  onResize?: (width: number, height: number) => void;
  // New props for floating subtitle console directly on canvas
  userSpeechSub?: string;
  aiSpeechSub?: string;
  systemState?: string;
  isListening?: boolean;
  isAwaitingConfirm?: boolean;
  onConfirmAction?: () => void;
  onCancelAction?: () => void;
  isLightMode?: boolean;
}

export const CanvasRenderer: React.FC<CanvasRendererProps> = ({
  progress,
  config,
  layers,
  isPaused,
  userSpeechSub = '',
  aiSpeechSub = '',
  systemState = '等待指令',
  isListening = false,
  isAwaitingConfirm = false,
  onConfirmAction,
  onCancelAction,
  isLightMode = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });

  // Handle ResizeObserver to scale canvas beautifully
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      const size = Math.min(width, height, 800) || 500;
      setDimensions({ width: size, height: size });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const getLayerVisibility = (layerName: string): boolean => {
    const layer = layers.find((l) => l.name === layerName);
    return layer ? layer.visible : true;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set resolution high for retina displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const w = dimensions.width;
    const h = dimensions.height;
    ctx.clearRect(0, 0, w, h);

    // Reference center mapping
    const cx = w / 2;
    const cy = h / 2 - 20;
    const scaleFactor = w / 500; // Base rendering coordinates designed on a 500x500 box

    // -------------------------------------------------------------------------
    // Helper Bezier drawing functions
    // -------------------------------------------------------------------------
    const drawStroke = (
      points: { x: number; y: number; cx1?: number; cy1?: number; cx2?: number; cy2?: number }[],
      color: string,
      lineWidth: number,
      dash: number[] = [],
      rough: boolean = false
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (dash.length > 0) ctx.setLineDash(dash);

      if (points.length < 2) return;
      ctx.moveTo(points[0].x * scaleFactor + cx, points[0].y * scaleFactor + cy);

      for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        if (pt.cx1 !== undefined && pt.cy1 !== undefined && pt.cx2 !== undefined && pt.cy2 !== undefined) {
          ctx.bezierCurveTo(
            pt.cx1 * scaleFactor + cx,
            pt.cy1 * scaleFactor + cy,
            pt.cx2 * scaleFactor + cx,
            pt.cy2 * scaleFactor + cy,
            pt.x * scaleFactor + cx,
            pt.y * scaleFactor + cy
          );
        } else if (pt.cx1 !== undefined && pt.cy1 !== undefined) {
          ctx.quadraticCurveTo(
            pt.cx1 * scaleFactor + cx,
            pt.cy1 * scaleFactor + cy,
            pt.x * scaleFactor + cx,
            pt.y * scaleFactor + cy
          );
        } else {
          ctx.lineTo(pt.x * scaleFactor + cx, pt.y * scaleFactor + cy);
        }
      }

      ctx.stroke();
      ctx.restore();
    };

    const drawFill = (
      points: { x: number; y: number; cx1?: number; cy1?: number; cx2?: number; cy2?: number }[],
      fillColor: string | CanvasGradient
    ) => {
      ctx.save();
      ctx.beginPath();
      if (points.length < 2) return;
      ctx.moveTo(points[0].x * scaleFactor + cx, points[0].y * scaleFactor + cy);

      for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        if (pt.cx1 !== undefined && pt.cy1 !== undefined && pt.cx2 !== undefined && pt.cy2 !== undefined) {
          ctx.bezierCurveTo(
            pt.cx1 * scaleFactor + cx,
            pt.cy1 * scaleFactor + cy,
            pt.cx2 * scaleFactor + cx,
            pt.cy2 * scaleFactor + cy,
            pt.x * scaleFactor + cx,
            pt.y * scaleFactor + cy
          );
        } else if (pt.cx1 !== undefined && pt.cy1 !== undefined) {
          ctx.quadraticCurveTo(
            pt.cx1 * scaleFactor + cx,
            pt.cy1 * scaleFactor + cy,
            pt.x * scaleFactor + cx,
            pt.y * scaleFactor + cy
          );
        } else {
          ctx.lineTo(pt.x * scaleFactor + cx, pt.y * scaleFactor + cy);
        }
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();
    };

    // Color mapper helpers
    const getHairColorHex = (colorName: string) => {
      switch (colorName.toLowerCase()) {
        case 'blue': return { primary: '#4ea8de', shadow: '#31446B', highlight: '#ade8f4' };
        case 'pink': return { primary: '#ff8fab', shadow: '#8B4F64', highlight: '#ffe5ec' };
        case 'purple': return { primary: '#9d4edd', shadow: '#401F5C', highlight: '#e0aaff' };
        case 'gold':
        case 'yellow': return { primary: '#fcc21b', shadow: '#90650d', highlight: '#fff2b2' };
        case 'black': return { primary: '#2b2d42', shadow: '#14151F', highlight: '#8d99ae' };
        default: return { primary: '#2a6f97', shadow: '#1a3a4b', highlight: '#a9d6e5' };
      }
    };

    const getEyeColorHex = (colorName: string) => {
      switch (colorName.toLowerCase()) {
        case 'blue': return { iris: '#0077b6', pupil: '#03045e', glow: '#90e0ef' };
        case 'purple': return { iris: '#e0aaff', pupil: '#3c096c', glow: '#ff9e00' };
        case 'pink': return { iris: '#ff4d6d', pupil: '#590d22', glow: '#ffccd5' };
        case 'green': return { iris: '#38b000', pupil: '#0f4c10', glow: '#ccff33' };
        case 'gold': return { iris: '#fb8500', pupil: '#5a2200', glow: '#ffb703' };
        default: return { iris: '#0077b6', pupil: '#03045e', glow: '#90e0ef' };
      }
    };

    const hairColors = getHairColorHex(config.hairColor);
    const eyeColors = getEyeColorHex(config.eyeColor);

    // -------------------------------------------------------------------------
    // STANDBY & INITIALIZATION DEFAULT OVERLAY
    // -------------------------------------------------------------------------
    if (progress === 0) {
      ctx.save();
      // Draw warm charcoal/paper texture backdrop (ivory/art-paper white for light; deep charcoal-ink for dark)
      ctx.fillStyle = isLightMode ? '#ffffff' : '#111216';
      ctx.fillRect(0, 0, w, h);

      // Programmatic paper grain effect for a natural draft paper feel
      for (let i = 0; i < w; i += 3) {
        for (let j = 0; j < h; j += 3) {
          const rand = Math.random();
          if (rand > 0.88) {
            ctx.fillStyle = isLightMode ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.035)';
            ctx.fillRect(i, j, 1.2 * scaleFactor, 1.2 * scaleFactor);
          } else if (rand < 0.05) {
            ctx.fillStyle = isLightMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.02)';
            ctx.fillRect(i, j, 1 * scaleFactor, 1 * scaleFactor);
          }
        }
      }

      // Draw warm watercolor bloom circle under the draft (implies organic wet-on-wet watercolor layer)
      let standbyBloom = ctx.createRadialGradient(cx, cy - 15 * scaleFactor, 30 * scaleFactor, cx, cy - 15 * scaleFactor, 160 * scaleFactor);
      if (isLightMode) {
        standbyBloom.addColorStop(0, 'rgba(14, 165, 233, 0.12)'); // soft cerulean blue wet bloom
        standbyBloom.addColorStop(0.5, 'rgba(219, 39, 119, 0.06)'); // soft pink bleed
        standbyBloom.addColorStop(1, 'rgba(255, 255, 255, 0)');
      } else {
        standbyBloom.addColorStop(0, 'rgba(74, 168, 222, 0.12)');
        standbyBloom.addColorStop(0.6, 'rgba(157, 78, 221, 0.06)');
        standbyBloom.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = standbyBloom;
      ctx.beginPath();
      ctx.arc(cx, cy - 15 * scaleFactor, 160 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      // ----- NEW: VISUAL WATERCOLOR PIGMENT BLEED SWATCHES IN MARGIN -----
      // Implies authentic wet pigment and edge-pooling styling before paint starts
      // Bottom-left swatches:
      const swatchCx = 45 * scaleFactor;
      const swatchCy = h - 65 * scaleFactor;

      // Swatch 1: Cyan/Cobalt Blue
      let gradCyan = ctx.createRadialGradient(swatchCx, swatchCy, 2 * scaleFactor, swatchCx, swatchCy, 18 * scaleFactor);
      gradCyan.addColorStop(0, 'rgba(14, 165, 233, 0.4)');
      gradCyan.addColorStop(0.8, 'rgba(14, 165, 233, 0.2)');
      gradCyan.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradCyan;
      ctx.beginPath();
      ctx.arc(swatchCx, swatchCy, 18 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();
      // Accent wet edges pooling
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)';
      ctx.lineWidth = 1.2 * scaleFactor;
      ctx.beginPath();
      ctx.arc(swatchCx, swatchCy, 14 * scaleFactor, -Math.PI / 3, Math.PI);
      ctx.stroke();

      // Swatch 2: Pink/Rose Magenta
      const swatch2Cx = 75 * scaleFactor;
      const swatch2Cy = h - 55 * scaleFactor;
      let gradPink = ctx.createRadialGradient(swatch2Cx, swatch2Cy, 2 * scaleFactor, swatch2Cx, swatch2Cy, 16 * scaleFactor);
      gradPink.addColorStop(0, 'rgba(244, 63, 94, 0.35)');
      gradPink.addColorStop(0.8, 'rgba(244, 63, 94, 0.18)');
      gradPink.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradPink;
      ctx.beginPath();
      ctx.arc(swatch2Cx, swatch2Cy, 16 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();
      // Accent wet edges pooling
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.3)';
      ctx.lineWidth = 1.2 * scaleFactor;
      ctx.beginPath();
      ctx.arc(swatch2Cx, swatch2Cy, 12 * scaleFactor, Math.PI / 4, Math.PI * 1.5);
      ctx.stroke();

      // Palette Handwriting Legend label
      ctx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.5)' : 'rgba(148, 163, 184, 0.5)';
      ctx.font = `600 font-mono ${8 * scaleFactor}px monospace`;
      ctx.fillText('极客数位水彩晕染测试 swatches', 35 * scaleFactor, h - 85 * scaleFactor);

      // Soft pencil drawing helper lines
      const pencilLine = isLightMode ? 'rgba(51, 65, 85, 0.14)' : 'rgba(148, 163, 184, 0.22)';
      ctx.strokeStyle = pencilLine;
      ctx.lineWidth = 1;

      // Draw artist grid proportions
      ctx.setLineDash([4, 12]);
      ctx.strokeRect(30 * scaleFactor, 30 * scaleFactor, w - 60 * scaleFactor, h - 60 * scaleFactor);

      // Facial axis & tilt ratio guides (cyan/coral graphite pencils)
      ctx.strokeStyle = isLightMode ? 'rgba(14, 116, 144, 0.25)' : 'rgba(6, 182, 212, 0.22)'; // Cyan drafting pencil
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);

      // Vertical facial center axis
      ctx.beginPath();
      ctx.moveTo(cx, 40 * scaleFactor);
      ctx.lineTo(cx, h - 60 * scaleFactor);
      ctx.stroke();

      // Eye height guideline
      ctx.strokeStyle = isLightMode ? 'rgba(185, 28, 28, 0.2)' : 'rgba(239, 68, 68, 0.16)'; // Coral pencil line
      ctx.beginPath();
      ctx.moveTo(40 * scaleFactor, cy - 15 * scaleFactor);
      ctx.lineTo(w - 40 * scaleFactor, cy - 15 * scaleFactor);
      ctx.stroke();

      // Golden ratio circle (cranium head-mass guide)
      ctx.strokeStyle = pencilLine;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy - 20 * scaleFactor, 78 * scaleFactor, 0, Math.PI * 2);
      ctx.stroke();

      // Jaw/Cheeks & face outline (faint graphite drawing)
      ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([]);

      const draftFacePoints = [
        { x: -58, y: -25 },
        { x: -60, y: 15 },
        { x: 0, y: 55 },
        { x: 60, y: 15 },
        { x: 58, y: -25 },
      ];
      ctx.beginPath();
      ctx.moveTo(draftFacePoints[0].x * scaleFactor + cx, draftFacePoints[0].y * scaleFactor + cy);
      for(let i=1; i<draftFacePoints.length; i++) {
        ctx.lineTo(draftFacePoints[i].x * scaleFactor + cx, draftFacePoints[i].y * scaleFactor + cy);
      }
      ctx.stroke();

      // Neck & collarbones blueprint lines
      ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo((cx - 24 * scaleFactor), (cy + 25 * scaleFactor));
      ctx.lineTo((cx - 27 * scaleFactor), (cy + 75 * scaleFactor));
      ctx.lineTo((cx - 85 * scaleFactor), (cy + 125 * scaleFactor));

      ctx.moveTo((cx + 24 * scaleFactor), (cy + 25 * scaleFactor));
      ctx.lineTo((cx + 27 * scaleFactor), (cy + 75 * scaleFactor));
      ctx.lineTo((cx + 85 * scaleFactor), (cy + 125 * scaleFactor));
      ctx.stroke();

      // Eyes outline guides (faint cute layout boxes)
      ctx.strokeStyle = isLightMode ? 'rgba(14, 116, 144, 0.16)' : 'rgba(6, 182, 212, 0.14)';
      ctx.strokeRect((cx - 46 * scaleFactor), (cy - 12 * scaleFactor), (28 * scaleFactor), (14 * scaleFactor));
      ctx.strokeRect((cx + 18 * scaleFactor), (cy - 12 * scaleFactor), (28 * scaleFactor), (14 * scaleFactor));

      // NEW: Draw a highly aesthetic faint, semi-transparent graphite sketch outline of an anime girl's face structure!
      ctx.save();
      ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.1)' : 'rgba(255, 255, 255, 0.11)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2, 2]);

      // Crown / Hair curvature setup
      ctx.beginPath();
      ctx.arc(cx, cy - 25 * scaleFactor, 78 * scaleFactor, -Math.PI * 0.95, -Math.PI * 0.05);
      ctx.stroke();

      // Long Hair flow draft lines (left & right sides)
      ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      // left flow
      ctx.moveTo(cx - 75 * scaleFactor, cy - 20 * scaleFactor);
      ctx.quadraticCurveTo(cx - 95 * scaleFactor, cy + 40 * scaleFactor, cx - 82 * scaleFactor, cy + 110 * scaleFactor);
      // right flow
      ctx.moveTo(cx + 75 * scaleFactor, cy - 20 * scaleFactor);
      ctx.quadraticCurveTo(cx + 95 * scaleFactor, cy + 40 * scaleFactor, cx + 82 * scaleFactor, cy + 110 * scaleFactor);
      ctx.stroke();

      // Cheek bangs/fringes sketches (faint)
      ctx.strokeStyle = isLightMode ? 'rgba(51, 65, 85, 0.12)' : 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath();
      ctx.moveTo(cx - 30 * scaleFactor, cy - 65 * scaleFactor);
      ctx.lineTo(cx - 15 * scaleFactor, cy - 15 * scaleFactor);
      ctx.moveTo(cx - 5 * scaleFactor, cy - 70 * scaleFactor);
      ctx.lineTo(cx - 10 * scaleFactor, cy - 5 * scaleFactor);
      ctx.moveTo(cx + 25 * scaleFactor, cy - 65 * scaleFactor);
      ctx.lineTo(cx + 15 * scaleFactor, cy - 15 * scaleFactor);
      ctx.stroke();

      // Soft Anime eye folds sketch
      ctx.strokeStyle = isLightMode ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.16)';
      ctx.setLineDash([]);
      ctx.beginPath();
      // left eyelid curve
      ctx.moveTo(cx - 38 * scaleFactor, cy - 6 * scaleFactor);
      ctx.quadraticCurveTo(cx - 32 * scaleFactor, cy - 11 * scaleFactor, cx - 26 * scaleFactor, cy - 6 * scaleFactor);
      // right eyelid curve
      ctx.moveTo(cx + 26 * scaleFactor, cy - 6 * scaleFactor);
      ctx.quadraticCurveTo(cx + 32 * scaleFactor, cy - 11 * scaleFactor, cx + 38 * scaleFactor, cy - 6 * scaleFactor);
      ctx.stroke();

      // Faint cute smile sketch
      ctx.beginPath();
      ctx.moveTo(cx - 9 * scaleFactor, cy + 28 * scaleFactor);
      ctx.quadraticCurveTo(cx, cy + 32 * scaleFactor, cx + 9 * scaleFactor, cy + 28 * scaleFactor);
      ctx.stroke();
      ctx.restore();

      // Small handwriting annotations in high-end Chinese/Tech-art style
      ctx.fillStyle = isLightMode ? 'rgba(15, 23, 42, 0.45)' : 'rgba(148, 163, 184, 0.4)';
      ctx.font = `600 font-mono ${9 * scaleFactor}px monospace`;
      ctx.fillText('颅顶拟合高度比例 R:78', cx - 115 * scaleFactor, cy - 43 * scaleFactor);
      ctx.fillText('五官双眼透视基准轴线', cx + 115 * scaleFactor, cy - 11 * scaleFactor);
      ctx.fillText('下颌骨舒展倾角 82°', cx - 115 * scaleFactor, cy + 50 * scaleFactor);
      ctx.fillText('肩部结构落点重心 v1.0', cx + 118 * scaleFactor, cy + 120 * scaleFactor);

      // Welcome Typography for the Drawing Workspace (CHINESE FIRST / NO OVER-ENGINEERING ENG PILES)
      ctx.fillStyle = isLightMode ? '#0f172a' : '#ffffff';
      ctx.font = `600 ${15 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('VocaSketch 语音驱动数位画板', cx, cy + 148 * scaleFactor);

      ctx.fillStyle = isLightMode ? '#0284c7' : '#7dd3fc';
      ctx.font = `700 font-mono ${10 * scaleFactor}px monospace`;
      ctx.fillText('等待你的创作指令', cx, cy + 168 * scaleFactor);

      ctx.fillStyle = isLightMode ? '#334155' : '#9cb3af';
      ctx.font = `${11 * scaleFactor}px sans-serif`;
      ctx.fillText('请说：画一个湖蓝色长发、粉色瞳孔女生', cx, cy + 188 * scaleFactor);
      ctx.restore();
      return;
    }

    // -------------------------------------------------------------------------
    // LAYER 1: Background (1. 背景层)
    // -------------------------------------------------------------------------
    if (getLayerVisibility('背景层') && progress > 2) {
      ctx.save();
      // Draw standard digital art board bounds
      ctx.fillStyle = isLightMode ? '#ffffff' : '#1e1e24';
      ctx.fillRect(0, 0, w, h);

      // Add soft decorative radial watercolor background blur
      let gradBg = ctx.createRadialGradient(cx, cy, 20 * scaleFactor, cx, cy, 200 * scaleFactor);
      let fadeColor = isLightMode ? 'rgba(255, 255, 255, 0)' : 'rgba(30, 30, 36, 0)';
      if (config.backgroundStyle === 'cherry') {
        gradBg.addColorStop(0, 'rgba(255, 175, 190, 0.35)');
        gradBg.addColorStop(1, fadeColor);
      } else if (config.backgroundStyle === 'watercolor') {
        gradBg.addColorStop(0, 'rgba(74, 168, 222, 0.25)');
        gradBg.addColorStop(0.6, 'rgba(157, 78, 221, 0.15)');
        gradBg.addColorStop(1, fadeColor);
      } else {
        gradBg.addColorStop(0, 'rgba(92, 102, 112, 0.25)');
        gradBg.addColorStop(1, fadeColor);
      }
      ctx.fillStyle = gradBg;
      ctx.beginPath();
      ctx.arc(cx, cy, 190 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      // Draw background decorations based on selection
      if (config.backgroundStyle === 'cherry' && progress > 50) {
        // Falling simple cherry blossoms
        ctx.fillStyle = 'rgba(255, 192, 203, 0.6)';
        const petalCoords = [
          { x: -120, y: -100, r: 6 }, { x: -140, y: -50, r: 4 }, { x: 120, y: -120, r: 8 },
          { x: 130, y: 10, r: 5 }, { x: -80, y: 150, r: 6 }, { x: 140, y: 120, r: 7 }
        ];
        petalCoords.forEach((p) => {
          ctx.beginPath();
          ctx.ellipse(
            cx + p.x * scaleFactor, cy + p.y * scaleFactor,
            p.r * scaleFactor, (p.r * 0.6) * scaleFactor,
            Math.PI / 4, 0, Math.PI * 2
          );
          ctx.fill();
        });
      } else if (config.backgroundStyle === 'stars' && progress > 50) {
        // Golden glowing stars
        ctx.fillStyle = 'rgba(254, 228, 64, 0.7)';
        const starCoords = [
          { x: -140, y: -140, s: 5 }, { x: 140, y: -100, s: 7 },
          { x: -150, y: 80, s: 4 }, { x: 150, y: 140, s: 6 }
        ];
        starCoords.forEach((st) => {
          ctx.beginPath();
          // Minimalist 4 point stars
          const x = cx + st.x * scaleFactor;
          const y = cy + st.y * scaleFactor;
          const s = st.s * scaleFactor;
          ctx.moveTo(x, y - s);
          ctx.quadraticCurveTo(x, y, x + s, y);
          ctx.quadraticCurveTo(x, y, x, y + s);
          ctx.quadraticCurveTo(x, y, x - s, y);
          ctx.quadraticCurveTo(x, y, x, y - s);
          ctx.fill();
        });
      }
      ctx.restore();
    } else {
      // Clear grey paper look if no background layer
      ctx.fillStyle = '#0f0f12';
      ctx.fillRect(0, 0, w, h);
    }

    // -------------------------------------------------------------------------
    // DEFINITION OF VECTOR PATHS FOR HEADSHOT
    // (A head outline, cute long/short hair, elegant neck, outfit collars, ribbon and eyes)
    // -------------------------------------------------------------------------

    // Face and Neck boundaries
    const facePoints = [
      { x: -60, y: -30 },
      { x: -62, y: 10, cx1: -60, cy1: -10, cx2: -65, cy2: 0 }, // Cheek bone
      { x: 0, y: 55, cx1: -58, cy1: 25, cx2: -35, cy2: 50 },  // Chin
      { x: 62, y: 10, cx1: 35, cy1: 50, cx2: 58, cy2: 25 },   // Right jaw
      { x: 60, y: -30, cx1: 65, cy1: 0, cx2: 60, cy2: -10 },
    ];

    const earL = [
      { x: -61, y: -10 },
      { x: -72, y: -18, cx1: -68, cy1: -12, cx2: -72, cy2: -15 },
      { x: -63, y: 1, cx1: -72, cy1: -2, cx2: -68, cy2: 0 }
    ];

    const earR = [
      { x: 61, y: -10 },
      { x: 72, y: -18, cx1: 68, cy1: -12, cx2: 72, cy2: -15 },
      { x: 63, y: 1, cx1: 72, cy1: -2, cx2: 68, cy2: 0 }
    ];

    const neckPoints = [
      { x: -25, y: 25 },
      { x: -28, y: 70 },
      { x: 28, y: 70 },
      { x: 25, y: 25 },
    ];

    // Clothes and Collar
    const collarLeft = [
      { x: -24, y: 70 },
      { x: -55, y: 110, cx1: -32, cy1: 85, cx2: -45, cy2: 100 },
      { x: -10, y: 115, cx1: -38, cy1: 115, cx2: -25, cy2: 115 },
      { x: -6, y: 92, cx1: -8, cy1: 102, cx2: -7, cy2: 95 }
    ];

    const collarRight = [
      { x: 24, y: 70 },
      { x: 55, y: 110, cx1: 32, cy1: 85, cx2: 45, cy2: 100 },
      { x: 10, y: 115, cx1: 38, cy1: 115, cx2: 25, cy2: 115 },
      { x: 6, y: 92, cx1: 8, cy1: 102, cx2: 7, cy2: 95 }
    ];

    const outfitBody = [
      { x: -85, y: 120 },
      { x: -95, y: 160, cx1: -90, cy1: 135, cx2: -93, cy2: 148 },
      { x: 95, y: 160 },
      { x: 85, y: 120, cx1: 93, cy1: 148, cx2: 90, cy2: 135 },
    ];

    // Gorgeous Bow Ribbon
    const bowL = [
      { x: 0, y: 95 },
      { x: -28, y: 85, cx1: -12, cy1: 88, cx2: -22, cy2: 82 },
      { x: -24, y: 112, cx1: -32, cy1: 95, cx2: -30, cy2: 105 },
      { x: 0, y: 102, cx1: -12, cy1: 108, cx2: -5, cy2: 104 }
    ];
    const bowR = [
      { x: 0, y: 95 },
      { x: 28, y: 85, cx1: 12, cy1: 88, cx2: 22, cy2: 82 },
      { x: 24, y: 112, cx1: 32, cy1: 95, cx2: 30, cy2: 105 },
      { x: 0, y: 102, cx1: 12, cy1: 108, cx2: 5, cy2: 104 }
    ];
    const bowStreamL = [
      { x: -6, y: 102 },
      { x: -30, y: 145, cx1: -15, cy1: 115, cx2: -25, cy2: 130 },
      { x: -12, y: 142, cx1: -20, cy1: 148, cx2: -15, cy2: 145 },
      { x: -2, y: 104, cx1: -5, cy1: 120, cx2: -3, cy2: 112 }
    ];
    const bowStreamR = [
      { x: 6, y: 102 },
      { x: 30, y: 145, cx1: 15, cy1: 115, cx2: 25, cy2: 130 },
      { x: 12, y: 142, cx1: 20, cy1: 148, cx2: 15, cy2: 145 },
      { x: 2, y: 104, cx1: 5, cy1: 120, cx2: 3, cy2: 112 }
    ];

    // Hair Back paths
    const hairBackFemaleLong = [
      { x: -60, y: -30 },
      { x: -110, y: 40, cx1: -95, cy1: -10, cx2: -110, cy2: 15 },
      { x: -120, y: 160, cx1: -110, cy1: 80, cx2: -125, cy2: 120 },
      { x: -90, y: 175, cx1: -115, cy1: 175, cx2: -100, cy2: 175 },
      { x: -40, y: 70, cx1: -80, cy1: 140, cx2: -60, cy2: 95 },
      // Right side backup
      { x: 40, y: 70 },
      { x: 90, y: 175, cx1: 60, cy1: 95, cx2: 80, cy2: 140 },
      { x: 120, y: 160, cx1: 100, cy1: 175, cx2: 115, cy2: 175 },
      { x: 110, y: 40, cx1: 125, cy1: 120, cx2: 110, cy2: 80 },
      { x: 60, y: -30, cx1: 110, cy1: 15, cx2: 95, cy2: -10 }
    ];

    const hairBackMaleShort = [
      { x: -60, y: -30 },
      { x: -85, y: 15, cx1: -80, cy1: -15, cx2: -85, cy2: 0 },
      { x: -65, y: 40, cx1: -85, cy1: 25, cx2: -75, cy2: 35 },
      { x: -35, y: 25 },
      { x: 35, y: 25 },
      { x: 65, y: 40 },
      { x: 85, y: 15, cx1: 75, cy1: 35, cx2: 85, cy2: 25 },
      { x: 60, y: -30, cx1: 85, cy1: 0, cx2: 80, cy2: -15 }
    ];

    // Hair Front Bangs framing face
    const bangsFemale = [
      // Left major strand
      { x: -65, y: -45 },
      { x: -45, y: -2, cx1: -65, cy1: -25, cx2: -52, cy2: -12 },
      { x: -38, y: -18, cx1: -42, cy1: -10, cx2: -40, cy2: -15 },
      // Center bangs
      { x: -15, y: 5, cx1: -30, cy1: -10, cx2: -20, cy2: -2 },
      { x: -6, y: -22, cx1: -10, cy1: -5, cx2: -8, cy2: -15 },
      { x: 8, y: 8, cx1: -2, cy1: -12, cx2: 4, cy2: -2 },
      { x: 14, y: -22, cx1: 10, cy1: -5, cx2: 12, cy2: -15 },
      // Right major strand
      { x: 45, y: -2, cx1: 20, cy1: -10, cx2: 35, cy2: -2 },
      { x: 65, y: -45, cx1: 52, cy1: -12, cx2: 65, cy2: -25 },
      // Head Crown outline
      { x: 0, y: -80, cx1: 60, cy1: -75, cx2: 35, cy2: -85 },
      { x: -65, y: -45, cx1: -35, cy1: -85, cx2: -60, cy2: -75 }
    ];

    // Left Eye coordinates
    const eyeCenterL = { x: -32, y: -6 };
    const eyeCenterR = { x: 32, y: -6 };
    const eyeRadius = 14;

    // -------------------------------------------------------------------------
    // RENDER: PROGRESS-BASED PROGRESSIVE GRAPHICS ENGINE (分阶段渲染逻辑)
    // -------------------------------------------------------------------------

    // 1. SKETCH LAYER (2. 草图层)
    // Gray pencil sketchy outlines with high-contrast indicator markings
    if (getLayerVisibility('草图层') && progress > 5) {
      const sketchColor = 'rgba(141, 153, 174, 0.55)';
      const sketchWidth = 1.3;

      // Axis helper guidelines for facial anatomy (证明是精密数字绘图，而不是一次生图)
      if (progress < 60) {
        // Horizontal eye axis line
        drawStroke([{ x: -90, y: -6 }, { x: 90, y: -6 }], 'rgba(230, 57, 70, 0.25)', 1, [4, 4]);
        // Vertical facial center line
        drawStroke([{ x: 0, y: -90 }, { x: 0, y: 90 }], 'rgba(230, 57, 70, 0.25)', 1, [4, 4]);
        // Oval skull outline
        ctx.save();
        ctx.strokeStyle = 'rgba(141, 153, 174, 0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy - 25 * scaleFactor, 70 * scaleFactor, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Portrait rough strokes
      drawStroke(facePoints, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(earL, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(earR, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(neckPoints, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(config.hairLength === 'long' ? hairBackFemaleLong : hairBackMaleShort, sketchColor, sketchWidth, [3, 2], true);
      drawStroke(bangsFemale, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(outfitBody, sketchColor, sketchWidth, [2, 2], true);
      drawStroke(collarLeft, sketchColor, sketchWidth, [2, 1], true);
      drawStroke(collarRight, sketchColor, sketchWidth, [2, 1], true);

      // Rough eyes circles
      ctx.save();
      ctx.strokeStyle = sketchColor;
      ctx.lineWidth = sketchWidth * scaleFactor;
      ctx.beginPath();
      ctx.arc(cx + eyeCenterL.x * scaleFactor, cy + eyeCenterL.y * scaleFactor, eyeRadius * scaleFactor, 0, Math.PI * 2);
      ctx.arc(cx + eyeCenterR.x * scaleFactor, cy + eyeCenterR.y * scaleFactor, eyeRadius * scaleFactor, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. FLAT BASE COLORS & WATERCOLOR LAYER (3. 铺色层 & 4. 水彩层)
    // Fills boundaries with beautiful gradients + watercolor smudge bleed
    if (progress > 45) {
      const showFlats = getLayerVisibility('基础色层');
      const showWatercolor = getLayerVisibility('水彩层');

      if (showFlats) {
        // Base Skin Fill
        drawFill(facePoints, '#fdf0ed');
        drawFill(earL, '#fdf0ed');
        drawFill(earR, '#fdf0ed');
        drawFill(neckPoints, '#f4e3df');

        // Neck shadowing (watercolor style)
        if (showWatercolor) {
          ctx.save();
          let neckGrad = ctx.createLinearGradient(
            cx - 20 * scaleFactor, cy + 25 * scaleFactor,
            cx - 20 * scaleFactor, cy + 55 * scaleFactor
          );
          neckGrad.addColorStop(0, '#eacac3');
          neckGrad.addColorStop(1, '#fdf0ed');
          drawFill([
            { x: -25, y: 25 },
            { x: -27, y: 55 },
            { x: 27, y: 55, cx1: -5, cy1: 58, cx2: 15, cy2: 56 },
            { x: 25, y: 25 },
          ], neckGrad);
          ctx.restore();
        }

        // Outfit fill
        drawFill(outfitBody, '#3d5a80'); // Deep navy base
        drawFill(collarLeft, '#f4f1de'); // Warm school white
        drawFill(collarRight, '#f4f1de');

        // Hair fills with gorgeous watercolor overlays
        const hairPoints = config.hairLength === 'long' ? hairBackFemaleLong : hairBackMaleShort;
        let hairGrad = ctx.createLinearGradient(cx, cy - 80 * scaleFactor, cx, cy + 160 * scaleFactor);
        hairGrad.addColorStop(0, hairColors.primary);
        hairGrad.addColorStop(1, hairColors.shadow);
        drawFill(hairPoints, hairGrad);

        // Frame hair fill (overlays top of head)
        drawFill(bangsFemale, hairColors.primary);

        // Soft locks highlight layer (simulate water bleed smudge)
        if (showWatercolor) {
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          let waterEdgeGrad = ctx.createRadialGradient(cx, cy - 30 * scaleFactor, 40 * scaleFactor, cx, cy + 20 * scaleFactor, 140 * scaleFactor);
          waterEdgeGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          waterEdgeGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.05)');
          waterEdgeGrad.addColorStop(1, hairColors.shadow + '60');
          drawFill(bangsFemale, waterEdgeGrad);
          ctx.restore();
        }

        // Primary Bow Fills
        const bowColor = config.accessory === 'butterfly_knot' ? '#e63946' : 'rgba(0,0,0,0)';
        if (config.accessory === 'butterfly_knot') {
          drawFill(bowL, '#e63946');
          drawFill(bowR, '#e63946');
          drawFill(bowStreamL, '#c31622');
          drawFill(bowStreamR, '#c31622');
        }

        // Draw Eye Iris base flats
        ctx.save();
        let leftEyeGrad = ctx.createRadialGradient(
          cx + eyeCenterL.x * scaleFactor, cy + (eyeCenterL.y + 4) * scaleFactor, 2 * scaleFactor,
          cx + eyeCenterL.x * scaleFactor, cy + eyeCenterL.y * scaleFactor, eyeRadius * scaleFactor
        );
        leftEyeGrad.addColorStop(0, eyeColors.glow);
        leftEyeGrad.addColorStop(0.5, eyeColors.iris);
        leftEyeGrad.addColorStop(1, eyeColors.pupil);

        let rightEyeGrad = ctx.createRadialGradient(
          cx + eyeCenterR.x * scaleFactor, cy + (eyeCenterR.y + 4) * scaleFactor, 2 * scaleFactor,
          cx + eyeCenterR.x * scaleFactor, cy + eyeCenterR.y * scaleFactor, eyeRadius * scaleFactor
        );
        rightEyeGrad.addColorStop(0, eyeColors.glow);
        rightEyeGrad.addColorStop(0.5, eyeColors.iris);
        rightEyeGrad.addColorStop(1, eyeColors.pupil);

        ctx.fillStyle = leftEyeGrad;
        ctx.beginPath();
        ctx.arc(cx + eyeCenterL.x * scaleFactor, cy + eyeCenterL.y * scaleFactor, eyeRadius * 0.9 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rightEyeGrad;
        ctx.beginPath();
        ctx.arc(cx + eyeCenterR.x * scaleFactor, cy + eyeCenterR.y * scaleFactor, eyeRadius * 0.9 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. FINE INK LINEART LAYER (精细线稿层)
    // Pure elegant crisp black lines
    if (getLayerVisibility('线稿层') && progress > 24) {
      const inkColor = '#1d1a1a'; // Soft charcoal black
      const inkWidth = 1.8;

      drawStroke(facePoints, inkColor, inkWidth);
      drawStroke(earL, inkColor, inkWidth);
      drawStroke(earR, inkColor, inkWidth);
      drawStroke(neckPoints, inkColor, inkWidth);
      drawStroke(config.hairLength === 'long' ? hairBackFemaleLong : hairBackMaleShort, inkColor, inkWidth + 0.3);
      drawStroke(bangsFemale, inkColor, inkWidth);
      drawStroke(outfitBody, inkColor, inkWidth + 0.2);
      drawStroke(collarLeft, inkColor, inkWidth);
      drawStroke(collarRight, inkColor, inkWidth);

      if (config.accessory === 'butterfly_knot') {
        drawStroke(bowL, inkColor, inkWidth);
        drawStroke(bowStreamL, inkColor, inkWidth);
        drawStroke(bowR, inkColor, inkWidth);
        drawStroke(bowStreamR, inkColor, inkWidth);
        // Minimal knot center
        ctx.save();
        ctx.fillStyle = '#c31622';
        ctx.strokeStyle = inkColor;
        ctx.lineWidth = inkWidth * scaleFactor;
        ctx.beginPath();
        ctx.roundRect((cx - 8 * scaleFactor), (cy + 90 * scaleFactor), (16 * scaleFactor), (12 * scaleFactor), 5 * scaleFactor);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Upper eyelashes - thick gorgeous wing lines
      drawStroke([
        { x: -44, y: -10 },
        { x: -32, y: -12, cx1: -42, cy1: -14, cx2: -35, cy2: -14 },
        { x: -18, y: -8, cx1: -28, cy1: -10, cx2: -20, cy2: -8 }
      ], inkColor, 3.5);

      drawStroke([
        { x: 18, y: -8 },
        { x: 32, y: -12, cx1: 20, cy1: -8, cx2: 28, cy2: -10 },
        { x: 44, y: -10, cx1: 35, cy1: -14, cx2: 42, cy2: -14 }
      ], inkColor, 3.5);

      // Double eyelids crease
      drawStroke([{ x: -40, y: -16 }, { x: -22, y: -14, cx1: -32, cy1: -18, cx2: -28, cy2: -17 }], 'rgba(29, 26, 26, 0.45)', 1);
      drawStroke([{ x: 22, y: -14 }, { x: 40, y: -16, cx1: 28, cy1: -17, cx2: 32, cy2: -18 }], 'rgba(29, 26, 26, 0.45)', 1);

      // Eyebrows
      drawStroke([{ x: -45, y: -25 }, { x: -25, y: -23, cx1: -35, cy1: -28, cx2: -30, cy2: -26 }], '#3a2d2d', 1.5);
      drawStroke([{ x: 25, y: -23 }, { x: 45, y: -25, cx1: 30, cy1: -26, cx2: 35, cy2: -28 }], '#3a2d2d', 1.5);

      // Cute nose dot
      drawStroke([{ x: 0, y: 15 }, { x: 1, y: 14.5 }], inkColor, 2);

      // Mouth expression
      if (config.expression === '微笑') {
        drawStroke([{ x: -12, y: 32 }, { x: 12, y: 32, cx1: -6, cy1: 37, cx2: 6, cy2: 37 }], inkColor, 2);
        // Small dimple corners
        drawStroke([{ x: -13, y: 31 }, { x: -11, y: 33 }], inkColor, 1);
        drawStroke([{ x: 11, y: 33 }, { x: 13, y: 31 }], inkColor, 1);
      } else if (config.expression === '害羞') {
        drawStroke([{ x: -8, y: 32 }, { x: 8, y: 32, cx1: -3, cy1: 35, cx2: 3, cy2: 35 }], inkColor, 1.8);
      } else if (config.expression === '冷淡') {
        drawStroke([{ x: -8, y: 32 }, { x: 8, y: 32 }], inkColor, 2);
      } else if (config.expression === '惊讶') {
        // Open oval mouth
        ctx.save();
        ctx.lineWidth = 1.8 * scaleFactor;
        ctx.strokeStyle = inkColor;
        ctx.fillStyle = '#ffb3c1';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 32 * scaleFactor, 6 * scaleFactor, 10 * scaleFactor, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Draw active accessories! Glasses
      if (config.accessory === 'glasses') {
        const frameColor = 'rgba(230, 57, 70, 0.95)'; // Cool red round glasses
        drawStroke([
          { x: -44, y: -7 }, { x: -44, y: 4 }, { x: -18, y: 4 }, { x: -18, y: -7 }, { x: -44, y: -7 }
        ], frameColor, 2);
        drawStroke([
          { x: 18, y: -7 }, { x: 18, y: 4 }, { x: 44, y: 4 }, { x: 44, y: -7 }, { x: 18, y: -7 }
        ], frameColor, 2);
        // Bridge connect
        drawStroke([{ x: -18, y: -4 }, { x: 18, y: -4 }], frameColor, 2.2);
        // Temples
        drawStroke([{ x: -44, y: -4 }, { x: -62, y: -8 }], frameColor, 1.8);
        drawStroke([{ x: 44, y: -4 }, { x: 62, y: -8 }], frameColor, 1.8);
      }
    }

    // 4. MAIN DETAILS & HIGHLIGHTS LAYER (5. 细节刻画层)
    // Shines, glow sparks, cute cheek blush, and flyaway hair details
    if (getLayerVisibility('细节层') && progress > 74) {
      // 1. Cheek blush (Radial blurred warm pink blooms)
      ctx.save();
      let leftBlush = ctx.createRadialGradient(
        cx - 42 * scaleFactor, cy + 12 * scaleFactor, 2 * scaleFactor,
        cx - 42 * scaleFactor, cy + 12 * scaleFactor, 16 * scaleFactor
      );
      leftBlush.addColorStop(0, 'rgba(255, 77, 109, 0.35)');
      leftBlush.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = leftBlush;
      ctx.beginPath();
      ctx.arc(cx - 42 * scaleFactor, cy + 12 * scaleFactor, 16 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      let rightBlush = ctx.createRadialGradient(
        cx + 42 * scaleFactor, cy + 12 * scaleFactor, 2 * scaleFactor,
        cx + 42 * scaleFactor, cy + 12 * scaleFactor, 16 * scaleFactor
      );
      rightBlush.addColorStop(0, 'rgba(255, 77, 109, 0.35)');
      rightBlush.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = rightBlush;
      ctx.beginPath();
      ctx.arc(cx + 42 * scaleFactor, cy + 12 * scaleFactor, 16 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      // Blush shy lines on cheeks
      if (config.expression === '害羞') {
        const lineBlsh = (x1: number) => {
          drawStroke([{ x: x1, y: 8 }, { x: x1 + 3, y: 14 }], 'rgba(230, 57, 70, 0.55)', 1);
          drawStroke([{ x: x1 + 4, y: 8 }, { x: x1 + 7, y: 14 }], 'rgba(230, 57, 70, 0.55)', 1);
          drawStroke([{ x: x1 + 8, y: 8 }, { x: x1 + 11, y: 14 }], 'rgba(230, 57, 70, 0.55)', 1);
        };
        lineBlsh(-46);
        lineBlsh(34);
      }
      ctx.restore();

      // 2. Beautiful white glossy eye spot highlights
      ctx.save();
      ctx.fillStyle = '#ffffff';

      // Left Eye gloss
      ctx.beginPath();
      ctx.arc(cx + (eyeCenterL.x - 4) * scaleFactor, cy + (eyeCenterL.y - 4) * scaleFactor, 3.2 * scaleFactor, 0, Math.PI * 2);
      ctx.arc(cx + (eyeCenterL.x + 4) * scaleFactor, cy + (eyeCenterL.y + 4) * scaleFactor, 1.8 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      // Right Eye gloss
      ctx.beginPath();
      ctx.arc(cx + (eyeCenterR.x - 4) * scaleFactor, cy + (eyeCenterR.y - 4) * scaleFactor, 3.2 * scaleFactor, 0, Math.PI * 2);
      ctx.arc(cx + (eyeCenterR.x + 4) * scaleFactor, cy + (eyeCenterR.y + 4) * scaleFactor, 1.8 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      // Eye starry sheen - very high-end
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(cx + (eyeCenterL.x - 2) * scaleFactor, cy + (eyeCenterL.y + 5) * scaleFactor, 1 * scaleFactor, 0, Math.PI * 2);
      ctx.arc(cx + (eyeCenterR.x - 2) * scaleFactor, cy + (eyeCenterR.y + 5) * scaleFactor, 1 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 3. Hair sheen halo (An angel halo highlight popular in anime art)
      ctx.save();
      ctx.strokeStyle = hairColors.highlight;
      ctx.lineWidth = 4 * scaleFactor;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      // Halo arc across front head
      ctx.arc(cx, cy - 42 * scaleFactor, 55 * scaleFactor, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.stroke();

      // Small secondary dashed halo
      ctx.lineWidth = 2 * scaleFactor;
      ctx.beginPath();
      ctx.arc(cx, cy - 47 * scaleFactor, 55 * scaleFactor, -Math.PI * 0.65, -Math.PI * 0.35);
      ctx.stroke();
      ctx.restore();

      // 4. White particle flecks (air-blown artistic sparkles)
      if (progress > 90) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        const sparklePoints = [
          { x: -65, y: -45 }, { x: 55, y: -55 }, { x: -80, y: 15 },
          { x: 80, y: 10 }, { x: -30, y: 124 }, { x: 45, y: 110 }
        ];
        sparklePoints.forEach((sp) => {
          ctx.beginPath();
          ctx.arc(cx + sp.x * scaleFactor, cy + sp.y * scaleFactor, 1.8 * scaleFactor, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }
    }

    // 5. POST-EFFECT WATERCOLOR PAPER TEXTURE
    // Overlays canvas matrix with authentic grainy board pattern mock
    if (progress > 55) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      // Programmatic noise generator overlay directly onto canvas
      for (let i = 0; i < w; i += 4) {
        for (let j = 0; j < h; j += 4) {
          if (Math.random() > 0.82) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
            ctx.fillRect(i, j, 1, 1);
          } else if (Math.random() < 0.05) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
            ctx.fillRect(i, j, 1, 1);
          }
        }
      }
      ctx.restore();
    }
  }, [dimensions, progress, config, layers]);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col items-center justify-center w-full h-full min-h-[300px] border ${isLightMode ? 'border-slate-200 bg-white shadow-lg' : 'border-[#2d2d38] bg-[#0c0c10] shadow-2xl'} rounded-xl overflow-hidden aspect-square select-none`}
      id="main-canvas-container"
    >
      {/* Decorative grid lines inside canvas frame to highlight vector style */}
      <div className={`absolute top-2 left-2 text-[10px] font-mono ${isLightMode ? 'text-slate-400' : 'text-[#4e5464]'}`}>
        <span>600 × 600 px</span>
      </div>
      <div className={`absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-mono ${isLightMode ? 'text-slate-400' : 'text-[#4e5464]'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>SVG / VECTOR MODE</span>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-crosshair"
        style={{ maxWidth: '100%', maxHeight: '100%' }}
        id="digital-painting-canvas"
      />

      {/* Pause Indicator overlay */}
      {isPaused && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 backdrop-blur-xs transition-opacity duration-300">
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

      {/* Drawing Progress indicators */}
      {progress > 0 && progress < 100 && !isPaused && (
        <div className="absolute bottom-4 left-4 right-4 bg-[#14141a]/95 border border-[#2d2d38] p-2.5 rounded-lg flex items-center gap-3 backdrop-blur-md shadow-lg pointer-events-none z-10">
          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-mono mb-1">
              <span className="text-[#969ba8]">
                {progress < 25 && '✍️ 草图绘制 (Draft Sketching...)'}
                {progress >= 25 && progress < 50 && '✒️ 高精线稿 (Refinement Inking...)'}
                {progress >= 50 && progress < 75 && '🎨 水彩铺色 (Chroma & flats...)'}
                {progress >= 75 && '✨ 高光细节 (Ambient highlights...)'}
              </span>
              <span className="text-[#5fbfff] font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-[#20202a] h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
          <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0"></div>
        </div>
      )}

      {/* NEW: Floating Cinematic Subtitle & Voice Action Hud overlaid directly inside canvas */}
      {(isListening || userSpeechSub || aiSpeechSub || isAwaitingConfirm || (systemState === '思考中')) && (
        <div className={`absolute left-3.5 right-3.5 bottom-3.5 ${isLightMode ? 'bg-white/95 border-[#e2e8f0]/90 text-slate-800 shadow-xl' : 'bg-[#0b0b10]/95 border-[#2d2d3c]/80 text-[#f1f5f9]'} p-3 rounded-lg flex flex-col gap-2 backdrop-blur-md shadow-2xl animate-fade-in pointer-events-auto z-20`}>
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-1.5 text-[10px] font-mono tracking-wider font-extrabold ${isLightMode ? 'text-slate-500' : 'text-neutral-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isListening ? 'bg-rose-500 animate-pulse' :
                systemState === '思考中' ? 'bg-indigo-400 animate-pulse' :
                isAwaitingConfirm ? 'bg-amber-400 animate-bounce' :
                'bg-emerald-400 font-bold'
              }`} />
              <span>
                {isListening ? '🎙️ 智能画板声麦录入中...' :
                 systemState === '思考中' ? '🧠 正在深度拆解人设语义属性...' :
                 isAwaitingConfirm ? '⚠️ 语义解析就绪 · 请求指令确认' :
                 '✨ 语音指令辅助总线在线'}
              </span>
            </div>

            {/* micro equalizers */}
            {(isListening || systemState === '思考中') && (
              <div className="flex items-end gap-0.5 h-2 my-0.5">
                <span className="w-[1.5px] bg-cyan-400 animate-[bounce_0.6s_infinite_50ms] h-full" />
                <span className="w-[1.5px] bg-cyan-500 animate-[bounce_0.6s_infinite_150ms] h-1/2" />
                <span className="w-[1.5px] bg-indigo-400 animate-[bounce_0.6s_infinite_250ms] h-2/3" />
              </div>
            )}
          </div>

          {/* Transcript Content Rows */}
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

          {/* Interactive Actions Overlay inside Canvas if awaiting confirmation */}
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
                <span>确认画笔渲染 (直接说"确认")</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
