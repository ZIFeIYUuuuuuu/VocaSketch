# Architecture Notes

## Overview

VocaSketch uses a voice-to-operations architecture.

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

## Parser Adapter

The parser adapter converts natural-language instructions into a stable internal DSL.

The adapter should support provider replacement:

- OpenAI-compatible endpoint for MVP
- DashScope or another official provider later
- local command parser for high-frequency control commands

The current implementation uses the local command parser first so that frontend/backend integration can be tested without external provider keys.

The historical `/api/v1` HTTP API contract is archived in [archive/api-v1-contract.md](archive/api-v1-contract.md). New work should target `backend` `/api/v2`.

## Drawing Engine

The drawing engine should operate on structured commands instead of free text.

Planned operation categories:

- style operations
- character attribute operations
- pose operations
- layer operations
- object modification operations
- control operations
- replay/export operations

## Persistence

The backend should save:

- session id
- project id
- current portrait traits
- layers
- object data
- operation history
- user transcription
- parser result
- confirmation records

For the local competition demo, anonymous sessions and local JSON files under `APP_STORAGE_DIR` are enough. Login and database setup are out of MVP scope.

## Risk Controls

- ASR error: repeat understanding and ask for confirmation
- ambiguous instruction: ask a targeted follow-up question
- unstable parser output: validate with JSON schema
- high latency: handle common control commands locally
- mistaken image-generator perception: show layers, operations, and replay
