# VocaSketch Python v2 Backend

`backend_py/` 是 VocaSketch 的 Python-first v2 后端骨架。它不替换现有 `backend/`，而是为后续 AI 绘图链路提供独立的 FastAPI + SSE + 异步 Drawing Job 基础设施。

## 当前阶段能力

- FastAPI v2 API 骨架
- 基于 SSE 的 drawing job 事件流
- 本地 JSON 文件 job store / asset store
- LangGraph-backed / sequential-fallback mock drawing workflow
- `preview_ready` 断点确认
- `confirm` / `cancel` / `retry` 基础控制
- 为未来 LangGraph 编排预留清晰模块边界

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
  - 定义 provider gateway 接口与异常类型
- `providers/mock.py`
  - 提供无网络、无 API key 的 mock provider gateway
- `assets/asset_store.py`
  - 抽离 preview / final / layer / manifest 资产写入逻辑

## 当前不包含

- 真实生图模型
- 真实外部模型调用
- LangGraph 持久化 checkpoint / human-in-the-loop runtime
- 真实图层分解算法
- 真实图像二进制输出
- OpenAI / DashScope / ComfyUI / 其他 provider 接入

当前 `assets` 仅返回 mock metadata JSON，用于验证前后端交互和 job 生命周期。
当前仍未接入真实 LLM、真实生图模型、真实分层模型。
当前已接入 LangGraph 编排边界与可选 runtime，但不接任何真实外部 provider。

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

说明：

- `POST /retry` 当前会记录 `fromPhase` / `reason` 到事件 payload 里，便于审计
- 但当前 mock retry 仍然会从 `queued` 全量重跑，不会从指定 phase 局部恢复
- 当前 workflow 内部已按节点拆分，但输出仍是 mock metadata，不是真实图像
- 当前即使使用 LangGraph-backed runner，也仍然只驱动 mock provider / mock asset metadata

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

## 数据目录

- `backend_py/data/jobs/`
- `backend_py/data/assets/`

这些目录用于本地开发时保存 job、event、asset metadata，已通过 `.gitignore` 忽略。

## 下一阶段方向

下一阶段会在现有 LangGraph-backed 编排层之上逐步接入：

- intent parsing node
- visual brief node
- image prompt node
- preview / final provider gateway
- layer decomposition node
- playback manifest builder
- 真实 LLM / 生图 / 分层 provider
