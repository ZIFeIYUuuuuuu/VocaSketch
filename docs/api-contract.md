# VocaSketch API Contract

This document defines the backend API surface required by the current frontend workspace. The goal is to replace the local mock NLP/state machine gradually while preserving the existing UI states: voice command, AI restatement, confirmation, staged painting, layers, traits, replay, and export.

## 1. Principles

- Frontend never stores provider API keys.
- Backend owns ASR, TTS, LLM parser calls, schema validation, persistence, and cost control.
- Frontend owns canvas rendering, stage animation, visible UI state, microphone permission, and local fallback controls.
- All drawing instructions from AI must become typed operations before execution.
- Mutating operations should enter the confirmation flow before the frontend applies them.

## 2. Base

- Base path: `/api/v1`
- Request format: JSON unless noted.
- Response format: JSON unless noted.
- Authentication: none for MVP; anonymous `sessionId` is used.
- Idempotency: mutating command endpoints should accept optional `clientCommandId`.

## 3. Shared Types

### 3.1 Enums

```ts
type DrawStage =
  | "未开始"
  | "草图阶段"
  | "线稿阶段"
  | "铺色阶段"
  | "水彩晕染"
  | "细节刻画"
  | "已完成";

type SystemState =
  | "等待指令"
  | "聆听中"
  | "思考中"
  | "等待确认"
  | "绘画中"
  | "已暂停";

type Intent =
  | "create_avatar"
  | "edit_traits"
  | "add_accessory"
  | "remove_accessory"
  | "control"
  | "clarify"
  | "smalltalk"
  | "unknown";
```

### 3.2 CharacterConfig

```ts
interface CharacterConfig {
  gender: "female" | "male" | "neutral";
  hairLength: "long" | "short" | "medium";
  hairColor: "blue" | "pink" | "purple" | "gold" | "black" | "white" | string;
  eyeColor: "blue" | "purple" | "green" | "red" | "gold" | "pink" | string;
  expression: "微笑" | "害羞" | "冷淡" | "惊讶";
  outfit: "school" | "hoodie" | "shirt";
  accessory: "butterfly_knot" | "glasses" | "none";
  backgroundStyle: "gradient" | "watercolor" | "stars" | "cherry";
}
```

### 3.3 PaintLayer

```ts
interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  stage: DrawStage;
  color: string;
  objectCount?: number;
  locked?: boolean;
}
```

### 3.4 DrawingOperation

The parser returns operations, but the frontend decides how to animate them.

```ts
type DrawingOperation =
  | { type: "set_character"; patch: Partial<CharacterConfig> }
  | { type: "start_auto_painting"; fromProgress?: number }
  | { type: "start_stage_painting"; fromStage?: DrawStage }
  | { type: "redraw_component"; target: "hair" | "eyes" | "expression" | "outfit" | "accessory" | "background"; patch: Partial<CharacterConfig> }
  | { type: "set_layer_visibility"; layerId: string; visible: boolean }
  | { type: "set_layer_opacity"; layerId: string; opacity: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "replay" }
  | { type: "export" };
```

### 3.5 CommandInterpretation

```ts
interface CommandInterpretation {
  interpretationId: string;
  sessionId: string;
  projectId: string;
  transcript: string;
  normalizedText: string;
  intent: Intent;
  confidence: number;
  requiresConfirmation: boolean;
  needsClarification: boolean;
  aiReplyText: string;
  clarificationQuestion?: string;
  traitPatch?: Partial<CharacterConfig>;
  operations: DrawingOperation[];
  affectedLayers: string[];
  costHint?: {
    parserTokensIn?: number;
    parserTokensOut?: number;
    provider: string;
    cacheHit: boolean;
  };
}
```

## 4. Session & Project APIs

### 4.1 Create Session

`POST /api/v1/sessions`

Creates an anonymous session for local demo use.

Request:

```json
{
  "clientId": "browser-generated-id",
  "locale": "zh-CN"
}
```

Response:

```json
{
  "sessionId": "sess_01J...",
  "expiresAt": null,
  "createdAt": "2026-06-12T02:00:00.000Z"
}
```

### 4.2 Create Project

