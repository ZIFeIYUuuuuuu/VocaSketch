# VocaSketch Python v2 Backend

## Stage 15 Cancel / Retry / Timeout Consistency

- Active jobs can be cancelled; cancelled jobs are terminal and should not later advance to preview, final, layers, playback, or completed.
- Cancelling terminal jobs returns the v2 error envelope with `WORKFLOW_STATE_CONFLICT` and does not append new status events.
- Retrying is only allowed for failed jobs. A retry creates a new job with `retryOfJobId`, starts a fresh event sequence at `seq=1`, and does not copy the previous job error into the new public snapshot.
- Provider timeout, schema, and generic provider failures converge through stable codes: `PROVIDER_TIMEOUT`, `PROVIDER_SCHEMA_ERROR`, and `PROVIDER_ERROR`.
- Failed snapshots, failed status events, and `job.failed` events preserve safe diagnostics while redacting secrets.
- The default provider profile remains `mock`; the default runtime path stays offline and does not make real external model requests.

## Stage 14 Error Contract / State Invariants

- v2 HTTP errors use a stable envelope:
  - `error.code`
  - `error.message`
  - `error.retryable`
  - `error.details`
- Drawing job, asset, runtime, and event-continuation errors are secret-safe and avoid stack traces, API keys, raw provider envelopes, and full local paths.
- Job status events use strictly increasing `seq` values.
- Job progress is expected to stay within `0..100` and not move backward across status-change events.
- Terminal jobs (`completed`, `failed`, `cancelled`) keep `completedAt`; non-terminal jobs should not set it.
- Snapshot status and latest status-change event are expected to converge to the same terminal state.
- The default provider profile remains `mock`; the default runtime path stays offline and does not make real external model requests.

## Stage 13 Session Resume / Event Continuation

- `GET /api/v2/drawing-jobs/{jobId}/events` now supports event continuation.
- Query params:
  - `afterSeq`: replay only events with `seq > afterSeq`, then continue live SSE.
  - `sinceSeq`: alias for the same behavior.
- Invalid continuation values return `400`; missing jobs still return `404`.
- This is still file-backed SSE history plus in-memory live fanout, not a durable message queue.
- The default provider profile remains `mock`; the default runtime path stays offline and does not make real external model requests.

## Stage 12 Recent Jobs / Runtime Visibility

- `GET /api/v2/drawing-jobs` returns a lightweight recent-job list for the v2 panel.
- Query params:
  - `limit`: 1-50, default 10
  - `status`: optional `JobStatus` filter, for example `failed` or `completed`
- List items intentionally exclude large fields such as `layerAssets`, `playbackManifest`, `parsedIntent`, `visualBrief`, and `imagePrompt`.
- Failed job summaries include only safe error fields: `code`, `phase`, `message`, `retryable`, and `provider`.
- Error text is redacted before list output so API keys, bearer tokens, authorization values, and URL query secrets are not exposed.
- `GET /api/v2/runtime/readiness` is still the safe read-only endpoint for provider profile, offline/live/placeholder mode, storage summary, and graph runner mode.
- The default provider profile remains `mock`; the default runtime path does not make real external model requests.

`backend_py/` 是 VocaSketch 的 Python-first v2 后端骨架。它不替换现有 `backend/`，而是为后续 AI 绘图链路提供独立的 FastAPI + SSE + 异步 Drawing Job 基础设施。

## 当前阶段能力

- FastAPI v2 API 骨架
- 基于 SSE 的 drawing job 事件流
- 本地 JSON 文件 job store / asset store
- LangGraph-backed / sequential-fallback mock drawing workflow
- Provider registry / config / placeholder gateway 框架
- 可选真实 LLM 文本节点边界
- 可选真实 image provider 边界
- File-backed asset content 层
- `preview_ready` 断点确认
- `confirm` / `cancel` / `retry` 基础控制
- Runtime readiness / provider mode 只读信息
- 更明确的 provider 配置校验与 job failed 事件观测信息
- 为未来 LangGraph 编排预留清晰模块边界

## Stage 11 Runtime Readiness / Config / Observability

- 新增只读 readiness endpoint：
  - `GET /api/v2/runtime/readiness`
- readiness 会返回安全摘要：
  - 当前 provider profile
  - `allowLiveRequests`
  - `networkEnabled` / `configured` / `placeholder`
  - text / preview / final / layers / playback 当前是 `mock`、`live` 还是 `placeholder`
  - data / jobs / assets 目录是否存在、启动阶段是否确认可写
  - LangGraph 是否可用、当前 runner mode
- readiness 不会输出：
  - API key
  - Authorization header
  - secret query 原文
  - 完整 provider envelope
  - 本机完整 data path
