# VocaSketch

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
├── .env.example                 # Environment variable example
├── .gitignore
├── competition-requirements.md  # Competition engineering and submission requirements
└── README.md
```

## Current PR Status

This first PR initializes the project documentation and repository structure. Runtime application code will be added in later PRs.

Included in this PR:

- project README
- startup guide
- architecture and design documentation
- PR template
- environment variable example
- frontend and backend directory placeholders
- competition requirement checklist
- PRD document

Not included in this PR:

- runnable frontend app
- runnable backend service
- ASR/TTS integration
- LLM parser integration
- drawing engine implementation

## Startup Guide

The application runtime is not scaffolded in PR 1. See [docs/startup.md](docs/startup.md) for the current setup plan and future startup commands.

Expected later workflow:

```bash
# frontend
cd frontend
npm install
npm run dev

# backend
cd backend
npm install
npm run dev
```

## Documentation

- [PRD](docs/PRD-ai-voice-drawing.md)
- [Design Document](docs/design.md)
- [Architecture Notes](docs/architecture.md)
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
