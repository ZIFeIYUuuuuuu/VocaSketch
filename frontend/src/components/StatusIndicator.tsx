/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Sparkles, Sliders, Volume2, Mic, Play } from 'lucide-react';
import { DrawStage, SystemState } from '../types';

interface StatusIndicatorProps {
  currentStage: DrawStage;
  systemState: SystemState;
  paintMode: 'auto' | 'stages';
  onTogglePaintMode: (mode: 'auto' | 'stages') => void;
  isLightMode?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  currentStage,
  systemState,
  paintMode,
  onTogglePaintMode,
  isLightMode = false,
}) => {
  // Map systemState into elegant colors
  const getStateStyle = (state: SystemState) => {
    switch (state) {
      case '等待指令':
        return {
          icon: <Activity className="w-4 h-4 text-neutral-400" />,
          bgColor: 'bg-neutral-500/10',
          borderColor: 'border-neutral-500/30',
          textColor: isLightMode ? 'text-slate-600' : 'text-neutral-300',
          labelText: '在线就绪 (Ready)',
          dotColor: 'bg-neutral-500',
        };
      case '聆听中':
        return {
          icon: <Mic className="w-4 h-4 text-rose-500 animate-pulse" />,
          bgColor: 'bg-rose-500/10',
          borderColor: 'border-rose-300',
          textColor: 'text-rose-500 font-bold',
          labelText: '正在聆听语音 (Listening)',
          dotColor: 'bg-rose-500 animate-ping',
        };
      case '思考中':
        return {
          icon: <Sliders className="w-4 h-4 text-cyan-600 animate-spin" />,
          bgColor: 'bg-cyan-500/10',
          borderColor: 'border-cyan-300',
          textColor: 'text-cyan-600',
          labelText: '大脑解析意图 (Parsing)',
          dotColor: 'bg-cyan-400',
        };
      case '等待确认':
        return {
          icon: <Volume2 className="w-4 h-4 text-purple-600" />,
          bgColor: 'bg-purple-500/10',
          borderColor: 'border-purple-300',
          textColor: 'text-purple-600',
          labelText: '等待口令确认 (Confirming)',
          dotColor: 'bg-purple-400 animate-bounce',
        };
      case '绘画中':
        return {
          icon: <Sparkles className="w-4 h-4 text-emerald-600" />,
          bgColor: 'bg-emerald-500/10',
          borderColor: 'border-emerald-300',
          textColor: 'text-emerald-650',
          labelText: '数位上色绘制中 (Drawing)',
          dotColor: 'bg-emerald-400',
        };
      case '已暂停':
        return {
          icon: <Play className="w-4 h-4 text-amber-500" />,
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-300',
          textColor: 'text-amber-600',
          labelText: '进程挂起已暂停 (Paused)',
          dotColor: 'bg-amber-500 animate-pulse',
        };
      default:
        return {
          icon: <Activity className="w-4 h-4 text-neutral-400" />,
          bgColor: 'bg-neutral-500/10',
          borderColor: 'border-neutral-500/30',
          textColor: isLightMode ? 'text-slate-600' : 'text-neutral-300',
          labelText: '等待指令',
          dotColor: 'bg-neutral-500',
        };
    }
  };

  const stateDetails = getStateStyle(systemState);

  // Stepper representation for drawing stages
  const stages: DrawStage[] = [
    '草图阶段',
    '线稿阶段',
    '铺色阶段',
    '水彩晕染',
    '细节刻画',
    '已完成',
  ];

  return (
    <div className={`w-full ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} p-4 rounded-xl flex flex-col gap-4 shadow-xl`} id="top-status-indicator">
      {/* Top row: controls setup & primary state tracker */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* State Tracker */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className={`absolute inline-flex h-3 w-3 rounded-full ${stateDetails.dotColor} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${stateDetails.dotColor}`}></span>
          </div>
          <div className="flex flex-col">
            <span className={`text-[10px] font-mono tracking-widest ${isLightMode ? 'text-slate-500 font-bold' : 'text-[#5c687a]'} uppercase`}>机脑运行状态</span>
            <div className={`mt-0.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium border ${stateDetails.bgColor} ${stateDetails.borderColor} ${stateDetails.textColor}`}>
              {stateDetails.icon}
              {stateDetails.labelText}
            </div>
          </div>
        </div>

        {/* Phase progress meter details */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col md:items-end">
            <span className={`text-[10px] font-mono tracking-widest ${isLightMode ? 'text-slate-500' : 'text-[#5c687a]'} uppercase font-bold text-sky-505`}>当前绘画解构阶段</span>
            <span className={`text-sm font-sans font-semibold ${isLightMode ? 'text-slate-900' : 'text-[#f1f5f9]'} mt-0.5`}>
              {currentStage === '未开始' ? '🎨 画板就绪·等待指令' : `✨ ${currentStage}层`}
            </span>
          </div>
        </div>

        {/* Playback Mode Toggler (Auto vs Stages) */}
        <div className="flex flex-col">
          <span className={`text-[10px] font-mono tracking-widest ${isLightMode ? 'text-slate-500 font-bold' : 'text-[#5c687a]'} uppercase mb-1.5`}>画布渲染模式</span>
          <div className={`inline-flex ${isLightMode ? 'bg-slate-100 border-[#cbd5e1]' : 'bg-[#181822] border-[#23232d]'} p-1 rounded-lg border w-fit`}>
            <button
              onClick={() => onTogglePaintMode('auto')}
              className={`px-3 py-1 text-xs font-medium font-sans rounded-md transition-all duration-200 ${
                paintMode === 'auto'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : isLightMode
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-[#94a3b8] hover:text-[#f8fafc]'
              }`}
            >
              自动连续绘画
            </button>
            <button
              onClick={() => onTogglePaintMode('stages')}
              className={`px-3 py-1 text-xs font-medium font-sans rounded-md transition-all duration-200 ${
                paintMode === 'stages'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : isLightMode
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-[#94a3b8] hover:text-[#f8fafc]'
              }`}
            >
              分阶段单步确认
            </button>
          </div>
        </div>
      </div>

      {/* Progressive Stage Stepper Tracker */}
      <div className={`w-full ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#181822] border-[#1b1b24]'} p-3 rounded-lg border overflow-x-auto`}>
        <div className="flex items-center justify-between min-w-[600px] px-2">
          {stages.map((stage, index) => {
            const isCompleted =
              currentStage === '已完成' ||
              stages.indexOf(currentStage) > index;
            const isActive = currentStage === stage;

            return (
              <React.Fragment key={stage}>
                {/* Step circle */}
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono border transition-all duration-300 ${
                      isCompleted
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-600 font-bold'
                        : isActive
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-extrabold shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                        : isLightMode
                        ? 'bg-white border-slate-300 text-slate-400'
                        : 'bg-[#111115] border-neutral-800 text-[#5c687a]'
                    }`}
                  >
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  <span
                    className={`text-[11px] font-medium transition-colors ${
                      isCompleted
                        ? 'text-emerald-600'
                        : isActive
                        ? 'text-cyan-500 font-semibold'
                        : isLightMode
                        ? 'text-slate-400'
                        : 'text-[#5c687a]'
                    }`}
                  >
                    {stage.replace('阶段', '')}
                  </span>
                </div>

                {/* Connector line */}
                {index < stages.length - 1 && (
                  <div className={`flex-1 mx-2 h-[2px] ${isLightMode ? 'bg-slate-200' : 'bg-neutral-850'} rounded-full overflow-hidden shrink-1`}>
                    <div
                      className={`h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-700 ${
                        isCompleted ? 'w-full' : 'w-0'
                      }`}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
