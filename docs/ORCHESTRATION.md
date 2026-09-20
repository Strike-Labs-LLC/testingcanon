# Canon orchestration runtime

This repository includes the **Autonomous production engineering** pipeline. Canon stores its executable graph,
run state helpers, policy checks, and stage handoff logic under `.canon/`.

## How a run works

1. A run starts from the generated pipeline workflow or the configured start label.
2. Preflight verifies the Canon GitHub App, agent credentials, Actions policy, labels,
   environments, branch governance, and any required security capability.
3. Each stage receives the accepted output and commit identity from its predecessors.
4. AI stages run with the stage's compiled tool and path authority. Human stages wait
   for the assigned reviewer and record the decision in the run issue.
5. Source changes leave an agent job as patches. A separate trusted publisher validates
   and applies those patches with a short-lived, operation-scoped token.
6. The run issue remains the readable audit record for stage status, outputs, retries,
   loop-backs, and failures.

## Trust boundaries

- Generated hooks, agent contracts, instructions, and `AGENTS.md` are restored from
  the default branch before a stage runs. A candidate cannot weaken its own policy.
- Provider credentials remain GitHub Actions secrets. Canon does not write them into
  generated files or run output.
- A stage cannot push directly. Publication requires Canon's brokered GitHub App token
  after deterministic path, patch, and provenance checks pass.
- Parallel flows use separate runtime folders, workflow names, labels, locks, and
  artifacts, so one flow cannot overwrite another flow's execution state.

## Important files

| Path | Purpose |
| --- | --- |
| `.canon/graph.json` | Compiled stages, handoffs, gates, authority, and workflow paths. |
| `.canon/preflight.mjs` | Repository and account readiness checks before execution. |
| `.canon/start-run.mjs` | Creates the auditable run record and begins dispatch. |
| `.canon/run-stage.mjs` | Restores trusted policy, executes a stage, and captures patches. |
| `.canon/tick.mjs` | Advances eligible stages and enforces loop and join rules. |
| `.canon/manifest.json` | Versioned inventory and hashes for install, update, and removal. |

## Operations

- Verify installation: `node .canon/verify.mjs`
- Preview an update: `node .canon/install.mjs --dry-run`
- Apply an update: `node .canon/install.mjs`
- Preview removal: `node .canon/uninstall.mjs`

Generated from blueprint version 7 on 2026-09-20.
