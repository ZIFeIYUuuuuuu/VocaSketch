/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Volume2,
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
import { StatusIndicator } from './components/StatusIndicator';
import { VoiceController } from './components/VoiceController';
import { ProcessPlaybackPlayer } from './components/ProcessPlaybackPlayer';
import {
  computePlaybackElapsed,
  computeStepOpacity,
  pausePlaybackAt,
  restartPlaybackAt,
  resumePlaybackAt,
} from './utils/playback.js';
import {
  buildV2ConfirmationMessage,
  V2_PROGRESS_STEPS,
  describeV2Error,
  formatV2JobTime,
  getV2AssetReadinessLabel,
  getV2ErrorDiagnostic,
  getV2FrameStepLabel,
  getV2ProcessPhaseLabel,
  getV2UserStatus,
  isTerminalV2Status,
  shouldAutoRestoreV2Job,
  summarizeV2Input,
} from './utils/v2DrawingJob.js';
import { CharacterConfig, DrawStage, PaintLayer, SystemState, VoiceLog } from './types';
import {
  buildAssetContentUrl,
  cancelDrawingJob,
  confirmCommand,
  confirmDrawingJob,
  createDrawingJob,
  createProject,
  createSession,
  getAssetMetadata,
  getDrawingJob,
  getProject,
  getProjectHistory,
  getRuntimeReadiness,
  getV2ApiBaseUrl,
  interpretCommand,
  listDrawingJobs,
  redoProject,
  retryDrawingJob,
  saveProjectSnapshot,
  subscribeDrawingJobEvents,
  synthesizeSpeech,
  transcribeAudio,
  undoProject
} from './api/client';
import type {
  AssetRecord,
  CommandInterpretation,
  DrawingJob,
  DrawingJobSummary,
  DrawingOperation,
  JobEvent,
  JobStatus,
  LayerAsset,
  PlaybackManifestStep,
  ProjectHistoryEntry,
  RuntimeReadiness
} from './api/types';

// Web Speech SpeechRecognition typed definition helper
const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

