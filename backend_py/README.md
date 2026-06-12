# VocaSketch Python v2 Backend

`backend_py/` 是 VocaSketch 的 Python-first v2 后端骨架。它不替换现有 `backend/`，而是为后续 AI 绘图链路提供独立的 FastAPI + SSE + 异步 Drawing Job 基础设施。

## 当前阶段能力

- FastAPI v2 API 骨架
- 基于 SSE 的 drawing job 事件流
- 本地 JSON 文件 job store / asset store
- mock drawing workflow
- `preview_ready` 断点确认
- `confirm` / `cancel` / `retry` 基础控制
- 为未来 LangGraph 编排预留清晰模块边界

## 当前不包含

- 真实生图模型
- 真实 LangGraph 图
- 真实图层分解算法
- 真实图像二进制输出
- OpenAI / DashScope / ComfyUI / 其他 provider 接入

当前 `assets` 仅返回 mock metadata JSON，用于验证前后端交互和 job 生命周期。

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
- 但阶段二的 mock retry 仍然会从 `queued` 全量重跑，不会从指定 phase 局部恢复

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

下一阶段会把当前 mock workflow 替换为真正的 LangGraph 节点链路，并逐步接入：

- intent parsing node
- visual brief node
- image prompt node
- preview / final provider gateway
- layer decomposition node
- playback manifest builder
