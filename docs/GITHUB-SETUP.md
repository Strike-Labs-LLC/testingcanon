# GitHub setup after installation

The exported files configure agents, workflows, and documentation. The settings below are
**not files** — apply them in the repository once, after the installation pull request merges.

Repository: `YOUR-ORG/YOUR-REPO`
Default branch: `main`

Run everything below in one step:

```bash
bash .sdlc/github/apply.sh
```

The payloads in `.sdlc/github/` are GitHub REST request bodies. `.sdlc/github-setup.json` is
Canon's inventory of the same configuration and is not itself an API payload.

## 1. Merge strategy

Settings → General → Pull Requests:

- Allow squash merging: on
- Allow merge commits: off
- Allow rebase merging: off
- Automatically delete head branches: on

## 2. Branch ruleset (enforced)

Applied from `.sdlc/github/ruleset-branch.json`.

- Name: Canon default branch protection
- Enforcement: Active
- Target: `main`
- Rules:
  - Restrict deletions
  - Block force pushes
  - Require a pull request before merging
    - Required approvals: 1
    - Code owners — not configured
    - Dismiss stale approvals on push: on
    - Require conversation resolution: on
  - Require status checks to pass:
    - Lint
    - Build
    - Unit tests
    - Integration tests
    - Dependency review

Release tags matching `v*` are protected by `.sdlc/github/ruleset-tags.json`, so an
unauthorized release tag cannot be created in the first place.

Without this ruleset the pipeline is advisory only: anything can push directly to
`main` and skip every gate.

## 3. Environments and approval authority

- **development** — deployments allowed from `main`
- **staging** — deployments allowed from `main`
- **production** — required reviewers: **unresolved — set an approver on the human release gate**; protected branches only; prevent self-review on

Approval authority per gate (`.sdlc/approval-policy.json`):

- No human gates in this pipeline.

Only the people and teams listed above can satisfy a gate. Repository write access is not
sufficient by itself.

## 4. Labels

Every label below is referenced by a workflow or by the Canon runtime. A missing label makes
the referencing workflow fail at apply time, so all of them are created.

- `feature` — New capability
- `bug` — Defect
- `chore` — Routine maintenance
- `tech-debt` — Maintainability work
- `security` — Security work
- `needs-triage` — Awaiting triage
- `needs-info` — Blocked on missing information
- `ready-for-design` — Requirements approved
- `ready-for-development` — Design approved
- `dependencies` — Dependency updates
- `ci` — Pipeline changes
- `canon:start` — Starts a Canon orchestration run
- `canon-run` — Canon orchestration run
- `awaiting-human` — A human gate is open on this run
- `run-completed` — Canon run finished successfully
- `run-failed` — Canon run failed
- `resource-conflict` — Two stages own the same resource in a run
- `sla-breached` — A human gate passed its response time
- `design-approved` — Technical approach accepted
- `design-changes-required` — Technical approach needs rework
- `changes-requested` — Review requested changes
- `review-approved` — Review approved the change
- `security-review` — Needs a security review
- `docs-drift` — Documentation no longer matches the code
- `release-readiness` — Release readiness report
- `technical-audit` — Repository audit findings

```bash
bash .sdlc/github/labels.sh
```

## 5. Stack-derived CI

The pipelines are built from the stack layers confirmed in Canon, not from a generic preset.

- Electron runs headless on the runner through Xvfb.
- A style lint job runs the repository's lint:styles script when it exists.

## 6. Security features

Settings → Code security:

- Secret scanning: on
- Push protection: on
- Dependabot alerts: on
- Dependabot security updates: on
- Code scanning (CodeQL): off
- Private vulnerability reporting: on

## 7. Agents and workflows

- Agent definitions in `.github/agents/` are read from the **default branch**. They only take
  effect after the installation pull request merges.
- Every workflow in `.github/workflows/` is an ordinary deterministic Actions workflow. There is
  no second compiler and no generated lock files to keep in sync.
- Agent jobs check out read-only with credentials not persisted. All writes go through the
  trusted publisher job in `.canon/publish.mjs`, which validates each patch before committing.
- Create the `COPILOT_GITHUB_TOKEN` secret (a PAT or GitHub App token with Copilot access).
- Confirm Copilot coding agent is enabled for `YOUR-ORG/YOUR-REPO` (Settings → Copilot).

## 8. MCP servers

MCP is configured in repository settings, not in this package:
**Settings → Copilot → Coding agent → MCP configuration**. Reference an MCP tool from an agent
file as `<server>/<tool>` in its `tools:` list.

## 9. Assigning work to the Copilot cloud agent

Assign the issue to `copilot-swe-agent[bot]` through the Issues API and pass the agent
assignment options:

```bash
gh api --method POST repos/YOUR-ORG/YOUR-REPO/issues/ISSUE_NUMBER/assignees \
  -f "assignees[]=copilot-swe-agent[bot]" \
  -f "agent_assignment[base_branch]=main" \
  -f "agent_assignment[custom_agent]=delivery-orchestrator"
```

Stage-to-agent mapping lives in `.sdlc/agent-routing.yml`.

## Separation of authority

An agent saying "this is ready" is not the same as GitHub allowing a merge. Rulesets,
environments, and required checks are the enforcement layer, and they sit outside the agents.
Copilot hooks are a guardrail, not a boundary: a command hook that times out fails open.
