# Canon orchestration runtime

Generated runtime for **Autonomous feature delivery**.

Edit the blueprint in Canon and recompile. Do not edit these files by hand.

This flow uses the default single-flow layout, `.canon`. Connect it through Canon to install it in an isolated namespace alongside other flows.

## Layout

| File | Responsibility |
| --- | --- |
| `graph.json` | Compiled blueprint: stages, connectors, conditions, joins, loop caps. |
| `engine.mjs` | Pure decision logic: ready set, join policy, routing, loop caps. |
| `state.mjs` | Reads and writes the run record on the run issue. Verifies stage results before they may change it. |
| `start-run.mjs` | Opens a run issue and starts the loop. |
| `tick.mjs` | One tick: plan ready stages, apply results, route. |
| `run-stage.mjs` | Executes one AI stage and posts a structured result (run, stage attempt, single-use ticket, workflow run, evaluated commit). |
| `publish.mjs` | Trusted publisher. Validates each stage patch against that stage's authority, size, file-type, secret, and base-commit rules, then commits. Stage jobs hold no write credential. |
| `canon-token.mjs` | Obtains a short-lived, operation-scoped publishing token from Canon. Jobs prove identity with the Actions OIDC token. No publishing credential is stored in this repository. |
| `invoke-agent.mjs` | Provider-agnostic model call. Analysis stages only. |
| `coding-agent.mjs` | Coding-agent session (shell, edits, tests, Git) for action stages. |
| `human.mjs` | Records `/canon <decision>` from a person and resumes the run. |
| `release.mjs` | Authorizes a release for the run's candidate commit — the commit development produced and every review, QA, and approval stage evaluated. A run whose stages judged different commits is never authorized. |
| `escalate.mjs` | Escalates human stages past their response time. |
| `artifacts/` | Every artifact produced by every run, committed to the repository. |

## Result trust

Comments are the audit log, not the state machine.

`plan` issues a single-use ticket for each stage attempt. A `canon:result` marker moves the run only when all of the following are true:

- Posted by a workflow (bot/App) identity
- Never edited
- Names this run and a stage that is currently running
- Quotes that stage's ticket and attempt
- Declares its workflow run
- Evaluated the run's candidate commit

Anything else is ignored and called out on the issue.

## Configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `CANON_AGENT_PROVIDER` | Repository variable | `anthropic`, `openai`, or `command`; there is no silent default. |
| `CANON_AGENT_COMMAND` | Repository variable | CLI to run when the provider is `command`. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Repository secret | Required only for those providers. |
| `CANON_CODING_AGENT` | Repository variable | Coding agent for action stages: `copilot` (default), `claude`, `codex`, `command`. |
| `CANON_CODING_AGENT_COMMAND` | Repository variable | CLI to run when the coding agent is `command`. |
| `COPILOT_GITHUB_TOKEN` | Protected workflow variable | The job's short-lived GitHub token, passed to Copilot CLI without exposing it in the prompt. |
| `CANON_BROKER_URL` | Repository variable | Defaults to `https://usecanon.app/api/public/runtime/token`. Override only for a private Canon deployment. |

## Write authority

Nothing in this directory holds a standing credential that can change the repository.

- Stage jobs run agent output with a read-only token and a checkout that persists no credentials.
- Work is handed to `publish.mjs` as a patch.
- The publisher and the release job request a token from Canon for one operation at a time.
- Identity is proven with the Actions OIDC token (repository, workflow, run).
- Canon signs the request with the Canon GitHub App's private key. That key never enters this repository.

## Execution modes

| Kind | How it runs |
| --- | --- |
| Document stages (spec, review notes, decision) | Single model turn. |
| Action stages (code, tests, deployment config) | Coding agent with checkout, shell, file editing, and Git. Canon commits to `canon/<run>/<stage>` and opens a pull request. |

Action stages never fall back to plain inference. If no coding agent is configured, the stage fails.

Action stages in this blueprint: **Feature Coder**, **Test Author**, **QA Verifier**

## Start a run

1. Actions → **Orchestration pipeline** → Run workflow, or
2. Add the `canon:start` label to an issue.

The run issue is created immediately, labelled `canon-run`. Every step is recorded there.

## Loop caps

Return connectors may fire **3** times. After that the run fails with `loop-limit-exceeded`.

This prevents an agent and a reviewer from ping-ponging forever.

## Handoffs, conflicts, and audit

- Every fired connector records a handoff: source stage, artifact, outcome, and the exact commit the work was judged on.
- A stage never starts on a handoff whose commit has been superseded. It waits rather than reviewing code that no longer exists.
- Two stages that own the same resource compile to the same lock. If both become ready at once, Canon runs one, blocks the other, and opens a `resource-conflict` issue naming the resource and the two stages. Resolve by narrowing ownership or sequencing the stages, then recompile.
- Every transition is hash-chained inside the run record and checkpointed as a comment. If the run record is edited by hand, the chain fails verification and the run halts. History cannot be rewritten quietly.

## Human stages

This blueprint has no human stages.
