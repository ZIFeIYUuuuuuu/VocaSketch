export const V2_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export const V2_PROGRESS_STEPS = [
  { role: 'sketch', label: '10% 草图', progressPercent: 10 },
  { role: 'lineart', label: '25% 线稿', progressPercent: 25 },
  { role: 'flat_color', label: '45% 平涂', progressPercent: 45 },
  { role: 'shadow', label: '65% 阴影', progressPercent: 65 },
  { role: 'lighting', label: '85% 光照', progressPercent: 85 },
  { role: 'details', label: '100% 完成', progressPercent: 100 },
];

const STEP_LABELS_BY_ROLE = Object.fromEntries(V2_PROGRESS_STEPS.map((step) => [step.role, step.label]));

export function isTerminalV2Status(status) {
  return !!status && V2_TERMINAL_STATUSES.includes(status);
}

export function shouldTrackV2Job(status) {
  return !!status && !isTerminalV2Status(status);
}

export function shouldAutoRestoreV2Job(job) {
  return !!job?.status && !isTerminalV2Status(job.status);
}

export function shouldFinalizeV2Speech({
  nowMs,
  lastSpeechAtMs,
  hasTranscript,
  silenceThresholdMs = 5000,
}) {
  return !!hasTranscript && nowMs - lastSpeechAtMs >= silenceThresholdMs;
}

export function buildV2ConfirmationMessage(prompt) {
  const normalized = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  return `我理解你的绘图指令是：${normalized}。确认后我会先做文本识别并生成生图提示词，再开始生成绘画过程。`;
}

export function getV2FrameStepLabel(step, index) {
  return STEP_LABELS_BY_ROLE[step?.role] ?? V2_PROGRESS_STEPS[index]?.label ?? step?.label ?? '过程帧';
}

export function getV2ProcessPhaseLabel(phase, index) {
  return STEP_LABELS_BY_ROLE[phase?.role] ?? V2_PROGRESS_STEPS[index]?.label ?? phase?.label ?? '过程阶段';
}

export function summarizeV2Input(value) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized || '(empty prompt)';
}

export function formatV2JobTime(value) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getV2UserStatus(job) {
  if (!job) {
    return {
      label: '尚未创建任务',
      message: '输入或语音确认后，将创建 Python v2 drawing job。',
      phase: 'idle',
    };
  }

  if (job.status === 'failed') {
    return {
      label: '生成失败',
      message: describeV2Error(job.error),
      phase: 'failed',
    };
  }
  if (job.status === 'cancelled') {
    return {
      label: '已取消',
      message: '绘画任务已停止，可作为历史任务查看。',
      phase: 'cancelled',
    };
  }
  if (job.status === 'completed') {
    return {
      label: '绘画完成',
      message: '绘画过程帧已完成，可以查看和回放。',
      phase: 'completed',
    };
  }
  if (job.status === 'final_ready' || job.status === 'layers_generating' || job.status === 'layers_ready' || job.status === 'playback_ready') {
    return {
      label: '正在生成绘画过程',
      message: '正在整理 10% 到 100% 的绘画过程帧。',
      phase: 'process',
    };
  }
  if (job.status === 'preview_generating' || job.status === 'preview_ready' || job.status === 'final_generating') {
    return {
      label: '正在生成图像',
      message: '正在生成最终图，完成后会直接展示绘画过程帧。',
      phase: 'image',
    };
  }

  return {
    label: '正在准备任务',
    message: '正在准备绘画任务并进入图像生成。',
    phase: 'preparing',
  };
}

export function describeV2Error(error) {
  if (!error) {
    return '生成失败，请查看诊断信息后重试。';
  }
  if (error.code === 'PROVIDER_TIMEOUT') {
    return '生成超时，当前任务可以重试。';
  }
  if (error.code === 'PROVIDER_SCHEMA_ERROR') {
    return '生图网关返回格式不兼容，请检查模型或网关兼容性。';
  }
  if (error.code === 'PROVIDER_ERROR') {
    return '生图网关或模型调用失败，请检查模型名、额度、权限或网关状态。';
  }
  if (error.code === 'WORKFLOW_STATE_CONFLICT') {
    return '当前任务状态不允许这个操作。';
  }
  return error.message || '生成失败，请查看诊断信息后重试。';
}

export function getV2ErrorDiagnostic(error, apiError) {
  const fragments = [];
  if (apiError?.status) {
    fragments.push(`status ${apiError.status}`);
  }
  if (apiError?.code || error?.code) {
    fragments.push(apiError?.code ?? error.code);
  }
  if (error?.phase) {
    fragments.push(error.phase);
  }
  if (typeof (apiError?.retryable ?? error?.retryable) === 'boolean') {
    fragments.push(`retryable ${(apiError?.retryable ?? error.retryable) ? 'yes' : 'no'}`);
  }
  if (error?.provider) {
    fragments.push(error.provider);
  }
  return fragments.length > 0 ? fragments.join(' · ') : null;
}

export function getV2AssetReadinessLabel(job) {
  if (!job) {
    return 'no job';
  }
  if (job.playbackManifestAssetId) {
    return '过程帧就绪';
  }
  if (job.finalAssetId) {
    return '最终图就绪';
  }
  if (job.previewAssetId) {
    return '生成图像中';
  }
  return '等待资产';
}
