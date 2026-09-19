# AGENTS.md — Engineering Constitution

This file governs every AI agent and every human contributor working in this repository.
It is generated from the SDLC blueprint (`.sdlc/blueprint.yml`). Change the blueprint, then
regenerate — do not hand-edit this file.

## Mission

John’s Flow #1 orchestration flow.

## Repository architecture

- Project type: web application
- Frontend framework: None
- Backend: None
- Database: None
- Infrastructure: None
- Desktop runtime: Electron
- AI integration: None
- Styling: Tailwind CSS
- Default branch: `main`
- Environments: none created by Canon

## Canonical tool names

Use these exact spellings for tools and platforms in code comments, issues, pull
requests, commit messages, and generated documentation. Do not invent variants
(`Supabase`, never `supabase` or `supa base`). A tool that is not listed keeps the
spelling its own documentation uses.

| Field | This project | Canonical names (top 8) |
| --- | --- | --- |
| Frontend framework | `None` _(custom — not in the canonical list)_ | `React`, `Next.js`, `TypeScript`, `Vue`, `Svelte`, `Angular`, `React Native`, `Tailwind CSS` |
| Backend | `None` _(custom — not in the canonical list)_ | `Node.js`, `TypeScript`, `Python`, `Go`, `Java`, `Ruby on Rails`, `.NET`, `Supabase Edge Functions` |
| Database | `None` _(custom — not in the canonical list)_ | `PostgreSQL`, `Supabase`, `MySQL`, `SQLite`, `MongoDB`, `Redis`, `DynamoDB`, `Snowflake` |
| Infrastructure | `None` _(custom — not in the canonical list)_ | `GitHub Actions`, `AWS`, `Vercel`, `Cloudflare`, `Google Cloud`, `Azure`, `Docker`, `Kubernetes` |
| Desktop runtime | `Electron` | `None`, `Electron`, `Tauri`, `Neutralino`, `Capacitor`, `Qt`, `.NET MAUI` |
| AI integration | `None` | `None`, `OpenAI`, `Anthropic`, `GitHub Models`, `Azure OpenAI`, `Google Gemini`, `Ollama`, `LangChain` |
| SPA bridge | _not specified_ | `None`, `tRPC`, `REST`, `GraphQL`, `gRPC-Web`, `WebSocket`, `Server Actions`, `IPC` |
| Styling | `Tailwind CSS` | `Tailwind CSS`, `CSS Modules`, `Sass`, `styled-components`, `Emotion`, `Vanilla Extract`, `Plain CSS` |
| Tooling | _not specified_ | `Vite`, `Webpack`, `Turbopack`, `esbuild`, `Rollup`, `Turborepo`, `Nx`, `ESLint` |
| Testing | _not specified_ | `Vitest`, `Jest`, `Playwright`, `Cypress`, `Testing Library`, `pytest`, `Go test`, `JUnit` |

Source: Canon · Orchestration settings → Stack (src/features/blueprint/spec/stackPresets.ts). The list is a controlled vocabulary, not a
restriction — custom values are allowed and are recorded verbatim above.

## Repository context

These are the standing facts about this repository. They apply to every stage of
every run and outrank any assumption an agent brings from another codebase.

### What this repository owns

Owns a single-page static web app that shows a rocket lift-off animation. This repository is Strike Labs' internal test target for Canon: pipeline changes are exercised here end to end before they reach customer repositories. It contains only static HTML, CSS, and vanilla JavaScript, with no backend, database, or build step.

### Outcome it must produce

A small, stable app that a Canon run can change, review, test, and release without human rework. A successful run delivers a working page change through a merged pull request with every required check green. The page loads instantly and works in current desktop and mobile browsers. It stays simple enough that any run failure points to Canon, not the app.

### Who depends on it

Internal only. Strike Labs engineering uses this repository to validate Canon runs; there is a single maintainer who approves all changes. No external customers, no authentication, no personal data. Favor small, readable, easy-to-debug changes over features or polish.

### Tradeoff order when several approaches are valid

canon-priorities:v1:{"order":["simplicity","correctness","delivery-speed","security","data-integrity","reliability","observability","maintainability","backward-compatibility","cost"]}

### Must survive every change

The app runs by opening index.html or serving the folder statically, with no build step.
Zero runtime dependencies and no package manager files unless the objective explicitly requests them.
The page loads with no console errors and honors prefers-reduced-motion.
Every change ships through a pull request with required checks green.

### Never do this

Do not add package.json, frameworks, bundlers, or test runners unless the objective explicitly requests them.
Do not add a backend, database, authentication, analytics, tracking, or external network calls.
Do not load scripts, fonts, or assets from third-party CDNs.
Do not modify .github/, .canon/, .sdlc/, or AGENTS.md.
Do not commit secrets or credentials.

