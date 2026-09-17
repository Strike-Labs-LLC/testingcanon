<!-- canon:begin — Canon owns this region. Edits inside it are replaced on reinstall. -->
# Bug triage fix verify

John’s Flow #5 orchestration flow.

## AI SDLC pipeline

This repository is configured to run an AI-assisted software development lifecycle.

- `AGENTS.md` — the rules every agent and contributor follows
- `.github/agents/` — the agent roster
- `.github/workflows/` — CI/CD plus agentic workflows
- `.sdlc/` — the canonical specification everything is generated from
- `INSTALL-GITHUB.md` — installation and post-install setup steps

## Pipeline stages

1. Bug Triage — Product Manager
2. Coder — Coder
3. Code Reviewer — Code Reviewer
4. Fix Verification — Tester
5. Bug Closeout — Engineering Orchestrator

## Getting started

```bash
npm ci
npm run dev
```
<!-- canon:end -->
