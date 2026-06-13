# VocaSketch Frontend

VocaSketch 前端是一个 Vite + React 绘图工作台原型，用于演示语音指令、确认流、绘图阶段、图层面板、局部修改、撤销重做和回放。

当前版本保留原有 v1 工作台逻辑，并额外提供一条最小化的 v2 drawing job 体验面板：

- v1：语音指令 + Canvas 演示工作台
- v2：连接 `backend_py` 的 drawing job / SSE / preview / final asset content

当前仍不接入真实外部模型，不会发起真实模型网络请求。

## 本地启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

如果需要联调 Stage 7 的 v2 预览链路，另开一个终端启动 `backend_py`：

```bash
cd backend_py
python -m uvicorn vocasketch_backend.main:app --app-dir src --host 127.0.0.1 --port 8000
```

然后在前端环境变量中配置：

```bash
VITE_API_BASE_URL=http://localhost:8787/api/v1
VITE_API_V2_BASE_URL=http://localhost:8000/api/v2
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
- 最小 v2 drawing job 面板
- preview / final SVG asset 展示
- 语义图层面板
- 角色属性面板
- 撤销、重做、暂停、继续、回放和导出入口

## 后续接入

- ASR/TTS 服务接入
- 后端 `/api/v1/commands/interpret` 指令解析
- v2 layer playback UI
- 工程保存和恢复
- 真实操作历史回放
