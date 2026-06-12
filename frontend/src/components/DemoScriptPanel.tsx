/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Play, Sparkles, MessageSquare, Check, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { SystemState } from '../types';

interface DemoScriptPanelProps {
  systemState: SystemState;
  onSimulateCommand: (commandText: string) => void;
  onSimulateConfirm: () => void;
  isAwaitingConfirm: boolean;
  isLightMode?: boolean;
}

interface ScriptScenario {
  id: string;
  phase: string;
  command: string;
  outcome: string;
  badge: string;
  badgeColor: string;
}

export const DemoScriptPanel: React.FC<DemoScriptPanelProps> = ({
  systemState,
  onSimulateCommand,
  onSimulateConfirm,
  isAwaitingConfirm,
  isLightMode = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);
  const scenarios: ScriptScenario[] = [
    {
      id: 'step1',
      phase: '阶段 1 · 整体创建',
      command: '画一个蓝色长发的二次元女生半身头像，水彩素描风',
      outcome: '画布重置，启动 0-12秒 动态分图层渐进绘制流程（草图、精细线稿、上色、水彩融合、高光细节）。',
      badge: '创建 (Create)',
      badgeColor: 'border-cyan-500/30 text-cyan-500 bg-cyan-500/5',
    },
    {
      id: 'step2',
      phase: '阶段 2 · 眼睛组件局部重画',
      command: '把眼睛改成紫色',
      outcome: '仅重置“线稿、铺色、水彩、细节”层中的眼部组件模型参数，其他区域（长蓝发、肤色等）完全保留。',
      badge: '局部修改 (Edit Component)',
      badgeColor: 'border-purple-500/30 text-purple-500 bg-purple-500/5',
    },
    {
      id: 'step3',
      phase: '阶段 3 · 戴圆框眼镜 (增加部件)',
      command: '戴上一副红框大圆眼镜',
      outcome: '在原人物线稿层与细节层上，精准覆盖矢量红框眼镜组件并带有光泽投影。',
      badge: '组件增删 (Accessories)',
      badgeColor: 'border-pink-500/30 text-pink-550 bg-pink-550/5',
    },
    {
      id: 'step4',
      phase: '阶段 4 · 表情语义改写',
      command: '表情换成害羞，再添加红彤彤的腮红',
      outcome: '嘴角曲线重绘、两颊覆上精细径向渐变日本动漫风阴影腮红。',
      badge: '表情重绘 (Emotion update)',
      badgeColor: 'border-amber-500/35 text-amber-650 bg-amber-500/5',
    },
    {
      id: 'step5',
      phase: '阶段 5 · 换发色',
      command: '把头发改成粉红色吧',
      outcome: '全图层发缕色浆及矢量发丝高光瞬间重排（变为蜜桃粉红），不波及五官及衣服。',
      badge: '着色替换 (Recolor Hair)',
      badgeColor: 'border-emerald-500/30 text-emerald-650 bg-emerald-500/5',
    },
  ];

  return (
    <div className={`w-full ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} rounded-xl overflow-hidden shadow-xl`} id="demo-scenarios-panel">
      {/* Panel Header (Clickable toggle) */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`w-full text-left p-4 border-b ${isLightMode ? 'border-[#e2e8f0] bg-slate-50 hover:bg-slate-100/80' : 'border-[#23232d] bg-[#16161f] hover:bg-[#1b1b26]'} transition-colors focus:outline-none cursor-pointer`}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className={`font-sans font-semibold text-xs ${isLightMode ? 'text-slate-800' : 'text-[#e2e8f0]'} tracking-wide uppercase`}>
            评委路演快捷剧本模拟 (Demonstration)
          </span>
        </div>
        <div className={`flex items-center gap-1.5 text-[10px] font-mono ${isLightMode ? 'text-slate-600 bg-slate-200' : 'text-slate-400 bg-black/40'} border border-white/5 py-0.5 px-2 rounded`}>
          <span>{isCollapsed ? '展开脚本' : '收起脚本'}</span>
          {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </button>

      {/* Confirmation Bar if pending confirmation (Always prominent regardless of collapse status) */}
      {isAwaitingConfirm && (
        <div className="m-3 p-3 bg-gradient-to-r from-purple-900/10 via-indigo-900/10 to-transparent border border-purple-300 rounded-lg flex items-center justify-between gap-4 animate-pulse z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-600">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-900">AI 已就绪：等待您口语确认指令</p>
              <p className="text-[10px] text-indigo-700">您可以直接说“确认”或点击右侧</p>
            </div>
          </div>
          <button
            onClick={onSimulateConfirm}
            className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white px-4.5 py-1.5 rounded-md text-xs font-extrabold shadow-lg transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            <span>模拟点击 [确认执行]</span>
          </button>
        </div>
      )}

      {/* Collapsed State Quick Preview */}
      {isCollapsed && !isAwaitingConfirm && (
        <div className={`p-3 ${isLightMode ? 'bg-[#ffffff] hover:bg-slate-50/50 text-slate-800' : 'bg-[#111115] hover:bg-white/[0.01] text-slate-300'} transition-all flex items-center justify-between gap-3 text-xs`}>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
            <span className={`leading-tight shrink-0 font-bold ${isLightMode ? 'text-slate-600' : 'text-cyan-400'}`}>推荐第一步口令：</span>
            <span className="truncate italic max-w-[190px]">“画一个蓝色长发女生”</span>
          </div>
          <button
            disabled={systemState === '绘画中'}
            onClick={() => onSimulateCommand('画一个蓝色长发的二次元女生半身头像，水彩素描风')}
            className={`text-[10px] ${isLightMode ? 'bg-cyan-100 border-cyan-300 text-cyan-800' : 'bg-cyan-500/15 border border-cyan-500/20 text-[#7dd3fc]'} font-bold px-2.5 py-1 rounded hover:bg-cyan-500 hover:text-black transition-colors shrink-0`}
          >
            模拟说出
          </button>
        </div>
      )}

      {/* Trigger list Details - Shown only when expanded */}
      {!isCollapsed && (
        <div className={`p-3.5 space-y-3.5 border-t ${isLightMode ? 'border-slate-200 bg-slate-50/50' : 'border-[#1a1a24] bg-neutral-950/20'}`}>
          <p className={`text-[11px] ${isLightMode ? 'text-slate-600 bg-slate-100 border-[#cbd5e1]' : 'text-neutral-500 bg-[#15151e] border-[#1d1d28]'} p-2.5 rounded border leading-relaxed`}>
            📌 <strong className={isLightMode ? 'text-slate-800' : 'text-neutral-400'}>演示小贴士：</strong>
            极客路演推荐分五步连贯发出下面剧本指令。点击卡片右侧的
            <span className="text-sky-505 font-mono px-1 font-semibold">模拟说出</span>
            ，主画布中会当即悬浮展现并拆解 ASR 意图，随后您只需要顺从画笔直接说 <strong className="text-purple-600 font-medium">“确认”</strong> 或者点击浮窗“确认开始”即可！
          </p>

          <div className="grid grid-cols-1 gap-3">
            {scenarios.map((sc, index) => {
              const isDisabled =
                systemState === '思考中' ||
                systemState === '等待确认' ||
                (systemState === '绘画中' && sc.id === 'step1');

              return (
                <div
                  key={sc.id}
                  className={`group p-3 rounded-lg border ${isLightMode ? 'bg-[#ffffff] border-slate-200 hover:border-slate-350 shadow-sm' : 'bg-[#16161f] border-[#1e1e27] hover:border-[#353b4d]'} transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-[0_2px_6px_rgba(0,0,0,0.15)] animate-fade-in`}
                >
                  {/* Content info */}
                  <div className="flex-1 space-y-1.5 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-mono text-neutral-500 font-bold">
                        0{index + 1} · {sc.phase}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${sc.badgeColor}`}>
                        {sc.badge}
                      </span>
                    </div>

                    <div className="flex gap-1.5 items-start">
                      <MessageSquare className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                      <p className={`text-xs font-sans font-semibold ${isLightMode ? 'text-slate-800' : 'text-slate-200'} leading-snug`}>
                        "{sc.command}"
                      </p>
                    </div>

                    <p className={`text-[10px] ${isLightMode ? 'text-slate-500' : 'text-neutral-400'} leading-relaxed pl-5 font-sans`}>
                      {sc.outcome}
                    </p>
                  </div>

                  {/* Simulated action trigger */}
                  <button
                    disabled={isDisabled}
                    onClick={() => onSimulateCommand(sc.command)}
                    className={`flex items-center gap-1.5 py-2 px-3.5 rounded-lg text-xs font-sans font-semibold border transition-all shrink-0 ${
                      isDisabled
                        ? 'bg-neutral-800/40 border-neutral-800 text-neutral-600 cursor-not-allowed'
                        : isLightMode
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-[#fff] active:scale-95 cursor-pointer shadow-md'
                        : 'bg-indigo-500/15 border-indigo-500/25 text-[#7dd3fc] hover:bg-indigo-500 hover:text-[#000] active:scale-95 cursor-pointer shadow-md'
                    }`}
                    title="模拟麦克风 input 该命令文本"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>模拟说出</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
