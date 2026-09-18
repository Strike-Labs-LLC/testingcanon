<!-- canon:begin — Canon owns this region. Edits inside it are replaced on reinstall. -->
# Autonomous feature delivery

John’s Flow #1 orchestration flow.

## AI SDLC pipeline

This repository is configured to run an AI-assisted software development lifecycle.

- `AGENTS.md` — the rules every agent and contributor follows
- `.github/agents/` — the agent roster
- `.github/workflows/` — CI/CD plus agentic workflows
- `.sdlc/` — the canonical specification everything is generated from
- `INSTALL-GITHUB.md` — installation and post-install setup steps

## Pipeline stages

1. Delivery Orchestrator — Engineering Orchestrator
2. Requirements Analyst — Product Manager
3. Acceptance Criteria Author — Product Manager
4. Feature Coder — Coder
5. Code Reviewer — Code Reviewer
6. Test Author — Tester
7. QA Verifier — QA
8. Release Gatekeeper — Release Reviewer
9. Deployment Runner — DevOps Deploy

## Getting started

```bash
npm ci
npm run dev
```
<!-- canon:end -->
