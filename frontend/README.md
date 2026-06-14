# VocaSketch Frontend

VocaSketch 前端是一个 Vite + React 绘图工作台，用于演示语音描述、Python v2 drawing job、绘画过程播放、图层面板和本地画布辅助视图。

当前版本的正常后端流程已经全面转向 `backend`：

- Python v2：drawing job / SSE / final asset content / 10%-100% 绘画过程帧 playback
- 本地 Canvas：只保留为前端辅助展示，不再依赖旧 Node/V1 后端

默认配置仍不接入真实外部模型，不会发起真实模型网络请求；只有显式 live 环境变量启用后才会走真实 provider。

## 核心前端能力

- 浏览器 Web Speech 语音输入
- 5 秒静音后进入确认态
- 用户确认后创建 Python v2 drawing job
- recent jobs 历史查看与恢复
- runtime readiness 摘要展示
- final 图、图层和绘画过程播放
- failed / cancelled / retry 状态提示

## v2 绘画过程播放

- 如果后端提供 `playbackManifest.process`，v2 面板优先使用 canvas 动作播放器，而不是只叠加静态 layer image。
- 当前动作播放器会按时间轴展示草图、线稿、平涂扩散、阴影 `Layer: Multiply`、光照 `Layer: Add / Glow` 和最终成稿揭示。
- 旧 job 或旧 manifest 没有 `process` 时，仍 fallback 到原来的 layer/frame playback。
- 播放器只读取后端 final asset 的 `contentUrl` 和 manifest 动作数据；默认 mock/offline 路径不会触发真实外部模型请求。

## v2 状态与恢复体验

- 当前 v2 路径不会展示 preview 确认；preview 只是后端内部产物，用户直接等待绘画过程帧。
- create、cancel、retry 都有 in-flight guard，避免重复点击造成重复请求。
- failed job 只有在 `error.retryable=true` 时才会启用重试。
- 页面刷新后会恢复最近查看的 drawing job；如果任务还没结束，会继续 SSE 或 polling 跟踪。
- recent jobs 可以重新打开历史任务；terminal job 以静态历史态展示。
- readiness、recent jobs、restore、create、cancel、retry 的错误都局部展示，不会拖垮整个页面。

## v2 默认用户流程

- 语音模式默认使用浏览器 Web Speech，不经过旧 V1 command parser、legacy realtime ASR 或本地头像 trait parser。
- 用户说完后需要保持约 5 秒静音，前端才会把识别文本收口到确认态。
- 用户确认后，原始输入会提交到 Python v2 drawing job，由后端文本节点完成 intent parsing / visual brief / image prompt，再进入真实或 mock 生图；前端立即显示 10% 草图、25% 线稿、45% 平涂、65% 阴影、85% 光照、100% 完成的过程骨架。
- preview/internal composition 只作为后端内部产物，不在用户侧显示确认断点。

## 本地启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

另开一个终端启动 `backend`：

```bash
cd backend
python -m uvicorn vocasketch_backend.main:app --app-dir src --host 127.0.0.1 --port 8000
```

然后在前端环境变量中配置：

```bash
VITE_API_V2_BASE_URL=http://localhost:8000/api/v2
VITE_ENABLE_V2_VOICE_DRAWING=true
```

旧 Node/V1 后端已从默认流程移除。只有需要历史对照时才显式设置：

```bash
VITE_ENABLE_LEGACY_V1_BACKEND=true
VITE_LEGACY_API_BASE_URL=http://localhost:4000/api/v1
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
- 浏览器 Web Speech 语音输入，说完静音 5 秒后先进入确认态，用户确认后再创建 Python v2 绘画任务
- Canvas 二次元水彩头像绘制
- v2 drawing job 面板
- 完成后展示 final asset 与 10% 草图、25% 线稿、45% 平涂、65% 阴影、85% 光照、100% 完成帧
- 按 playback manifest 顺序播放 frame/layer assets
- v2 failed / cancelled / retry 状态提示
- 语义图层面板
- 角色属性面板
- 暂停、继续、回放和导出入口

## v2 失败、取消与重试体验

- failed 状态会显示后端返回的安全错误摘要：
  - error code
  - phase
  - retryable
- 只有 `retryable=true` 的 failed job 才会启用重试按钮
- retry 成功后会显示新 job id 与来源 job id
- cancelled / completed 状态会显示稳定提示，并禁用不适用的取消或重试操作
- SSE 断开时仍会切到 polling fallback，job snapshot 与事件状态保持一致

## 后续接入

- 将更多语音/工程状态能力迁移到 Python v2
- 继续优化真实生图后的确定性绘画过程播放
- 真实图层分解 provider 接入