### Not this repository's work

Production hosting and uptime, customer-facing features, user accounts, payments, CRM, analytics, legacy browser support, and serving as an architecture template for other repositories.


## Orchestration output contract

Every stage that runs inside the orchestration pipeline must end its reply with exactly one
fenced result block. The run halts if the block is missing or the outcome is not one this
stage is allowed to return.

```canon-result
{ "outcome": "approved", "summary": "One sentence describing what changed.", "route": [] }
```

- `outcome` decides which connector the run takes next.
- `summary` is written to the run issue.
- `route` names the target stages for expression-based branches; leave it empty otherwise.
- Everything before the block is saved as the stage artifact under `.canon/artifacts/`.

## Source-of-truth hierarchy

When sources disagree, the higher entry wins:

1. `.sdlc/blueprint.yml` — the canonical SDLC specification
2. `AGENTS.md` — this constitution
3. `.github/copilot-instructions.md` — repository operating manual
4. `.github/instructions/*.instructions.md` — path-specific engineering standards
5. `.github/agents/*.agent.md` — individual agent behaviour (automated stages only)
6. `docs/` — reference documentation
7. Code comments

## SDLC lifecycle

1. **Requirements Analyst** — Product Manager
2. **Acceptance Criteria Author** — Product Manager
3. **Feature Coder** — Coder
4. **Test Author** — Tester
5. **QA Verifier** — QA
6. **Code Reviewer** — Code Reviewer
7. **Release Gatekeeper** — Release Reviewer

### Transitions

- Requirements Analyst → Acceptance Criteria Author — Always (always)
- Acceptance Criteria Author → Feature Coder — Always (always)
- Feature Coder → Test Author — Always (always)
- Test Author → Feature Coder — If failed (return (loop back))
- Test Author → QA Verifier — If passed (conditional)
- QA Verifier → Feature Coder — If failed (return (loop back))
- QA Verifier → Code Reviewer — If passed (conditional)
- Code Reviewer → Feature Coder — If changes required (return (loop back))
- Code Reviewer → Release Gatekeeper — If approved (conditional)
- Release Gatekeeper → Feature Coder — If blocked (return (loop back))

Pipeline start: **Requirements Analyst**
Pipeline end: **Release Gatekeeper**

## Definition of Ready

A work item may enter implementation only when all of the following are true:

- The problem statement and the affected user are stated.
- Acceptance criteria are explicit and testable.
- Security and data implications are recorded.
- Dependencies and out-of-scope items are listed.
- The item is assigned to the correct pipeline stage.

## Definition of Done

- Acceptance criteria are demonstrably met.

- Code review is complete and approved.
- Static analysis considered.
- No secrets are present in the diff.
- Documentation affected by the change is updated.

## Branch policy

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: this repository has no test command; no test gate is enforced.
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments are automatic once gates pass.
- Staging deploys automatically from the default branch.

## Agent authority boundaries

- Agents may read the repository, propose changes, open pull requests, and comment.
- Agents may not merge to `main` without the approvals defined above.
- Agents may not deploy to production.
- Agents may not modify `AGENTS.md`, `.github/agents/`, `.github/hooks/`, or `.sdlc/` as part of feature work.
- Agents may not add, rotate, or print secrets.
- Agents may not disable tests, linters, or security checks to make a build pass.

## Escalation rules

Escalate to a human when a product decision is required, when acceptance criteria are
ambiguous, when a change touches authentication, authorization, billing, or personal data,
or when the same stage fails twice for the same reason.

## Human approval requirements

- Final merge and production release require a named human approver.

## Forbidden actions

- Force-pushing or rewriting history on protected branches.
- Committing credentials, tokens, private keys, or customer data.
- Running destructive database commands against a shared environment.
- Bypassing the pipeline stages defined above.
- Editing generated files instead of the blueprint they come from.

## Agent roster

- `.github/agents/01-requirements-analyst.agent.md` — Requirements Analyst (Product Manager)
- `.github/agents/02-acceptance-criteria-author.agent.md` — Acceptance Criteria Author (Product Manager)
- `.github/agents/03-feature-coder.agent.md` — Feature Coder (Coder)
- `.github/agents/04-test-author.agent.md` — Test Author (Tester)
- `.github/agents/05-qa-verifier.agent.md` — QA Verifier (QA)
- `.github/agents/06-code-reviewer.agent.md` — Code Reviewer (Code Reviewer)
- `.github/agents/07-release-gatekeeper.agent.md` — Release Gatekeeper (Release Reviewer)