- 默认 `mock` profile 会明确显示 offline/mock，不会联网
- readiness GET 本身不做写盘探针，只返回启动阶段缓存的 storage 摘要
- OpenAI 配置错误现在会以 `ProviderConfigError` 给出稳定语义：
  - `VOCASKETCH_OPENAI_TIMEOUT_SECONDS` 必须是正数
  - 如果提供 `VOCASKETCH_OPENAI_API_BASE_URL`，必须是绝对 `http(s)` URL
  - 默认 mock profile 不会被外部脏 OpenAI env 破坏
- job failed 事件会包含安全定位信息：
  - `code`
  - `phase`
  - `provider`
  - `retryable`
  - `details.node` 或其他非 secret 细节
- failed event 不包含 stack trace、API key、raw provider payload

## Stage 10 Layer Decomposition / Playback

- 默认 provider profile 仍是 `mock`
- 默认运行路径仍不联网，layer decomposition / playback manifest 继续由本地 mock provider 完成
- `openai` profile 现在支持更细的 mixed mode：
  - `live text + mock image + mock layers`
  - `live text + live image + mock layers`
  - `live text + live image + live layers`
- 只有在同时满足以下条件时，layer decomposition 才会启用真实 layer transport：
  - `VOCASKETCH_PROVIDER_PROFILE=openai`
  - `VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=1`
  - `VOCASKETCH_OPENAI_API_BASE_URL` 已配置
  - `VOCASKETCH_OPENAI_API_KEY` 已配置
  - `VOCASKETCH_OPENAI_RESPONSE_MODEL` 已配置
  - `VOCASKETCH_OPENAI_LAYER_MODEL` 已配置
- 如果只开启了 live text 或 live image，但没有 `layerModel`，系统会继续走 mock layer decomposition，保证前端 playback 体验闭环不断
- 当前 layer transport 只建立了边界与 fake transport 测试，不作为默认路径启用
- layer asset metadata 现在会稳定包含：
  - `role`
  - `order`
  - `opacity`
  - `blendMode`
  - `sourceFinalAssetId`
- playback manifest steps 现在面向前端播放语义稳定输出：
  - `stepId`
  - `order`
  - `role`
  - `label`
  - `assetId`
  - `contentUrl`
  - `startMs`
  - `durationMs`
  - `opacityFrom`
  - `opacityTo`
  - `blendMode`
  - `easing`
  - `transition`
- 当前前端 v2 panel 已能按 manifest 顺序播放 `sketch -> lineart -> flat_color -> shadow -> lighting -> details`
- fake transport 测试不发真实网络请求

## Stage 9 Image Provider 层

- 默认 provider profile 仍是 `mock`
- 默认运行路径仍不联网，preview / final 继续生成本地 SVG mock asset
- `openai` profile 现在支持更细的 mixed mode：
  - `live text + mock image`
  - `live text + live image`
- 只有在同时满足以下条件时，preview / final 才会启用真实 image transport：
  - `VOCASKETCH_PROVIDER_PROFILE=openai`
  - `VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=1`
  - `VOCASKETCH_OPENAI_API_BASE_URL` 已配置
  - `VOCASKETCH_OPENAI_API_KEY` 已配置
  - `VOCASKETCH_OPENAI_RESPONSE_MODEL` 已配置
  - `VOCASKETCH_OPENAI_IMAGE_MODEL` 已配置
- 如果只配置了 live text，但没有 `imageModel`，系统会继续走 `live text + mock image`，这样前端仍能拿到完整 preview/final 闭环
- image transport 当前只建立了 OpenAI-compatible endpoint 边界与 fake transport 测试，不作为默认路径启用
- live image asset 会以 `png` / `jpeg` / `webp` 等真实图片 bytes 落盘，并继续复用同一个 `contentUrl`
- layer decomposition / playback 仍然是 mock，不是真实图层分解
- fake transport 测试不发真实网络请求

## Stage 8 文本 LLM Provider 层

- 默认 provider profile 仍是 `mock`
- 只有在显式设置 `VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=1` 且配置齐全时，`openai` profile 才会启用真实文本 transport
- 当前真实 LLM 只覆盖：
  - `parse_intent`
  - `build_visual_brief`
  - `build_image_prompt`
- preview / final 默认仍走本地 mock SVG asset provider；Stage 9 中可以在显式开启时切到 live image transport
- 这意味着当前是可选的 mixed mode：
  - live text intelligence
  - local mock image assets，或在显式开启后使用 live preview/final image
- 测试使用 fake transport，不发真实网络请求

## Stage 6 资产内容层

