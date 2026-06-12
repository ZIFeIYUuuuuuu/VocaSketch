# VocaSketch Backend

VocaSketch 后端当前提供最小可运行 API，用于替代前端本地 mock 指令解析的第一步。

## 启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:4000
```

## 验证

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

## 当前能力

- `GET /api/v1/health`
- `GET /api/v1/config/runtime`
- `POST /api/v1/sessions`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{projectId}?sessionId={sessionId}`
- `PUT /api/v1/projects/{projectId}/snapshot`
- `POST /api/v1/commands/interpret`
- `POST /api/v1/commands/{interpretationId}/confirm`
- `POST /api/v1/commands/{interpretationId}/reject`

当前版本使用本地 JSON 文件存储。文本指令解析通过 Parser Adapter 处理：配置 OpenAI-compatible/sub2api 后会优先调用远端模型；未配置、超时、网络失败或模型输出不合法时自动回退到本地规则解析。ASR/TTS 暂未接入真实服务。

Parser 相关环境变量：

```text
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_MODEL=
OPENAI_COMPATIBLE_TIMEOUT_MS=8000
PARSER_PROVIDER=auto
PARSER_COST_LOG=false
```

默认存储目录：

```text
backend/data
```
