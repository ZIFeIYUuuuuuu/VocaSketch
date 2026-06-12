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
├── backend/                     # Backend service, APIs, parser adapter, persistence
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

The repository now includes a runnable frontend drawing workspace prototype and a minimal backend API service. The frontend demonstrates the voice entry point, confirmation flow, drawing stages, layer panel, and local mock command parsing. The backend provides session, project, and text command interpretation APIs as the first step toward replacing the frontend mock.

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
- minimal Node.js backend API service
- local rule-based command interpretation
- repository collaboration and Git operation rules

Not included yet:

- ASR/TTS integration
- LLM parser integration
- file-based project persistence implementation

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

The backend API service can run locally:

```bash
cd backend
npm install
npm run dev
```

Default backend URL:

```text
http://localhost:8787
```

Health check:

```text
http://localhost:8787/api/v1/health
```

## Documentation

- [PRD](docs/PRD-ai-voice-drawing.md)
- [Design Document](docs/design.md)
- [Architecture Notes](docs/architecture.md)
- [API Contract](docs/api-contract.md)
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
