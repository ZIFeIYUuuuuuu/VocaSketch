import assert from 'node:assert/strict';
import test from 'node:test';

import {
  V2_PROGRESS_STEPS,
  buildV2ConfirmationMessage,
  describeV2Error,
  getV2AssetReadinessLabel,
  getV2ErrorDiagnostic,
  getV2FrameStepLabel,
  getV2UserStatus,
  isTerminalV2Status,
  summarizeV2Input,
  shouldAutoRestoreV2Job,
  shouldFinalizeV2Speech,
  shouldTrackV2Job,
} from './v2DrawingJob.js';

test('maps backend engineering statuses to user-facing v2 phases', () => {
  assert.equal(getV2UserStatus({ status: 'queued' }).label, '正在准备任务');
  assert.equal(getV2UserStatus({ status: 'prompt_ready' }).label, '正在准备任务');
  assert.equal(getV2UserStatus({ status: 'preview_ready' }).label, '正在生成图像');
  assert.equal(getV2UserStatus({ status: 'final_generating' }).label, '正在生成图像');
  assert.equal(getV2UserStatus({ status: 'layers_generating' }).label, '正在生成绘画过程');
  assert.equal(getV2UserStatus({ status: 'completed' }).label, '绘画完成');
});

test('keeps process skeleton labels stable', () => {
  assert.deepEqual(
    V2_PROGRESS_STEPS.map((step) => step.label),
    ['10% 草图', '25% 线稿', '45% 平涂', '65% 阴影', '85% 光照', '100% 完成'],
  );
  assert.equal(getV2FrameStepLabel({ role: 'shadow' }, 3), '65% 阴影');
});

test('translates provider errors into actionable Chinese copy', () => {
  assert.equal(describeV2Error({ code: 'PROVIDER_TIMEOUT', retryable: true }), '生成超时，当前任务可以重试。');
  assert.equal(
    describeV2Error({ code: 'PROVIDER_ERROR', retryable: true }),
    '生图网关或模型调用失败，请检查模型名、额度、权限或网关状态。',
  );
  assert.equal(
    describeV2Error({ code: 'PROVIDER_SCHEMA_ERROR', retryable: true }),
    '生图网关返回格式不兼容，请检查模型或网关兼容性。',
  );
});

test('builds compact diagnostics without raw details', () => {
  assert.equal(
    getV2ErrorDiagnostic(
      { code: 'PROVIDER_ERROR', phase: 'preview_generating', retryable: true, provider: 'openai-mixed-provider' },
      { status: 502 },
    ),
    'status 502 · PROVIDER_ERROR · preview_generating · retryable yes · openai-mixed-provider',
  );
});

test('summarizes job input and readiness for lists', () => {
  assert.equal(isTerminalV2Status('completed'), true);
  assert.equal(isTerminalV2Status('preview_ready'), false);
  assert.equal(shouldTrackV2Job('preview_ready'), true);
  assert.equal(shouldTrackV2Job('completed'), false);
  assert.equal(shouldAutoRestoreV2Job({ status: 'final_generating' }), true);
  assert.equal(shouldAutoRestoreV2Job({ status: 'completed' }), false);
  assert.equal(summarizeV2Input('  画一个    蓝发角色  '), '画一个 蓝发角色');
  assert.equal(getV2AssetReadinessLabel({ playbackManifestAssetId: 'manifest_1' }), '过程帧就绪');
});

test('builds confirmation copy and silence gating for v2 speech', () => {
  assert.equal(
    buildV2ConfirmationMessage('  画一个 蓝色长发角色  '),
    '我理解你的绘图指令是：画一个 蓝色长发角色。确认后我会先做文本识别并生成生图提示词，再开始生成绘画过程。',
  );
  assert.equal(
    shouldFinalizeV2Speech({ nowMs: 7000, lastSpeechAtMs: 1000, hasTranscript: true, silenceThresholdMs: 5000 }),
    true,
  );
  assert.equal(
    shouldFinalizeV2Speech({ nowMs: 4000, lastSpeechAtMs: 1000, hasTranscript: true, silenceThresholdMs: 5000 }),
    false,
  );
});
