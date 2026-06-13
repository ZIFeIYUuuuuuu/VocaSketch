# 启动说明

本文档记录 VocaSketch 当前可运行部分和本地验证方式。

## 当前状态

VocaSketch 的正常运行路径已经全面转向 Python `backend` v2 后端。前端使用浏览器 Web Speech API 获取文本，并把绘画描述直接提交给 v2 Drawing Job；后端负责真实/模拟 provider、资产文件、SSE 事件、最近任务、runtime readiness 和绘画过程播放 manifest。

旧 Node/V1 后端已经从默认流程移除。前端默认不会请求 `/api/v1`；当前只需要启动 `backend/` 这一套 Python 后端。

## 前端启动

```bash
cd frontend
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

## 前端验证

```bash
cd frontend
npm run lint
```

如需验证生产构建，可运行 `npm run build`；该命令会写入 `frontend/dist/`。

## Python v2 后端启动

```bash
cd backend
python -m uvicorn vocasketch_backend.main:app --app-dir src --host 127.0.0.1 --port 8000
```

默认地址：

```text
http://localhost:8000
```

runtime readiness：

```text
http://localhost:8000/api/v2/runtime/readiness
```

## Python v2 后端验证

```bash
python -B -m unittest discover -s backend/tests -v
python -B -m compileall backend/src backend/tests
```

## 后端本地存储

Python v2 后端使用 `VOCASKETCH_BACKEND_DATA_DIR` 指定本地 JSON 与资产存储目录，默认是 `backend/data/`。

目录结构：

```text
backend/data/
├── jobs/
├── events/
└── assets/
    ├── content/
    └── metadata/
```

`backend/data/` 已被 `.gitignore` 忽略，请不要提交本地运行数据。runtime readiness、job metadata、event payload 和 asset metadata 都不应记录 API key。

## 环境变量

前端示例配置见 [../frontend/.env.example](../frontend/.env.example)。

```text
VITE_API_V2_BASE_URL=http://localhost:8000/api/v2
VITE_ENABLE_V2_VOICE_DRAWING=true
```

Python v2 后端常用配置：

```text
VOCASKETCH_BACKEND_DATA_DIR=backend/data
VOCASKETCH_BACKEND_HOST=127.0.0.1
VOCASKETCH_BACKEND_PORT=8000
VOCASKETCH_PROVIDER_PROFILE=mock
VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=0
VOCASKETCH_OPENAI_API_BASE_URL=
VOCASKETCH_OPENAI_API_KEY=
VOCASKETCH_OPENAI_RESPONSE_MODEL=
VOCASKETCH_OPENAI_IMAGE_API_BASE_URL=
VOCASKETCH_OPENAI_IMAGE_API_KEY=
VOCASKETCH_OPENAI_IMAGE_MODEL=
```

默认 `mock` 不联网。只有显式设置 `VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS=1` 且 provider 配置齐全时，才会调用真实模型。

兼容说明：

- 新的标准命名是 `VOCASKETCH_BACKEND_DATA_DIR`、`VOCASKETCH_BACKEND_HOST`、`VOCASKETCH_BACKEND_PORT`
- 旧的 `VOCASKETCH_BACKEND_PY_*` 仍可读取，便于本地迁移
- 更早期文档里出现过的 `VOCASKETCH_DATA_DIR` 也仍兼容，但不再推荐继续使用

请不要提交真实 API Key。

## 历史说明

旧 `/api/v1` 合约仅作为历史归档保留，详见 [archive/api-v1-contract.md](archive/api-v1-contract.md)。正常开发不要再按该合约启动服务。后续工作继续围绕 Python v2：

- 优化真实生图后的确定性绘画过程播放
- 将更多工程状态能力迁移到 v2
- 接入生产级真实图层分解 provider
