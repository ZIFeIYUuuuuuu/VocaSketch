/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Eye, EyeOff, Layers, ShieldCheck } from 'lucide-react';
import { PaintLayer, DrawStage } from '../types';

interface LayerPanelProps {
  layers: PaintLayer[];
  currentStage: DrawStage;
  onTogglePlayLayer: (id: string) => void;
  onResetLayers?: () => void;
  isLightMode?: boolean;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  currentStage,
  onTogglePlayLayer,
  isLightMode = false,
}) => {
  // Helper to determine stage state badges
  const getStageStatusBadge = (layerStage: DrawStage, progressStage: DrawStage) => {
    const stageOrder: DrawStage[] = [
      '未开始',
      '草图阶段',
      '线稿阶段',
      '铺色阶段',
      '水彩晕染',
      '细节刻画',
      '已完成',
    ];

    const layerIdx = stageOrder.indexOf(layerStage);
    const currentIdx = stageOrder.indexOf(progressStage);

    if (currentIdx === 0) {
      return { text: '未激活', classes: isLightMode ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-[#252530] text-[#717684] border-[#2d2d3d]' };
    }

    if (layerIdx < currentIdx) {
      return { text: '就绪', classes: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
    }

    if (layerIdx === currentIdx) {
      return { text: '绘制中', classes: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30 animate-pulse' };
    }

    return { text: '待绘制', classes: isLightMode ? 'bg-slate-50 text-slate-400 border-slate-150' : 'bg-[#181822] text-[#4b5161] border-[#22222d]' };
  };

  return (
    <div className={`w-full flex flex-col ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} rounded-xl overflow-hidden shadow-xl`} id="semantic-layer-panel">
      {/* Header title */}
      <div className={`p-4 border-b ${isLightMode ? 'border-[#e2e8f0] bg-slate-50' : 'border-[#23232d] bg-[#16161f]'} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-500" />
          <span className={`font-sans font-medium text-sm ${isLightMode ? 'text-slate-800' : 'text-[#e2e8f0]'} tracking-wide`}>
            语义图层结构 (Layers)
          </span>
        </div>
        <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-650 border border-cyan-500/20 px-2 py-0.5 rounded uppercase font-bold" title="PSD">
          6 层可编辑图层
        </span>
      </div>

      {/* Layer rows list */}
      <div className={`flex-1 overflow-y-auto divide-y ${isLightMode ? 'divide-slate-100' : 'divide-[#1b1b24]'} p-2 space-y-1`}>
        {layers.map((layer) => {
          const isLayerActive = currentStage !== '未开始' && layer.stage === currentStage;
          const status = getStageStatusBadge(layer.stage, currentStage);

          return (
            <div
              key={layer.id}
              className={`group flex items-center justify-between p-3 rounded-lg border transition-all duration-200 ${
                isLayerActive
                  ? 'bg-cyan-500/5 border-cyan-500/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                  : isLightMode
                  ? 'bg-transparent border-transparent hover:bg-slate-50 hover:border-slate-200'
                  : 'bg-transparent border-transparent hover:bg-white/[0.02] hover:border-[#2d2d38]'
              }`}
            >
              {/* Row Left: eye visibility toggle + naming info */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onTogglePlayLayer(layer.id)}
                  className={`p-1.5 rounded-md hover:bg-white/[0.05] transition-colors ${
                    layer.visible ? 'text-[#a0aec0] hover:text-white' : 'text-[#4b5563] hover:text-[#9ca3af]'
                  }`}
                  title={layer.visible ? '点击隐藏图层' : '点击显示图层'}
                >
                  {layer.visible ? (
                    <Eye className="w-4 h-4 text-sky-500" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-neutral-400" />
                  )}
                </button>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold transition-colors ${
                        layer.visible
                          ? isLightMode ? 'text-slate-900' : 'text-[#f1f5f9]'
                          : 'text-[#64748b] line-through'
                      }`}
                    >
                      {layer.name}
                    </span>
                    {isLayerActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                    )}
                  </div>
                  <span className={`text-[10px] font-mono ${isLightMode ? 'text-slate-400' : 'text-[#5c687a]'}`}>
                    #{layer.id.substring(0, 8)} · Opacity: {layer.visible ? '100' : '0'}%
                  </span>
                </div>
              </div>

              {/* Row Right: layer stage badge type */}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-sans font-medium ${status.classes}`}>
                  {status.text}
                </span>

                {/* Visual thumbnail outline color */}
                <div
                  className={`w-4 h-4 rounded border ${isLightMode ? 'border-slate-300' : 'border-white/20'} shrink-0`}
                  style={{ backgroundColor: layer.color }}
                  title="图层掩码"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Verification notice */}
      <div className={`p-3.5 ${isLightMode ? 'bg-slate-50 border-t border-slate-200 text-slate-500' : 'bg-[#14141c] border-t border-[#23232d] text-[#6b7280]'} text-[11px]`}>
        <div className="flex gap-2 items-start">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-500 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong className={isLightMode ? 'text-slate-800' : 'text-gray-300'}>防伪防AI拼合声明：</strong>
            系统支持各图层独立控制与局部重构，通过上方眼睛图标可随时校验绘制轨迹的图层树隔离性。
          </p>
        </div>
      </div>
    </div>
  );
};