`POST /api/v1/projects`

Request:

```json
{
  "sessionId": "sess_01J...",
  "title": "未命名语音头像",
  "initialConfig": {
    "gender": "female",
    "hairLength": "long",
    "hairColor": "blue",
    "eyeColor": "blue",
    "expression": "微笑",
    "outfit": "school",
    "accessory": "none",
    "backgroundStyle": "watercolor"
  }
}
```

Response:

```json
{
  "projectId": "proj_01J...",
  "sessionId": "sess_01J...",
  "title": "未命名语音头像",
  "config": {},
  "layers": [],
  "drawProgress": 0,
  "currentStage": "未开始",
  "serverRevision": 1,
  "createdAt": "2026-06-12T02:00:00.000Z",
  "updatedAt": "2026-06-12T02:00:00.000Z"
}
```

### 4.3 Get Project

`GET /api/v1/projects/{projectId}?sessionId={sessionId}`

Returns the saved project state for restoring the workspace.

`sessionId` is optional for the local demo restore path. When provided, the backend validates that the project belongs to that session and returns `SESSION_PROJECT_MISMATCH` if it does not.

Response:

```json
{
  "projectId": "proj_01J...",
  "sessionId": "sess_01J...",
  "title": "蓝色长发水彩头像",
  "config": {},
  "layers": [],
  "drawProgress": 100,
  "currentStage": "已完成",
  "historyCount": 6,
  "serverRevision": 2,
  "createdAt": "2026-06-12T02:00:00.000Z",
  "updatedAt": "2026-06-12T02:05:00.000Z"
}
```

### 4.4 Save Project Snapshot

`PUT /api/v1/projects/{projectId}/snapshot`

Used after frontend applies confirmed operations.

Request:

```json
{
  "sessionId": "sess_01J...",
  "config": {},
  "layers": [],
  "drawProgress": 100,
  "currentStage": "已完成",
  "canvasObjects": [],
  "clientRevision": 8,
  "historyMeta": {
    "kind": "command",
    "transcript": "把眼睛改成紫色",
    "aiReplyText": "我会把眼睛改成紫色，确认吗？",
    "operations": []
  }
}
```

Response:

```json
{
  "projectId": "proj_01J...",
  "serverRevision": 9,
  "historyCount": 6,
  "redoCount": 0,
  "savedAt": "2026-06-12T02:06:00.000Z"
}
```

## 5. Voice APIs

### 5.1 ASR Transcribe

`POST /api/v1/voice/asr`

Content type: `multipart/form-data`

Fields:

- `sessionId`: string
- `projectId`: string
- `audio`: audio blob
- `format`: `webm` | `wav` | `mp3`
- `locale`: default `zh-CN`

Response:

```json
{
  "transcript": "画一个蓝色长发的二次元女生半身头像，水彩素描风",
  "confidence": 0.985,
  "durationMs": 3200,
  "provider": "dashscope",
  "rawProviderRequestId": "optional-for-debug"
}
```

Notes:

- Current frontend uses Web Speech API fallback. This endpoint is the target integration for Qwen/DashScope ASR.
- For quick MVP, frontend may send text directly to `/commands/interpret` while ASR integration is pending.

### 5.2 TTS Synthesize

`POST /api/v1/voice/tts`

Request:

```json
{
  "sessionId": "sess_01J...",
  "text": "我会绘制蓝色长发、女生半身头像，水彩素描风格，是否确认？",
  "voice": "gentle_female",
  "format": "mp3"
}
```

Response:

```json
{
  "audioUrl": "/api/v1/assets/audio/tts_01J.mp3",
  "durationMs": 4100,
  "provider": "dashscope"
}
```

Alternative response for small audio:

```json
{
  "audioBase64": "...",
  "mimeType": "audio/mpeg",
  "durationMs": 4100,
  "provider": "dashscope"
}
```

## 6. Command APIs

### 6.1 Interpret Text Command

`POST /api/v1/commands/interpret`

Converts recognized text into a confirmation reply and typed drawing operations. This is the main replacement for the frontend `interpretVoiceCommand` mock.

Request:

