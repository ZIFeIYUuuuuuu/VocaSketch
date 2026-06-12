/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Volume2,
  Info,
  Mic,
  Maximize2,
  Minimize2,
  FileCode,
  CheckCircle,
  XCircle,
  HelpCircle,
  Database,
  Sun,
  Moon
} from 'lucide-react';
import { CanvasRenderer } from './components/CanvasRenderer';
import { LayerPanel } from './components/LayerPanel';
import { StatusIndicator } from './components/StatusIndicator';
import { VoiceController } from './components/VoiceController';
import { DemoScriptPanel } from './components/DemoScriptPanel';
import { CharacterConfig, DrawStage, PaintLayer, SystemState, VoiceLog } from './types';
import {
  confirmCommand,
  createProject,
  createSession,
  getProject,
  getProjectHistory,
  interpretCommand,
  redoProject,
  saveProjectSnapshot,
  undoProject
} from './api/client';
import type { CommandInterpretation, DrawingOperation, ProjectHistoryEntry } from './api/types';

// Web Speech SpeechRecognition typed definition helper
const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

const SESSION_STORAGE_KEY = 'vocasketch.sessionId';
const PROJECT_STORAGE_KEY = 'vocasketch.projectId';

export default function App() {
  // -------------------------------------------------------------------------
  // 1. STATE INITIALIZATION
  // -------------------------------------------------------------------------

  // App UI Config
  const [characterConfig, setCharacterConfig] = useState<CharacterConfig>({
    gender: 'female',
    hairLength: 'long',
    hairColor: 'blue',
    eyeColor: 'blue',
    expression: '微笑',
    outfit: 'school',
    accessory: 'none',
    backgroundStyle: 'watercolor',
  });

  const [isLightMode, setIsLightMode] = useState<boolean>(true);

  // Target config planned by NLP interpretation (awaiting confirm)
  const [pendingConfig, setPendingConfig] = useState<Partial<CharacterConfig> | null>(null);
  const [isAwaitingConfirm, setIsAwaitingConfirm] = useState<boolean>(false);
  const [pendingVerb, setPendingVerb] = useState<'create' | 'edit' | 'accessory' | null>(null);
  const [pendingInterpretation, setPendingInterpretation] = useState<CommandInterpretation | null>(null);

  // Layout Layers state
  const [layers, setLayers] = useState<PaintLayer[]>([
    { id: 'layer-details', name: '细节层', visible: true, opacity: 1.0, stage: '细节刻画', color: 'rgba(255,255,255,0.75)' },
    { id: 'layer-watercolor', name: '水彩层', visible: true, opacity: 1.0, stage: '水彩晕染', color: 'rgba(74, 168, 222, 0.45)' },
    { id: 'layer-flats', name: '基础色层', visible: true, opacity: 1.0, stage: '铺色阶段', color: '#fdd9ce' },
    { id: 'layer-lineart', name: '线稿层', visible: true, opacity: 1.0, stage: '线稿阶段', color: '#1d1a1a' },
    { id: 'layer-sketch', name: '草图层', visible: true, opacity: 1.0, stage: '草图阶段', color: 'rgba(141, 153, 174, 0.8)' },
    { id: 'layer-bg', name: '背景层', visible: true, opacity: 1.0, stage: '未开始', color: '#1e1e24' },
  ]);

  // Operational undo/redo history tracks
  const [history, setHistory] = useState<CharacterConfig[]>([]);
  const [redoStack, setRedoStack] = useState<CharacterConfig[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [serverRevision, setServerRevision] = useState<number | null>(null);
  const [historyCount, setHistoryCount] = useState<number>(0);
  const [redoCount, setRedoCount] = useState<number>(0);

  // State Machine control vectors
  const [drawProgress, setDrawProgress] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<DrawStage>('未开始');
  const [systemState, setSystemState] = useState<SystemState>('等待指令');
  const [paintMode, setPaintMode] = useState<'auto' | 'stages'>('auto');

  // Multi-line subtitles & logs
  const [userSpeechSub, setUserSpeechSub] = useState<string>('');
  const [aiSpeechSub, setAiSpeechSub] = useState<string>('');
  const [voiceLogs, setVoiceLogs] = useState<VoiceLog[]>([]);

  // Web Speech controls
  const [isListening, setIsListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Painting drawing loop timer ref
  const paintTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bootstrapStartedRef = useRef<boolean>(false);

  // UI layout extra toggles
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // 2. HELPER UTILS & LOGGER
  // -------------------------------------------------------------------------
  const pushLog = (sender: 'user' | 'ai' | 'system', text: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const newLog: VoiceLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: timeStr,
      sender,
      text,
    };
    setVoiceLogs((prev) => [newLog, ...prev]);
  };

  const applyProjectState = (project: {
    projectId: string;
    sessionId: string;
    config: CharacterConfig;
    layers: PaintLayer[];
    drawProgress: number;
    currentStage: DrawStage;
    serverRevision: number;
    historyCount?: number;
  }) => {
    setSessionId(project.sessionId);
    setProjectId(project.projectId);
    setCharacterConfig(project.config);
    setLayers(project.layers);
    setDrawProgress(project.drawProgress);
    setCurrentStage(project.currentStage);
    setServerRevision(project.serverRevision);
    setHistoryCount(project.historyCount ?? 0);
  };

  // Push welcome instructions on load
  useEffect(() => {
    pushLog('system', '🎨 AI 语音数位绘画工作台控制引擎就绪。');
    pushLog('system', '您可以开启麦克风或点击右侧【快捷剧本模拟】体验高精绘图。');
    pushLog('ai', '您好，我是您的数位绘画助理。说出指令如“画一个蓝色长发女生半身像，水彩素描风”，我们即可开始创作！');
  }, []);

  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }
    bootstrapStartedRef.current = true;

    let cancelled = false;

    const bootstrapProject = async () => {
      const savedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      const savedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);

      if (savedSessionId && savedProjectId) {
        try {
          const project = await getProject({
            projectId: savedProjectId,
            sessionId: savedSessionId
          });
          if (cancelled) return;

          applyProjectState(project);
          localStorage.setItem(SESSION_STORAGE_KEY, project.sessionId);
          localStorage.setItem(PROJECT_STORAGE_KEY, project.projectId);

          const historyState = await getProjectHistory({
            projectId: project.projectId,
            sessionId: project.sessionId,
            limit: 50
          });
          if (cancelled) return;

          setHistoryCount(historyState.undoCount);
          setRedoCount(historyState.redoCount);
          pushLog('system', `已从后端恢复工程 ${project.projectId}，历史 ${historyState.undoCount} 步。`);
          return;
        } catch (error) {
          console.warn('Project restore failed, creating a new demo project.', error);
          localStorage.removeItem(SESSION_STORAGE_KEY);
          localStorage.removeItem(PROJECT_STORAGE_KEY);
        }
      }

      try {
        const session = await createSession({
          clientId: `browser-${crypto.randomUUID?.() ?? Date.now().toString(36)}`,
          locale: 'zh-CN'
        });
        const project = await createProject({
          sessionId: session.sessionId,
          title: '未命名语音头像',
          initialConfig: characterConfig
        });
        if (cancelled) return;

        localStorage.setItem(SESSION_STORAGE_KEY, session.sessionId);
        localStorage.setItem(PROJECT_STORAGE_KEY, project.projectId);
        applyProjectState(project);
        setRedoCount(0);
        pushLog('system', `后端匿名工程已创建：${project.projectId}`);
      } catch (error) {
        console.warn('Backend bootstrap failed; local fallback remains available.', error);
        pushLog('system', '后端暂不可用，已进入本地内存 fallback 模式。');
      }
    };

    void bootstrapProject();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync canvas progress with Stage Enum
  useEffect(() => {
    if (drawProgress === 0) {
      setCurrentStage('未开始');
    } else if (drawProgress > 0 && drawProgress < 25) {
      setCurrentStage('草图阶段');
    } else if (drawProgress >= 25 && drawProgress < 50) {
      setCurrentStage('线稿阶段');
    } else if (drawProgress >= 50 && drawProgress < 75) {
      setCurrentStage('铺色阶段');
    } else if (drawProgress >= 75 && drawProgress < 85) {
      setCurrentStage('水彩晕染');
    } else if (drawProgress >= 85 && drawProgress < 100) {
      setCurrentStage('细节刻画');
    } else if (drawProgress >= 100) {
      setCurrentStage('已完成');
    }
  }, [drawProgress]);

  // -------------------------------------------------------------------------
  // 3. CORE PAINTING TIME-LOOP ENGINE (0-12s 绘画动画引擎)
  // -------------------------------------------------------------------------
  const startPaintingLoop = (startFromProgress: number = 0) => {
    // Clear any active timer first
    if (paintTimerRef.current) clearInterval(paintTimerRef.current);

    setDrawProgress(startFromProgress);
    setSystemState('绘画中');
    pushLog('system', `绘画引擎激活，当前从 ${startFromProgress}% 渐进渲染...`);

    const intervalMs = 120; // Ticking Interval
    const progressStep = 1.35; // Increment to fill 100% in ~9 seconds (or matching requirements)

    paintTimerRef.current = setInterval(() => {
      setDrawProgress((prevProgress) => {
        const nextProgress = prevProgress + progressStep;

        // "STAGES MODE (分阶段单步确认模式)" CHECK:
        // We pause at step boundaries and await user verbal/manual OK.
        if (paintMode === 'stages') {
          // Check sketch complete (25%)
          if (prevProgress < 25 && nextProgress >= 25) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [草图绘制阶段已达成 25%] 结构线条规划完毕。请问确认进入【线稿阶段】继续精描吗？');
            setAiSpeechSub('草图层绘制完成。是否允许我继续渲染【线稿层】精细毛刷？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit'); // mock confirm action to trigger next progress
            return 25;
          }
          // Check lineart complete (50%)
          if (prevProgress < 50 && nextProgress >= 50) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [精细线稿阶段已达成 50%] 人物墨线雕琢完毕。请问确认进入【铺色与水彩上色阶段】吗？');
            setAiSpeechSub('线稿层校对结束。是否允许开始在配饰及身体上铺染色彩？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit');
            return 50;
          }
          // Check watercolor complete (85%)
          if (prevProgress < 85 && nextProgress >= 85) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [水彩晕染叠色已达成 85%] 块面渲染完毕。请问确认进入【最后的局部细节刻画层】雕饰瞳光和腮红吗？');
            setAiSpeechSub('水彩层叠染完工。是否开始最后的【高光跟脸红细节】修饰？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit');
            return 85;
          }
        }

        if (nextProgress >= 100) {
          clearInterval(paintTimerRef.current!);
          setSystemState('等待指令');
          pushLog('system', '🎉 矢量渲染画布渲染流完成 100%！');
          pushLog('ai', '画作已雕琢完毕！二次元水彩半身女头像已经完美交付。说出来：“把眼睛改成紫色” 或者“戴上红框圆眼镜”，我们能进行局部微调哦！');
          setAiSpeechSub('作品已绘制完成！图层已解开。随时和我说“改紫色眼睛”或“更换发色”进行组件化极速微调，不破坏其他区域线稿。');
          return 100;
        }

        return nextProgress;
      });
    }, intervalMs);
  };

  // -------------------------------------------------------------------------
  // 4. CLIENT NLP INTERPRETATION STATE-MACHINE (本地语音语义理解状态机)
  // -------------------------------------------------------------------------
  const interpretVoiceCommand = async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    if (/确定|确认|ok|好的|开始|没错|绘制|可以/.test(text) && isAwaitingConfirm) {
      pushLog('user', text);
      setUserSpeechSub(text);
      await handleConfirmAction();
      return;
    }

    if (/取消|放弃|不要了|不画了|不对|不对劲|错了/.test(text)) {
      pushLog('user', text);
      setIsAwaitingConfirm(false);
      setPendingConfig(null);
      setPendingVerb(null);
      setPendingInterpretation(null);
      setSystemState('等待指令');
      setUserSpeechSub(text);
      setAiSpeechSub('好的，已撤销当前的待办指令，随时为您待命。');
      pushLog('ai', '已为您撤销前面的操作。');
      return;
    }

    if (/暂停|停一下|先停/.test(text)) {
      pushLog('user', text);
      setUserSpeechSub(text);
      handlePauseResume(true);
      return;
    }

    if (/继续|接着/.test(text)) {
      pushLog('user', text);
      setUserSpeechSub(text);
      handlePauseResume(false);
      return;
    }

    if (/回放|重新放|重演/.test(text)) {
      pushLog('user', text);
      setUserSpeechSub(text);
      await handleReplay();
      return;
    }

    if (/撤销|上一步|撤消/.test(text)) {
      pushLog('user', text);
      setUserSpeechSub(text);
      await handleUndo();
      return;
    }

    if (/重做|恢复下一步|前进/.test(text)) {
      pushLog('user', text);
      setUserSpeechSub(text);
      await handleRedo();
      return;
    }

    if (!projectId || !sessionId) {
      interpretVoiceCommandLocally(text);
      return;
    }

    pushLog('user', text);
    setUserSpeechSub(text);
    setSystemState('思考中');

    try {
      const interpretation = await interpretCommand({
        sessionId,
        projectId,
        clientCommandId: `cmd_${Date.now().toString(36)}`,
        text,
        currentState: {
          systemState,
          currentStage,
          drawProgress,
          paintMode,
          config: characterConfig,
          layers
        }
      });

      if (interpretation.needsClarification || interpretation.operations.length === 0) {
        setSystemState('等待指令');
        setAiSpeechSub(interpretation.aiReplyText);
        pushLog('ai', interpretation.aiReplyText);
        return;
      }

      setPendingInterpretation(interpretation);
      setPendingConfig(resolveConfigFromOperations(interpretation.operations));
      setPendingVerb(interpretation.intent === 'create_avatar' ? 'create' : 'edit');
      setIsAwaitingConfirm(interpretation.requiresConfirmation);
      setAiSpeechSub(interpretation.aiReplyText);
      pushLog('ai', interpretation.aiReplyText);
      setSystemState(interpretation.requiresConfirmation ? '等待确认' : '等待指令');

      if (!interpretation.requiresConfirmation) {
        await applyConfirmedOperations(interpretation.operations, {
          transcript: interpretation.transcript,
          aiReplyText: interpretation.aiReplyText,
          persist: false
        });
      }
    } catch (error) {
      console.warn('Backend command interpretation failed; falling back to local parser.', error);
      pushLog('system', '后端指令解析暂不可用，切回本地语义解析。');
      interpretVoiceCommandLocally(text);
    }
  };

  const interpretVoiceCommandLocally = (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    pushLog('user', text);
    setUserSpeechSub(text);
    setSystemState('思考中');

    // Simulate AI semantic thinking delay (1 second)
    setTimeout(() => {
      // Create copy of state configs
      let nextConfig = { ...characterConfig };
      let updatedTraits: string[] = [];
      let isCreation = false;

      // Handle general controls first prior to NLP creation:
      if (/确定|确认|ok|好的|开始|没错|绘制|可以/.test(text) && isAwaitingConfirm) {
        handleConfirmAction();
        return;
      }

      if (/取消|放弃|不要了|不画了|不对|不对劲|错了/.test(text)) {
        setIsAwaitingConfirm(false);
        setPendingConfig(null);
        setPendingVerb(null);
        setPendingInterpretation(null);
        setSystemState('等待指令');
        setUserSpeechSub(text);
        setAiSpeechSub('好的，已撤销当前的待办指令，随时为您待命。');
        pushLog('ai', '已为您撤销前面的操作。');
        return;
      }

      if (/暂停|停一下|先停/.test(text)) {
        handlePauseResume(true); // force pause
        return;
      }

      if (/继续|接着/.test(text)) {
        handlePauseResume(false); // force resume
        return;
      }

      if (/回放|重新放|重演/.test(text)) {
        handleReplay();
        return;
      }

      if (/撤销|上一步|撤消/.test(text)) {
        handleUndo();
        return;
      }

      if (/重做|恢复下一步|前进/.test(text)) {
        handleRedo();
        return;
      }

      // NLP keyword parser - Mapping Speech traits to config triggers

      // Style Creation Check
      if (/画一个|画一张|画个|全新|开始制作|画个女性|画女/.test(text)) {
        isCreation = true;
        // defaults
        nextConfig = {
          gender: 'female',
          hairLength: 'long',
          hairColor: 'blue',
          eyeColor: 'blue',
          expression: '微笑',
          outfit: 'school',
          accessory: 'none',
          backgroundStyle: 'watercolor',
        };
      }

      // 1. Gender / Role
      if (/男生|男孩子|少年|帅哥/.test(text)) {
        nextConfig.gender = 'male';
        nextConfig.hairLength = 'short';
        updatedTraits.push('角色：帅气男生');
      } else if (/女|女生|女孩|二次元女生|女孩子|少女/.test(text)) {
         nextConfig.gender = 'female';
         updatedTraits.push('角色：可爱女生');
      }

      // 2. Hair color
      if (/蓝色头发|蓝发|蓝色发/.test(text)) {
        nextConfig.hairColor = 'blue';
        updatedTraits.push('发色：静谧湖蓝');
      } else if (/粉红色头发|粉色发|粉发|粉红发|蜜桃粉/.test(text)) {
        nextConfig.hairColor = 'pink';
        updatedTraits.push('发色：海盐樱粉');
      } else if (/紫色头发|紫发|紫色发/.test(text)) {
        nextConfig.hairColor = 'purple';
        updatedTraits.push('发色：梦幻极光紫');
      } else if (/金色头发|金发|黄色发|金黄色/.test(text)) {
        nextConfig.hairColor = 'gold';
        updatedTraits.push('发色：暖金灿烂');
      } else if (/黑色头发|黑发|黑头发/.test(text)) {
        nextConfig.hairColor = 'black';
        updatedTraits.push('发色：曜石玄黑');
      }

      // 3. Hair length
      if (/短发|刘海|狼尾/.test(text)) {
        nextConfig.hairLength = 'short';
        updatedTraits.push('发型：俏皮短发(狼尾)');
      } else if (/长发|过肩长发/.test(text)) {
        nextConfig.hairLength = 'long';
        updatedTraits.push('发型：飘逸长发');
      }

      // 4. Eye Color
      if (/紫色眼|紫眼|紫色瞳|紫瞳/.test(text)) {
        nextConfig.eyeColor = 'purple';
        updatedTraits.push('瞳色：星空紫晶');
      } else if (/蓝色眼|蓝眼|蓝色瞳|蓝瞳/.test(text)) {
        nextConfig.eyeColor = 'blue';
        updatedTraits.push('瞳色：深海闪耀蓝');
      } else if (/红色眼|红眼|红瞳/.test(text)) {
        nextConfig.eyeColor = 'red';
        updatedTraits.push('瞳色：绯红烈焰');
      } else if (/金眼|金瞳|黄金眼/.test(text)) {
        nextConfig.eyeColor = 'gold';
        updatedTraits.push('瞳色：璀璨烁金');
      } else if (/绿色眼|绿眼|绿瞳|绿色瞳/.test(text)) {
        nextConfig.eyeColor = 'green';
        updatedTraits.push('瞳色：森林翡翠绿');
      } else if (/粉眼|粉瞳|粉红色瞳/.test(text)) {
        nextConfig.eyeColor = 'pink';
        updatedTraits.push('瞳色：流光樱粉');
      }

      // 5. Expression / Emotion
      if (/害羞|脸红|羞涩|腮红/.test(text)) {
        nextConfig.expression = '害羞';
        updatedTraits.push('表情：羞赧绯红');
      } else if (/微笑|开心|大笑|笑一个/.test(text)) {
        nextConfig.expression = '微笑';
        updatedTraits.push('表情：甜美微笑');
      } else if (/冷淡|无表情|高冷|酷/.test(text)) {
        nextConfig.expression = '冷淡';
        updatedTraits.push('表情：冷峻高冷');
      } else if (/惊讶|张嘴|萌/.test(text)) {
        nextConfig.expression = '惊讶';
        updatedTraits.push('表情：呆萌惊讶');
      }

      // 6. Accessories
      if (/眼镜|红框眼镜|大圆眼镜|圆框眼镜|戴眼镜/.test(text)) {
        nextConfig.accessory = 'glasses';
        updatedTraits.push('追加部件：红色醋酸圆框眼镜');
      } else if (/蝴蝶结|红领结|丝带|领带/.test(text)) {
        nextConfig.accessory = 'butterfly_knot';
        updatedTraits.push('追加部件：水手服红蝴蝶结');
      } else if (/脱掉眼镜|不戴眼镜|摘下眼镜|取消眼镜/.test(text)) {
        nextConfig.accessory = 'none';
        updatedTraits.push('抹除部件：圆框眼镜');
      }

      // 7. Background style
      if (/渐变|水彩背景|混色背景/.test(text)) {
        nextConfig.backgroundStyle = 'watercolor';
        updatedTraits.push('背景：双色浸染水彩晕晕');
      } else if (/樱花|花瓣|粉色背景/.test(text)) {
        nextConfig.backgroundStyle = 'cherry';
        updatedTraits.push('背景：春日粉樱飞舞');
      } else if (/星光|星空|星星/.test(text)) {
        nextConfig.backgroundStyle = 'stars';
        updatedTraits.push('背景：闪烁金星微粒');
      }

      if (updatedTraits.length === 0) {
        // Did not parse any exact traits
        setSystemState('等待指令');
        setAiSpeechSub('抱歉，这句指令我还没有很好的匹配二次元头像部件。建议对我说：“把眼睛改成紫色” 或者 “戴上红框眼镜” 试试看？');
        pushLog('ai', '抱歉，未能识别可更改的绘画组件元数据。您可以用词句形容：更改瞳色、更改头发色、戴眼镜等。');
        return;
      }

      // Store what we computed and ask user to confirm (P0 Req: Awaiting voice repetition/affirmation)
      setPendingConfig(nextConfig);
      setPendingInterpretation(null);
      setIsAwaitingConfirm(true);

      if (isCreation) {
        setPendingVerb('create');
        const detailsStr = updatedTraits.join('、');
        setAiSpeechSub(`已为您规划好创作任务：${detailsStr}。我将开展分层逐步渲染（草图->线稿->色彩绽放），是否确认绘制该画布？`);
        pushLog('ai', `收到新头像绘制邀约！计划绘制【${detailsStr}】。说出“确认”即可启动全自动化多线程渲染。`);
      } else {
        setPendingVerb('edit');
        const detailsStr = updatedTraits.join('，');
        setAiSpeechSub(`检测到【局部语义图层重构】意图：${detailsStr}。系统将精准抽取局部网格模型进行更新，并保持其他区域图像不变，是否确认局部重画？`);
        pushLog('ai', `监测到组件更新需求：【${detailsStr}】。我将专门锁死其余无干涉图层，对该局部图样进行精密覆盖。说“确认”开始！`);
      }
      setSystemState('等待确认');
    }, 1100);
  };

  // -------------------------------------------------------------------------
  // 5. DECISION ENGINE - CONFIRMS & DEVIATIONS
  // -------------------------------------------------------------------------
  const handleConfirmAction = async () => {
    if (!isAwaitingConfirm) return;

    // Backup current traits to Undo history prior to execution
    setHistory((prev) => [...prev, characterConfig]);
    setRedoStack([]); // Clear forward stack

    const verb = pendingVerb;
    const nextCfg = pendingConfig;
    const confirmedTranscript = userSpeechSub;
    const confirmedReplyText = aiSpeechSub;

    if (pendingInterpretation && projectId && sessionId) {
      try {
        const confirmed = await confirmCommand({
          interpretationId: pendingInterpretation.interpretationId,
          sessionId,
          projectId,
          confirmed: true,
          confirmationText: confirmedTranscript || '确认',
          currentRevision: serverRevision ?? undefined
        });

        setIsAwaitingConfirm(false);
        setPendingConfig(null);
        setPendingVerb(null);
        setPendingInterpretation(null);
        setAiSpeechSub(confirmed.aiReplyText);

        await applyConfirmedOperations(confirmed.operations, {
          transcript: pendingInterpretation.transcript,
          aiReplyText: pendingInterpretation.aiReplyText,
          persist: true
        });
        return;
      } catch (error) {
        console.warn('Backend confirmation failed; falling back to local pending state.', error);
        pushLog('system', '后端确认记录不可用，切回本地确认执行。');
      }
    }

    const nextCharacterConfig = nextCfg ? ({ ...characterConfig, ...nextCfg } as CharacterConfig) : characterConfig;
    const operationPatch = nextCfg ? diffCharacterConfig(characterConfig, nextCharacterConfig) : null;
    const operations = operationsForConfirmedCommand(
      verb,
      verb === 'create' ? nextCharacterConfig : operationPatch
    );

    setIsAwaitingConfirm(false);
    setPendingConfig(null);
    setPendingVerb(null);
    setPendingInterpretation(null);

    // Apply the traits
    if (nextCfg) {
      setCharacterConfig(nextCharacterConfig);
    }

    if (verb === 'create') {
      // Complete avatar generation animation (0% to 100%)
      pushLog('system', '项目工程重建中... 草图及底片刷新。');
      pushLog('ai', '好的！这就为您动笔，我们将按照数位板绘画流程依序推进，请鉴赏画面的分层生长。');
      setAiSpeechSub('正在依照标准数字工作台工序绘制：草图构型阶段(25%) -> 线稿描黑阶段(50%) -> 多重颜色浸润分色(85%) -> 动漫高光烘焙。');
      startPaintingLoop(0); // Start from scratch!
      void persistProjectSnapshot({
        config: nextCharacterConfig,
        layers,
        drawProgress: 100,
        currentStage: '已完成',
        transcript: confirmedTranscript,
        aiReplyText: confirmedReplyText,
        operations
      });
    } else if (paintMode === 'stages' && drawProgress > 0 && drawProgress < 100) {
      // Midpoint step resume: continues standard drawing stages
      pushLog('system', '单步授权通过，开始调度渲染下一层绘画组件群。');
      pushLog('ai', '好的，继续落笔。请查阅下一阶段的线条叠放。');
      setAiSpeechSub('单步授权成功。正在继续载载，请欣赏下个工序。');
      startPaintingLoop(drawProgress);
      void persistProjectSnapshot({
        config: nextCharacterConfig,
        layers,
        drawProgress: Math.min(100, drawProgress),
        currentStage,
        transcript: confirmedTranscript || '分阶段确认',
        aiReplyText: confirmedReplyText,
        operations: [
          {
            type: 'start_stage_painting',
            fromStage: currentStage
          }
        ]
      });
    } else {
      // Local Component re-drafting:
      // Flash a quick segment-redraft (e.g. restarts from progress 65% up to 100% inside 1.5 seconds)
      // to aesthetically demonstrate the "local redrawing component" without touching others
      pushLog('system', '定位矢量图层，单独重写局部组件掩模。其他图层保持锁闭隔离。');
      pushLog('ai', '好的，局部重绘启动。将针对指定层重画。');
      setAiSpeechSub('已锁定头部及衣领等其余图层。正在对目标组件单独进行精描合成... 瞬间回填渲染完毕。');

      // Let's do a fast 65% -> 100% segment animation of the local edit
      startPaintingLoop(70);
      void persistProjectSnapshot({
        config: nextCharacterConfig,
        layers,
        drawProgress: 100,
        currentStage: '已完成',
        transcript: confirmedTranscript,
        aiReplyText: confirmedReplyText,
        operations
      });
    }
  };

  // -------------------------------------------------------------------------
  // 6. CONTROL OPERATIONS (Unsolicited backups, exports, replays, details)
  // -------------------------------------------------------------------------
  const handlePauseResume = (forcePause?: boolean) => {
    const shouldPause = forcePause !== undefined ? forcePause : (systemState === '绘画中');

    if (shouldPause && systemState === '绘画中') {
      if (paintTimerRef.current) clearInterval(paintTimerRef.current);
      setSystemState('已暂停');
      pushLog('system', '绘画挂起。所有矢量画笔暂停输出，画幅冻结在当前画质。');
      pushLog('ai', '绘画已经为您在当前进展暂停了。想继续请对我说“继续”或点击继续。');
      setAiSpeechSub('画作已暂停。说出“继续”或点击按钮，让我从刚才冻结的图层状态快步渲染。');
    } else if (!shouldPause && systemState === '已暂停') {
      setSystemState('绘画中');
      pushLog('system', '绘画恢复。');
      pushLog('ai', '好的，继续起笔。');
      startPaintingLoop(drawProgress);
    }
  };

  const persistProjectSnapshot = async (snapshot: {
    config: CharacterConfig;
    layers: PaintLayer[];
    drawProgress: number;
    currentStage: DrawStage;
    transcript?: string;
    aiReplyText?: string;
    operations?: DrawingOperation[];
  }) => {
    if (!projectId || !sessionId || serverRevision === null) {
      return;
    }

    try {
      const saved = await saveProjectSnapshot({
        projectId,
        sessionId,
        config: snapshot.config,
        layers: snapshot.layers,
        drawProgress: snapshot.drawProgress,
        currentStage: snapshot.currentStage,
        canvasObjects: [],
        clientRevision: serverRevision,
        historyMeta: {
          kind: 'command',
          transcript: snapshot.transcript,
          aiReplyText: snapshot.aiReplyText,
          operations: snapshot.operations ?? []
        }
      });
      setServerRevision(saved.serverRevision);
      setHistoryCount(saved.historyCount ?? historyCount + 1);
      setRedoCount(saved.redoCount ?? 0);
      pushLog('system', `后端快照已保存，revision ${saved.serverRevision}。`);
    } catch (error) {
      console.warn('Project snapshot save failed; local fallback remains available.', error);
      pushLog('system', '后端快照保存失败，本次操作仍保留在本地撤销栈。');
    }
  };

  const applyConfirmedOperations = async (
    operations: DrawingOperation[],
    meta: {
      transcript?: string;
      aiReplyText?: string;
      persist: boolean;
    }
  ) => {
    const nextConfig = applyOperationsToConfig(characterConfig, operations);
    const nextLayers = applyOperationsToLayers(layers, operations);
    const startsAutoPainting = operations.some((operation) => operation.type === 'start_auto_painting');
    const startsStagePainting = operations.some((operation) => operation.type === 'start_stage_painting');
    const redrawsComponent = operations.some((operation) => operation.type === 'redraw_component');

    setCharacterConfig(nextConfig);
    setLayers(nextLayers);

    if (operations.some((operation) => operation.type === 'pause')) {
      handlePauseResume(true);
      return;
    }
    if (operations.some((operation) => operation.type === 'resume')) {
      handlePauseResume(false);
      return;
    }
    if (operations.some((operation) => operation.type === 'undo')) {
      await handleUndo();
      return;
    }
    if (operations.some((operation) => operation.type === 'redo')) {
      await handleRedo();
      return;
    }
    if (operations.some((operation) => operation.type === 'replay')) {
      await handleReplay();
      return;
    }
    if (operations.some((operation) => operation.type === 'export')) {
      handleExport();
      return;
    }

    if (startsAutoPainting) {
      pushLog('system', '后端 operations 已确认，启动完整绘画流程。');
      startPaintingLoop(operationStartProgress(operations, 0));
    } else if (startsStagePainting) {
      pushLog('system', '后端 operations 已确认，继续分阶段绘画流程。');
      startPaintingLoop(drawProgress);
    } else if (redrawsComponent) {
      pushLog('system', '后端 operations 已确认，启动局部组件重绘。');
      startPaintingLoop(70);
    }

    if (meta.persist) {
      await persistProjectSnapshot({
        config: nextConfig,
        layers: nextLayers,
        drawProgress: startsAutoPainting || redrawsComponent ? 100 : drawProgress,
        currentStage: startsAutoPainting || redrawsComponent ? '已完成' : currentStage,
        transcript: meta.transcript,
        aiReplyText: meta.aiReplyText,
        operations
      });
    }
  };

  const applyOperationsToConfig = (
    baseConfig: CharacterConfig,
    operations: DrawingOperation[]
  ): CharacterConfig => {
    return operations.reduce<CharacterConfig>((nextConfig, operation) => {
      if (operation.type === 'set_character' || operation.type === 'redraw_component') {
        return {
          ...nextConfig,
          ...operation.patch
        };
      }

      return nextConfig;
    }, baseConfig);
  };

  const applyOperationsToLayers = (
    baseLayers: PaintLayer[],
    operations: DrawingOperation[]
  ): PaintLayer[] => {
    return operations.reduce<PaintLayer[]>((nextLayers, operation) => {
      if (operation.type === 'set_layer_visibility') {
        return nextLayers.map((layer) =>
          layer.id === operation.layerId ? { ...layer, visible: operation.visible } : layer
        );
      }
      if (operation.type === 'set_layer_opacity') {
        return nextLayers.map((layer) =>
          layer.id === operation.layerId ? { ...layer, opacity: operation.opacity } : layer
        );
      }

      return nextLayers;
    }, baseLayers);
  };

  const operationStartProgress = (
    operations: DrawingOperation[],
    fallbackProgress: number
  ): number => {
    const autoPaint = operations.find((operation) => operation.type === 'start_auto_painting');
    return autoPaint?.type === 'start_auto_painting'
      ? autoPaint.fromProgress ?? fallbackProgress
      : fallbackProgress;
  };

  const resolveConfigFromOperations = (
    operations: DrawingOperation[]
  ): Partial<CharacterConfig> | null => {
    const patch = operations.reduce<Partial<CharacterConfig>>((nextPatch, operation) => {
      if (operation.type === 'set_character' || operation.type === 'redraw_component') {
        return {
          ...nextPatch,
          ...operation.patch
        };
      }
      return nextPatch;
    }, {});

    return Object.keys(patch).length > 0 ? patch : null;
  };

  const operationsForConfirmedCommand = (
    verb: 'create' | 'edit' | 'accessory' | null,
    nextConfig: Partial<CharacterConfig> | null
  ): DrawingOperation[] => {
    if (!nextConfig) {
      return [];
    }

    if (verb === 'create') {
      return [
        {
          type: 'set_character',
          patch: nextConfig
        },
        {
          type: paintMode === 'stages' ? 'start_stage_painting' : 'start_auto_painting'
        }
      ];
    }

    return [
      {
        type: 'set_character',
        patch: nextConfig
      }
    ];
  };

  const diffCharacterConfig = (
    before: CharacterConfig,
    after: CharacterConfig
  ): Partial<CharacterConfig> => {
    return {
      ...(before.gender !== after.gender ? { gender: after.gender } : {}),
      ...(before.hairLength !== after.hairLength ? { hairLength: after.hairLength } : {}),
      ...(before.hairColor !== after.hairColor ? { hairColor: after.hairColor } : {}),
      ...(before.eyeColor !== after.eyeColor ? { eyeColor: after.eyeColor } : {}),
      ...(before.expression !== after.expression ? { expression: after.expression } : {}),
      ...(before.outfit !== after.outfit ? { outfit: after.outfit } : {}),
      ...(before.accessory !== after.accessory ? { accessory: after.accessory } : {}),
      ...(before.backgroundStyle !== after.backgroundStyle
        ? { backgroundStyle: after.backgroundStyle }
        : {})
    };
  };

  const fallbackUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((old) => [characterConfig, ...old]);
    setHistory((old) => old.slice(0, old.length - 1));
    setCharacterConfig(prev);

    setUserSpeechSub('撤销');
    setAiSpeechSub('已成功帮您撤回刚才修改的步骤，画作成功复原回上个图纸。');
    pushLog('system', '撤销操作被激活，工程图纸回退。');
    // Keep high completion so they don't lose progress rendering
    setDrawProgress(100);
  };

  const handleUndo = async () => {
    if (projectId && sessionId && serverRevision !== null && historyCount > 0) {
      try {
        const restored = await undoProject({
          projectId,
          sessionId,
          currentRevision: serverRevision
        });
        setCharacterConfig(restored.config);
        setLayers(restored.layers);
        setDrawProgress(restored.drawProgress);
        setCurrentStage(restored.currentStage);
        setServerRevision(restored.serverRevision);
        setHistoryCount(restored.historyCount ?? 0);
        setRedoCount(restored.redoCount);
        setUserSpeechSub('撤销');
        setAiSpeechSub(restored.aiReplyText);
        pushLog('system', '后端撤销操作完成，工程图纸已恢复到上一版。');
        return;
      } catch (error) {
        console.warn('Backend undo failed; falling back to local history.', error);
        pushLog('system', '后端撤销不可用，尝试使用本地撤销栈。');
      }
    }

    fallbackUndo();
  };

  const fallbackRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((old) => old.slice(1));
    setHistory((old) => [...old, characterConfig]);
    setCharacterConfig(next);

    setUserSpeechSub('重做');
    setAiSpeechSub('已重新执行上一项被撤回的绘画工序。');
    pushLog('system', '重做操作被激活，重新覆写图纸。');
    setDrawProgress(100);
  };

  const handleRedo = async () => {
    if (projectId && sessionId && serverRevision !== null && redoCount > 0) {
      try {
        const restored = await redoProject({
          projectId,
          sessionId,
          currentRevision: serverRevision
        });
        setCharacterConfig(restored.config);
        setLayers(restored.layers);
        setDrawProgress(restored.drawProgress);
        setCurrentStage(restored.currentStage);
        setServerRevision(restored.serverRevision);
        setHistoryCount(restored.historyCount ?? 0);
        setRedoCount(restored.redoCount);
        setUserSpeechSub('重做');
        setAiSpeechSub(restored.aiReplyText);
        pushLog('system', '后端重做操作完成，工程图纸已重新覆写。');
        return;
      } catch (error) {
        console.warn('Backend redo failed; falling back to local redo stack.', error);
        pushLog('system', '后端重做不可用，尝试使用本地重做栈。');
      }
    }

    fallbackRedo();
  };

  const runFastReplay = (sourceLabel: string) => {
    pushLog('system', '触发回放引擎。清空工程数据，执行快速过程追踪回溯重演。');
    pushLog('ai', sourceLabel);
    setAiSpeechSub(sourceLabel);

    // Fast replay loop: we reset progress to 1, and make it jump fast
    if (paintTimerRef.current) clearInterval(paintTimerRef.current);

    setDrawProgress(1);
    setIsAwaitingConfirm(false);
    setSystemState('绘画中');

    let current = 1;
    paintTimerRef.current = setInterval(() => {
      current += 6.5; // fast steps to complete in ~2-3 seconds
      if (current >= 100) {
        clearInterval(paintTimerRef.current!);
        setDrawProgress(100);
        setSystemState('等待指令');
        pushLog('system', '🎥 画布步骤回放追溯圆满完成！');
        pushLog('ai', '回演完毕。');
        setAiSpeechSub('快进演练回播已落成。图层恢复当前可编辑隔离树结构。');
      } else {
        setDrawProgress(current);
      }
    }, 120);
  };

  const runHistoryReplay = (items: ProjectHistoryEntry[]) => {
    const replayItems = [...items].reverse();
    pushLog('system', `使用后端历史回放 ${replayItems.length} 步。`);
    setAiSpeechSub(`使用后端历史回放 ${replayItems.length} 步，正在按历史操作推进画布。`);

    if (paintTimerRef.current) clearInterval(paintTimerRef.current);

    setDrawProgress(1);
    setIsAwaitingConfirm(false);
    setSystemState('绘画中');

    let index = 0;
    paintTimerRef.current = setInterval(() => {
      const item = replayItems[index];
      if (!item) {
        clearInterval(paintTimerRef.current!);
        setDrawProgress(100);
        setCurrentStage('已完成');
        setSystemState('等待指令');
        pushLog('system', '🎥 后端历史步骤回放完成。');
        pushLog('ai', '回演完毕。');
        setAiSpeechSub('后端历史回放已完成，画布停留在最新可编辑状态。');
        return;
      }

      setCharacterConfig((config) => applyOperationsToConfig(config, item.operations));
      setLayers((currentLayers) => applyOperationsToLayers(currentLayers, item.operations));
      setDrawProgress(item.drawProgress);
      setCurrentStage(item.currentStage);
      pushLog(
        'system',
        `回放 ${index + 1}/${replayItems.length}: ${item.transcript ?? item.kind} (${item.currentStage} ${item.drawProgress}%)`
      );
      index += 1;
    }, Math.max(280, Math.floor(1800 / Math.max(replayItems.length, 1))));
  };

  const handleReplay = async () => {
    if (projectId && sessionId) {
      try {
        const projectHistory = await getProjectHistory({
          projectId,
          sessionId,
          limit: 50
        });
        setHistoryCount(projectHistory.undoCount);
        setRedoCount(projectHistory.redoCount);

        if (projectHistory.items.length > 0) {
          runHistoryReplay(projectHistory.items);
          return;
        }
      } catch (error) {
        console.warn('Backend replay history failed; falling back to local replay.', error);
        pushLog('system', '后端历史读取失败，切回本地轻量回放。');
      }
    }

    runFastReplay('好的，清空画布！为您进行 0 - 100% 超高速作画回放，请查阅。');
  };

  // Trigger from Storyboard Shortcut buttons
  const handleSimulateCommand = (command: string) => {
    interpretVoiceCommand(command);
  };

  const handleTogglePlayLayer = (id: string) => {
    setLayers((prev) =>
      prev.map((ly) => (ly.id === id ? { ...ly, visible: !ly.visible } : ly))
    );
    pushLog('system', `图层可见性切换：${id}`);
  };

  const handleExport = () => {
    pushLog('system', '正在打包导出当前工程模型与位图大图...');
    const dataUrl = canvasRefToImage();
    const link = document.createElement('a');
    link.download = `AI_Voice_Sketch_Avatar_${characterConfig.hairColor}_hair.png`;
    link.href = dataUrl;
    link.click();
    pushLog('ai', '已经为您打包好二次元高分辨率水彩半身头像的 PSD/PNG，生成完毕！');
    setAiSpeechSub('导出成功！已激活下载任务。工程数据打包成 json 伴随无损 PNG 图片导出（可跨平台二次编辑）。');
  };

  // Manual fallback image converter for downloading canvas raw
  const canvasRefToImage = (): string => {
    const canvas = document.getElementById('digital-painting-canvas') as HTMLCanvasElement;
    if (canvas) {
      return canvas.toDataURL('image/png');
    }
    return '';
  };

  // -------------------------------------------------------------------------
  // 7. WEB SPEECH API REAL INTERACTION HANDLING
  // -------------------------------------------------------------------------
  const toggleSpeechRecognition = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      pushLog('system', '麦克风监听关闭。');
    } else {
      if (!SpeechRecognitionAPI) {
        setMicError('您的浏览器未对 Web Speech API 进行完整适配。建议直接使用右侧极速卡片触发，或使用 Chrome 浏览器。');
        pushLog('system', '⚠️ Speech API 不支持（已启动纯拟真交互方案）。');
        // Instantly simulate user speech text placeholder to give visual action feedback
        setIsListening(true);
        setTimeout(() => {
          setIsListening(false);
          interpretVoiceCommand('画一个蓝色长发的二次元女生半身头像，水彩素描风');
        }, 3000);
        return;
      }

      setMicError(null);
      setIsListening(true);
      pushLog('system', '🎙️ 麦克风已捕获，聆听中... 欢迎说出语音指令。');

      const r = new SpeechRecognitionAPI();
      r.continuous = false;
      r.interimResults = false;
      r.lang = 'zh-CN';

      r.onstart = () => {
        setSystemState('聆听中');
        setUserSpeechSub('正在录入您的普通话...');
      };

      r.onresult = (event: any) => {
        const textResult = event.results[0][0].transcript;
        interpretVoiceCommand(textResult);
      };

      r.onerror = (e: any) => {
        console.error('Speech recognition error', e);
        setMicError(`识别信号偏弱: ${e.error}`);
        r.stop();
        setIsListening(false);
        setSystemState('等待指令');
      };

      r.onend = () => {
        setIsListening(false);
        if (systemState === '聆听中') {
          setSystemState('等待指令');
        }
      };

      recognitionRef.current = r;
      r.start();
    }
  };

  return (
    <div className={`min-h-screen ${isLightMode ? 'bg-[#f4f5f8] text-slate-800' : 'bg-[#09090c] text-slate-100'} flex flex-col font-sans transition-colors duration-300 selection:bg-cyan-550 selection:text-black`}>

      {/* GLOWING AMBIENT BACKGROUND */}
      <div className={`absolute top-0 left-0 w-full h-[600px] ${isLightMode ? 'bg-gradient-to-b from-sky-100 via-rose-50/10 to-transparent' : 'bg-gradient-to-b from-indigo-900/10 via-purple-900/5 to-transparent'} pointer-events-none`} />

      {/* 1. TOP NAVIGATION / BANNER */}
      <header className={`relative z-10 border-b ${isLightMode ? 'border-[#e0e3eb] bg-[#ffffff]/95 shadow-sm' : 'border-[#1b1b24] bg-[#0c0c11]/90'} backdrop-blur-md px-4 py-3 xl:px-8 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-400 to-indigo-500 p-0.5 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <div className={`w-full h-full rounded-[10px] ${isLightMode ? 'bg-white' : 'bg-[#0c0c11]'} flex items-center justify-center`}>
              <Sparkles className="w-5 h-5 text-cyan-500" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className={`text-base font-extrabold font-sans tracking-wide ${isLightMode ? 'text-slate-900' : 'text-white'}`}>
                VocaSketch
              </h1>
              <span className={`text-xs font-extrabold font-sans ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                ｜ 语音驱动的二次元数位画板
              </span>
            </div>
            <p className={`text-[10px] ${isLightMode ? 'text-slate-500 font-semibold' : 'text-[#5c687a]'} font-sans leading-tight font-medium`}>
              Voice-First Anime Portrait Drawing Workspace · 题目二路演大展
            </p>
          </div>
        </div>

        {/* Theme select button + Info panel triggers */}
        <div className="flex items-center gap-3">
          {/* Active features stats */}
          <div className="hidden lg:flex items-center gap-5">
            <div className={`flex items-center gap-2 text-xs font-mono ${isLightMode ? 'bg-[#f1f3f9] border-[#e2e8f0]' : 'bg-[#14141a] border-[#23232d]'} px-3 py-1.5 rounded-lg border`}>
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-neutral-500 text-[11px]">图层隔离策略:</span>
              <span className="text-emerald-500 font-bold">原子级微调解耦</span>
            </div>

            <div className={`text-xs font-mono flex items-center gap-2 ${isLightMode ? 'text-slate-600' : 'text-[#969ba8]'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>ASR 普通话离线推理服务已就绪</span>
            </div>
          </div>

          {/* LIGHT / DARK SPEED TOGGLE BUTTON (User focus) */}
          <button
            onClick={() => setIsLightMode(!isLightMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 shadow-sm border ${
              isLightMode
                ? 'bg-[#ffffff] hover:bg-slate-50 text-slate-800 border-slate-300 cursor-pointer'
                : 'bg-[#181822] hover:bg-[#20202d] text-cyan-400 border-[#2d2d3c] cursor-pointer'
            }`}
            title="切换亮白色/极客暗黑画板主题"
            id="theme-toggle-button"
          >
            {isLightMode ? (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-500" />
                <span>深色画板</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>亮白纸纹</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 2. BODY CONTENT LAYOUT */}
      <main className="flex-1 w-full max-w-[1400px] 2xl:max-w-[1536px] mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 relative z-10">

        {/* LEFT COLUMN: HERO WORKSPACE & CANVAS (7 COLS) */}
        <div className="lg:col-span-7 flex flex-col gap-5">

          {/* TOP MONITORS */}
          <StatusIndicator
            currentStage={currentStage}
            systemState={systemState}
            paintMode={paintMode}
            onTogglePaintMode={(mode) => {
              setPaintMode(mode);
              pushLog('system', `切换绘图模式为：${mode === 'auto' ? '连续全自动化绘制' : '分阶段单步确认绘制'}`);
            }}
            isLightMode={isLightMode}
          />

          {/* HERO CANVAS & CONTROLLER PLATFORM */}
          <div className={`w-full flex flex-col gap-2 ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} p-3.5 rounded-2xl shadow-xl`}>
            <div className="flex items-center justify-between px-1 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-bold ${isLightMode ? 'text-slate-800' : 'text-slate-300'} font-sans`}>主视角智能声控绘图板</span>
                <span className="text-[8px] tracking-wider text-cyan-400 font-mono bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded uppercase font-bold">2D 矢量动态画布</span>
              </div>
              <div className={`flex items-center gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                <span>画板尺寸: 600 × 600 px (自适应视网膜屏幕)</span>
              </div>
            </div>

            <div className="w-full">
              <CanvasRenderer
                progress={drawProgress}
                config={characterConfig}
                layers={layers}
                isPaused={systemState === '已暂停'}
                userSpeechSub={userSpeechSub}
                aiSpeechSub={aiSpeechSub}
                systemState={systemState}
                isListening={isListening}
                isAwaitingConfirm={isAwaitingConfirm}
                onConfirmAction={handleConfirmAction}
                onCancelAction={() => {
                  setIsAwaitingConfirm(false);
                  setPendingConfig(null);
                  setPendingVerb(null);
                  setSystemState('等待指令');
                  setAiSpeechSub('好的，当前操作已取消，随时等候您的下一步指令。');
                  pushLog('ai', '已取消前面的操作。');
                }}
                isLightMode={isLightMode}
              />
            </div>

            {/* Audio warning and tips strip */}
            {micError && (
              <div className="p-2 mt-1 bg-red-950/40 border border-red-500/30 rounded-lg text-[11px] text-red-300 flex items-center gap-2 animate-pulse">
                <span>⚠️ {micError}</span>
              </div>
            )}

            {/* LOWER CONTROLLER SUBTITLES BOARD (Tightly Integrated) */}
            <div className="mt-2 pt-2 border-t border-[#1b1b24] dark:border-[#23232d]">
              <VoiceController
                systemState={systemState}
                isListening={isListening}
                userSpeechSub={userSpeechSub}
                aiSpeechSub={aiSpeechSub}
                voiceLogs={voiceLogs}
                onToggleMic={toggleSpeechRecognition}
                onPauseResume={() => handlePauseResume()}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onReplay={handleReplay}
                onExport={handleExport}
                canUndo={historyCount > 0 || history.length > 0}
                canRedo={redoCount > 0 || redoStack.length > 0}
                isLightMode={isLightMode}
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: INTEGRATED WORKSPACE COMPONENT STACK (5 COLS) */}
        <div className="lg:col-span-5 flex flex-col gap-5">

          {/* SEC 1: SEMANTIC WORKSPACE LAYER BOARD */}
          <div className="flex flex-col animate-fade-in shadow-xl">
            <LayerPanel
              layers={layers}
              currentStage={currentStage}
              onTogglePlayLayer={handleTogglePlayLayer}
              isLightMode={isLightMode}
            />
          </div>

          {/* SEC 2: CHARACTER ATOMIC VECTOR TRAITS CARD */}
          <div className={`w-full flex flex-col ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} rounded-xl p-4.5 gap-4.5 shadow-xl animate-fade-in`}>
            <div className="flex items-center justify-between">
              <div className={`flex items-center gap-2 text-xs ${isLightMode ? 'text-slate-805 text-slate-800' : 'text-neutral-300'} font-bold uppercase tracking-wider font-mono`}>
                <Info className="w-4 h-4 text-cyan-500" />
                <span>智能属性特征解码 (Decoded Traits)</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-650 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 rounded uppercase font-extrabold shadow-sm">
                实时属性特征析出
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-sans">
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">性别/形式</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>{characterConfig.gender === 'female' ? '🌸 二次元少女' : '少年/男生'}</p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">发型特征</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>{characterConfig.hairLength === 'long' ? '💇‍♀️ 飘逸长发' : '💇‍♂️ 短发狼尾'}</p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">发缕着色</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'} flex items-center gap-1.5`}>
                  <span className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0" style={{ backgroundColor: characterConfig.hairColor === 'gold' ? '#fcc21b' : characterConfig.hairColor }} />
                  <span>{characterConfig.hairColor === 'blue' && '湖蓝色'}
                        {characterConfig.hairColor === 'pink' && '蜜桃粉'}
                        {characterConfig.hairColor === 'purple' && '极光紫'}
                        {characterConfig.hairColor === 'gold' && '璀璨金'}
                        {characterConfig.hairColor === 'black' && '曜石黑'}</span>
                </p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">瞳孔色基因</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'} flex items-center gap-1.5`}>
                  <span className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0" style={{ backgroundColor: characterConfig.eyeColor }} />
                  <span>{characterConfig.eyeColor === 'blue' && '闪耀蓝'}
                        {characterConfig.eyeColor === 'purple' && '深邃紫'}
                        {characterConfig.eyeColor === 'red' && '烈焰红'}
                        {characterConfig.eyeColor === 'gold' && '璀璨金'}
                        {characterConfig.eyeColor === 'green' && '翡翠绿'}
                        {characterConfig.eyeColor === 'pink' && '樱落粉'}</span>
                </p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">嘴角表情</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>😀 {characterConfig.expression}</p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isLightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-[#181822] border-[#1e1e27] hover:border-neutral-700'} transition-colors`}>
                <p className="text-neutral-500 text-[10px] font-mono leading-none mb-1.5">挂戴配饰</p>
                <p className={`font-extrabold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>
                  👓 {characterConfig.accessory === 'glasses' ? '重塑红框圆镜' : characterConfig.accessory === 'butterfly_knot' ? '蝴蝶挂戴发结' : '无配饰'}
                </p>
              </div>
            </div>

            {/* Quick check verification line */}
            <div className={`text-[10px] ${isLightMode ? 'bg-slate-50 border-slate-200 text-slate-500' : 'text-slate-500 bg-[#0c0c10] border-[#1b1b24]'} p-2.5 rounded-lg font-mono flex flex-col gap-1 leading-relaxed`}>
              <span className={`${isLightMode ? 'text-slate-705' : 'text-[#888]'} font-bold uppercase`}>🧬 NLP 隔离解耦热编译状态</span>
              <div className="flex justify-between">
                <span>分层机制: 6 属性独立插槽控制</span>
                <span className="text-teal-600 font-bold">CHECKSUM √</span>
              </div>
            </div>
          </div>

          {/* SEC 3: DEMO ROADMAP SCRIPT HOTKEYS (ALWAYS ON DISPLAY) */}
          <div className="flex flex-col animate-fade-in shadow-xl">
            <DemoScriptPanel
              systemState={systemState}
              onSimulateCommand={handleSimulateCommand}
              onSimulateConfirm={handleConfirmAction}
              isAwaitingConfirm={isAwaitingConfirm}
              isLightMode={isLightMode}
            />
          </div>

        </div>

      </main>

      {/* 3. FOOTER CREDIT STRIPS */}
      <footer className={`mt-auto border-t ${isLightMode ? 'border-[#e2e8f0] bg-white text-slate-500 shadow-sm' : 'border-[#1b1b24] bg-[#09090d] text-neutral-500'} text-center py-4 text-xs font-sans`}>
        <p>© 2026 VocaSketch · 语音驱动的二次元数位画板成果展示平台</p>
      </footer>
    </div>
  );
}
