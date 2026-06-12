# VocaSketch Python v2 Backend

`backend_py/` 是 VocaSketch 的 Python-first v2 后端骨架。它不替换现有 `backend/`，而是为后续 AI 绘图链路提供独立的 FastAPI + SSE + 异步 Drawing Job 基础设施。

## 当前阶段能力

- FastAPI v2 API 骨架
- 基于 SSE 的 drawing job 事件流
- 本地 JSON 文件 job store / asset store
- LangGraph-backed / sequential-fallback mock drawing workflow
- Provider registry / config / placeholder gateway 框架
- File-backed asset content 层
- `preview_ready` 断点确认
- `confirm` / `cancel` / `retry` 基础控制
- 为未来 LangGraph 编排预留清晰模块边界

## Stage 6 资产内容层

- `GET /api/v2/assets/{assetId}` 继续返回资产 metadata
- 新增 `GET /api/v2/assets/{assetId}/content` 返回实际内容文件
- preview / final / layer asset 现在会落本地内容文件，并提供稳定 `contentUrl`
- 默认 mock provider 生成的是本地 SVG 占位图，`mimeType=image/svg+xml`
- playback manifest 也会落成本地 JSON 文件，便于调试和前端读取
- 如果 metadata 存在但内容文件丢失，content endpoint 返回 `410 Gone`

## Stage 5 Provider 层

- 默认 provider profile 是 `mock`
- 通过 `VOCASKETCH_PROVIDER_PROFILE` 选择 provider profile
  - 当前支持：`mock`、`openai`、`dashscope`、`comfyui`、`local`
- `mock` 会正常完成当前整条 mock workflow
- 非 `mock` profile 目前只会创建 placeholder provider
  - 不发真实网络请求
  - 不读取或输出 API key
  - 不会静默 fallback 成功
  - 缺少最低限度的非 secret 公共配置时，应用会在启动时 fail fast
  - 公共配置齐全时，应用可启动，但 job 会在执行节点时明确返回 `ProviderError`
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
- 真正可计费或会联网的 OpenAI / DashScope / ComfyUI / 本地生成服务接入

当前 `assets` 会返回 metadata，并为 mock image asset 生成本地 SVG 文件内容。
当前仍未接入真实 LLM、真实生图模型、真实分层模型。
当前已接入 LangGraph 编排边界、provider registry 与 placeholder provider，但不接任何真实外部 provider。

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

说明：

- `POST /retry` 当前会记录 `fromPhase` / `reason` 到事件 payload 里，便于审计
- 但当前 mock retry 仍然会从 `queued` 全量重跑，不会从指定 phase 局部恢复
- 当前 workflow 内部已按节点拆分，但输出仍是 mock metadata，不是真实图像
- 当前即使使用 LangGraph-backed runner，也仍然只驱动 mock provider / 本地 SVG mock asset
- 当前即使选择非 `mock` provider profile，也只会进入 placeholder provider，不会发真实请求
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

5. 拉取 mock asset metadata

```bash
curl http://127.0.0.1:8000/api/v2/assets/<assetId>
```

6. 拉取 mock asset content

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
