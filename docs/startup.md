# 启动说明

本文档记录 VocaSketch 当前可运行部分和本地验证方式。

## 当前状态

前端绘图工作台已经可以本地启动。当前版本使用浏览器 Web Speech API 和本地 mock 指令解析，用于演示语音入口、AI 复述确认、绘图阶段、图层面板和操作历史。

后端服务已经提供最小可运行 API，包括健康检查、运行时配置、会话创建、工程创建、工程快照保存、本地 JSON 文件持久化、文本指令解析和 DashScope/千问 ASR/TTS 语音接口。文本指令解析会优先使用 OpenAI-compatible/sub2api Parser Adapter，未配置或调用失败时自动回退到本地规则解析。语音能力未配置或调用失败时，前端会回退到 Web Speech API 或字幕模式。

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
npm run build
```

当前 PR 已验证：

- TypeScript 类型检查通过
- Vite 生产构建通过

## 后端启动

```bash
cd backend
npm install
npm run dev
```

默认地址：

```text
http://localhost:4000
```

健康检查：

```text
http://localhost:4000/api/v1/health
```

## 后端验证

```bash
cd backend
npm run typecheck
npm run build
npm test
```

## 后端本地存储

后端使用 `APP_STORAGE_DIR` 指定本地 JSON 存储目录，默认是从 `backend/` 启动时的 `./data`，即 `backend/data/`。

目录结构：

```text
backend/data/
├── sessions/
│   └── sess_xxx.json
├── projects/
│   └── proj_xxx.json
├── interpretations/
│   └── interp_xxx.json
├── history/
│   └── proj_xxx.json
└── parser-costs/
    └── YYYY-MM-DD.jsonl
└── audio/
    ├── tmp/
    └── tts/
```

`backend/data/` 已被 `.gitignore` 忽略，请不要提交本地运行数据。`parser-costs/` 只记录 provider、model、延迟、fallback reason、token usage 等调用摘要，不记录 API key。

## 环境变量

前端示例配置见 [../frontend/.env.example](../frontend/.env.example)。

```text
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_ENABLE_MOCK_COMMANDS=true
```

后端示例配置见 [../backend/.env.example](../backend/.env.example)，根目录 `.env.example` 也包含同名变量。

```text
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=https://your-sub2api-host/v1
OPENAI_COMPATIBLE_MODEL=your-model
OPENAI_COMPATIBLE_TIMEOUT_MS=8000
PARSER_PROVIDER=auto
PARSER_COST_LOG=false
DASHSCOPE_API_KEY=
DASHSCOPE_ASR_MODEL=paraformer-realtime-8k-v2
# Legacy REST Qwen-ASR model, kept only for rollback/reference:
# DASHSCOPE_ASR_MODEL=qwen3-asr-flash
DASHSCOPE_TTS_MODEL=qwen3-tts-flash
VOICE_ASR_TIMEOUT_MS=15000
VOICE_TTS_TIMEOUT_MS=15000
VOICE_MAX_AUDIO_MB=10
VOICE_MAX_TTS_CHARS=300
```

`OPENAI_COMPATIBLE_BASE_URL` 可以填 `https://host/v1`，也可以直接填 `https://host/v1/chat/completions`。`PARSER_PROVIDER=local` 会强制使用本地规则解析；`auto` 在配置完整时远端优先；`openai-compatible` 会优先远端，但失败时仍回退本地规则解析，保证演示不中断。

请不要提交真实 API Key。

## 后端后续计划

后续后端将继续补齐：

- 流式 ASR/TTS 体验
- 绘图工程与操作历史恢复

具体接口见 [api-contract.md](api-contract.md)。
