# VocaSketch Backend

VocaSketch 后端当前提供最小可运行 API，用于替代前端本地 mock 指令解析的第一步。

## 启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:8787
```

## 验证

```bash
npm run lint
npm run build
```

## 当前能力

- `GET /api/v1/health`
- `GET /api/v1/config/runtime`
- `POST /api/v1/sessions`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{projectId}`
- `PUT /api/v1/projects/{projectId}/snapshot`
- `POST /api/v1/commands/interpret`
- `POST /api/v1/commands/{interpretationId}/confirm`
- `POST /api/v1/commands/{interpretationId}/reject`

当前版本使用内存存储和本地规则解析，不调用真实 ASR、TTS 或 LLM 服务。
