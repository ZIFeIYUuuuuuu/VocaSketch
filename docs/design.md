# VocaSketch 指令能力设计文档

## 1. 文档目的

本文记录 VocaSketch 计划支持的语音/文本指令能力、当前提交版本已经实现的能力，以及未完成部分的原因。本文面向比赛评审和后续开发者，重点说明“语音驱动绘图工作台”这条主线的设计取舍。

当前实现以 Python-first v2 Drawing Job 为主线。前端负责语音入口、确认交互、状态展示、过程播放和本地控制；后端负责异步绘图任务、provider 边界、资产存储、SSE 事件、recent jobs、runtime readiness、cancel/retry 和过程 manifest。

## 2. 产品方向

VocaSketch 的目标不是把用户语音直接送入黑盒生图接口，而是把语音指令转成可观察的绘图任务：

1. 用户用中文语音或文本描述绘图意图。
2. 系统先复述理解结果，等待用户确认。
3. 确认后创建 Drawing Job，后端生成意图、视觉 brief、图像提示词、内部构图、最终图、图层和回放 manifest。
4. 前端展示完成图、语义图层、逐步播放、事件流和最近任务。

因此，本项目优先实现“创建 -> 确认 -> 绘制 -> 图层/回放 -> 恢复/诊断”的闭环，再逐步补齐真实 ASR/TTS、真实分层和局部编辑。

## 3. 计划支持的指令能力

### 3.1 创建类指令

计划支持一句中文创建半身二次元头像。

示例：

```text
画一个蓝色长发的二次元女生半身头像，水彩素描风。
```

计划行为：

- 识别用户输入。
- 生成结构化绘图任务。
- 复述理解结果。
- 用户确认后开始完整绘制。
- 产出最终图、语义图层、过程播放和任务历史。

### 3.2 确认与取消类指令

计划支持：

- 确认
- 开始
- 可以
- 取消
- 不画了
- 重新说

设计原则是：创建、局部修改、阶段推进等可能改变画布的动作，都先确认再执行。

### 3.3 修改类指令

计划支持通过后续语音局部修改头像属性。

示例：

- 把眼睛改成紫色
- 头发改短一点
- 换成粉色背景
- 表情改成害羞
- 加一个蝴蝶结

计划行为是只影响目标部件，尽量保留其他区域。这个能力依赖稳定的语义对象模型或真实分层/局部重绘 provider。

### 3.4 绘画控制类指令

计划支持：

- 暂停
- 继续
- 撤销
- 重做
- 回放
- 导出

这些高频控制词应优先走本地低延迟路径，避免每次都调用模型。

### 3.5 任务控制与诊断类指令

计划支持：

- 取消当前后端绘图任务
- 失败后重试
- 查看最近任务
- 恢复上次任务
- 查看运行时 readiness

这部分不是传统画笔指令，但对比赛 demo 的可复现性和稳定性很关键。

### 3.6 澄清类指令

计划在语义不明确时追问，而不是直接猜测。

示例：

```text
你想调整头发、眼睛、衣服，还是背景？
```

该能力需要稳定的意图解析、置信度和歧义字段。

## 4. 当前实现总览

