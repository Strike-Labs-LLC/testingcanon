# Canon orchestration runtime

This directory executes the blueprint for **Bug triage fix verify**. It is generated —
edit the blueprint in Canon and recompile rather than editing these files by hand.

| File | Responsibility |
| --- | --- |
| `graph.json` | The compiled blueprint: stages, connectors, conditions, joins, loop caps. |
| `engine.mjs` | Pure decision logic: ready set, join policy, routing, loop caps. |
| `state.mjs` | Reads and writes the run record stored in the run issue, and verifies stage results before they may change it. |
| `start-run.mjs` | Opens a run issue and starts the loop. |
| `tick.mjs` | One tick: plan the ready stages, then apply results and route. |
| `run-stage.mjs` | Executes one AI stage and posts a structured result carrying its run, stage attempt, single-use ticket, workflow run, and evaluated commit. |
| `publish.mjs` | The trusted publisher: validates each stage's patch against that stage's authority, size, file-type, secret, and base-commit rules, then commits it. Stage jobs hold no write credential of their own. |
| `canon-token.mjs` | Obtains the short-lived, operation-scoped publishing token from Canon. Trusted jobs prove their identity with the Actions OIDC token; no publishing credential is stored in this repository. |
| `invoke-agent.mjs` | Provider-agnostic model call — analysis stages only. |
| `coding-agent.mjs` | Real coding-agent session (shell, edits, tests, Git) for action stages. |
| `human.mjs` | Records `/canon <decision>` from a person and resumes the run. |
| `release.mjs` | Authorizes a release for the run's candidate commit — the commit development produced and every review, QA, and approval stage evaluated. A run whose stages judged different commits is never authorized. |
| `escalate.mjs` | Escalates human stages past their response time. |
| `artifacts/` | Every artifact produced by every run, committed to the repository. |

### Result trust

Comments are the audit log, not the state machine. `plan` issues a single-use ticket for
each stage attempt, and a `canon:result` marker only moves the run when it was posted by
a workflow (bot/App) identity, was never edited, names this run and a stage that is
currently running, quotes that stage's ticket and attempt, declares its workflow run, and
evaluated the run's candidate commit. Anything else is ignored and called out on the issue.

## Configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `CANON_AGENT_PROVIDER` | Repository variable | `github-models` (default), `anthropic`, `openai`, or `command`. |
| `CANON_AGENT_COMMAND` | Repository variable | CLI to run when the provider is `command`. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Repository secret | Only for those providers. |
| `CANON_CODING_AGENT` | Repository variable | Coding agent for action stages: `copilot` (default), `claude`, `codex`, `command`. |
| `CANON_CODING_AGENT_COMMAND` | Repository variable | CLI to run when the coding agent is `command`. |
| `COPILOT_GITHUB_TOKEN` | Repository secret | Required by the default Copilot CLI coding agent. |
| `CANON_BROKER_URL` | Repository variable | Defaults to `https://usecanon.app/api/public/runtime/token`. Override only for a private Canon deployment. |

### Who may write to this repository

Nothing here holds a standing credential that can change the repository. Stage jobs run
agent output with a read-only token and a checkout that persists no credentials, and they
hand their work to `publish.mjs` as a patch. The publisher and the release job request a
token from Canon for one operation at a time, proving which repository, workflow, and run
they are with the Actions OIDC token. Canon signs the request with the Canon GitHub App's
private key, which never enters this repository.

## Execution modes

Stages that produce a document (spec, review notes, decision) run as a single model
turn. Stages that must change the repository — code, tests, deployment config — run
inside a coding agent with a checkout, a shell, file editing, and Git; Canon commits
their work to `canon/<run>/<stage>` and opens a pull request. Action stages never
fall back to plain inference: if no coding agent is configured the stage fails.

Action stages in this blueprint: Coder, Fix Verification.

## Starting a run

Actions → **Orchestration pipeline** → Run workflow, or add the `canon:start` label to an
issue. The run issue is created immediately and every step is recorded there.

## Loop caps

Return connectors may fire 3 times before the run fails with
`loop-limit-exceeded`. This prevents an agent and a reviewer from ping-ponging forever.

## Handoffs, conflicts, and the audit trail

Every connector that fires records a handoff: which stage handed over, what artifact,
what outcome, and the exact commit the work was judged on. A stage never starts on a
handoff whose commit has been superseded — it waits instead of reviewing code that no
longer exists.

Two stages that own the same resource compile to the same lock. If both become ready
at once, Canon runs one, blocks the other, and opens a `resource-conflict` issue
naming the resource and the two stages. Resolve it by narrowing ownership or by
connecting the stages in sequence, then recompile.

Every transition is hash-chained inside the run record and checkpointed as a comment.
If the run record is edited by hand the chain no longer verifies and the run halts —
the history of a run cannot be rewritten quietly.

## Human stages

This blueprint has no human stages.
