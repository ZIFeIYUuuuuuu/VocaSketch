# VocaSketch Frontend

## v2 Process Playback

- 如果后端 `playbackManifest.process.version=process-v1`，v2 面板优先使用 canvas 动作播放器，而不是只叠加静态 layer image。
- 当前动作播放器会按时间轴展示草图、线稿、平涂扩散、阴影 `Layer: Multiply`、光照 `Layer: Add / Glow`、最终 `Eye Spark`。
- 旧 job 或旧 manifest 没有 `process` 时，仍 fallback 到原来的 layer/frame playback。
- 播放器只读取后端 final asset 的 `contentUrl` 和 manifest 动作数据；默认 mock/offline 路径不会触发真实外部模型请求。

## Stage 15 v2 Operation Guards

- The v2 panel guards create, cancel, and retry with a shared in-flight state so repeated clicks do not send overlapping workflow requests.
- The current v2 user path does not show a preview or ask for preview confirmation; any backend confirmation breakpoint is auto-advanced so the user waits for drawing-process frames.
- Failed jobs only enable retry when the backend snapshot marks `error.retryable=true`.
- Cancelled and completed jobs are shown as terminal history views; cancelled jobs no longer imply generation is still running.
- Retry success switches the panel to the new job and keeps the source job visible through `retryOfJobId`.
- The default v2 backend profile remains `mock`; the default frontend path does not trigger real external model requests.

## Stage 14 v2 Error Diagnostics

- The frontend v2 API client recognizes the backend error envelope:
  - `error.code`
  - `error.message`
  - `error.retryable`
  - `error.details`
- The v2 panel shows a readable error message plus compact diagnostics such as HTTP status, error code, and retryable flag.
- Failed drawing jobs still use the job snapshot `error` object for retry gating.
- Readiness, recent jobs, restore, create, confirm, cancel, and retry errors stay local to the v2 panel and do not break the local canvas workspace.
- The default v2 backend profile remains `mock`; the default frontend path does not trigger real external model requests.

## Stage 13 v2 Session Restore

- The v2 panel stores the currently viewed drawing job id in browser storage.
- On page refresh or reopen, the panel restores that job snapshot, reloads final/manifest metadata, and resumes tracking if the job is still active.
- Completed, failed, or cancelled jobs restore as static history views.
- The SSE client can reconnect with `afterSeq` so the backend only replays events after the last seen sequence.
- If the saved job is missing or invalid, the panel clears the saved state and keeps the rest of the app usable.
- The default v2 backend profile remains `mock`; the default frontend path does not trigger real external model requests.

## Stage 12 v2 Panel Continuity

- The v2 drawing panel can now load recent jobs from `GET /api/v2/drawing-jobs`.
- Recent jobs show status, prompt summary, asset readiness, retry source, and last update time.
- Clicking a recent job reopens its snapshot; active non-terminal jobs can keep using SSE/polling, while terminal jobs are shown as static history.
- The panel also reads `GET /api/v2/runtime/readiness` and displays provider profile, runner mode, network mode, and text/internal-composition/final/layer modes.
- The default v2 backend profile remains `mock`; the default frontend path does not trigger real external model requests.

VocaSketch 前端是一个 Vite + React 绘图工作台，用于演示语音描述、Python v2 drawing job、绘画过程播放、图层面板和本地画布辅助视图。

当前版本的正常后端流程已经全面转向 `backend`：

- Python v2：drawing job / SSE / final asset content / 10%-100% 绘画过程帧 playback
- 本地 Canvas：只保留为前端辅助展示，不再依赖旧 Node/V1 后端

默认配置仍不接入真实外部模型，不会发起真实模型网络请求；只有显式 live 环境变量启用后才会走真实 provider。

## 本地启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

另开一个终端启动 `backend`：

```bash
cd backend
python -m uvicorn vocasketch_backend.main:app --app-dir src --host 127.0.0.1 --port 8000
```

然后在前端环境变量中配置：

```bash
VITE_API_V2_BASE_URL=http://localhost:8000/api/v2
VITE_ENABLE_V2_VOICE_DRAWING=true
```

旧 Node/V1 后端已从默认流程移除。只有需要历史对照时才显式设置：

```bash
VITE_ENABLE_LEGACY_V1_BACKEND=true
VITE_LEGACY_API_BASE_URL=http://localhost:4000/api/v1
```

## 可用脚本

```bash
npm run dev      # 启动开发服务器
npm run lint     # TypeScript 类型检查
npm run build    # 生产构建
npm run preview  # 预览构建结果
```

## 当前能力

- 语音输入入口和麦克风状态展示
- 浏览器 Web Speech 语音输入，识别文本直接提交到 Python v2
- Canvas 二次元水彩头像绘制
- v2 drawing job 面板
- 完成后展示 final asset 与 10% 草图、25% 线稿、45% 平涂、65% 阴影、85% 光照、100% 完成帧
- 按 playback manifest 顺序播放 frame/layer assets
- v2 failed / cancelled / retry 状态提示
- 语义图层面板
- 角色属性面板
- 暂停、继续、回放和导出入口

## v2 失败、取消与重试体验

- failed 状态会显示后端返回的安全错误摘要：
  - error code
  - phase
  - retryable
- 只有 `retryable=true` 的 failed job 才会启用重试按钮
- retry 成功后会显示新 job id 与来源 job id
- cancelled / completed 状态会显示稳定提示，并禁用不适用的取消或重试操作
- SSE 断开时仍会切到 polling fallback，job snapshot 与事件状态保持一致

## 后续接入

- 将更多语音/工程状态能力迁移到 Python v2
- 继续优化真实生图后的确定性绘画过程播放
- 真实图层分解 provider 接入