| 能力 | 计划状态 | 当前实现状态 | 说明 |
| --- | --- | --- | --- |
| 中文语音输入 | 计划 P0 | 已实现基础入口 | 前端使用浏览器 Web Speech API 作为默认语音识别入口；旧 v1 ASR 后端默认关闭。 |
| 文本输入 | 计划 P0 | 已实现 | v2 面板可直接输入绘图描述，便于本地复现和现场兜底。 |
| 执行前复述确认 | 计划 P0 | 已实现 | 前端在创建 v2 Drawing Job 前先生成确认文案，确认后才提交后端任务。 |
| 创建绘图任务 | 计划 P0 | 已实现 | `POST /api/v2/drawing-jobs` 创建异步任务，返回 job id 和 events url。 |
| 绘图指令理解 | 计划 P0 | 已实现边界与 mock/openai mixed mode | 默认 mock provider 返回稳定结构；openai profile 可显式启用 live text。 |
| 自动完整绘制 | 计划 P0 | 已实现 demo 闭环 | 后端自动推进 intent、prompt、preview、final、layers、playback、completed。 |
| 二次元半身头像主题 | 计划 P0 | 已实现受控范围 | mock/live prompt 均围绕 anime watercolor portrait 组织。 |
| 图层展示 | 计划 P0 | 已实现 | 后端产出 layer assets；前端展示语义图层和播放步骤。 |
| 绘画过程回放 | 计划 P1 | 已实现 | 后端生成 playback manifest/process，前端 ProcessPlaybackPlayer 播放。 |
| 最近任务 | 计划 P1 | 已实现 | `GET /api/v2/drawing-jobs` 返回 lightweight recent jobs。 |
| 恢复上次任务 | 计划 P1 | 已实现基础恢复 | 前端通过本地保存 job id 和 event seq 恢复当前/最近 v2 任务。 |
| SSE 事件流 | 计划 P1 | 已实现 | 支持 job.created、status_changed、intent.ready、prompt.ready、preview.ready、final.ready、layers.ready、playback.ready、completed、failed、cancelled。 |
| 事件续传 | 计划 P1 | 已实现 | `afterSeq` / `sinceSeq` 支持从指定序号后继续读取事件。 |
| 取消任务 | 计划 P1 | 已实现 | `POST /api/v2/drawing-jobs/{jobId}/cancel` 可取消非终态任务。 |
| 失败重试 | 计划 P1 | 已实现 | `POST /api/v2/drawing-jobs/{jobId}/retry` 从 failed job 创建新任务。 |
| 运行时 readiness | 计划 P1 | 已实现 | `GET /api/v2/runtime/readiness` 输出 provider、storage、workflow 的安全摘要。 |
| 导出作品 | 计划 P1 | 已实现本地导出 | 前端可导出当前画布 PNG 和工程 JSON。 |
| 暂停/继续 | 计划 P0 | 部分实现 | 本地画布/回放控制已实现；后端 v2 job 暂停/继续尚未做成持久状态机能力。 |
| 撤销/重做 | 计划 P0 | 部分实现 | 前端本地历史可用；旧 v1 project undo/redo 仅在 legacy 开关启用时调用，v2 后端尚未提供工程级 undo/redo。 |
| 连续局部修改 | 计划 P0 | 部分实现 | 前端有本地语义 patch 与组件重绘流程；v2 后端尚未对已完成图执行真实局部重绘。 |
| 澄清追问 | 计划 P0 | 部分实现 | 数据模型保留 ambiguities/clarification 思路；当前 v2 主线默认不因歧义中断追问。 |
| TTS 语音反馈 | 计划 P0 | 未完成默认路径 | 旧 v1 TTS client 保留但默认关闭；v2 后端未提供 TTS endpoint。 |
| 真实 ASR 服务 | 计划 P0 | 未完成默认路径 | 默认依赖浏览器 Web Speech；DashScope/Paraformer 式后端 ASR 未纳入 v2 默认运行。 |
| 真实图层分解 provider | 计划 P1 | 未完成默认路径 | 已建立 live layer provider 边界，但默认仍使用 mock/derived。 |
| 生产部署 | 计划 P2 | 未完成 | 当前以本地比赛 demo 复现为主，未提供公开线上部署地址。 |

## 5. 已实现能力细节

### 5.1 创建与确认

当前前端在用户语音识别或文本输入后，不会立即创建后端任务，而是进入等待确认状态。用户点击确认或说“确认/开始/可以”等语义后，前端才调用 v2 Drawing Job API。

这满足比赛中“语音理解后先复述，降低误识别风险”的要求。

### 5.2 后端 Drawing Job 状态机

v2 后端实现了完整异步任务状态：

```text
queued
-> parsing
-> intent_ready
-> prompt_ready
-> preview_generating
-> preview_ready
-> final_generating
-> final_ready
-> layers_generating
-> layers_ready
-> playback_ready
-> completed
```

失败和取消会进入终态：

```text
failed / cancelled
```

状态变化通过 SSE 推送，前端同时轮询快照作为兜底。

### 5.3 Provider 边界

当前 provider 设计分为：

- `mock`：默认路径，不联网，生成本地 SVG 资产，保证 demo 稳定。
- `openai`：可在显式配置并允许 live requests 后启用 live text/image/layer 的 mixed mode。
- `dashscope` / `comfyui` / `local`：当前主要是占位边界，不在默认路径发真实请求。

默认不联网是有意选择：比赛评审本地复现时不应因为 API key、网络或外部模型状态导致主流程不可用。

### 5.4 图层与回放

当前默认生成以下语义层：

- sketch
- lineart
- flat_color
- shadow
- lighting
- details

后端为每层保存 asset metadata 和 content，并生成 playback manifest。前端按 manifest 的 step、duration、opacity、blendMode 和 process actions 播放，形成“从草图到完成图”的过程证明。

### 5.5 任务历史与可恢复性

当前 v2 已支持：

- recent jobs 列表。
- 任务快照读取。
- asset metadata/content 读取。
- SSE `afterSeq` 续传。
- 前端保存当前 job id 和最后 event seq。

这使 demo 刷新后仍可恢复最近任务，而不是只能看一次性页面状态。

### 5.6 错误与安全

当前 v2 错误采用统一 envelope，并对错误信息做脱敏处理。runtime readiness 只输出 provider profile、模式、storage 摘要和 runner mode，不输出 API key、Authorization、完整本地路径或 provider 原始响应。

## 6. 未完成部分与原因

### 6.1 真实 ASR/TTS 未进入 v2 默认路径

原因：

