# Architecture Notes

## Overview

VocaSketch uses a voice-to-operations architecture.

```text
User speech
  -> frontend microphone capture
  -> ASR service
  -> backend command interpretation API
  -> LLM parser adapter
  -> JSON schema validation
  -> confirmation reply
  -> drawing operation queue
  -> frontend drawing engine
  -> project state and operation history
```

## Frontend Responsibilities

- request microphone permission
- capture speech input
- show transcription and AI replies
- render drawing canvas
- execute structured drawing operations
- show semantic layer state
- support pause, continue, undo, redo, replay, and export
- keep the core demo usable through voice commands

## Backend Responsibilities

- keep API keys out of the frontend
- call ASR/TTS providers
- call the OpenAI-compatible parser model
- validate parser output with JSON schema
- manage session state
- save project files and operation history
- provide stable API boundaries for future model/provider replacement

## Parser Adapter

The parser adapter converts natural-language instructions into a stable internal DSL.

The adapter should support provider replacement:

- OpenAI-compatible endpoint for MVP
- DashScope or another official provider later
- local command parser for high-frequency control commands

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

For the local competition demo, anonymous sessions are enough. Login is out of MVP scope.

## Risk Controls

- ASR error: repeat understanding and ask for confirmation
- ambiguous instruction: ask a targeted follow-up question
- unstable parser output: validate with JSON schema
- high latency: handle common control commands locally
- mistaken image-generator perception: show layers, operations, and replay
