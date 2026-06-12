# 启动说明

本文档记录 VocaSketch 当前可运行部分和后续服务启动计划。

## 当前状态

前端绘图工作台已经可以本地启动。当前版本使用浏览器 Web Speech API 和本地 mock 指令解析，用于演示语音入口、AI 复述确认、绘图阶段、图层面板和操作历史。

后端服务尚未实现。ASR/TTS、LLM 指令解析、工程保存和恢复会在后续 PR 中接入。

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

## 环境变量

前端示例配置见 [../frontend/.env.example](../frontend/.env.example)。

```text
VITE_API_BASE_URL=http://localhost:8787/api/v1
VITE_ENABLE_MOCK_COMMANDS=true
```

根目录 `.env.example` 保留给后续后端服务使用。

请不要提交真实 API Key。

## 后端计划

后端实现后，预计使用：

```bash
cd backend
npm install
npm run dev
```

后端将负责：

- ASR/TTS 调用
- LLM 指令解析
- JSON Schema 校验
- 会话状态管理
- 绘图工程与操作历史保存

具体接口见 [api-contract.md](api-contract.md)。
