# VocaSketch

[中文](README.md) | English

Voice-first AI drawing workspace for layered anime watercolor portraits.

VocaSketch is a competition demo project for the "AI voice drawing tool" track. The product lets users create and edit a half-body anime portrait through Chinese voice commands. The drawing result is represented as a layered, editable, replayable project instead of a single end-to-end generated image.

## Competition Track

- Track: Topic 2, AI voice drawing tool
- Requirement: users complete drawing creation through voice commands, without relying on mouse or keyboard for the core workflow
- Focus areas:
  - speech command understanding accuracy
  - tolerance for ambiguous or imperfect instructions
  - response latency from speech to drawing operation
  - decomposition and execution of complex drawing commands
  - design documentation for planned, implemented, and unfinished command capabilities

## MVP Scope

The MVP focuses on one controlled drawing domain:

- half-body anime portrait
- watercolor coloring
- sketch-style line art
- semantic layers
- voice-driven creation, confirmation, modification, pause, continue, undo, redo, and replay

The project does not use end-to-end image generation as the main drawing path. The planned implementation converts voice input into structured drawing operations, then renders the result as a drawing project with layers, objects, operations, and history.

## Planned Capabilities

### P0

- Chinese voice input
- AI response through subtitles and voice feedback
- natural-language drawing instruction parsing
- execution confirmation before drawing
- automatic full drawing flow
- half-body anime avatar generation
- gender selection through voice
- watercolor + sketch style
- continuous voice modification
- pause and continue
- undo and redo
- semantic layer panel
- simplified object count display
- project and operation history persistence

### P1

- lightweight replay
- image export
- staged drawing mode
- partial redraw
- project restoration
- complete demo script

## Repository Structure

```text
.
├── backend/                  # Python v2 backend: drawing jobs, assets, providers, SSE
├── docs/                        # PRD, design notes, architecture, startup docs
├── frontend/                    # Web drawing workspace
├── .github/                     # Pull request template
├── AGENTS.md                    # Repository collaboration and Git operation rules
├── .env.example                 # Environment variable example
├── .gitignore
├── competition-requirements.md  # Competition engineering and submission requirements
├── README.en.md                 # English README
└── README.md                    # Chinese README
```

## Current Implementation Status

The repository now uses the Python-first v2 backend as the normal runtime path. The frontend demonstrates the voice entry point, Python drawing jobs, process playback, layer panel, and a local canvas helper view. The backend provides v2 drawing jobs, asset content, runtime readiness, recent jobs, SSE events, and optional real provider boundaries.

Included:

- project README
- startup guide
- architecture and design documentation
- API contract
- PR template
- environment variable example
- competition requirement checklist
- PRD document
- Vite + React frontend workspace prototype
- Python FastAPI v2 backend
- Drawing Job / SSE / local asset content layer
- optional real text and image provider boundaries
- process playback manifests and derived frames
- repository collaboration and Git operation rules

Not included yet:

- production account system
- production live layer decomposition provider

## Startup Guide

The frontend workspace can run locally:

```bash
cd frontend
npm install
npm run dev
```

Default URL:

```text
http://localhost:3000
```

The Python v2 backend can run locally:

```bash
cd backend
python -m uvicorn vocasketch_backend.main:app --app-dir src --host 127.0.0.1 --port 8000
```

Default backend URL:

```text
http://localhost:8000
```

Runtime readiness:

```text
http://localhost:8000/api/v2/runtime/readiness
```

## Documentation

- [Project Structure](docs/project-structure.md)
- [PRD](docs/PRD-ai-voice-drawing.md)
- [Design Document](docs/design.md)
- [Architecture Notes](docs/architecture.md)
- [Archived API Contract](docs/archive/api-v1-contract.md)
- [Startup Guide](docs/startup.md)
- [Competition Requirements](competition-requirements.md)

## Development Rules

- Create the official repository after the topic is released.
- Keep commit timestamps inside the selected competition batch.
- Use small, focused PRs.
- Keep PR descriptions complete and aligned with code changes.
- Keep the main branch runnable after implementation PRs are merged.
- Document third-party dependencies and original functionality in README.
- Use voice control as the primary interaction path for the core demo workflow.

## Project Name

VocaSketch combines "vocal" and "sketch". The name reflects the product direction: users speak their drawing intent, and the system turns it into a structured sketch and watercolor painting process.