```json
{
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "clientCommandId": "cmd_client_001",
  "text": "画一个蓝色长发的二次元女生半身头像，水彩素描风",
  "currentState": {
    "systemState": "等待指令",
    "currentStage": "未开始",
    "drawProgress": 0,
    "paintMode": "auto",
    "config": {
      "gender": "female",
      "hairLength": "long",
      "hairColor": "blue",
      "eyeColor": "blue",
      "expression": "微笑",
      "outfit": "school",
      "accessory": "none",
      "backgroundStyle": "watercolor"
    },
    "layers": []
  }
}
```

Response for create:

```json
{
  "interpretationId": "interp_01J...",
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "transcript": "画一个蓝色长发的二次元女生半身头像，水彩素描风",
  "normalizedText": "创建蓝色长发女生半身头像，风格为水彩素描",
  "intent": "create_avatar",
  "confidence": 0.96,
  "requiresConfirmation": true,
  "needsClarification": false,
  "aiReplyText": "我会绘制蓝色长发、二次元女生半身头像，使用水彩上色和素描线稿。确认开始吗？",
  "traitPatch": {
    "gender": "female",
    "hairLength": "long",
    "hairColor": "blue",
    "backgroundStyle": "watercolor"
  },
  "operations": [
    {
      "type": "set_character",
      "patch": {
        "gender": "female",
        "hairLength": "long",
        "hairColor": "blue",
        "backgroundStyle": "watercolor"
      }
    },
    {
      "type": "start_auto_painting",
      "fromProgress": 0
    }
  ],
  "affectedLayers": [
    "layer-sketch",
    "layer-lineart",
    "layer-flats",
    "layer-watercolor",
    "layer-details",
    "layer-bg"
  ],
  "costHint": {
    "provider": "openai-compatible",
    "cacheHit": false
  }
}
```

Response for ambiguous command:

```json
{
  "interpretationId": "interp_01J...",
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "transcript": "这个颜色怪怪的，调一下",
  "normalizedText": "用户想调整颜色，但目标不明确",
  "intent": "clarify",
  "confidence": 0.52,
  "requiresConfirmation": false,
  "needsClarification": true,
  "aiReplyText": "你想调整头发、眼睛、衣服，还是背景？",
  "clarificationQuestion": "你想调整头发、眼睛、衣服，还是背景？",
  "operations": [],
  "affectedLayers": []
}
```

Response for local-control command:

```json
{
  "interpretationId": "interp_01J...",
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "transcript": "暂停",
  "normalizedText": "暂停绘画",
  "intent": "control",
  "confidence": 0.99,
  "requiresConfirmation": false,
  "needsClarification": false,
  "aiReplyText": "好的，先暂停在当前进度。",
  "operations": [
    {
      "type": "pause"
    }
  ],
  "affectedLayers": []
}
```

### 6.2 Confirm Interpretation

`POST /api/v1/commands/{interpretationId}/confirm`

Records that the user confirmed an interpretation. Backend returns the same executable operations plus a server revision. Frontend applies them and then calls project snapshot save.

Request:

```json
{
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "confirmed": true,
  "confirmationText": "确认",
  "currentRevision": 8
}
```

Response:

```json
{
  "projectId": "proj_01J...",
  "interpretationId": "interp_01J...",
  "confirmed": true,
  "aiReplyText": "好的，我开始绘制。",
  "operations": [
    {
      "type": "set_character",
      "patch": {
        "gender": "female",
        "hairLength": "long",
        "hairColor": "blue"
      }
    },
    {
      "type": "start_auto_painting",
      "fromProgress": 0
    }
  ],
  "serverRevision": 9
}
```

### 6.3 Reject Interpretation

`POST /api/v1/commands/{interpretationId}/reject`

Request:

```json
{
  "sessionId": "sess_01J...",
  "projectId": "proj_01J...",
  "reasonText": "不对，取消"
}
```

Response:

```json
{
  "interpretationId": "interp_01J...",
  "cancelled": true,
  "aiReplyText": "好的，我先不执行这次修改。"
}
```

## 7. Operation History APIs

### 7.1 List Operation History

`GET /api/v1/projects/{projectId}/history?sessionId={sessionId}&limit=50`