- 比赛主流程优先保证本地可复现，浏览器 Web Speech 已能覆盖基础中文语音入口。
- 真实 ASR/TTS 需要额外 provider key、音频上传、格式兼容和错误兜底。
- 旧 v1 client 仍有 ASR/TTS 调用形态，但当前 Python v2 后端没有对应默认 endpoint；继续开放会制造不可复现的半成品路径。

后续建议：

- 在 v2 后端新增 `/api/v2/voice/asr` 与 `/api/v2/voice/tts`。
- 让浏览器 Web Speech 保持兜底，真实 ASR/TTS 作为显式配置能力。

### 6.2 局部语义修改尚未接入 v2 真实绘图链路

原因：

- 局部修改不仅是改 prompt，还需要稳定对象模型、mask/region、分层资产和重绘合成。
- 当前 v2 的 layer assets 主要用于展示和回放，不等价于可编辑 PSD 式图层。
- 如果直接对完成图重新生图，容易破坏“保留其他区域”的承诺。

后续建议：

- 为 completed job 增加 edit job 类型。
- 保存可编辑的 portrait traits 和 target region。
- 先支持低风险属性修改，如背景色、眼睛颜色、配饰开关，再扩展到发型和表情。

### 6.3 后端级暂停/继续未实现

原因：

- 当前后端任务是短周期异步 runner，主要通过 cancel/retry 管理中断和恢复。
- 真正的 pause/resume 需要每个 workflow node 都支持可中断检查、持久 checkpoint 和恢复点。
- LangGraph 边界已建立，但尚未引入持久化 checkpoint。

后续建议：

- 将长耗时节点拆成可检查 cancellation/pause token 的小步骤。
- 增加 `paused` 状态和 `/resume` endpoint。
- 对 live provider 请求定义不可暂停区间，只允许节点间暂停。

### 6.4 v2 工程级撤销/重做未实现

原因：

- 当前 v2 Drawing Job 以生成任务为中心，而不是长期可编辑 project 为中心。
- 前端本地 history 能覆盖 demo 控制，但不能作为跨设备/刷新后的真实工程历史。
- 旧 v1 project history 默认关闭，不能作为当前主线能力宣传。

后续建议：

- 新增 v2 project/session 模型。
- 把 edit job、layer state、playback manifest、export metadata 统一挂到 project revision。
- 提供 `/api/v2/projects/{id}/undo` 和 `/redo`。

### 6.5 真实图层分解 provider 未默认启用

原因：

- 真实图层分解需要模型稳定返回可消费的 layer asset 或 mask 数据。
- 当前比赛 demo 更需要稳定过程展示，mock/derived 可以保证“图层和回放”闭环不断。
- live layer provider 需要额外模型、schema 校验、失败降级和成本控制。

后续建议：

- 保持默认 mock/derived。
- 在 live layer 配置完整时启用真实分层。
- 增加 fake transport 测试和真实 provider 手动验收脚本。

### 6.6 任意主题自由绘画未实现

原因：

- MVP 明确聚焦“二次元半身头像 + 水彩素描风”。
- 任意主题会放大语音理解、构图、绘图质量和编辑范围的不确定性。
- 比赛核心是语音绘图流程，不是通用图像生成能力。

后续建议：

- 先增加少量受控主题模板。
- 每个主题都定义可编辑对象、图层和回放策略。

### 6.7 公开线上部署未完成

原因：

- 当前后端依赖本地文件资产目录，默认 demo 路径更适合本地复现。
- live provider key、CORS、持久化存储和部署成本需要额外配置。
- 比赛提交优先保证 README 本地启动可运行。

后续建议：

- 使用对象存储保存 asset content。
- 给 mock/offline 模式提供只读 demo 部署。
- live 模式通过环境变量和 secret manager 管理。

## 7. 最终提交口径

当前提交版本可以稳定展示以下完整链路：

```text
中文语音或文本输入
-> 前端复述并等待确认
-> 创建 Python v2 Drawing Job
-> 后端解析/生成 prompt/生成图像资产
-> 生成语义图层和 playback manifest
-> 前端过程播放、图层展示、完成图展示
-> recent jobs / runtime readiness / cancel / retry / event continuation
```

当前提交版本不把以下能力标记为完成：

- v2 默认真实 ASR/TTS。
- 对已完成作品的真实局部重绘。
- 后端持久化暂停/继续。
- v2 工程级撤销/重做。
- 生产级账号、分享和公开部署。

## 8. 设计结论

本项目最终优先完成的是“可复现、可解释、可回放”的比赛 demo 主线，而不是追求所有计划指令一次性商用化。未完成部分大多不是简单按钮缺失，而是需要更强的工程模型：真实语音 provider、可编辑 project revision、局部重绘数据结构、可暂停工作流和生产部署。

当前架构已经为这些能力保留了边界：v2 Drawing Job、provider gateway、asset store、SSE events、runtime readiness 和 playback manifest 可以继续承载下一阶段扩展。
