# Install your AI SDLC pipeline in GitHub

> **Review before you install.** These files are generated from your blueprint and are
> provided as is, without warranty. They can create, modify, and delete code and
> infrastructure. Read every file, test in an isolated environment first, and keep a human
> approval step on anything that deploys or deletes. Strike Labs is not liable for the
> outcome. See `DISCLAIMER.md`.

This package configures a GitHub repository to run the **Bug triage fix verify** pipeline you designed.


- Platform: GitHub
- Installation scope: Single repository
- Repository: existing repository
- Installation method: Git command line
- Target repository: `YOUR-ORGANIZATION/YOUR-REPOSITORY`
- Default branch: `main`

## Do not rename or move anything

GitHub discovers these features by exact path. These directories must stay where they are:

```text
.github/agents/
.github/instructions/
.github/skills/
.github/prompts/
.github/hooks/
.github/workflows/
.github/ISSUE_TEMPLATE/
```

## Install using Git

### 1. Clone

```bash
git clone https://github.com/YOUR-ORGANIZATION/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

### 2. Create the installation branch

```bash
git checkout -b setup/ai-sdlc
```

### 3. Install with the Canon installer — do not rsync

```bash
unzip ~/Downloads/bug-triage-fix-verify-github-package.zip -d /tmp/sdlc-package
node /tmp/sdlc-package/.canon/install.mjs --target . --dry-run
node /tmp/sdlc-package/.canon/install.mjs --target .
```

Never copy the package with rsync or cp. The installer classifies every path and treats a pre-existing Canon-owned file as a conflict unless the content already matches.

### 4. Hook scripts

Hook commands invoke scripts via `bash <script>`, so execute bits are not required — browser uploads and ZIP extracts work as-is. If you prefer direct execution, run `chmod +x .github/hooks/scripts/*.sh`.

The hooks read each tool call as JSON on stdin and need `jq`. GitHub-hosted runners and Codespaces
include it; on a self-hosted runner or a local machine, install it (`brew install jq`,
`apt-get install jq`). Without `jq` the hooks deny tool calls rather than pass them through.


### 5. Commit and push

```bash
git add -A
git commit -m "Install AI SDLC pipeline"
git push -u origin setup/ai-sdlc
```

## Open a pull request

1. Open a pull request from `setup/ai-sdlc` into `main`.
2. Review the generated files — especially the workflows, hooks, and CODEOWNERS.
3. Merge through the repository's normal review controls.
4. Return to Canon and verify installation before starting a run.

Custom agents, issue forms, and agentic workflows operate from the **default branch**. Nothing
is active until the pull request merges. Never push the package directly to `main`.


## Post-install repository settings

Several controls are settings, not files: branch rulesets, environments and approvals,
labels, and security features. Apply them from `docs/GITHUB-SETUP.md`
(machine-readable form: `.sdlc/github-setup.json`).

The `.yml` workflows are ordinary deterministic Actions and run immediately.

## Connecting MCP servers

MCP is not a file in this package. For the Copilot coding agent it is configured per repository:
**Settings → Copilot → Coding agent → MCP configuration**. Add the servers your stages need
(for example an issue tracker or documentation server), then reference their tools from an agent
file as `<server>/<tool>` in the `tools:` list.

IDE-level MCP is separate and lives in your editor configuration (for example
`.vscode/mcp.json`). It does not affect the coding agent running on GitHub.

## Install the Canon GitHub App (optional)

You do not need this to compile, download, or install the package. Everything in
this package runs with GitHub's built-in `GITHUB_TOKEN`.

Install the App only if you want Canon to create **protected `v*` release tags**
for you. Without it, protected tags are created by whoever you name as the bypass
actor in the tag ruleset (see `docs/GITHUB-SETUP.md`), or you can leave the tag
ruleset off and tag manually.

If you do want it:

1. Install the Canon GitHub App on the selected repository only.
2. Confirm the App id is available to Canon as `CANON_RELEASE_APP_ID` so the tag
   ruleset can name it as the only `v*` creation bypass actor.
3. Set repository variable `CANON_BROKER_URL` if you are not using
   `https://usecanon.app/api/public/runtime/token`.
4. Do not start a run until App installation, permissions, and broker reachability
   are confirmed.


## Operating the pipeline

The orchestration pipeline is a real run loop, not a set of placeholder jobs. It lives in
`.canon/` (the engine, the compiled graph, and the stage runner) and four workflows in
`.github/workflows/`.

### 1. Choose how agents are invoked

Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value |
| --- | --- |
| `CANON_AGENT_PROVIDER` | `github-models` (default, uses the built-in token and the workflow's `models: read` permission), `anthropic`, `openai`, or `command` |
| `CANON_AGENT_COMMAND` | Only for `command`: the CLI to pipe each stage into (Claude Code, Cursor, Copilot CLI) |

Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` as an Actions **secret** if you picked that provider.

This provider is used for **analysis stages only** — stages that read context and write a
document. Stages that must change the repository (code, tests, deployment config) run in a
real coding agent with a shell, file editing, and Git:

| Variable | Value |
| --- | --- |
| `CANON_CODING_AGENT` | `copilot` (default), `claude`, `codex`, or `command` |
| `CANON_CODING_AGENT_COMMAND` | Only for `command`: the coding-agent CLI to run |

Add the matching Actions **secret**: `COPILOT_GITHUB_TOKEN` for Copilot CLI,
`ANTHROPIC_API_KEY` for Claude Code, `OPENAI_API_KEY` for Codex. Action stages fail
closed if no coding agent is configured — Canon will not fake code changes with a chat reply.
Their work is committed to `canon/<run>/<stage>` and opened as a pull request.

### 2. Allow Actions to run Actions

Settings → Actions → General → Workflow permissions: enable **Read and write permissions**
and **Allow GitHub Actions to create and approve pull requests**. The run loop re-dispatches
itself, so without this a run stops after the first tick.

### 3. Start a run

Actions → **Orchestration pipeline** → Run workflow, and describe the objective. You can also
add the `canon:start` label to any issue.

Canon opens a run issue labelled `canon-run`. That issue *is* the run: it holds the run record
(stage statuses, outcomes, artifact paths, loop counters) and every stage result as a comment.

### 4. Answer a human gate

When the run reaches a human stage it posts an assignment comment naming the assignee, the
instructions, and the allowed decisions. Reply on the issue:

```text
/canon approved
/canon changes_required Needs error handling on the retry path.
```

Only the named assignee or a collaborator with write access can decide a gate. Deploy and
release stages additionally run inside a GitHub Environment, so the native required-reviewer
approval applies on top of the decision.

### 5. Read the results

Artifacts are committed to `.canon/artifacts/<run-id>/<stage>/`. Loop-backs are capped, so a
coder/reviewer cycle fails the run with `loop-limit-exceeded` instead of running forever.

## Verify the installation

- [ ] `AGENTS.md` is at the repository root
- [ ] `.github/agents/` contains one file per automated stage (human stages have no agent file)
- [ ] Actions ran on the installation pull request
- [ ] Issue forms appear under **New issue**
- [ ] Branch ruleset is active on `main`
- [ ] Environments exist with the required approvals
- [ ] MCP servers configured in repository settings, if any stage needs them
- [ ] `CANON_AGENT_PROVIDER` is set and its provider secret exists
- [ ] `CANON_CODING_AGENT` is set and its secret exists, if any stage produces code, tests, or deployments
- [ ] A test run reaches at least the first stage and posts a result comment
- [ ] Hook scripts run via `bash` (execute bits not required)

## Changing the pipeline later

Edit the blueprint in the builder, export again, and replace the generated files. Do not
hand-edit them — `.sdlc/blueprint.yml` is the source of truth.