const legacyApiBaseUrl = import.meta.env.VITE_LEGACY_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL;
const drawingApiBaseUrl = getV2ApiBaseUrl();
const SESSION_STORAGE_KEY = 'vocasketch.sessionId';
const PROJECT_STORAGE_KEY = 'vocasketch.projectId';
const V2_JOB_STORAGE_KEY = 'vocasketch.v2JobId';
const V2_EVENT_SEQ_STORAGE_KEY = 'vocasketch.v2LastEventSeq';
const AUTO_RECORD_MAX_MS = 30000;
const AUTO_RECORD_MIN_MS = 900;
const NO_SPEECH_IDLE_TIMEOUT_MS = 5000;
const SILENCE_AFTER_SPEECH_MS = 5000;
const SPEECH_LEVEL_THRESHOLD = 0.035;
const STAGE_BOUNDARIES = {
  sketchDone: 25,
  lineDone: 50,
  flatsDone: 70,
  watercolorDone: 90
} as const;
type RedrawTarget = 'hair' | 'eyes' | 'expression' | 'outfit' | 'accessory' | 'background';
const ENABLE_V2_VOICE_DRAWING = import.meta.env.VITE_ENABLE_V2_VOICE_DRAWING !== 'false';
const ENABLE_LEGACY_V1_BACKEND = import.meta.env.VITE_ENABLE_LEGACY_V1_BACKEND === 'true';

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
  const [pendingV2PromptText, setPendingV2PromptText] = useState<string | null>(null);

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
  const [v2PromptText, setV2PromptText] = useState<string>('');
  const [v2Job, setV2Job] = useState<DrawingJob | null>(null);
  const [v2PreviewAsset, setV2PreviewAsset] = useState<AssetRecord | null>(null);
  const [v2FinalAsset, setV2FinalAsset] = useState<AssetRecord | null>(null);
  const [v2PlaybackManifestAsset, setV2PlaybackManifestAsset] = useState<AssetRecord | null>(null);
  const [v2LastEventType, setV2LastEventType] = useState<JobEvent['type'] | null>(null);
  const [v2EventLog, setV2EventLog] = useState<JobEvent[]>([]);
  const [v2FlowMessage, setV2FlowMessage] = useState<string>('等待创建 v2 drawing job');
  const [v2UiError, setV2UiError] = useState<string | null>(null);
  const [v2UiErrorDiagnostic, setV2UiErrorDiagnostic] = useState<string | null>(null);
  const [v2RecentJobs, setV2RecentJobs] = useState<DrawingJobSummary[]>([]);
  const [v2RecentJobsError, setV2RecentJobsError] = useState<string | null>(null);
  const [isV2RecentJobsLoading, setIsV2RecentJobsLoading] = useState<boolean>(false);
  const [v2RuntimeReadiness, setV2RuntimeReadiness] = useState<RuntimeReadiness | null>(null);
  const [v2RuntimeError, setV2RuntimeError] = useState<string | null>(null);
  const [isV2RuntimeLoading, setIsV2RuntimeLoading] = useState<boolean>(false);
  const [isV2Submitting, setIsV2Submitting] = useState<boolean>(false);
  const [isV2Retrying, setIsV2Retrying] = useState<boolean>(false);
  const [isV2Cancelling, setIsV2Cancelling] = useState<boolean>(false);
  const isV2ActionBusy = isV2Submitting || isV2Retrying || isV2Cancelling;
  const [isV2PlaybackRunning, setIsV2PlaybackRunning] = useState<boolean>(false);
  const [v2PlaybackElapsedMs, setV2PlaybackElapsedMs] = useState<number>(0);
  const [v2PlaybackSessionNonce, setV2PlaybackSessionNonce] = useState<number>(0);

  // State Machine control vectors
  const [drawProgress, setDrawProgress] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<DrawStage>('未开始');
  const [systemState, setSystemState] = useState<SystemState>('等待指令');
  const [paintMode, setPaintMode] = useState<'auto' | 'stages'>('auto');
  const [lastRedrawTarget, setLastRedrawTarget] = useState<RedrawTarget | null>(null);

  // Multi-line subtitles & logs
  const [userSpeechSub, setUserSpeechSub] = useState<string>('');
  const [aiSpeechSub, setAiSpeechSub] = useState<string>('');
  const [voiceLogs, setVoiceLogs] = useState<VoiceLog[]>([]);

  // Web Speech controls
  const [isListening, setIsListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeAudioContextRef = useRef<AudioContext | null>(null);
  const realtimeSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const realtimeProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const realtimeFinalTranscriptRef = useRef<string>('');
  const realtimePartialTranscriptRef = useRef<string>('');
  const realtimeStoppingRef = useRef<boolean>(false);
  const webSpeechFinalTranscriptRef = useRef<string>('');
  const webSpeechInterimTranscriptRef = useRef<string>('');
  const webSpeechSilenceTimerRef = useRef<number | null>(null);
  const webSpeechStopRequestedRef = useRef<boolean>(false);
  const webSpeechFinalizeGuardRef = useRef<boolean>(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorderStopRequestedRef = useRef<boolean>(false);
  const recorderStopHandledRef = useRef<boolean>(false);
  const recorderAutoStopTimerRef = useRef<number | null>(null);
  const recorderLevelTimerRef = useRef<number | null>(null);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const lastSpeechAtRef = useRef<number>(0);
  const hasDetectedSpeechRef = useRef<boolean>(false);

  // Painting drawing loop timer ref
  const paintTimerRef = useRef<NodeJS.Timeout | null>(null);
  const redrawPulseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bootstrapStartedRef = useRef<boolean>(false);
  const v2SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const v2PollTimerRef = useRef<number | null>(null);
  const v2ActiveJobIdRef = useRef<string | null>(null);
  const v2LastEventSeqRef = useRef<number>(0);
  const v2RestoreStartedRef = useRef<boolean>(false);
  const v2AutoAdvanceJobIdRef = useRef<string | null>(null);
  const v2PlaybackRafRef = useRef<number | null>(null);
  const v2PlaybackStartedAtRef = useRef<number | null>(null);
  const v2PlaybackBaseElapsedRef = useRef<number>(0);

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

  const stopV2Polling = () => {
    if (v2PollTimerRef.current !== null) {
      window.clearInterval(v2PollTimerRef.current);
      v2PollTimerRef.current = null;
    }
  };

  const stopV2Subscription = () => {
    v2SubscriptionRef.current?.close();
    v2SubscriptionRef.current = null;
  };

  const stopV2PlaybackLoop = () => {
    if (v2PlaybackRafRef.current !== null) {
      window.cancelAnimationFrame(v2PlaybackRafRef.current);
      v2PlaybackRafRef.current = null;
    }
  };

  const pauseV2Playback = () => {
    const snapshot = pausePlaybackAt(v2PlaybackElapsedMs);
    stopV2PlaybackLoop();
    v2PlaybackBaseElapsedRef.current = snapshot.baseElapsedMs;
    v2PlaybackStartedAtRef.current = snapshot.startedAtMs;
    setIsV2PlaybackRunning(false);
  };

  const resumeV2Playback = () => {
    const snapshot = resumePlaybackAt(v2PlaybackElapsedMs, performance.now());
    v2PlaybackBaseElapsedRef.current = snapshot.baseElapsedMs;
    v2PlaybackStartedAtRef.current = snapshot.startedAtMs;
    setIsV2PlaybackRunning(true);
  };

  const restartV2Playback = () => {
    const snapshot = restartPlaybackAt(performance.now());
    stopV2PlaybackLoop();
    v2PlaybackBaseElapsedRef.current = snapshot.baseElapsedMs;
    v2PlaybackStartedAtRef.current = snapshot.startedAtMs;
    setV2PlaybackElapsedMs(0);
    setIsV2PlaybackRunning(true);
    setV2PlaybackSessionNonce((value) => value + 1);
  };

  const resetV2Playback = () => {
    stopV2PlaybackLoop();
    v2PlaybackStartedAtRef.current = null;
    v2PlaybackBaseElapsedRef.current = 0;
    setIsV2PlaybackRunning(false);
    setV2PlaybackElapsedMs(0);
  };

  const resetV2Tracking = () => {
    stopV2Subscription();
    stopV2Polling();
    stopV2PlaybackLoop();
    v2ActiveJobIdRef.current = null;
    v2LastEventSeqRef.current = 0;
  };

  const shouldAutoAdvanceV2Frames = (job: DrawingJob) =>
    job.status === 'preview_ready' && !job.finalAssetId && !job.playbackManifestAssetId;

  const clearV2UiError = () => {
    setV2UiError(null);
    setV2UiErrorDiagnostic(null);
  };

  const setV2ErrorFromUnknown = (error: unknown, fallbackMessage: string) => {
    const apiError = error as Error & {
      status?: number;
      code?: string;
      retryable?: boolean;
    };
    setV2UiError(apiError.code ? describeV2Error(apiError) : error instanceof Error ? error.message : fallbackMessage);
    setV2UiErrorDiagnostic(getV2ErrorDiagnostic(null, apiError));
  };

  const persistV2CurrentJob = (jobId: string) => {
    localStorage.setItem(V2_JOB_STORAGE_KEY, jobId);
  };

  const clearPersistedV2EventSeq = () => {
    localStorage.removeItem(V2_EVENT_SEQ_STORAGE_KEY);
    v2LastEventSeqRef.current = 0;
  };

  const clearPersistedV2Job = () => {
    localStorage.removeItem(V2_JOB_STORAGE_KEY);
    clearPersistedV2EventSeq();
  };

  const readPersistedV2JobId = () => {
    return localStorage.getItem(V2_JOB_STORAGE_KEY)?.trim() || null;
  };

  const readPersistedV2EventSeq = () => {
    const rawValue = localStorage.getItem(V2_EVENT_SEQ_STORAGE_KEY);
    if (!rawValue) {
      return 0;
    }
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const persistV2EventSeq = (seq: number) => {
    if (!Number.isFinite(seq) || seq <= v2LastEventSeqRef.current) {
      return;
    }
    v2LastEventSeqRef.current = seq;
    localStorage.setItem(V2_EVENT_SEQ_STORAGE_KEY, String(seq));
  };

  const refreshV2RecentJobs = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setIsV2RecentJobsLoading(true);
    }

    try {
      const response = await listDrawingJobs({ limit: 6 });
      setV2RecentJobs(response.items);
      setV2RecentJobsError(null);
    } catch (error) {
      console.warn('Loading recent v2 drawing jobs failed.', error);
      setV2RecentJobsError(error instanceof Error ? error.message : '无法加载最近任务。');
    } finally {
      if (!options.silent) {
        setIsV2RecentJobsLoading(false);
      }
    }
  };

  const refreshV2RuntimeReadiness = async () => {
    setIsV2RuntimeLoading(true);
    try {
      const readiness = await getRuntimeReadiness();
      setV2RuntimeReadiness(readiness);
      setV2RuntimeError(null);
    } catch (error) {
      console.warn('Loading v2 runtime readiness failed.', error);
      setV2RuntimeError(error instanceof Error ? error.message : '无法读取 v2 runtime readiness。');
    } finally {
      setIsV2RuntimeLoading(false);
    }
  };

  const loadV2AssetSet = async (job: DrawingJob) => {
    const [previewAsset, finalAsset, manifestAsset] = await Promise.all([
      job.previewAssetId ? getAssetMetadata(job.previewAssetId).catch(() => null) : Promise.resolve(null),
      job.finalAssetId ? getAssetMetadata(job.finalAssetId).catch(() => null) : Promise.resolve(null),
      job.playbackManifestAssetId ? getAssetMetadata(job.playbackManifestAssetId).catch(() => null) : Promise.resolve(null)
    ]);

    setV2PreviewAsset(previewAsset);
    setV2FinalAsset(finalAsset);
    setV2PlaybackManifestAsset(manifestAsset);
  };

  const clearWebSpeechSilenceTimer = () => {
    if (webSpeechSilenceTimerRef.current !== null) {
      window.clearTimeout(webSpeechSilenceTimerRef.current);
      webSpeechSilenceTimerRef.current = null;
    }
  };

  const finalizeWebSpeechTranscript = (transcriptOverride?: string) => {
    if (webSpeechFinalizeGuardRef.current) {
      return;
    }
    webSpeechFinalizeGuardRef.current = true;
    const transcript = (transcriptOverride ?? webSpeechFinalTranscriptRef.current ?? '').trim();
    clearWebSpeechSilenceTimer();
    webSpeechStopRequestedRef.current = false;
    recognitionRef.current = null;
    setIsListening(false);
    if (transcript) {
      setUserSpeechSub(transcript);
      setSystemState('等待确认');
      pushLog('system', `语音识别完成，等待确认：${transcript}`);
      requestV2DrawingConfirmation(transcript);
      return;
    }
    setSystemState('等待指令');
    setUserSpeechSub('没有听到有效语音，请再试一次。');
  };

  const scheduleWebSpeechFinalize = () => {
    clearWebSpeechSilenceTimer();
    webSpeechSilenceTimerRef.current = window.setTimeout(() => {
      const transcript =
        webSpeechFinalTranscriptRef.current.trim() || webSpeechInterimTranscriptRef.current.trim();
      const recognition = recognitionRef.current;
      webSpeechStopRequestedRef.current = true;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          // ignore stop race
        }
      }
      finalizeWebSpeechTranscript(transcript);
    }, SILENCE_AFTER_SPEECH_MS);
  };

  const describeV2Status = (job: DrawingJob) => {
    return getV2UserStatus(job).message;
  };

  const autoAdvanceV2Frames = async (job: DrawingJob) => {
    if (!shouldAutoAdvanceV2Frames(job) || v2AutoAdvanceJobIdRef.current === job.jobId) {
      return;
    }

    if (!job.requiresConfirmation) {
      setV2FlowMessage('内部构图完成，正在继续生成 10% 到 100% 帧。');
      return;
    }

    v2AutoAdvanceJobIdRef.current = job.jobId;
    setV2FlowMessage('内部构图完成，正在自动进入 10% 到 100% 帧生成。');

    try {
      const advanced = await confirmDrawingJob(job.jobId, {
        selectedPreviewAssetId: job.previewAssetId ?? undefined,
        notes: 'frontend-auto-advance-to-frame-generation'
      });

      if (v2ActiveJobIdRef.current !== job.jobId) {
        return;
      }

      setV2Job(advanced);
      await loadV2AssetSet(advanced);
      setV2FlowMessage(describeV2Status(advanced));
      void refreshV2RecentJobs({ silent: true });
    } catch (error) {
      console.error('Auto advancing v2 drawing job to frame generation failed.', error);
      setV2ErrorFromUnknown(error, '自动进入绘画过程帧生成失败。');
    } finally {
      if (v2AutoAdvanceJobIdRef.current === job.jobId) {
        v2AutoAdvanceJobIdRef.current = null;
      }
    }
  };

  const refreshV2JobSnapshot = async (jobId: string, options: { force?: boolean } = {}) => {
    const job = await getDrawingJob(jobId);
    if (v2ActiveJobIdRef.current !== jobId && !options.force) {
      return job;
    }

    v2ActiveJobIdRef.current = jobId;
    setV2Job(job);
    persistV2CurrentJob(job.jobId);
    clearV2UiError();
    setV2FlowMessage(describeV2Status(job));
    await loadV2AssetSet(job);

    if (shouldAutoAdvanceV2Frames(job)) {
      void autoAdvanceV2Frames(job);
    }

    if (isTerminalV2Status(job.status)) {
      stopV2Polling();
      void refreshV2RecentJobs({ silent: true });
    }

    return job;
  };

  const startV2Polling = (jobId: string) => {
    if (v2PollTimerRef.current !== null) {
      return;
    }

    v2PollTimerRef.current = window.setInterval(() => {
      void refreshV2JobSnapshot(jobId).catch((error) => {
        console.warn('Polling v2 drawing job failed.', error);
      });
    }, 1500);
  };

  const trackV2Job = (jobId: string, options: { afterSeq?: number } = {}) => {
    const resumeAfterSeq = Math.max(0, Math.floor(options.afterSeq ?? v2LastEventSeqRef.current));
    resetV2Tracking();
    v2ActiveJobIdRef.current = jobId;
    v2LastEventSeqRef.current = resumeAfterSeq;
    persistV2CurrentJob(jobId);
    if (resumeAfterSeq > 0) {
      localStorage.setItem(V2_EVENT_SEQ_STORAGE_KEY, String(resumeAfterSeq));
    } else {
      localStorage.removeItem(V2_EVENT_SEQ_STORAGE_KEY);
    }

    const subscription = subscribeDrawingJobEvents(jobId, {
      afterSeq: resumeAfterSeq,
      onOpen: () => {
        if (v2ActiveJobIdRef.current === jobId) {
          setV2FlowMessage('已连接 drawing job 事件流。');
        }
      },
      onEvent: (event) => {
        if (v2ActiveJobIdRef.current !== jobId) {
          return;
        }
        persistV2EventSeq(event.seq);
        setV2LastEventType(event.type);
        setV2EventLog((prev) => [event, ...prev].slice(0, 14));
        void refreshV2JobSnapshot(jobId).catch((error) => {
          console.warn('Refreshing v2 drawing job after event failed.', error);
        });
      },
      onError: (error) => {
        if (v2ActiveJobIdRef.current !== jobId) {
          return;
        }
        console.warn('Drawing job SSE failed, switching to polling.', error);
        setV2FlowMessage('事件流中断，已切换到轮询刷新。');
        startV2Polling(jobId);
      }
    });

    v2SubscriptionRef.current = subscription;
    if (!subscription.usingEventSource) {
      setV2FlowMessage('当前环境不支持 SSE，已启用轮询刷新。');
      startV2Polling(jobId);
    }
  };

  const triggerRedrawPulse = (target: RedrawTarget) => {
    setLastRedrawTarget(target);
    if (redrawPulseTimerRef.current) {
      clearTimeout(redrawPulseTimerRef.current);
    }
    redrawPulseTimerRef.current = setTimeout(() => {
      setLastRedrawTarget(null);
      redrawPulseTimerRef.current = null;
    }, 2000);
  };

  const clearRecorderTimers = () => {
    if (recorderAutoStopTimerRef.current !== null) {
      window.clearTimeout(recorderAutoStopTimerRef.current);
      recorderAutoStopTimerRef.current = null;
    }
    if (recorderLevelTimerRef.current !== null) {
      window.clearInterval(recorderLevelTimerRef.current);
      recorderLevelTimerRef.current = null;
    }
  };

  const closeRecordingAudioContext = () => {
    const audioContext = recordingAudioContextRef.current;
    recordingAudioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close();
    }
  };

  const cleanupRecordingResources = () => {
    clearRecorderTimers();
    closeRecordingAudioContext();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const requestRecorderStop = (reason: 'manual' | 'silence' | 'timeout') => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive' || recorderStopRequestedRef.current) {
      return;
    }

    recorderStopRequestedRef.current = true;
    clearRecorderTimers();
    if (reason === 'silence') {
      pushLog('system', '检测到说话结束，正在自动提交语音识别。');
    } else if (reason === 'timeout') {
      pushLog('system', '录音窗口结束，正在自动提交语音识别。');
    } else {
      pushLog('system', '手动结束录音，正在提交语音识别。');
    }
    recorder.stop();
  };

  const startSpeechAutoStopMonitor = (stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      recorderAutoStopTimerRef.current = window.setTimeout(() => {
        requestRecorderStop('timeout');
      }, AUTO_RECORD_MAX_MS);
      return;
    }

    try {
      const audioContext = new AudioContextCtor();
      recordingAudioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      recordingStartedAtRef.current = performance.now();
      lastSpeechAtRef.current = recordingStartedAtRef.current;
      hasDetectedSpeechRef.current = false;

      recorderLevelTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const level = Math.sqrt(sum / samples.length);
        const now = performance.now();
        const elapsed = now - recordingStartedAtRef.current;

        if (level > SPEECH_LEVEL_THRESHOLD) {
          hasDetectedSpeechRef.current = true;
          lastSpeechAtRef.current = now;
        }

        const silenceMs = now - lastSpeechAtRef.current;
        if (hasDetectedSpeechRef.current && elapsed > AUTO_RECORD_MIN_MS && silenceMs > SILENCE_AFTER_SPEECH_MS) {
          requestRecorderStop('silence');
          return;
        }

        if (!hasDetectedSpeechRef.current && elapsed > NO_SPEECH_IDLE_TIMEOUT_MS) {
          requestRecorderStop('timeout');
          return;
        }

        if (elapsed > AUTO_RECORD_MAX_MS && (!hasDetectedSpeechRef.current || silenceMs > SILENCE_AFTER_SPEECH_MS)) {
          requestRecorderStop('timeout');
        }
      }, 120);
    } catch (error) {
      console.warn('Audio level monitor failed; falling back to timed recording.', error);
      recorderAutoStopTimerRef.current = window.setTimeout(() => {
        requestRecorderStop('timeout');
      }, AUTO_RECORD_MAX_MS);
    }
  };

  const playAssistantSpeech = async (text: string) => {
    if (!ENABLE_LEGACY_V1_BACKEND) {
      return;
    }
    if (!sessionId || !projectId || !text.trim()) {
      return;
    }

    try {
      const audio = await synthesizeSpeech({
        sessionId,
        projectId,
        text: text.slice(0, 300),
        voice: 'gentle_female',
        format: 'mp3'
      });
      const source = audio.audioUrl
        ? toAbsoluteApiAssetUrl(audio.audioUrl)
        : audio.audioBase64 && audio.mimeType
        ? `data:${audio.mimeType};base64,${audio.audioBase64}`
        : undefined;
      if (!source) {
        return;
      }

      ttsAudioRef.current?.pause();
      const player = new Audio(source);
      ttsAudioRef.current = player;
      await player.play();
    } catch (error) {
      console.warn('TTS failed; subtitle fallback remains active.', error);
      pushLog('system', '语音服务不可用，已切换字幕模式。');
    }
  };

  const toAbsoluteApiAssetUrl = (url: string) => {
    if (/^https?:\/\//.test(url)) {
      return url;
    }

    if (!legacyApiBaseUrl) {
      return url;
    }

    return `${legacyApiBaseUrl.replace(/\/api\/v1\/?$/, '')}${url}`;
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

  const handleUseLatestTranscriptForV2 = () => {
    const transcript = userSpeechSub.trim();
    if (!transcript) {
      setV2UiError('当前还没有可复用的语音转写文本。');
      setV2UiErrorDiagnostic(null);
      return;
    }
    clearV2UiError();
    setV2PromptText(transcript);
  };

  const requestV2DrawingConfirmation = (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      setV2UiError('请先输入或填入一段用于 v2 生成的描述文本。');
      setV2UiErrorDiagnostic(null);
      return;
    }

    clearV2UiError();
    setV2PromptText(prompt);
    setPendingV2PromptText(prompt);
    setPendingConfig(null);
    setPendingVerb(null);
    setPendingInterpretation(null);
    setIsAwaitingConfirm(true);
    setSystemState('等待确认');
    const reply = buildV2ConfirmationMessage(prompt);
    setAiSpeechSub(reply);
    pushLog('ai', reply);
  };

  const startV2DrawingJobFromText = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (isV2ActionBusy) {
      return;
    }
    if (!prompt) {
      setV2UiError('请先输入或填入一段用于 v2 生成的描述文本。');
      setV2UiErrorDiagnostic(null);
      return;
    }

    setIsV2Submitting(true);
    clearV2UiError();
    setV2Job(null);
    setV2FinalAsset(null);
    setV2PlaybackManifestAsset(null);
    setV2LastEventType(null);
    setV2EventLog([]);
    setV2FlowMessage('正在创建绘画任务，马上进入过程帧生成。');
    resetV2Tracking();
    resetV2Playback();
    clearPersistedV2EventSeq();

    try {
      const created = await createDrawingJob(prompt, {
        locale: 'zh-CN',
        clientSessionId: sessionId ?? undefined,
        projectHint: projectId ?? undefined,
        qualityProfile: 'high'
      });

      persistV2CurrentJob(created.jobId);
      v2ActiveJobIdRef.current = created.jobId;
      await refreshV2JobSnapshot(created.jobId);
      trackV2Job(created.jobId);
      void refreshV2RecentJobs({ silent: true });
      pushLog('system', `V2 绘画任务已创建：${created.jobId}`);
    } catch (error) {
      console.error('Creating v2 drawing job failed.', error);
      setV2ErrorFromUnknown(error, '创建 v2 drawing job 失败。');
      setV2FlowMessage('未能创建绘画任务。');
    } finally {
      setIsV2Submitting(false);
    }
  };

  const handleStartV2DrawingJob = async () => {
    const prompt = v2PromptText.trim();
    if (isAwaitingConfirm && pendingV2PromptText?.trim() === prompt) {
      await handleConfirmAction();
      return;
    }
    requestV2DrawingConfirmation(prompt);
  };

  const handleRetryV2DrawingJob = async () => {
    if (!v2Job || v2Job.status !== 'failed' || !v2Job.error?.retryable || isV2ActionBusy) {
      return;
    }

    setIsV2Retrying(true);
    clearV2UiError();
    try {
      const retried = await retryDrawingJob(v2Job.jobId, {
        fromPhase: v2Job.error?.phase,
        reason: 'frontend-stage7-retry'
      });
      setV2FinalAsset(null);
      setV2PlaybackManifestAsset(null);
      setV2LastEventType(null);
      setV2EventLog([]);
      resetV2Playback();
      clearPersistedV2EventSeq();
      persistV2CurrentJob(retried.jobId);
      v2ActiveJobIdRef.current = retried.jobId;
      await refreshV2JobSnapshot(retried.jobId);
      trackV2Job(retried.jobId);
      void refreshV2RecentJobs({ silent: true });
      setV2FlowMessage(`已创建新的重试任务：${retried.jobId}，来源任务：${retried.retryOfJobId}。`);
    } catch (error) {
      console.error('Retrying v2 drawing job failed.', error);
      setV2ErrorFromUnknown(error, '重试 v2 drawing job 失败。');
    } finally {
      setIsV2Retrying(false);
    }
  };

  const handleCancelV2DrawingJob = async () => {
    if (!v2Job || isTerminalV2Status(v2Job.status) || isV2ActionBusy) {
      return;
    }

    setIsV2Cancelling(true);
    clearV2UiError();
    try {
      const cancelled = await cancelDrawingJob(v2Job.jobId, 'frontend-stage7-cancel');
      setV2Job(cancelled);
      persistV2CurrentJob(cancelled.jobId);
      setV2FlowMessage('drawing job 已取消，可作为历史任务查看。');
      stopV2Polling();
      stopV2Subscription();
      setIsV2PlaybackRunning(false);
      void refreshV2RecentJobs({ silent: true });
    } catch (error) {
      console.error('Cancelling v2 drawing job failed.', error);
      setV2ErrorFromUnknown(error, '取消 v2 drawing job 失败。');
    } finally {
      setIsV2Cancelling(false);
    }
  };

  const handleSelectV2RecentJob = async (jobId: string) => {
    if (v2Job?.jobId === jobId) {
      v2ActiveJobIdRef.current = jobId;
      await refreshV2JobSnapshot(jobId).catch((error) => {
        if ((error as Error & { status?: number }).status === 404) {
          clearPersistedV2Job();
          v2ActiveJobIdRef.current = null;
        }
        setV2ErrorFromUnknown(error, '刷新历史任务失败。');
      });
      return;
    }

    clearV2UiError();
    setV2LastEventType(null);
    setV2EventLog([]);
    setV2FlowMessage('正在打开历史 drawing job...');
    resetV2Tracking();
    resetV2Playback();
    clearPersistedV2EventSeq();
    setV2FinalAsset(null);
    setV2PlaybackManifestAsset(null);

    try {
      v2ActiveJobIdRef.current = jobId;
      const job = await refreshV2JobSnapshot(jobId);
      if (!isTerminalV2Status(job.status)) {
        trackV2Job(jobId);
      }
    } catch (error) {
      console.error('Opening recent v2 drawing job failed.', error);
      v2ActiveJobIdRef.current = null;
      if ((error as Error & { status?: number }).status === 404 || (error as Error & { status?: number }).status === 400) {
        clearPersistedV2Job();
      }
      setV2ErrorFromUnknown(error, '打开历史任务失败。');
      setV2FlowMessage('未能打开历史 drawing job。');
    }
  };

  const restoreV2JobFromStorage = async () => {
    const savedJobId = readPersistedV2JobId();
    if (!savedJobId || v2ActiveJobIdRef.current === savedJobId) {
      return;
    }

    const savedAfterSeq = readPersistedV2EventSeq();
    clearV2UiError();
    setV2LastEventType(null);
    setV2EventLog([]);
    setV2FlowMessage('正在恢复上次查看的 v2 drawing job...');
    resetV2Tracking();
    resetV2Playback();
    setV2FinalAsset(null);
    setV2PlaybackManifestAsset(null);

    try {
      v2ActiveJobIdRef.current = savedJobId;
      const job = await getDrawingJob(savedJobId);
      if (!shouldAutoRestoreV2Job(job)) {
        v2ActiveJobIdRef.current = null;
        clearPersistedV2Job();
        setV2Job(null);
        setV2FinalAsset(null);
        setV2PlaybackManifestAsset(null);
        setV2FlowMessage('上次任务已完成，已放入 Recent Jobs，可手动打开历史查看。');
        void refreshV2RecentJobs({ silent: true });
        return;
      }

      const restored = await refreshV2JobSnapshot(savedJobId, { force: true });
      if (!isTerminalV2Status(restored.status)) {
        setV2FlowMessage('已恢复上次任务，正在继续跟踪。');
        trackV2Job(savedJobId, { afterSeq: savedAfterSeq });
      }
    } catch (error) {
      console.error('Restoring persisted v2 drawing job failed.', error);
      v2ActiveJobIdRef.current = null;
      clearPersistedV2Job();
      setV2ErrorFromUnknown(error, '恢复上次 v2 drawing job 失败。');
      setV2FlowMessage('已清理不可恢复的 v2 drawing job。');
    }
  };

  // Push welcome instructions on load
  useEffect(() => {
    pushLog('system', '🎨 AI 语音数位绘画工作台控制引擎就绪。');
    pushLog('system', '您可以开启麦克风或点击右侧【快捷剧本模拟】体验高精绘图。');
    pushLog('ai', '您好，我是您的数位绘画助理。说出指令如“画一个蓝色长发女生半身像，水彩素描风”，我们即可开始创作！');

    return () => {
      if (redrawPulseTimerRef.current) {
        clearTimeout(redrawPulseTimerRef.current);
      }
      resetV2Tracking();
      cleanupRecordingResources();
      cleanupRealtimeAudio();
      cleanupRealtimeSocket();
    };
  }, []);

  useEffect(() => {
    void refreshV2RuntimeReadiness();
    void refreshV2RecentJobs();
    if (!v2RestoreStartedRef.current) {
      v2RestoreStartedRef.current = true;
      void restoreV2JobFromStorage();
    }
  }, []);

  useEffect(() => {
    if (!ENABLE_LEGACY_V1_BACKEND) {
      pushLog('system', '旧 Node/V1 后端已从默认流程移除；当前只使用 Python backend v2。');
      return;
    }

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
    } else if (drawProgress > 0 && drawProgress < STAGE_BOUNDARIES.sketchDone) {
      setCurrentStage('草图阶段');
    } else if (drawProgress >= STAGE_BOUNDARIES.sketchDone && drawProgress < STAGE_BOUNDARIES.lineDone) {
      setCurrentStage('线稿阶段');
    } else if (drawProgress >= STAGE_BOUNDARIES.lineDone && drawProgress < STAGE_BOUNDARIES.flatsDone) {
      setCurrentStage('铺色阶段');
    } else if (drawProgress >= STAGE_BOUNDARIES.flatsDone && drawProgress < STAGE_BOUNDARIES.watercolorDone) {
      setCurrentStage('水彩晕染');
    } else if (drawProgress >= STAGE_BOUNDARIES.watercolorDone && drawProgress < 100) {
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

    paintTimerRef.current = setInterval(() => {
      setDrawProgress((prevProgress) => {
        const progressStep =
          prevProgress >= STAGE_BOUNDARIES.flatsDone && prevProgress < STAGE_BOUNDARIES.watercolorDone
            ? 0.58
            : 1.35;
        const nextProgress = prevProgress + progressStep;

        // "STAGES MODE (分阶段单步确认模式)" CHECK:
        // We pause at step boundaries and await user verbal/manual OK.
        if (paintMode === 'stages') {
          // Check sketch complete (25%)
          if (prevProgress < STAGE_BOUNDARIES.sketchDone && nextProgress >= STAGE_BOUNDARIES.sketchDone) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [草图绘制阶段已达成 25%] 结构线条规划完毕。请问确认进入【线稿阶段】继续精描吗？');
            setAiSpeechSub('草图层绘制完成。是否允许我继续渲染【线稿层】精细毛刷？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit'); // mock confirm action to trigger next progress
            return STAGE_BOUNDARIES.sketchDone;
          }
          // Check lineart complete (50%)
          if (prevProgress < STAGE_BOUNDARIES.lineDone && nextProgress >= STAGE_BOUNDARIES.lineDone) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [精细线稿阶段已达成 50%] 人物墨线雕琢完毕。请问确认进入【基础铺色阶段】吗？');
            setAiSpeechSub('线稿层校对结束。是否允许开始在皮肤、头发、眼睛与服饰上铺基础色？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit');
            return STAGE_BOUNDARIES.lineDone;
          }
          // Check flats complete (70%)
          if (prevProgress < STAGE_BOUNDARIES.flatsDone && nextProgress >= STAGE_BOUNDARIES.flatsDone) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [基础铺色阶段已达成 70%] 色块已经分层落位。请问确认进入【水彩晕染阶段】吗？');
            setAiSpeechSub('基础色层完成。是否开始慢速水彩晕染，让颜料在纸纹上叠色扩散？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit');
            return STAGE_BOUNDARIES.flatsDone;
          }
          // Check watercolor complete (90%)
          if (prevProgress < STAGE_BOUNDARIES.watercolorDone && nextProgress >= STAGE_BOUNDARIES.watercolorDone) {
            clearInterval(paintTimerRef.current!);
            setSystemState('等待确认');
            pushLog('ai', '🎨 [水彩晕染叠色已达成 90%] 纸面颜料扩散完毕。请问确认进入【最后的局部细节刻画层】雕饰瞳光和腮红吗？');
            setAiSpeechSub('水彩层叠染完工。是否开始最后的【高光跟脸红细节】修饰？说“确认”或“继续”。');
            setIsAwaitingConfirm(true);
            setPendingVerb('edit');
            return STAGE_BOUNDARIES.watercolorDone;
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

    const isControlCommand = /^(确定|确认|取消|放弃|不要了|暂停|停一下|先停|继续|接着|回放|重新放|重演|撤销|上一步|撤消|重做|恢复下一步|前进)\b/.test(text);
    if (ENABLE_V2_VOICE_DRAWING && !isControlCommand) {
      pushLog('user', text);
      setUserSpeechSub(text);
      pushLog('system', '已识别语音绘图描述，等待用户确认后再创建 Python v2 Drawing Job。');
      requestV2DrawingConfirmation(text);
      return;
    }

    if (!isControlCommand) {
      setV2PromptText(text);
    }

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
      setPendingV2PromptText(null);
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
        void playAssistantSpeech(interpretation.aiReplyText);
        return;
      }

      const confirmationReply = interpretation.aiReplyText.includes('确认')
        ? interpretation.aiReplyText
        : `${interpretation.aiReplyText} 请确认后我再开始执行。`;

      setPendingInterpretation(interpretation);
      setPendingV2PromptText(null);
      setPendingConfig(resolveConfigFromOperations(interpretation.operations));
      setPendingVerb(interpretation.intent === 'create_avatar' ? 'create' : 'edit');
      setIsAwaitingConfirm(true);
      setAiSpeechSub(confirmationReply);
      pushLog('ai', confirmationReply);
      void playAssistantSpeech(confirmationReply);
      setSystemState('等待确认');
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
        setPendingV2PromptText(null);
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
      setPendingV2PromptText(null);
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

    if (pendingV2PromptText) {
      const prompt = pendingV2PromptText;
      setIsAwaitingConfirm(false);
      setPendingV2PromptText(null);
      setPendingConfig(null);
      setPendingVerb(null);
      setPendingInterpretation(null);
      setSystemState('思考中');
      pushLog('system', '用户已确认，开始创建 Python v2 Drawing Job。');
      await startV2DrawingJobFromText(prompt);
      return;
    }

    // Backup current traits to Undo history prior to execution
    setHistory((prev) => [...prev, characterConfig]);
    setRedoStack([]); // Clear forward stack

    const verb = pendingVerb;
    const nextCfg = pendingConfig;
    const confirmedTranscript = userSpeechSub;
    const confirmedReplyText = aiSpeechSub;

    if (ENABLE_LEGACY_V1_BACKEND && pendingInterpretation && projectId && sessionId) {
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
        setPendingV2PromptText(null);
        setAiSpeechSub(confirmed.aiReplyText);
        void playAssistantSpeech(confirmed.aiReplyText);

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
    setPendingV2PromptText(null);

    // Apply the traits
    if (nextCfg) {
      setCharacterConfig(nextCharacterConfig);
    }

    if (verb === 'create') {
      // Complete avatar generation animation (0% to 100%)
      pushLog('system', '项目工程重建中... 草图及底片刷新。');
      pushLog('ai', '好的！这就为您动笔，我们将按照数位板绘画流程依序推进，请鉴赏画面的分层生长。');
      setAiSpeechSub('正在依照标准数字工作台工序绘制：草图构型阶段(25%) -> 线稿描黑阶段(50%) -> 基础色分层(70%) -> 慢速水彩晕染(90%) -> 动漫高光烘焙。');
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
      const redrawTarget = operationPatch ? resolveRedrawTarget(operationPatch) : 'hair';
      triggerRedrawPulse(redrawTarget);
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

    if (!ENABLE_LEGACY_V1_BACKEND) {
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
    const redrawOperation = operations.find((operation) => operation.type === 'redraw_component');

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
      if (redrawOperation?.type === 'redraw_component') {
        triggerRedrawPulse(redrawOperation.target);
      }
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
        type: 'redraw_component',
        target: resolveRedrawTarget(nextConfig),
        patch: nextConfig
      }
    ];
  };

  const resolveRedrawTarget = (patch: Partial<CharacterConfig>): RedrawTarget => {
    if (patch.hairColor || patch.hairLength || patch.gender) return 'hair';
    if (patch.eyeColor) return 'eyes';
    if (patch.expression) return 'expression';
    if (patch.outfit) return 'outfit';
    if (patch.accessory) return 'accessory';
    if (patch.backgroundStyle) return 'background';
    return 'hair';
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
    if (ENABLE_LEGACY_V1_BACKEND && projectId && sessionId && serverRevision !== null && historyCount > 0) {
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
    if (ENABLE_LEGACY_V1_BACKEND && projectId && sessionId && serverRevision !== null && redoCount > 0) {
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
    const hasV2ProcessPlayback = !!v2Job?.playbackManifest?.durationMs && !!(v2Job.finalAssetId || v2FinalAsset);
    if (hasV2ProcessPlayback) {
      restartV2Playback();
      setSystemState('绘画中');
      setAiSpeechSub('正在从 10% 草图开始重放完整绘画过程。');
      pushLog('system', '已将“重放过程”绑定到当前 Python v2 绘画过程播放器。');
      return;
    }

    if (ENABLE_LEGACY_V1_BACKEND && projectId && sessionId) {
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
  // -------------------------------------------------------------------------
  // 7. REAL VOICE HANDLING WITH DASHSCOPE REALTIME ASR AND FALLBACKS
  // -------------------------------------------------------------------------
  const toggleSpeechRecognition = async () => {
    if (isListening) {
      stopRealtimeAsr();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        requestRecorderStop('manual');
        return;
      }
      clearWebSpeechSilenceTimer();
      webSpeechStopRequestedRef.current = true;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.stop();
      setIsListening(false);
      setSystemState('等待指令');
      pushLog('system', '麦克风监听关闭。');
      return;
    }

    if (ENABLE_V2_VOICE_DRAWING) {
      startWebSpeechFallback('Python v2 语音绘图模式：使用浏览器识别，静音 5 秒后等待确认。');
      return;
    }

    if (!sessionId || !projectId) {
      startWebSpeechFallback('工程会话尚未就绪，临时切换浏览器识别。');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined') {
      await startRecordedAsrFallback('浏览器不支持实时音频通道，切换短录音识别。');
      return;
    }

    try {
      await startRealtimeAsr();
    } catch (error) {
      const message = error instanceof Error ? error.message : '实时语音识别启动失败。';
      console.warn('Realtime ASR unavailable.', error);
      setMicError(message);
      setUserSpeechSub(message);
      pushLog('system', `实时语音识别未启动：${message}`);
      await startRecordedAsrFallback('实时通道不可用，切换短录音识别。');
    }
  };

  const startRealtimeAsr = async () => {
    if (ENABLE_V2_VOICE_DRAWING) {
      startWebSpeechFallback('Python v2 语音绘图模式只使用浏览器识别。');
      return;
    }
    if (!sessionId || !projectId) {
      throw new Error('缺少 session/project，无法启动实时识别。');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true
      }
    });
    const socket = new WebSocket(toRealtimeAsrUrl());
    socket.binaryType = 'arraybuffer';

    streamRef.current = stream;
    realtimeSocketRef.current = socket;
    realtimeFinalTranscriptRef.current = '';
    realtimePartialTranscriptRef.current = '';
    realtimeStoppingRef.current = false;
    setMicError(null);
    setIsListening(true);
    setSystemState('聆听中');
    setUserSpeechSub('正在连接实时语音识别...');
    pushLog('system', '🎙️ 麦克风已捕获，正在连接实时 ASR。');

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanupRealtimeAudio();
        cleanupRealtimeSocket();
        setIsListening(false);
        setSystemState('等待指令');
        reject(new Error(message));
      };

      socket.onopen = () => {
        opened = true;
        socket.send(JSON.stringify({
          type: 'start',
          sessionId,
          projectId,
          locale: 'zh-CN'
        }));
        setUserSpeechSub('实时识别准备中...');
      };

      socket.onerror = () => {
        if (!opened) {
          fail('实时 ASR WebSocket 连接失败。');
          return;
        }
        setMicError('实时 ASR WebSocket 连接中断。');
        pushLog('system', '实时 ASR WebSocket 连接中断。');
      };

      socket.onmessage = (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message) return;

        if (message.type === 'starting') {
          setUserSpeechSub('实时识别已连接，等待服务就绪...');
          return;
        }

        if (message.type === 'ready') {
          startRealtimeAudioPipeline(stream, socket);
          setUserSpeechSub('正在听您说话...');
          pushLog('system', '🎙️ 实时 ASR 已就绪，请直接说口令。');
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (message.type === 'partial' || message.type === 'final') {
          const transcript = message.transcript.trim();
          if (!transcript) return;
          realtimePartialTranscriptRef.current = transcript;
          if (message.type === 'final') {
            realtimeFinalTranscriptRef.current = transcript;
          }
          setUserSpeechSub(transcript);
          return;
        }

        if (message.type === 'done') {
          const transcript =
            realtimeFinalTranscriptRef.current.trim() || realtimePartialTranscriptRef.current.trim();
          cleanupRealtimeAudio();
          cleanupRealtimeSocket();
          setIsListening(false);
          setSystemState(transcript ? '思考中' : '等待指令');
          if (transcript) {
            pushLog('system', `实时 ASR 识别完成：${transcript}`);
            void interpretVoiceCommand(transcript);
          } else {
            setUserSpeechSub('没有听到有效语音，请再试一次。');
          }
          return;
        }

        if (message.type === 'error') {
          const messageText = message.message || '实时语音识别失败。';
          setMicError(messageText);
          setUserSpeechSub(messageText);
          pushLog('system', `实时 ASR 错误：${messageText}`);
          fail(messageText);
        }
      };

      socket.onclose = () => {
        if (!opened) {
          fail('实时 ASR 连接被关闭。');
          return;
        }
        if (!realtimeStoppingRef.current && realtimeSocketRef.current === socket) {
          cleanupRealtimeAudio();
          cleanupRealtimeSocket();
          setIsListening(false);
          setSystemState('等待指令');
        }
      };
    });
  };

  const stopRealtimeAsr = () => {
    realtimeStoppingRef.current = true;
    cleanupRealtimeAudio();
    const socket = realtimeSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'finish' }));
      setUserSpeechSub('正在完成实时识别...');
      pushLog('system', '已停止说话，正在收尾实时识别。');
      return;
    }
    cleanupRealtimeSocket();
  };

  const cleanupRealtimeAudio = () => {
    realtimeProcessorRef.current?.disconnect();
    realtimeSourceRef.current?.disconnect();
    void realtimeAudioContextRef.current?.close().catch(() => undefined);
    realtimeProcessorRef.current = null;
    realtimeSourceRef.current = null;
    realtimeAudioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const cleanupRealtimeSocket = () => {
    const socket = realtimeSocketRef.current;
    realtimeSocketRef.current = null;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  };

  const startRealtimeAudioPipeline = (stream: MediaStream, socket: WebSocket) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('浏览器不支持 AudioContext。');
    }

    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    realtimeAudioContextRef.current = audioContext;
    realtimeSourceRef.current = source;
    realtimeProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN || realtimeStoppingRef.current) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const resampled = resampleFloat32(input, audioContext.sampleRate, 8000);
      socket.send(floatTo16BitPcm(resampled));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  };

  const startRecordedAsrFallback = async (reason?: string) => {
    if (ENABLE_V2_VOICE_DRAWING) {
      startWebSpeechFallback(reason ?? 'Python v2 语音绘图模式只使用浏览器识别。');
      return;
    }
    if (reason) {
      pushLog('system', reason);
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      startWebSpeechFallback('浏览器不支持录音上传，切换 Web Speech。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mediaChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let submitted = false;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (submitted) return;
        submitted = true;
        const blob = new Blob(mediaChunksRef.current, { type: mimeType || 'audio/webm' });
        mediaChunksRef.current = [];
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setIsListening(false);
        void handleRecordedAudio(blob);
      };

      setMicError(null);
      setIsListening(true);
      setSystemState('聆听中');
      setUserSpeechSub('短录音识别中，请说完整口令...');
      pushLog('system', '🎙️ 已进入短录音 ASR 备用模式，结束后自动提交。');
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 5000);
    } catch (error) {
      console.warn('MediaRecorder unavailable; falling back to Web Speech.', error);
      startWebSpeechFallback('录音上传不可用，切换 Web Speech。');
    }
  };

  const toRealtimeAsrUrl = () => {
    if (!legacyApiBaseUrl) {
      throw new Error('Legacy v1 realtime ASR backend is disabled.');
    }
    const httpBase = legacyApiBaseUrl.replace(/\/api\/v1\/?$/, '');
    const wsBase = httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsBase}/api/v1/voice/asr/realtime`;
  };

  const parseRealtimeMessage = (data: unknown) => {
    if (typeof data !== 'string') {
      return null;
    }

    try {
      const parsed = JSON.parse(data) as {
        type?: string;
        transcript?: string;
        message?: string;
      };
      if (
        parsed.type === 'starting' ||
        parsed.type === 'ready' ||
        parsed.type === 'done' ||
        parsed.type === 'partial' ||
        parsed.type === 'final' ||
        parsed.type === 'error'
      ) {
        return {
          type: parsed.type,
          transcript: parsed.transcript ?? '',
          message: parsed.message ?? ''
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const resampleFloat32 = (
    input: Float32Array,
    sourceSampleRate: number,
    targetSampleRate: number
  ) => {
    if (sourceSampleRate === targetSampleRate) {
      return input;
    }

    const ratio = sourceSampleRate / targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = index * ratio;
      const before = Math.floor(sourceIndex);
      const after = Math.min(before + 1, input.length - 1);
      const weight = sourceIndex - before;
      output[index] = input[before] * (1 - weight) + input[after] * weight;
    }
    return output;
  };

  const floatTo16BitPcm = (input: Float32Array) => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  };

  const handleRecordedAudio = async (audio: Blob) => {
    if (ENABLE_V2_VOICE_DRAWING) {
      startWebSpeechFallback('Python v2 语音绘图模式只使用浏览器识别。');
      return;
    }
    if (!ENABLE_LEGACY_V1_BACKEND) {
      startWebSpeechFallback('旧 Node/V1 录音 ASR 已移除，切换浏览器 Web Speech。');
      return;
    }

    if (!sessionId || !projectId) {
      startWebSpeechFallback('工程会话尚未就绪，切换 Web Speech。');
      return;
    }

    try {
      setSystemState('思考中');
      setUserSpeechSub('正在识别语音...');
      pushLog('system', '正在上传备用录音到后端 ASR 服务...');
      const result = await transcribeAudio({
        sessionId,
        projectId,
        audio,
        locale: 'zh-CN',
        format: 'webm'
      });
      pushLog('system', `ASR 识别完成：${result.transcript}`);
      setUserSpeechSub(result.transcript);
      setSystemState('思考中');
      await interpretVoiceCommand(result.transcript);
    } catch (error) {
      console.warn('ASR failed; falling back to Web Speech.', error);
      pushLog('system', '语音服务不可用，已切换浏览器 Web Speech fallback。');
      startWebSpeechFallback('后端 ASR 不可用，切换 Web Speech。');
    }
  };

  const startWebSpeechFallback = (reason?: string) => {
    if (reason) {
      pushLog('system', reason);
    }

    if (!SpeechRecognitionAPI) {
      setMicError('您的浏览器未对 Web Speech API 进行完整适配。建议直接使用右侧极速卡片触发，或使用 Chrome 浏览器。');
      pushLog('system', '⚠️ Speech API 不支持（已启动纯拟真交互方案）。');
      setIsListening(true);
      setTimeout(() => {
        setIsListening(false);
        setSystemState('等待确认');
        requestV2DrawingConfirmation('画一个蓝色长发的二次元女生半身头像，水彩素描风');
      }, 3000);
      return;
    }

    setMicError(null);
    setIsListening(true);
    pushLog('system', '🎙️ 已进入 Python v2 语音识别。说完后静音 5 秒，我会先等待您确认。');
    webSpeechFinalTranscriptRef.current = '';
    webSpeechInterimTranscriptRef.current = '';
    webSpeechStopRequestedRef.current = false;
    webSpeechFinalizeGuardRef.current = false;
    clearWebSpeechSilenceTimer();

    const r = new SpeechRecognitionAPI();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'zh-CN';

    r.onstart = () => {
      setSystemState('聆听中');
      setUserSpeechSub('浏览器备用识别中...');
    };

    r.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const textResult = event.results[index][0].transcript;
        if (event.results[index].isFinal) {
          finalText += textResult;
        } else {
          interim += textResult;
        }
      }
      if (finalText.trim()) {
        webSpeechFinalTranscriptRef.current = `${webSpeechFinalTranscriptRef.current} ${finalText}`.trim();
      }
      webSpeechInterimTranscriptRef.current = interim.trim();
      const display =
        `${webSpeechFinalTranscriptRef.current} ${webSpeechInterimTranscriptRef.current}`.trim() ||
        finalText ||
        interim;
      if (display) {
        setUserSpeechSub(display);
      }
      scheduleWebSpeechFinalize();
    };

    r.onerror = (e: any) => {
      console.error('Speech recognition error', e);
      setMicError(`识别信号偏弱: ${e.error}`);
      clearWebSpeechSilenceTimer();
      r.stop();
      recognitionRef.current = null;
      webSpeechStopRequestedRef.current = false;
      webSpeechFinalizeGuardRef.current = false;
      setIsListening(false);
      setSystemState('等待指令');
    };

    r.onend = () => {
      if (webSpeechStopRequestedRef.current) {
        return;
      }
      const transcript =
        webSpeechFinalTranscriptRef.current.trim() || webSpeechInterimTranscriptRef.current.trim();
      if (transcript) {
        scheduleWebSpeechFinalize();
        return;
      }
      setIsListening(false);
      recognitionRef.current = null;
      if (systemState === '聆听中') {
        setSystemState('等待指令');
      }
    };

    recognitionRef.current = r;
    r.start();
  };

  const v2PreviewSrc = v2PreviewAsset
    ? buildAssetContentUrl(v2PreviewAsset)
    : v2Job?.previewAssetId
      ? buildAssetContentUrl(v2Job.previewAssetId)
      : null;
  const v2FinalSrc = v2FinalAsset
    ? buildAssetContentUrl(v2FinalAsset)
    : v2Job?.finalAssetId
      ? buildAssetContentUrl(v2Job.finalAssetId)
      : null;
  const v2LayerAssets: LayerAsset[] = v2Job?.layerAssets ?? [];
  const v2LayerAssetsById = new Map<string, LayerAsset>(v2LayerAssets.map((layer) => [layer.assetId, layer]));
  const v2PlaybackSteps: PlaybackManifestStep[] = [...(v2Job?.playbackManifest?.steps ?? [])].sort(
    (left, right) => left.order - right.order
  );
  const v2PlaybackProcess = v2Job?.playbackManifest?.process ?? null;
  const v2PlaybackProcessPhases = v2PlaybackProcess?.phases ?? [];
  const v2PlaybackDurationMs = v2Job?.playbackManifest?.durationMs ?? 0;
  const v2PlaybackSignature = `${v2Job?.jobId ?? 'none'}:${v2Job?.playbackManifestAssetId ?? 'none'}`;
  const v2PlaybackLayers = v2PlaybackSteps
    .map((step, stepIndex) => {
      const layer = step.assetId ? v2LayerAssetsById.get(step.assetId) : undefined;
      if (!layer) {
        return null;
      }
      return {
        step,
        stepIndex,
        layer,
        src: buildAssetContentUrl({
          assetId: layer.assetId,
          contentUrl: layer.contentUrl,
        }),
      };
    })
    .filter((entry): entry is { step: PlaybackManifestStep; stepIndex: number; layer: LayerAsset; src: string } => entry !== null);
  const v2HasProcessPlayback = !!v2PlaybackProcess && !!v2FinalSrc;
  const v2HasPlayableManifest = (v2PlaybackLayers.length > 0 || v2HasProcessPlayback) && v2PlaybackDurationMs > 0;
  let v2CurrentPlaybackStepIndex = -1;
  for (let index = 0; index < v2PlaybackSteps.length; index += 1) {
    const step = v2PlaybackSteps[index];
    if (v2PlaybackElapsedMs >= step.startMs) {
      v2CurrentPlaybackStepIndex = index;
    } else {
      break;
    }
  }
  let v2CurrentProcessPhaseIndex = -1;
  for (let index = 0; index < v2PlaybackProcessPhases.length; index += 1) {
    const phase = v2PlaybackProcessPhases[index];
    if (v2PlaybackElapsedMs >= phase.startMs) {
      v2CurrentProcessPhaseIndex = index;
    } else {
      break;
    }
  }
  const v2CurrentPlaybackStep =
    v2CurrentPlaybackStepIndex >= 0 ? v2PlaybackSteps[v2CurrentPlaybackStepIndex] : v2PlaybackSteps[0] ?? null;
  const v2CurrentProcessPhase =
    v2CurrentProcessPhaseIndex >= 0
      ? v2PlaybackProcessPhases[v2CurrentProcessPhaseIndex]
      : v2PlaybackProcessPhases[0] ?? null;
  const canRetryV2Job = v2Job?.status === 'failed' && !!v2Job.error?.retryable && !isV2ActionBusy;
  const canCancelV2Job = !!v2Job && !isTerminalV2Status(v2Job.status) && !isV2ActionBusy;
  const isV2PromptAwaitingConfirmation = isAwaitingConfirm && pendingV2PromptText?.trim() === v2PromptText.trim() && !!v2PromptText.trim();
  const v2UserStatus = getV2UserStatus(v2Job);
  const v2JobErrorDiagnostic = v2Job?.error ? getV2ErrorDiagnostic(v2Job.error, null) : null;
  const v2ManifestStepCount = v2PlaybackSteps.length;
  const v2RuntimeModes = v2RuntimeReadiness?.provider.modes;
  const v2RuntimeNetworkLabel = v2RuntimeReadiness
    ? v2RuntimeReadiness.provider.networkEnabled
      ? 'live network enabled'
      : v2RuntimeReadiness.provider.placeholder
        ? 'placeholder offline'
        : 'offline mock'
    : isV2RuntimeLoading
      ? 'loading'
      : 'unavailable';
  const getV2PlaybackOpacity = (step: PlaybackManifestStep, stepIndex: number) => {
    return computeStepOpacity(step, v2PlaybackElapsedMs, stepIndex === v2PlaybackSteps.length - 1);
  };
  const v2PlaybackProgressPercent =
    v2PlaybackDurationMs > 0 ? Math.min((v2PlaybackElapsedMs / v2PlaybackDurationMs) * 100, 100) : 0;
  const v2DisplayPlaybackStepIndex =
    v2HasProcessPlayback && v2CurrentProcessPhaseIndex >= 0 ? v2CurrentProcessPhaseIndex : v2CurrentPlaybackStepIndex;
  const v2MainPlaybackLabel = v2HasProcessPlayback && v2CurrentProcessPhase
    ? getV2ProcessPhaseLabel(v2CurrentProcessPhase, Math.max(v2CurrentProcessPhaseIndex, 0))
    : v2CurrentPlaybackStep
    ? getV2FrameStepLabel(v2CurrentPlaybackStep, Math.max(v2CurrentPlaybackStepIndex, 0))
    : '等待过程帧';
  const v2MainPlaybackSummary = v2HasPlayableManifest
    ? `${v2MainPlaybackLabel} · ${Math.round(v2PlaybackProgressPercent)}% · ${
        v2PlaybackProcess ? `${v2PlaybackProcess.actions.length} 动作` : `${v2ManifestStepCount} 步`
      }`
    : '画布尺寸: 600 × 600 px (自适应视网膜屏幕)';

  useEffect(() => {
    if (!v2HasPlayableManifest) {
      resetV2Playback();
      return;
    }

    stopV2PlaybackLoop();
    v2PlaybackStartedAtRef.current = null;
    const initialElapsedMs = isTerminalV2Status(v2Job?.status) ? v2PlaybackDurationMs : 0;
    v2PlaybackBaseElapsedRef.current = initialElapsedMs;
    setV2PlaybackElapsedMs(initialElapsedMs);
    setIsV2PlaybackRunning(false);
  }, [v2PlaybackSignature, v2HasPlayableManifest, v2Job?.status, v2PlaybackDurationMs]);

  useEffect(() => {
    if (!isV2PlaybackRunning || !v2HasPlayableManifest) {
      stopV2PlaybackLoop();
      v2PlaybackStartedAtRef.current = null;
      return;
    }

    if (v2PlaybackStartedAtRef.current === null) {
      v2PlaybackStartedAtRef.current = performance.now();
    }

    const tick = (now: number) => {
      const nextElapsed = computePlaybackElapsed(
        v2PlaybackBaseElapsedRef.current,
        v2PlaybackStartedAtRef.current,
        now,
        v2PlaybackDurationMs
      );
      setV2PlaybackElapsedMs(nextElapsed);

      if (nextElapsed >= v2PlaybackDurationMs) {
        v2PlaybackBaseElapsedRef.current = v2PlaybackDurationMs;
        v2PlaybackStartedAtRef.current = null;
        setIsV2PlaybackRunning(false);
        stopV2PlaybackLoop();
        return;
      }

      v2PlaybackRafRef.current = window.requestAnimationFrame(tick);
    };

    v2PlaybackRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      stopV2PlaybackLoop();
    };
  }, [isV2PlaybackRunning, v2HasPlayableManifest, v2PlaybackDurationMs, v2PlaybackSessionNonce]);

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
                <span>{v2MainPlaybackSummary}</span>
              </div>
            </div>

            <div className="w-full">
              {v2HasPlayableManifest ? (
                <div className={`rounded-xl border p-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0c0d12] border-[#23232d]'}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className={`text-xs font-bold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>10% 到 100% 绘画过程</p>
                      <p className={`mt-1 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        step {Math.max(v2DisplayPlaybackStepIndex + 1, 1)} / {v2ManifestStepCount}
                        {v2HasPlayableManifest ? ` · ${v2MainPlaybackLabel}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (isV2PlaybackRunning) {
                            pauseV2Playback();
                            return;
                          }
                          resumeV2Playback();
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          isLightMode
                            ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            : 'bg-[#14141c] border-[#2b2b38] text-slate-200 hover:bg-[#1b1b25]'
                        }`}
                      >
                        {isV2PlaybackRunning ? '暂停' : '播放'}
                      </button>
                      <button
                        onClick={restartV2Playback}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          isLightMode
                            ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            : 'bg-[#14141c] border-[#2b2b38] text-slate-200 hover:bg-[#1b1b25]'
                        }`}
                      >
                        重播
                      </button>
                    </div>
                  </div>

                  {v2HasProcessPlayback && v2PlaybackProcess && v2FinalSrc ? (
                    <ProcessPlaybackPlayer
                      process={v2PlaybackProcess}
                      previewSrc={v2PreviewSrc}
                      finalSrc={v2FinalSrc}
                      elapsedMs={v2PlaybackElapsedMs}
                      isLightMode={isLightMode}
                    />
                  ) : (
                    <div className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl border ${isLightMode ? 'bg-white border-slate-200' : 'bg-[#090a10] border-[#1f2230]'}`}>
                      {v2FinalSrc && (
                        <img
                          src={v2FinalSrc}
                          alt="V2 final composite background"
                          className="absolute inset-0 h-full w-full object-cover"
                          style={{ opacity: 0.08 }}
                        />
                      )}
                      {v2PlaybackLayers.map(({ step, stepIndex, layer, src }) => (
                        <img
                          key={layer.assetId}
                          src={src}
                          alt={layer.label}
                          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                          style={{
                            opacity: getV2PlaybackOpacity(step, stepIndex),
                            mixBlendMode: step.blendMode as React.CSSProperties['mixBlendMode'],
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-col gap-2">
                    <div className={`h-2 rounded-full overflow-hidden ${isLightMode ? 'bg-slate-200' : 'bg-[#1c1e28]'}`}>
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 transition-all duration-150"
                        style={{ width: `${v2PlaybackProgressPercent}%` }}
                      />
                    </div>
                    <div className={`flex items-center justify-between text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      <span>{Math.round(v2PlaybackElapsedMs)} ms</span>
                      <span>{v2PlaybackDurationMs} ms</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                    {v2PlaybackSteps.map((step, index) => (
                      <div
                        key={step.stepId}
                        className={`rounded-lg border px-2.5 py-2 ${index === v2DisplayPlaybackStepIndex
                          ? isLightMode
                            ? 'bg-cyan-50 border-cyan-200'
                            : 'bg-cyan-950/20 border-cyan-500/40'
                          : isLightMode
                            ? 'bg-white border-slate-200'
                            : 'bg-[#10121a] border-[#23232d]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-[11px] font-semibold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>{getV2FrameStepLabel(step, index)}</p>
                          <span className={`text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>#{step.order}</span>
                        </div>
                        <p className={`mt-1 truncate text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          {step.role} · {step.durationMs} ms
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
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
                    setPendingInterpretation(null);
                    setPendingV2PromptText(null);
                    setSystemState('等待指令');
                    setAiSpeechSub('好的，当前操作已取消，随时等候您的下一步指令。');
                    pushLog('ai', '已取消前面的操作。');
                  }}
                  isLightMode={isLightMode}
                  lastRedrawTarget={lastRedrawTarget}
                />
              )}
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

          <div className={`w-full flex flex-col gap-4 ${isLightMode ? 'bg-[#ffffff] border-[#e2e8f0]' : 'bg-[#111115] border-[#23232d]'} rounded-xl p-4.5 shadow-xl animate-fade-in`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`flex items-center gap-2 text-xs ${isLightMode ? 'text-slate-800' : 'text-slate-200'} font-bold uppercase tracking-wider font-mono`}>
                  <Sparkles className="w-4 h-4 text-cyan-500" />
                  <span>Python v2 Drawing Job</span>
                </div>
                <p className={`mt-1 text-[11px] leading-relaxed ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                  这条链路直接接到 `backend` 的异步绘画任务。确认后立即开始绘制，内部构图不会打断用户流程。
                </p>
              </div>
              <span className={`text-[10px] font-mono px-2 py-1 rounded border ${isLightMode ? 'bg-slate-50 border-slate-200 text-slate-500' : 'bg-[#181822] border-[#2d2d3c] text-slate-400'}`}>
                {drawingApiBaseUrl}
              </span>
            </div>

            <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0c0d12] border-[#23232d]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>Runtime Readiness</p>
                  <p className={`mt-1 text-[11px] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                    {v2RuntimeError ?? `${v2RuntimeReadiness?.provider.profile ?? 'unknown'} · ${v2RuntimeNetworkLabel}`}
                  </p>
                </div>
                <button
                  onClick={() => void refreshV2RuntimeReadiness()}
                  disabled={isV2RuntimeLoading}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                    isV2RuntimeLoading
                      ? 'opacity-50 cursor-not-allowed bg-transparent border-slate-300 text-slate-400'
                      : isLightMode
                        ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        : 'bg-[#14141c] border-[#2b2b38] text-slate-200 hover:bg-[#1b1b25]'
                  }`}
                >
                  {isV2RuntimeLoading ? '刷新中' : '刷新'}
                </button>
              </div>
              <div className={`mt-2 flex flex-wrap gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                <span>runner: {v2RuntimeReadiness?.workflow.runnerMode ?? '--'}</span>
                <span>network: {v2RuntimeNetworkLabel}</span>
                <span>text: {v2RuntimeModes?.text ?? '--'}</span>
                <span>内部构图: {v2RuntimeModes?.preview ?? '--'}</span>
                <span>final: {v2RuntimeModes?.final ?? '--'}</span>
                <span>layers: {v2RuntimeModes?.layers ?? '--'}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className={`text-[11px] font-semibold ${isLightMode ? 'text-slate-700' : 'text-slate-300'}`}>
                输入绘图描述，或直接用语音说一句；确认后才会正式开始绘制
              </label>
              <textarea
                value={v2PromptText}
                onChange={(event) => setV2PromptText(event.target.value)}
                rows={4}
                placeholder="例如：画一个蓝色长发的二次元女生半身像，水彩风，带柔和光影"
                className={`w-full resize-none rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none transition-colors ${
                  isLightMode
                    ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-cyan-400'
                    : 'bg-[#0f1016] border-[#2a2a36] text-slate-100 placeholder:text-slate-500 focus:border-cyan-500'
                }`}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleUseLatestTranscriptForV2}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    isLightMode
                      ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                      : 'bg-[#181822] border-[#2d2d3c] text-slate-200 hover:bg-[#222231]'
                  }`}
                >
                  使用最近识别文本
                </button>
                <button
                  onClick={() => void handleStartV2DrawingJob()}
                  disabled={isV2ActionBusy || !v2PromptText.trim()}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    isV2ActionBusy || !v2PromptText.trim()
                      ? 'opacity-50 cursor-not-allowed bg-transparent border-slate-300 text-slate-400'
                      : 'bg-cyan-500 text-slate-950 border-cyan-400 hover:bg-cyan-400'
                  }`}
                >
                  {isV2Submitting ? '创建中...' : isV2PromptAwaitingConfirmation ? '确认并开始绘制' : '准备绘制'}
                </button>
                <button
                  onClick={() => void handleCancelV2DrawingJob()}
                  disabled={!canCancelV2Job}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    !canCancelV2Job
                      ? 'opacity-50 cursor-not-allowed bg-transparent border-slate-300 text-slate-400'
                      : 'bg-transparent text-rose-400 border-rose-400/50 hover:bg-rose-500/10'
                  }`}
                >
                  {isV2Cancelling ? '取消中...' : '取消任务'}
                </button>
              </div>
            </div>

            <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0c0d12] border-[#23232d]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>
                    {v2Job ? `${v2UserStatus.label} · ${v2Job.jobId}` : v2UserStatus.label}
                  </p>
                  <p className={`mt-1 text-[11px] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                    {v2UiError ?? v2FlowMessage}
                  </p>
                  {v2UiErrorDiagnostic && (
                    <p className={`mt-1 text-[10px] font-mono ${isLightMode ? 'text-rose-600' : 'text-rose-300'}`}>
                      {v2UiErrorDiagnostic}
                    </p>
                  )}
                </div>
                {v2Job && (
                  <span className={`text-[11px] font-mono px-2 py-1 rounded border ${isLightMode ? 'bg-white border-slate-200 text-slate-700' : 'bg-[#14141c] border-[#2b2b38] text-slate-300'}`}>
                    {v2UserStatus.label} · {v2Job.progressPercent}%
                  </span>
                )}
              </div>
              {v2Job && (
                <>
                  <div className={`mt-3 h-2 rounded-full overflow-hidden ${isLightMode ? 'bg-slate-200' : 'bg-[#1c1e28]'}`}>
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-300"
                      style={{ width: `${Math.max(4, v2Job.progressPercent)}%` }}
                    />
                  </div>
                  <div className={`mt-2 flex flex-wrap gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    <span>engine: {v2Job.status}</span>
                    <span>last event: {v2LastEventType ?? 'waiting'}</span>
                    <span>内部构图自动推进</span>
                    {v2Job.retryOfJobId && <span>retry of: {v2Job.retryOfJobId}</span>}
                  </div>
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0c0d12] border-[#23232d]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>Recent Jobs</p>
                  <p className={`mt-1 text-[11px] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                    {v2RecentJobsError ?? (v2RecentJobs.length === 0 ? '还没有历史 v2 drawing job。' : '点击任意任务可重新打开快照。')}
                  </p>
                </div>
                <button
                  onClick={() => void refreshV2RecentJobs()}
                  disabled={isV2RecentJobsLoading}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                    isV2RecentJobsLoading
                      ? 'opacity-50 cursor-not-allowed bg-transparent border-slate-300 text-slate-400'
                      : isLightMode
                        ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        : 'bg-[#14141c] border-[#2b2b38] text-slate-200 hover:bg-[#1b1b25]'
                  }`}
                >
                  {isV2RecentJobsLoading ? '加载中' : '刷新'}
                </button>
              </div>
              {v2RecentJobs.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {v2RecentJobs.map((job) => {
                    const isCurrentJob = v2Job?.jobId === job.jobId;
                    const recentStatus = getV2UserStatus(job);
                    return (
                      <button
                        key={job.jobId}
                        onClick={() => void handleSelectV2RecentJob(job.jobId)}
                        disabled={isCurrentJob}
                        className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                          isCurrentJob
                            ? isLightMode
                              ? 'bg-cyan-50 border-cyan-200 cursor-default'
                              : 'bg-cyan-950/20 border-cyan-500/40 cursor-default'
                            : isLightMode
                              ? 'bg-white border-slate-200 hover:bg-slate-100'
                              : 'bg-[#10121a] border-[#23232d] hover:bg-[#161824]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className={`min-w-0 truncate text-[11px] font-semibold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>
                            {summarizeV2Input(job.inputText)}
                          </p>
                          <span className={`shrink-0 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                            {recentStatus.label} · {job.progressPercent}%
                          </span>
                        </div>
                        <div className={`mt-1 flex flex-wrap gap-2 text-[10px] font-mono ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          <span>{formatV2JobTime(job.updatedAt)}</span>
                          <span>{getV2AssetReadinessLabel(job)}</span>
                          {job.retryOfJobId && <span>retry of {job.retryOfJobId}</span>}
                          {job.error && <span>{job.error.code}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {v2Job && !isTerminalV2Status(v2Job.status) && !v2HasPlayableManifest && (
              <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-cyan-50 border-cyan-200 text-cyan-700' : 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200'}`}>
                <p className="text-xs font-bold">绘画过程生成中</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  内部构图只在后端使用，用户侧直接等待 10% 到 100% 进度图。
                </p>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {V2_PROGRESS_STEPS.map((step) => {
                    const isReached = v2Job.progressPercent >= step.progressPercent;
                    return (
                      <div
                        key={step.role}
                        className={`rounded-md border px-2 py-2 text-[10px] font-mono ${
                          isReached
                            ? isLightMode
                              ? 'bg-white border-cyan-300 text-cyan-800'
                              : 'bg-cyan-500/10 border-cyan-400/40 text-cyan-100'
                            : isLightMode
                              ? 'bg-white/60 border-cyan-100 text-cyan-600/70'
                              : 'bg-black/10 border-cyan-500/20 text-cyan-200/60'
                        }`}
                      >
                        {step.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {v2Job?.status === 'failed' && (
              <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-950/20 border-rose-500/30 text-rose-200'}`}>
                <p className="text-xs font-bold">任务失败</p>
                <p className="mt-1 text-[11px] leading-relaxed">{describeV2Error(v2Job.error)}</p>
                {v2Job.error && (
                  <p className="mt-1 text-[10px] font-mono">
                    {v2JobErrorDiagnostic ?? `${v2Job.error.code} · ${v2Job.error.phase} · retryable ${v2Job.error.retryable ? 'yes' : 'no'}`}
                  </p>
                )}
                <button
                  onClick={() => void handleRetryV2DrawingJob()}
                  disabled={!canRetryV2Job}
                  className={`mt-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    !canRetryV2Job
                      ? 'opacity-50 cursor-not-allowed bg-rose-300 text-white'
                      : 'bg-rose-500 text-white hover:bg-rose-400'
                  }`}
                >
                  {isV2Retrying ? '重试中...' : '重试任务'}
                </button>
              </div>
            )}

            {v2Job?.status === 'cancelled' && (
              <div className={`rounded-lg border p-3 text-[11px] ${isLightMode ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-[#181822] border-[#2d2d3c] text-slate-300'}`}>
                当前 v2 drawing job 已取消，生成链路已停止，可作为历史任务查看。
              </div>
            )}

            {v2Job?.status === 'completed' && (
              <div className={`rounded-lg border p-3 text-[11px] ${isLightMode ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'}`}>
                当前 v2 drawing job 已完成，绘画过程帧可继续查看和回放。
              </div>
            )}

            {v2HasPlayableManifest && (
              <div className={`rounded-lg border p-3 text-[11px] ${isLightMode ? 'bg-cyan-50 border-cyan-200 text-cyan-700' : 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200'}`}>
                绘画过程已接入主视角智能声控绘图板：{v2ManifestStepCount} 步
                {v2PlaybackProcess ? ` · ${v2PlaybackProcess.actions.length} 动作` : ''}。
              </div>
            )}

            {v2EventLog.length > 0 && (
              <div className={`rounded-lg border p-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0c0d12] border-[#23232d]'}`}>
                <p className={`text-xs font-bold mb-2 ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>Recent Job Events</p>
                <div className="space-y-1.5">
                  {v2EventLog.slice(0, 6).map((event) => (
                    <div key={event.eventId} className={`flex items-center justify-between gap-3 text-[10px] font-mono ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                      <span>{event.type}</span>
                      <span>{event.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
