# Startup Guide

This document records the current startup status and the planned local development workflow.

## Current Status

PR 1 only initializes documentation and repository structure. The frontend and backend runtimes have not been scaffolded yet.

There is no runnable application in this PR.

## Planned Local Development

After the frontend and backend scaffolds are added, the project will use two local services:

- frontend web drawing workspace
- backend API service for ASR/TTS calls, command parsing, session state, and project persistence

Expected commands:

```bash
# Start frontend
cd frontend
npm install
npm run dev
```

```bash
# Start backend
cd backend
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` in the service that needs it after runtime code is added.

Do not commit real API keys.

Expected variables:

```text
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_MODEL=
DASHSCOPE_API_KEY=
APP_STORAGE_DIR=
```

## Verification Plan

Once runtime code exists, each implementation PR should include the relevant verification evidence:

- frontend dev server starts successfully
- backend dev server starts successfully
- voice command can be transcribed or mocked
- command parser returns schema-valid operations
- drawing workspace renders expected layer state
- README startup commands match the actual project
