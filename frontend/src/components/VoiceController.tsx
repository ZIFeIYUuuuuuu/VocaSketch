/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Undo2,
  Redo2,
  Download,
  Terminal,
  CornerDownRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SystemState, VoiceLog } from '../types';

interface VoiceControllerProps {
  systemState: SystemState;
  isListening: boolean;
  userSpeechSub: string;
  aiSpeechSub: string;
  voiceLogs: VoiceLog[];
  onToggleMic: () => void;
  onPauseResume: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReplay: () => void;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  currentSpeechCommand?: string;
  isMicLoading?: boolean;
  isLightMode?: boolean;
}

export const VoiceController: React.FC<VoiceControllerProps> = ({
  systemState,
  isListening,
  userSpeechSub,
  aiSpeechSub,
  voiceLogs,
  onToggleMic,
  onPauseResume,
  onUndo,
  onRedo,
  onReplay,
  onExport,
  canUndo,
  canRedo,
  currentSpeechCommand,
  isMicLoading = false,
  isLightMode = false,
}) => {
  const [showLogs, setShowLogs] = useState<boolean>(false);

  return (
    <div className="w-full flex flex-col gap-4" id="voice-control-station">

      {/* 2. BOTTOM CONTROL & INTENT BUTTON TRIGGERS */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col xl:flex-row items-center justify-between gap-5">
          {/* Playback action triggers (Undo/Redo, Replay, Export) */}
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-center">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans border rounded-lg transition-all duration-200 ${
                canUndo
                  ? isLightMode
                    ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 hover:border-slate-400 active:scale-95'
                    : 'bg-[#181822] border-[#2d2d3c] text-white hover:bg-[#20202d] hover:border-neutral-500 active:scale-95'
                  : 'bg-transparent border-neutral-200 text-neutral-400 cursor-not-allowed opacity-50'
              }`}
              title="撤销上一次口令绘画修改 (支持说“撤销”)"
            >
              <Undo2 className="w-4.5 h-4.5 text-neutral-500" />
              <span>撤销</span>
            </button>

            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans border rounded-lg transition-all duration-200 ${
                canRedo
                  ? isLightMode
                    ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 hover:border-slate-400 active:scale-95'
                    : 'bg-[#181822] border-[#2d2d3c] text-white hover:bg-[#20202d] hover:border-neutral-500 active:scale-95'
                  : 'bg-transparent border-neutral-200 text-neutral-400 cursor-not-allowed opacity-50'
              }`}
              title="重做刚刚撤销的绘画步骤 (支持说“重做”)"
            >
              <Redo2 className="w-4.5 h-4.5 text-neutral-500" />
              <span>重做</span>
            </button>

            <button
              onClick={onReplay}
              disabled={systemState === '未开始'}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans border rounded-lg transition-all duration-200 ${
                systemState !== '未开始'
                  ? isLightMode
                    ? 'bg-[#ecfdf5] border-emerald-350 text-emerald-800 hover:bg-[#d1fae5] hover:border-emerald-500 active:scale-95'
                    : 'bg-[#181822] border-[#2d2d3c] text-teal-400 hover:bg-[#1a2d2d] hover:border-teal-500/50 active:scale-95'
                  : 'bg-transparent border-neutral-200 text-neutral-400 cursor-not-allowed opacity-50'
              }`}
              title="自白纸开始全画幅快进动态重播 (支持说“回放”)"
            >
              <RotateCcw className="w-4 h-4 text-emerald-500" />
              <span>重放过程</span>
            </button>

            <button
              onClick={onExport}
              disabled={systemState === '未开始'}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold font-sans border rounded-lg transition-all duration-200 ${
                systemState !== '未开始'
                  ? isLightMode
                    ? 'bg-[#f0f9ff] border-sky-355 text-sky-800 hover:bg-sky-100 hover:border-sky-500 active:scale-95 animate-pulse'
                    : 'bg-[#181822] border-[#2d2d3c] text-cyan-400 hover:bg-[#152e3d] hover:border-cyan-500/50 active:scale-95'
                  : 'bg-transparent border-neutral-200 text-neutral-400 cursor-not-allowed opacity-50'
              }`}
              title="保存高清图像与矢量工程JSON (支持说“导出”)"
            >
              <Download className="w-4 h-4 text-sky-500" />
              <span>导出作品</span>
            </button>
          </div>

          {/* CENTER INTERACTIVE BIG MICROPHONE KEY & RADIAL EFFECT */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative">
              {/* Pulsing visual halo wave triggers when active */}
              {isListening && (
                <>
                  <span className="absolute -inset-3.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 animate-ping opacity-75"></span>
                  <span className="absolute -inset-6 rounded-full bg-cyan-500/5 border border-cyan-500/15 animate-pulse"></span>
                </>
              )}

              <button
                onClick={onToggleMic}
                disabled={isMicLoading}
                className={`relative z-10 w-14 h-14 rounded-full flex flex-col items-center justify-center border-2 shadow-2xl transition-all duration-350 transform active:scale-90 ${
                  isListening
                    ? 'bg-gradient-to-tr from-cyan-450 to-sky-500 border-white text-slate-900 scale-105 shadow-[0_0_24px_rgba(34,211,238,0.4)] md:cursor-pointer'
                    : isLightMode
                    ? 'bg-gradient-to-tr from-[#f8fafc] to-[#e2e8f0] border-slate-300 text-slate-600 hover:text-slate-950 hover:border-cyan-500/50 md:cursor-pointer'
                    : 'bg-gradient-to-tr from-[#1b1c25] to-[#252834] border-[#313547] text-gray-400 hover:text-white hover:border-cyan-500/50 md:cursor-pointer'
                }`}
                id="voice-mic-trigger-btn"
              >
                {isMicLoading ? (
                  <div className="w-6 h-6 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                ) : isListening ? (
                  <Mic className="w-6 h-6 animate-pulse" />
                ) : (
                  <MicOff className="w-6 h-6" />
                )}
              </button>
            </div>

            <span className={`text-[10px] font-mono font-bold tracking-wider ${isLightMode ? 'text-slate-600' : 'text-slate-500'} mt-2`}>
              {isListening ? '🎙️ 实时识别中 (说完可点停)' : '点击开麦 (实时识别)'}
            </span>
          </div>

          {/* PAUSE / CONTINUE BUTTON */}
          <div className="w-full xl:w-auto flex items-center justify-center shrink-0">
            <button
              onClick={onPauseResume}
              disabled={systemState === '等待指令' || systemState === '未开始'}
              className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold font-sans rounded-xl border transition-all duration-200 uppercase tracking-widest ${
                systemState === '绘画中'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 hover:bg-amber-400 font-extrabold active:scale-95 shadow-[0_4px_12px_rgba(245,158,11,0.2)] md:cursor-pointer'
                  : systemState === '已暂停'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 hover:bg-emerald-450 font-extrabold active:scale-95 shadow-[0_4px_12px_rgba(16,185,129,0.2)] md:cursor-pointer'
                  : isLightMode
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-[#181822] border-neutral-800 text-neutral-600 cursor-not-allowed'
              }`}
            >
              {systemState === '已暂停' ? (
                <>
                  <Play className="w-4 h-4 fill-current text-slate-950" />
                  <div className="flex flex-col items-start leading-none text-left">
                    <span className="text-[8px] font-mono opacity-80 mb-0.5 text-slate-950">支持说“继续”</span>
                    <span>继续绘画</span>
                  </div>
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 fill-current text-[#000]" />
                  <div className="flex flex-col items-start leading-none text-[#000] text-left">
                    <span className="text-[8px] font-mono opacity-80 mb-0.5 font-bold text-slate-950">支持说“暂停”</span>
                    <span>临时暂停</span>
                  </div>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Small subtle help desk line in monospace */}
        <div className={`flex flex-wrap justify-between items-center text-[10px] ${isLightMode ? 'text-slate-600 border-slate-250' : 'text-slate-500 border-[#1a1a24]'} font-mono tracking-wide border-t pt-2.5 px-1 gap-2`}>
          <div className={`flex items-center gap-1.5 ${isLightMode ? 'text-slate-700' : 'text-[#8892b0]'}`}>
            <span className="text-cyan-500 font-bold shrink-0">快捷语音指令：</span>
            <span>“撤销操作”</span>
            <span className="opacity-40">|</span>
            <span>“重新做步”</span>
            <span className="opacity-40">|</span>
            <span>“快进回放整个绘画”</span>
            <span className="opacity-40">|</span>
            <span>“导出保存原图”</span>
          </div>
          <span className={`${isLightMode ? 'text-slate-500' : 'text-neutral-600'} hidden md:inline`}>Paraformer 实时 ASR 普通话识别</span>
        </div>
      </div>

      {/* 3. CLI DEBUGGER CONSOLE (本地控制历史反馈终端 - 收缩式) */}
      <div className={`border ${isLightMode ? 'bg-[#f8f9fc] border-slate-200' : 'bg-[#09090b] border-[#1d1d28]'} rounded-lg overflow-hidden flex flex-col`}>
        {/* Clickable Header bar */}
        <button
          onClick={() => setShowLogs(!showLogs)}
          className={`w-full ${isLightMode ? 'bg-slate-50' : 'bg-[#121217]'} px-3.5 py-2.5 border-none flex items-center justify-between text-left focus:outline-none hover:bg-slate-100 transition-colors cursor-pointer`}
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-cyan-500" />
            <span className={`text-xs font-sans ${isLightMode ? 'text-slate-600' : 'text-neutral-400'} font-medium`}>
              识别详情
            </span>
          </div>
          <div className={`flex items-center gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-600 bg-slate-200/50' : 'text-slate-500 bg-black/30'} border border-white/5 px-2 py-0.5 rounded`}>
            <span>{voiceLogs.length} 条流水</span>
            {showLogs ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        </button>

        {/* Nested Event Logs list */}
        {showLogs && (
          <div className={`border-t ${isLightMode ? 'border-slate-200 bg-[#fbfcfd]' : 'border-[#1b1b24] bg-black'} p-3 font-mono text-[11px] h-36 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-neutral-800 animate-fade-in`}>
            {voiceLogs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-neutral-600 text-xs text-center py-4 italic">
                待机中... 请说出语音口令触发日志流
              </div>
            ) : (
              voiceLogs.map((log) => {
                const textStyle =
                  log.sender === 'user'
                    ? 'text-sky-600'
                    : log.sender === 'ai'
                    ? 'text-indigo-600 font-medium'
                    : 'text-neutral-500';
                const prefix =
                  log.sender === 'user'
                    ? '👤 [语音录入]'
                    : log.sender === 'ai'
                    ? '🤖 [语义拆解]'
                    : '⚙️ [运行总线]';

                return (
                  <div key={log.id} className="flex gap-1.5 items-start leading-relaxed animate-fade-in">
                    <span className="text-[10px] text-neutral-400 select-none mt-0.5">{log.timestamp}</span>
                    <span className={log.sender === 'system' ? 'text-neutral-500 shrink-0' : log.sender === 'user' ? 'text-sky-500 shrink-0' : 'text-indigo-500 shrink-0'}>
                      {prefix}
                    </span>
                    <p className={`flex-1 ${textStyle}`}>{log.text}</p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

    </div>
  );
};