Used for replay, debugging, and future restore. The current UI does not need to show this by default.

Response:

```json
{
  "items": [
    {
      "historyId": "hist_01J...",
      "timestamp": "2026-06-12T02:08:00.000Z",
      "transcript": "把眼睛改成紫色",
      "aiReplyText": "我会把眼睛改成紫色，确认吗？",
      "confirmed": true,
      "operations": [
        {
          "type": "redraw_component",
          "target": "eyes",
          "patch": {
            "eyeColor": "purple"
          }
        }
      ],
      "currentStage": "已完成",
      "drawProgress": 100
    }
  ],
  "undoCount": 3,
  "redoCount": 1
}
```

### 7.2 Undo

`POST /api/v1/projects/{projectId}/undo`

Request:

```json
{
  "sessionId": "sess_01J...",
  "currentRevision": 9
}
```

Response:

```json
{
  "projectId": "proj_01J...",
  "config": {},
  "layers": [],
  "drawProgress": 100,
  "currentStage": "已完成",
  "serverRevision": 10,
  "historyCount": 2,
  "redoCount": 1,
  "aiReplyText": "已撤销上一步修改。"
}
```

### 7.3 Redo

`POST /api/v1/projects/{projectId}/redo`

Same shape as undo.

## 8. Export APIs

### 8.1 Export Project Data

`POST /api/v1/projects/{projectId}/exports`

Backend stores project JSON and optionally accepts the frontend-rendered PNG.

Request:

```json
{
  "sessionId": "sess_01J...",
  "format": "json+png",
  "projectState": {
    "config": {},
    "layers": [],
    "drawProgress": 100,
    "currentStage": "已完成",
    "canvasObjects": []
  },
  "pngBase64": "optional-data-url-or-base64"
}
```

Response:

```json
{
  "exportId": "exp_01J...",
  "files": [
    {
      "type": "project-json",
      "url": "/api/v1/assets/exports/exp_01J/project.json"
    },
    {
      "type": "png",
      "url": "/api/v1/assets/exports/exp_01J/preview.png"
    }
  ],
  "createdAt": "2026-06-12T02:10:00.000Z"
}
```

## 9. Provider & Health APIs

### 9.1 Health

`GET /api/v1/health`

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "providers": {
    "parser": "configured",
    "asr": "configured",
    "tts": "configured"
  },
  "storage": "ready"
}
```

### 9.2 Runtime Config

`GET /api/v1/config/runtime`

Returns public, non-secret config for the frontend.

Response:

```json
{
  "asrMode": "dashscope",
  "ttsEnabled": true,
  "parserMode": "openai-compatible",
  "defaultLocale": "zh-CN",
  "maxAudioSeconds": 20,
  "maxCommandChars": 500
}
```

## 10. Error Shape

All non-2xx JSON errors should use:

```json
{
  "error": {
    "code": "PARSER_SCHEMA_INVALID",
    "message": "模型返回的绘图指令格式不完整。",
    "retryable": true,
    "details": {}
  }
}
```

Suggested error codes:

- `SESSION_NOT_FOUND`
- `PROJECT_NOT_FOUND`
- `ASR_FAILED`
- `TTS_FAILED`
- `PARSER_TIMEOUT`
- `PARSER_SCHEMA_INVALID`
- `COMMAND_AMBIGUOUS`
- `CONFIRMATION_EXPIRED`
- `REVISION_CONFLICT`
- `EXPORT_FAILED`
- `RATE_LIMITED`

## 11. Frontend Migration Plan

1. Keep current local state machine as fallback.
2. Add API client module in `frontend/src/api`.
3. On app load, call `POST /sessions` and `POST /projects`.
4. Replace `interpretVoiceCommand` internals with `POST /commands/interpret`.
5. Store returned `interpretationId`, `aiReplyText`, `traitPatch`, and `operations` as pending confirmation state.
6. On confirm, call `POST /commands/{id}/confirm`, apply returned operations locally, then save snapshot.
7. Add optional ASR endpoint integration after text interpretation is stable.
8. Add optional TTS endpoint after subtitle flow is stable.