- `GET /api/v2/assets/{assetId}` 继续返回资产 metadata
- 新增 `GET /api/v2/assets/{assetId}/content` 返回实际内容文件
- preview / final / layer asset 现在会落本地内容文件，并提供稳定 `contentUrl`
- 默认 mock provider 生成的是本地 SVG 占位图，`mimeType=image/svg+xml`
- Stage 9 live image path 会把真实图片 bytes 落地为 `png` / `jpeg` / `webp` 文件，并复用相同的 metadata / content contract
- playback manifest 也会落成本地 JSON 文件，便于调试和前端读取
- 如果 metadata 存在但内容文件丢失，content endpoint 返回 `410 Gone`

## Stage 5 Provider 层

- 默认 provider profile 是 `mock`
- 通过 `VOCASKETCH_PROVIDER_PROFILE` 选择 provider profile
  - 当前支持：`mock`、`openai`、`dashscope`、`comfyui`、`local`
- `mock` 会正常完成当前整条 mock workflow
- 非 `mock` profile 默认仍走 placeholder provider
  - 不发真实网络请求
  - 不读取或输出 API key
  - 不会静默 fallback 成功
  - 缺少最低限度的非 secret 公共配置时，应用会在启动时 fail fast
  - 公共配置齐全但未显式开启 live 请求时，应用可启动，但 job 会在执行节点时明确返回 `ProviderError`
  - 只有 `openai` profile 在显式 live 开关开启后，才会进入 mixed mode
  - 未配置 `imageModel`：真实文本节点 + mock 资产
  - 配置 `imageModel`：真实文本节点 + 真实 preview/final image + mock layers/playback
- route 层和 workflow service 层都不感知具体 provider 类型，只依赖统一的 `ProviderGateway`

## Stage 4 编排层

- 当 `langgraph` 可用且未被显式关闭时，`DrawingGraphRunner` 会优先使用 LangGraph-backed runner
- 当 `langgraph` 不可用，或设置 `VOCASKETCH_DISABLE_LANGGRAPH=1` 时，会自动 fallback 到 sequential runner
- fallback 不影响 API 启动，也不改变外部 job 状态机语义
- FastAPI route 层不感知 LangGraph，仍只依赖 `workflow.py` service
- 当前 service 层仍负责 job 状态迁移、确认断点、SSE 事件发布；LangGraph 主要承载节点执行与可替换的 flow graph 边界

## 阶段三/四结构

- `workflows/state.py`
  - 定义 LangGraph-ready `DrawingWorkflowState`
- `workflows/nodes.py`
  - 拆分独立节点：
    - `parse_intent_node`
    - `build_visual_brief_node`
    - `build_image_prompt_node`
    - `generate_preview_node`
    - `generate_final_image_node`
    - `decompose_layers_node`
    - `build_playback_manifest_node`
- `workflows/drawing_graph.py`
  - Stage 4 起提供真正的 LangGraph-backed / fallback runner
  - 对 service 层保持稳定接口
  - 当前已支持按 node 和按 preconfirm/postconfirm flow 编译 graph，但完整 job 生命周期仍由 `workflow.py` 协调
- `providers/base.py`
  - 定义 provider gateway 接口、capabilities、runtime info 与异常类型
- `providers/config.py`
  - 解析 provider profile 与非 secret 公共配置
- `providers/registry.py`
  - 根据 profile 构建默认 mock provider 或 placeholder provider
- `providers/mock.py`
  - 提供无网络、无 API key 的 mock provider gateway
- `providers/placeholders.py`
  - 提供 `OpenAI` / `DashScope` / `ComfyUI` / `Local` 的占位 provider
- `assets/asset_store.py`
  - 统一管理 preview / final / layer / manifest 的 metadata 与内容文件写入逻辑

## 当前不包含

- 真实生图模型
- 真实外部模型调用
- LangGraph 持久化 checkpoint / human-in-the-loop runtime
- 真实图层分解算法
- 真实图像二进制输出
- 默认运行路径下的真实外部模型调用
- 真正可计费或会联网的 DashScope / ComfyUI / 本地生成服务接入
- 真实生图与分层 provider 接入

当前 `assets` 会返回 metadata，并为 mock image asset 生成本地 SVG 文件内容。
当前仍未接入真实分层模型。
当前已接入 LangGraph 编排边界、provider registry、可选真实文本 LLM provider 边界，以及可选真实生图 provider 边界；默认仍不接任何真实外部 provider。

## 安装依赖

推荐使用虚拟环境：

