# 项目结构

本文档描述 VocaSketch 当前推荐阅读顺序，以及各目录的职责边界。

## 顶层目录

```text
.
├── backend/                    # Python v2 后端：drawing jobs、资产、provider、SSE、tests
├── docs/                       # 当前有效文档
│   └── archive/                # 历史归档文档
├── frontend/                   # React + Vite 前端工作台
├── tools/                      # 本地开发辅助脚本
├── output/                     # 本地运行产物（已忽略，不提交）
├── .playwright-cli/            # 本地浏览器自动化缓存（已忽略，不提交）
├── .codex-run-logs/            # 本地代理运行日志（已忽略，不提交）
├── AGENTS.md                   # 仓库协作规则
├── README.md                   # 中文入口
└── README.en.md                # 英文入口
```

## backend/

```text
backend/
├── src/vocasketch_backend/     # 后端业务代码
│   ├── assets/                 # 资产内容与元数据存储
│   ├── providers/              # mock / live provider gateway 与 transport
│   ├── routes/                 # FastAPI 路由
│   └── workflows/              # drawing job workflow 节点与状态流
├── tests/                      # Stage 4-15 回归测试
├── data/                       # 本地 job / asset 数据（运行时目录）
├── README.md
├── pyproject.toml
└── load-live-image-env.ps1
```

推荐阅读顺序：

1. `backend/README.md`
2. `backend/src/vocasketch_backend/main.py`
3. `backend/src/vocasketch_backend/routes/`
4. `backend/src/vocasketch_backend/workflow.py`
5. `backend/src/vocasketch_backend/providers/`

## frontend/

```text
frontend/
├── src/
│   ├── api/                    # 前后端 API client 与类型
│   ├── components/             # UI 组件
│   ├── utils/                  # 纯函数与播放时间轴 helper
│   ├── App.tsx                 # 主工作台
│   └── main.tsx
├── assets/                     # 前端静态资源
├── README.md
├── package.json
└── vite.config.ts
```

推荐阅读顺序：

1. `frontend/README.md`
2. `frontend/src/App.tsx`
3. `frontend/src/api/client.ts`
4. `frontend/src/components/ProcessPlaybackPlayer.tsx`

## docs/

- `startup.md`
  当前启动和验证方式。
- `architecture.md`
  当前 v2 架构边界和职责划分。
- `design.md`
  产品交互与展示思路。
- `archive/`
  旧 API 合约等历史材料，只用于对照，不再作为当前实现入口。

## 结构约定

- `backend/` 是当前唯一正常后端目录；不再保留旧 Node/V1 服务目录。
- `docs/archive/` 只放历史材料，避免和当前实现文档混在一起。
- `output/`、`.playwright-cli/`、`.codex-run-logs/` 都是本地运行产物，不进入版本库。
- 前端主流程优先看 `App.tsx + api/client.ts + ProcessPlaybackPlayer.tsx`。
- 后端主流程优先看 `routes + workflow + providers` 三层。
