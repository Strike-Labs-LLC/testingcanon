# Copilot instructions — Bug triage fix verify

Repository-wide context automatically supplied to GitHub Copilot. Governance lives in
`AGENTS.md`; this file describes how to actually work in this repository.

## What this application is

John’s Flow #5 orchestration flow.

## How the repository is organized

| Path | Purpose |
| --- | --- |
| `.github/agents/` | Custom agent definitions, one per automated stage |
| `.github/instructions/` | Path-specific engineering standards |
| `.github/skills/` | Reusable procedures agents load on demand |
| `.github/prompts/` | Task starters for common requests |
| `.github/workflows/` | CI/CD and agentic workflows |
| `.sdlc/` | Canonical machine-readable SDLC specification |
| `docs/` | Product, architecture, security, and operations documentation |

## Frameworks

- Frontend framework: React
- Backend: Node.js
- Database: Supabase
- Infrastructure: AWS
- Desktop runtime: Electron
- AI integration: None
- Styling: Tailwind CSS

## Build, run, test, lint

Commands use npm, detected by repository discovery.

```bash
npm ci
npm run dev
npm run build
npm run test
npm run lint
```

## Conventions

- Keep modules small and named after the domain concept they serve.
- Validate all external input at the boundary.
- Never implement business logic in controllers or components.
- Use the existing error, logging, and configuration helpers instead of new ones.
- Match the file layout and naming already present in the directory you are editing.

## Before a pull request can merge

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: unit (required), integration (required), e2e (optional).
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments require explicit human approval.
- Staging deploys automatically from the default branch.
- The pull request description explains what changed and why.
- Documentation affected by the change is updated in the same pull request.