```bash
cd backend_py
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

如果暂时不做可编辑安装，也可以：

```bash
cd backend_py
pip install fastapi uvicorn pydantic
```

如果想提前准备下一阶段 graph runtime，可以安装可选依赖：

```bash
pip install -e .[graph]
```

如果你想强制验证 fallback 行为，可以在启动前设置：

```bash
set VOCASKETCH_DISABLE_LANGGRAPH=1
```

如果你想显式指定 provider profile，可以设置：

```bash
set VOCASKETCH_PROVIDER_PROFILE=mock
```

当前非 `mock` profile 只用于验证注册与占位行为。示例：

```bash
set VOCASKETCH_PROVIDER_PROFILE=openai
set VOCASKETCH_OPENAI_RESPONSE_MODEL=gpt-placeholder
set VOCASKETCH_OPENAI_IMAGE_MODEL=image-placeholder
```

如果你要显式测试 Stage 8/9 的 live provider 边界，需要额外开启：

```bash
set VOCASKETCH_PROVIDER_PROFILE=openai
set VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=1
set VOCASKETCH_OPENAI_API_BASE_URL=https://api.openai.com/v1
set VOCASKETCH_OPENAI_API_KEY=your-key
set VOCASKETCH_OPENAI_RESPONSE_MODEL=gpt-structured-model
set VOCASKETCH_OPENAI_IMAGE_MODEL=gpt-image-model
```

如果你要显式测试 Stage 10 的 live layer provider 边界，还需要补上：

```bash
set VOCASKETCH_OPENAI_LAYER_MODEL=gpt-layer-model
```

注意：

- 默认不要开启 live requests
- README 示例不要把真实 key 写进仓库
- 自动化测试仍使用 fake text transport / fake image transport / fake layer transport，不发网络请求

## 启动

```bash
cd backend_py
python -m uvicorn vocasketch_backend.main:app --app-dir src --reload --port 8000
```

默认 API 基地址：

```text
http://127.0.0.1:8000
```

## API 列表

- `POST /api/v2/drawing-jobs`
- `GET /api/v2/drawing-jobs/{jobId}`
- `GET /api/v2/drawing-jobs/{jobId}/events`
- `POST /api/v2/drawing-jobs/{jobId}/confirm`
- `POST /api/v2/drawing-jobs/{jobId}/cancel`
- `POST /api/v2/drawing-jobs/{jobId}/retry`
- `GET /api/v2/assets/{assetId}`
- `GET /api/v2/assets/{assetId}/content`
- `GET /api/v2/runtime/readiness`

说明：

- `POST /retry` 当前会记录 `fromPhase` / `reason` 到事件 payload 里，便于审计
- 但当前 mock retry 仍然会从 `queued` 全量重跑，不会从指定 phase 局部恢复
- 当前 workflow 内部已按节点拆分
- 当前即使使用 LangGraph-backed runner，playback 仍由 workflow service 保持节点级状态推进
- 当前 preview / final 默认仍由本地 SVG mock asset 提供；只有显式 live image 配置齐全时才会请求 image transport
- 当前 layers 默认仍由本地 SVG mock provider 提供；只有显式 live layer 配置齐全时才会请求 layer transport
- 当前默认 profile 仍不会发真实请求
- 当前 `openai` profile 只有显式 live 开关开启时，才会让文本节点与可选 image / layer 节点发起真实请求；自动化测试不会这样做
- 不要把 API key 写入代码、日志、事件 payload、job metadata 或 README 示例

## 典型验证流程

1. 创建 job

```bash
curl -X POST http://127.0.0.1:8000/api/v2/drawing-jobs ^
  -H "content-type: application/json" ^
  -d "{\"inputText\":\"画一个蓝色长发的二次元女生半身像，水彩风\",\"locale\":\"zh-CN\"}"
```

2. 订阅 SSE

```bash
curl http://127.0.0.1:8000/api/v2/drawing-jobs/<jobId>/events
```

3. 当状态到达 `preview_ready` 后确认继续

```bash
curl -X POST http://127.0.0.1:8000/api/v2/drawing-jobs/<jobId>/confirm ^
  -H "content-type: application/json" ^
  -d "{}"
```

4. 拉取 job 快照

```bash
curl http://127.0.0.1:8000/api/v2/drawing-jobs/<jobId>
```

5. 拉取 asset metadata

```bash
curl http://127.0.0.1:8000/api/v2/assets/<assetId>
```

6. 拉取 asset content

```bash
curl http://127.0.0.1:8000/api/v2/assets/<assetId>/content
```

## 数据目录

- `backend_py/data/jobs/`
- `backend_py/data/assets/`

这些目录用于本地开发时保存 job、event、asset metadata 以及 asset content 文件，已通过 `.gitignore` 忽略。

## 下一阶段方向

下一阶段会在现有 LangGraph-backed 编排层之上逐步接入：

- intent parsing node
- visual brief node
- image prompt node
- preview / final provider gateway
- layer decomposition node
- playback manifest builder
- 真实 LLM / 生图 / 分层 provider

前端下一步可以直接使用 `asset.contentUrl` 显示 preview / final / layers，而不必先读取本地文件路径。
