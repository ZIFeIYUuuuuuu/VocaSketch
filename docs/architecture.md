# Architecture Notes

## Overview

VocaSketch 使用的是一条“语音输入 -> 任务编排 -> 绘画过程展示”的架构链路，核心目标不是只生成成图，而是让结果具备过程感和可解释性。

```text
User speech
  -> frontend microphone capture
  -> browser speech transcript
  -> Python backend v2 Drawing Job API
  -> provider gateway (mock by default, optional live text/image)
  -> local asset content store
  -> playback manifest / derived process frames
  -> frontend process playback panel
  -> recent jobs and runtime readiness
```

## Frontend Responsibilities

- request microphone permission
- capture speech input
- show transcription and v2 job status
- render process playback from backend assets
- show semantic layer state
- support pause, continue, replay, export, recent job restore, cancel, and retry
- keep the core demo usable through voice commands

## Backend Responsibilities

- keep API keys out of the frontend
- run Drawing Job workflow and SSE events
- call optional live text/image providers only when explicitly enabled
- store generated preview/final/layer/process assets as local readable content
- provide runtime readiness and recent jobs diagnostics
- keep all public metadata and events secret-safe
- provide stable provider boundaries for future model/provider replacement

The current backend is `backend`, a FastAPI v2 service with file-backed jobs, events, assets, provider gateways, and deterministic process playback. The old Node/V1 backend has been removed from the normal runtime path.

## Intent / Prompt Layer

后端会把用户的原始输入转成稳定的中间表示，再进入后续绘图链路。这一层需要支持 provider 替换：

- OpenAI-compatible endpoint for MVP
- DashScope or another official provider later
- local fallback parser for controlled demo mode

当前主线默认仍支持离线/受控演示模式，因此不会要求默认联网，也不会要求前端暴露 API key。

The historical `/api/v1` HTTP API contract is archived in [archive/api-v1-contract.md](archive/api-v1-contract.md). New work should target `backend` `/api/v2`.

## Drawing Process Strategy

本项目的关键设计不是“自然语言直接驱动画笔动画”，而是：

- 先让后端理解用户意图
- 再生成 final 图或受控中间结果
- 最后把结果拆回更接近人类数位板流程的阶段

当前绘画过程重点围绕以下阶段组织：

- 草图
- 线稿
- 平涂
- 阴影
- 光照
- 完成图收束

## Persistence

The backend should save:

- session id
- project id
- current portrait traits
- layers
- object data
- operation history
- user transcription
- intent / prompt result
- confirmation records

For the local competition demo, anonymous sessions and local JSON files under `VOCASKETCH_BACKEND_DATA_DIR` are enough. Login and database setup are out of MVP scope.

## Risk Controls

- ASR error: repeat understanding and ask for confirmation
- ambiguous instruction: ask a targeted follow-up question
- unstable parser output: validate with JSON schema
- high latency: handle common control commands locally
- mistaken image-generator perception: show layers, operations, and replay
