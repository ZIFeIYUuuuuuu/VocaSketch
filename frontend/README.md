# VocaSketch Frontend

VocaSketch 前端是一个 Vite + React 绘图工作台原型，用于演示语音指令、确认流、绘图阶段、图层面板、局部修改、撤销重做和回放。

当前版本使用浏览器 Web Speech API 和本地 mock 指令解析，不包含真实 ASR/TTS/LLM 后端接入。

## 本地启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
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
- 本地中文指令解析 mock
- AI 复述确认流程
- 自动绘画和分阶段确认模式
- Canvas 二次元水彩头像绘制
- 语义图层面板
- 角色属性面板
- 撤销、重做、暂停、继续、回放和导出入口

## 后续接入

- ASR/TTS 服务接入
- 后端 `/api/v1/commands/interpret` 指令解析
- 工程保存和恢复
- 真实操作历史回放
