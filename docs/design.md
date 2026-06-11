# Design Document

## Product Direction

VocaSketch is a voice-first drawing workspace for creating layered anime watercolor portraits. The project answers the competition prompt by making voice control the main path for creation, confirmation, editing, playback, and basic drawing control.

The product is designed as a digital painting workstation rather than a chat-only assistant or one-shot image generator. The output should remain inspectable as layers, objects, operations, and history.

## Planned Command Capabilities

### Creation

Users can describe a portrait in one Chinese voice instruction.

Example:

```text
画一个蓝色长发的二次元女生半身头像，水彩素描风。
```

The system should parse the command into a structured drawing plan, then ask for confirmation before execution.

### Confirmation

Before executing creation or modification commands, the system repeats its understanding.

Example:

```text
我会绘制蓝色长发、女生半身头像、水彩素描风格，确认开始吗？
```

Supported user replies:

- 确认
- 开始
- 可以
- 取消
- 重新说

### Modification

Users can modify local portrait attributes through follow-up voice commands.

Planned examples:

- 把眼睛改成紫色
- 头发改短一点
- 换成粉色背景
- 表情改成害羞
- 加一个蝴蝶结

The system should preserve unrelated attributes during local edits.

### Drawing Control

Planned control commands:

- 暂停
- 继续
- 撤销
- 重做
- 回放一下
- 导出图片

High-frequency control commands should be handled with a low-latency local path when possible.

### Clarification

For ambiguous instructions, the system should ask a short follow-up question instead of guessing.

Example:

```text
你想调整头发、眼睛、衣服，还是背景？
```

## Planned Drawing Stages

The automatic drawing flow is split into visible stages:

1. sketch
2. line art
3. base color
4. watercolor rendering
5. details
6. completed

Each stage should produce operations that can be displayed in the operation history and replayed later.

## Planned Layers

The drawing project should use semantic layers:

- sketch layer
- line layer
- base color layer
- watercolor layer
- detail layer
- background layer

The layer panel is part of the competition proof: it shows that the work is a drawing project, not only a generated bitmap.

## Planned Data Model

The command parser should return schema-valid JSON before any drawing operation runs.

Example:

```json
{
  "reply": "我会绘制蓝色长发、女生半身头像，水彩素描风格，是否确认？",
  "intent": "create_avatar",
  "requiresConfirmation": true,
  "operations": [
    { "type": "set_style", "value": "watercolor_sketch" },
    { "type": "set_character", "gender": "female" },
    { "type": "set_hair", "length": "long", "color": "blue" },
    { "type": "start_auto_painting" }
  ]
}
```

## Implementation Status

| Capability | Planned | Implemented | Notes |
| --- | --- | --- | --- |
| Chinese voice input | Yes | No | Runtime not scaffolded in PR 1 |
| AI subtitle feedback | Yes | No | Runtime not scaffolded in PR 1 |
| TTS feedback | Yes | No | Requires ASR/TTS integration |
| command parsing | Yes | No | Requires parser adapter |
| confirmation before execution | Yes | No | Requires state machine |
| automatic portrait drawing | Yes | No | Requires drawing engine |
| local modification | Yes | No | Requires semantic object model |
| pause and continue | Yes | No | Requires operation queue |
| undo and redo | Yes | No | Requires operation history |
| layer panel | Yes | No | Requires frontend workspace |
| replay | Yes | No | Planned P1 |
| export image | Yes | No | Planned P1 |

## Unfinished Parts and Reasons

PR 1 intentionally contains documentation and repository setup only. Runtime features are unfinished because the first PR is scoped to project initialization, competition requirement capture, and implementation planning.

The next PR should scaffold the frontend and backend so the startup commands become runnable.
