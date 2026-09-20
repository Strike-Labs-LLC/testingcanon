// Execute one AI stage of a run.
//
// Builds the stage context from the compiled graph, the stage's agent file, and the
// artifacts produced upstream, invokes the agent, writes the artifact to disk, and
// posts a machine-readable result comment on the run issue. The stage fails loudly if
// the agent does not return a structured result — no silent passes.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  loadGraph,
  readRun,
  comment,
  resultComment,
  responseSection,
  CANON_ROOT,
} from "./state.mjs";
import { invokeCodingAgent } from "./coding-agent.mjs";
import { stageById, forwardInbound, handoffsFor } from "./engine.mjs";
import { allowedToWrite, normalizePath } from "./paths.mjs";

const GIT_BUFFER = 8 * 1024 * 1024;

function gitRaw(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: GIT_BUFFER });
}

function git(...args) {
  return gitRaw(...args).trim();
}

/**
 * Commit whatever the coding agent changed in the workspace to a stage branch and
 * open a pull request. Artifacts are committed separately by the workflow, so this
 * only carries real source changes.
 */
function headSha() {
  try {
    return git("rev-parse", "HEAD");
  } catch {
    return "";
  }
}

/**
 * Put the workspace on the run's trusted candidate commit so this stage evaluates
 * exactly what upstream produced, not whatever ref dispatched the workflow.
 */
export function checkoutCandidate(run, runGit = git) {
  const sha = String(run.candidateSha ?? "").trim();
  if (!sha) return headSha();
  let present = hasObject(sha, runGit);
  if (!present) {
    try {
      runGit("fetch", "origin", sha);
      present = hasObject(sha, runGit);
    } catch {
      // Stage jobs check out with `persist-credentials: false`, so on a private
      // repository this fetch has no credential. `fetch-depth: 0` is what makes
      // the commit local instead; the check below says so when it is missing.
      present = hasObject(sha, runGit);
    }
  }
  if (!present) {
    throw new Error(
      `The candidate commit ${sha} is not present in this checkout and could not be fetched. ` +
        `Stage jobs check out without credentials, so every candidate must already be local: ` +
        `set \`fetch-depth: 0\` on actions/checkout in the stage job, or give the job a token ` +
        `that can read this repository.`,
    );
  }
  if (headSha() === sha) return sha;
  runGit("checkout", "--detach", sha);
  return sha;
}

/** True when a commit-ish already exists in this clone. */
function hasObject(ref, runGit = git) {
  try {
    runGit("cat-file", "-e", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** True when a ref exists locally, so an unauthenticated fetch failure is survivable. */
function hasRef(ref, runGit = git) {
  try {
    runGit("rev-parse", "--verify", "--quiet", ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore the policy surface from the trusted default branch after checking out
 * the candidate. A candidate may not weaken the hooks that govern its own run.
 */
function restoreTrustedPolicy() {
  const branch = String(process.env.CANON_DEFAULT_BRANCH || "main").trim();
  try {
    git("fetch", "origin", `${branch}:refs/remotes/origin/${branch}`);
  } catch {
    // The checkout may already carry the remote ref.
  }
  for (const protectedPath of [".github/hooks", ".github/agents", ".github/copilot-instructions.md", ".github/instructions", "AGENTS.md"]) {
    try {
      git("checkout", `origin/${branch}`, "--", protectedPath);
    } catch {
      // Optional policy paths may not exist in older installs.
    }
  }
  if (!fs.existsSync(".github/hooks")) {
    throw new Error(`Trusted hooks are missing from the base branch ${branch}. Merge the Canon installation pull request before starting a run.`);
  }
}

/**
 * Capture what the stage changed, as patches — never as pushes.
 *
 * This job holds no credential that can write to the repository. Everything the
 * stage produced leaves the runner as a patch artifact that the separate trusted
 * publisher job validates and commits. A stage cannot put anything into the
 * repository that Canon's deterministic checks did not accept first.
 */
function capturePatches(run, stage, outboxDir) {
  git("add", "-A", "--", ".");
  const names = (spec) =>
    git("diff", "--cached", "--name-only", ...spec)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const write = (file, contents) => {
    if (!contents.trim()) return null;
    fs.mkdirSync(outboxDir, { recursive: true });
    const target = path.join(outboxDir, file);
    fs.writeFileSync(target, contents, "utf8");
    return target;
  };

  const artifactPrefix = `${CANON_ROOT}/artifacts/${run.runId}/${stage.id}`;
  const artifactSpec = ["--", artifactPrefix];
  const sourceSpec = ["--", ".", `:(exclude)${CANON_ROOT}/artifacts`];

  const sourceFiles = names(sourceSpec);
  const artifactFiles = names(artifactSpec);
  const sourcePatch = sourceFiles.length ? gitRaw("diff", "--cached", ...sourceSpec) : "";
  let artifactBase = "";
  try {
    const branch = artifactBranch(run);
    git("rev-parse", "--verify", `refs/remotes/origin/${branch}`);
    artifactBase = `origin/${branch}`;
  } catch {
    artifactBase = "";
  }
  const artifactPatch = artifactFiles.length
    ? gitRaw("diff", "--cached", ...(artifactBase ? [artifactBase] : []), ...artifactSpec)
    : "";

  write(`${stage.id}.source.patch`, sourcePatch);
  write(`${stage.id}.artifacts.patch`, artifactPatch);

  return {
    sourceFiles,
    artifactFiles,
    sourceHash: sourcePatch ? sha256(sourcePatch) : null,
    artifactHash: artifactPatch ? sha256(artifactPatch) : null,
  };
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The single branch every artifact of a run is committed to. */
function artifactBranch(run) {
  return `canon/${run.runId}/artifacts`;
}

/**
 * Restore the run's artifacts into this runner's workspace.
 *
 * Each stage runs on a fresh runner, so the files written by upstream stages do
 * not exist locally. They were committed to the run's artifact branch, which is
 * the durable handoff channel — without this restore a downstream stage reads an
 * empty artifact and silently reviews nothing.
 */
export function restoreArtifacts(run, runGit = git) {
  const branch = artifactBranch(run);
  const remote = `refs/remotes/origin/${branch}`;
  try {
    runGit("fetch", "origin", `${branch}:${remote}`);
  } catch {
    // On a private repository the stage job has no credential, so this fetch
    // fails even when the branch exists. A full-depth checkout already carries
    // the ref, so the failure is not fatal — only a missing ref is.
  }
  if (!hasRef(remote, runGit)) return false;
  try {
    runGit("checkout", `origin/${branch}`, "--", `${CANON_ROOT}/artifacts`);
    runGit("reset", "--", `${CANON_ROOT}/artifacts`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Paths the stage changed that its authority forbids. Vendor flags stop most of
 * this at the source, but the workspace is the final word: a stage that touched
 * a guarded path is failed rather than committed.
 */
function guardedViolations(stage) {
  const changed = statusPaths(".").filter((file) => !file.startsWith(`${CANON_ROOT}/artifacts`));
  return changed.filter((file) => !allowedToWrite(file, stage));
}

/** Both sides of a rename/copy, from NUL-delimited porcelain. Unknown status is deny. */
function statusPaths(spec) {
  const raw = git("status", "-z", "--porcelain", "--", spec);
  const parts = raw.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    if (!rec) continue;
    const code = rec.slice(0, 2);
    const first = normalizePath(rec.slice(3));
    if (/[RC]/.test(code)) {
      const second = normalizePath(parts[i + 1] ?? "");
      i += 1;
      if (first) files.push(first);
      if (second) files.push(second);
    } else if (first) {
      files.push(first);
    }
  }
  return files;
}

/** True when a read-only stage left the workspace dirty. */
function dirtyWorkspace() {
  return git("status", "--porcelain", "--", ".", `:(exclude)${CANON_ROOT}/artifacts`)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Where a stage result goes.
 *
 * The stage job runs untrusted agent output, so it is not given permission to
 * write to the run issue. It drops the finished result in an outbox that the
 * separate reporter job — which holds `issues: write` and runs no agent —
 * uploads to the ledger. Without an outbox (local runs) the result is posted
 * directly, which keeps the script usable outside Actions.
 */
const OUTBOX = (process.env.CANON_OUTBOX || "").trim();

async function publish(issueNumber, stageId, body) {
  if (OUTBOX) {
    fs.mkdirSync(OUTBOX, { recursive: true });
    fs.writeFileSync(path.join(OUTBOX, `${stageId}.md`), body, "utf8");
    console.log(`Result queued for the reporter job: ${stageId}`);
    return;
  }
  await comment(issueNumber, body);
}

/**
 * Correlation a result must carry to be trusted: this run, this stage attempt, the
 * single-use ticket `plan` issued, and the workflow execution posting it.
 */
function provenance(run, stage) {
  const state = run.stages?.[stage.id] ?? {};
  return {
    stage: stage.id,
    runId: run.runId,
    attempt: state.attempt ?? null,
    ticket: state.ticket ?? null,
    // The candidate generation this attempt was dispatched in.
    generation: state.generation ?? run.generation ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    job: process.env.GITHUB_JOB || null,
  };
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Per-artifact cap for findings quoted into a brief. */
export const FINDINGS_ARTIFACT_LIMIT = 20 * 1024;

/**
 * The findings one handoff carries: who raised them, the outcome they carry, the
 * summary, and the artifact body itself (capped, because a brief has to stay
 * inside the model's context).
 */
export function findingsSection(handoff) {
  const body = handoff.artifact ? readIfExists(handoff.artifact) : "";
  const capped =
    body.length > FINDINGS_ARTIFACT_LIMIT
      ? `${body.slice(0, FINDINGS_ARTIFACT_LIMIT)}\n\n_Findings truncated at ${FINDINGS_ARTIFACT_LIMIT} characters. Read ${handoff.artifact} for the rest._`
      : body;
  const lines = [
    `### From ${handoff.from} (${handoff.outcome ?? "no outcome"})`,
    handoff.summary ? handoff.summary : "",
    capped ? `\n${capped}` : "",
  ].filter(Boolean);
  return lines.length > 1 ? lines.join("\n") : "";
}

function upstreamContext(graph, run, stage) {
  const sections = [];
  // The handoff contract: what was handed over, and the commit it was judged on.
  const handoffs = handoffsFor(run, stage.id);
  if (handoffs.length) {
    sections.push(
      [
        "### Handoff contract",
        ...handoffs.map(
          (h) =>
            `- ${h.from} handed over ${h.artifact ? `\`${h.artifact}\`` : "its result"} ` +
            `(${h.outcome ?? "no outcome"}) at commit ${h.sha ? String(h.sha).slice(0, 12) : "unknown"}.`,
        ),
        `You are working at commit ${String(run.candidateSha ?? "").slice(0, 12) || "the repository head"}.`,
      ].join("\n"),
    );
    // A loop-back resets the returning stage to pending, so the "Input from"
    // loop below skips it and its findings would never reach this brief. The
    // handoff itself carries them, so they are rendered from the handoff.
    const findings = handoffs
      .map((h) => findingsSection(h))
      .filter(Boolean)
      .join("\n\n");
    if (findings) sections.push(`## Findings to address\n\n${findings}`);
  }
  for (const edge of graph.edges.filter((candidate) => candidate.to === stage.id)) {
    const source = stageById(graph, edge.from);
    const state = run.stages[edge.from];
    if (!source || !state || state.status !== "done") continue;
    const body = state.artifact ? readIfExists(state.artifact) : "";
    sections.push(
      [
        `### Input from ${source.name} (${source.produces})`,
        `Outcome: ${state.outcome}`,
        state.summary ? `Summary: ${state.summary}` : "",
        body ? `\n${body}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function candidateDiff(run, runGit = gitRaw) {
  const base = String(run.baseSha ?? "").trim();
  const candidate = String(run.candidateSha ?? "").trim();
  if (!base || !candidate || base === candidate) return "";
  // Local first: the stage job holds no credential, so a fetch is only attempted
  // for commits a full-depth checkout did not already bring in.
  const plain = (...args) => runGit(...args).trim();
  for (const sha of [base, candidate]) {
    if (hasObject(sha, plain)) continue;
    try {
      runGit("fetch", "origin", sha);
    } catch {
      // Reported below if the object is still missing.
    }
  }
  try {
    const diff = runGit("diff", "--no-ext-diff", `${base}..${candidate}`, "--", ".");
    if (!diff) return "";
    const limit = 80000;
    return diff.length <= limit
      ? `### Candidate diff\n\n\`\`\`diff\n${diff}\`\`\``
      : `### Candidate diff\n\n_Diff truncated to the final ${limit} characters._\n\n\`\`\`diff\n${diff.slice(-limit)}\`\`\``;
  } catch {
    return "### Candidate diff\n\nThe candidate diff could not be loaded; do not approve without inspecting the checkout directly.";
  }
}

/**
 * The agent's own words, ready to be read in the run issue.
 *
 * The artifact file holds the full response, but nobody reads a file path in a
 * comment thread. The ledger carries the real answer so a run looks like work
 * happening, not a template being filled in. Long responses are tailed so one
 * verbose stage cannot exceed GitHub's comment limit.
 */
const RESPONSE_LIMIT = 40000;

function narrative(text) {
  const body = String(text ?? "")
    .replace(/```canon-result[\s\S]*?```/i, "")
    .trim();
  if (body.length <= RESPONSE_LIMIT) return body;
  return `_Response truncated — the full text is in the artifact._\n\n${body.slice(-RESPONSE_LIMIT)}`;
}

function parseResult(text) {
  const match = text.match(/```canon-result\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function main() {
  const issueNumber = Number(arg("issue"));
  const stageId = arg("stage");
  const graph = loadGraph();
  const run = await readRun(issueNumber);
  const stage = stageById(graph, stageId);
  if (!stage) throw new Error(`Stage "${stageId}" is not in graph.json.`);

  // Called by the workflow when the stage job itself fails (runner crash, timeout,
  // cancelled job). Records an infrastructure failure so the run cannot advance as if
  // the stage had completed.
  if (process.argv.includes("--report-failure")) {
    // The failed "Run stage" step usually queued its own result first — with
    // the real reason, such as the agent CLI's error. Never overwrite it with
    // this generic job-level record.
    const queued = OUTBOX ? path.join(OUTBOX, `${stage.id}.md`) : "";
    if (queued && fs.existsSync(queued)) {
      console.log(`A result for ${stage.id} is already queued; keeping it.`);
      return;
    }
    const reason = arg("reason") || "The stage job failed before it could publish a result.";
    await publish(
      issueNumber,
      stage.id,
      resultComment(
        { ...provenance(run, stage), status: "failed", summary: reason },
        `### ${stage.name} — failed\n\n${reason}`,
      ),
    );
    return;
  }

  // Every stage — inference or coding agent — is bound to the commit it read,
  // and reads upstream artifacts from the run's artifact branch. Both happen
  // before the prompt is built, because the prompt quotes those artifacts.
  let evaluatedSha = "";
  try {
    evaluatedSha = checkoutCandidate(run);
    restoreTrustedPolicy();
  } catch (error) {
    const reason = `Could not check out candidate commit ${String(run.candidateSha).slice(0, 12)}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    await publish(
      issueNumber,
      stage.id,
      resultComment(
        { ...provenance(run, stage), status: "failed", summary: reason },
        `### ${stage.name} — failed\n\n${reason}`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  restoreArtifacts(run);

  const agentFile = stage.agentFile ? readIfExists(stage.agentFile) : "";
  const allowed = (stage.outcomes ?? ["approved", "changes_required", "rejected"]).join(", ");
  const policy = stage.tools ?? { write: true, shell: true, denyPaths: [] };

  const system = [
    agentFile || `You are the ${stage.role} stage of an engineering pipeline.`,
    "",
    "## Output contract",
    "",
    "Write your work as markdown. Then end your reply with exactly one fenced block:",
    "",
    "```canon-result",
    `{ "outcome": "<one of: ${allowed}>", "summary": "<one sentence>", "route": [] }`,
    "```",
    "",
    "The run halts if this block is missing or the outcome is not in the allowed list.",
    stage.forbidden?.length
      ? `\nNever do any of the following: ${stage.forbidden.join("; ")}.`
      : "",
  ].join("\n");

  const prompt = [
    `# Run ${run.runId}`,
    run.objective ? `\nObjective: ${run.objective}` : "",
    `\n## Your stage: ${stage.name}`,
    stage.task ? `\nTask: ${stage.task}` : "",
    stage.acceptance ? `\nDone when: ${stage.acceptance}` : "",
    stage.produces ? `\nProduce: ${stage.produces.replace(/_/g, " ")}` : "",
    "",
    upstreamContext(graph, run, stage) || "No upstream artifacts — you are the first stage.",
    stage.attestsCandidate ? candidateDiff(run) : "",
  ].join("\n");

  const dir = path.join(CANON_ROOT, "artifacts", run.runId, stage.id);
  fs.mkdirSync(dir, { recursive: true });

  // Every stage that must see the repository runs in a coding agent. Action
  // stages get write/shell when the compiled policy allows it. Analysis stages
  // get a read-only session so they can inspect the tree without a chat-only
  // provider (GitHub Models is gone).
  const action = stage.execution === "coding-agent";
  const mode = action ? "coding-agent" : "repo-read";
  const agentPolicy = action
    ? policy
    : { write: false, shell: false, denyPaths: policy.denyPaths ?? [] };

  // The agentStop test hook is expensive: it forces the model to continue. It is
  // told, explicitly, whether this stage may write at all.
  process.env.CANON_STAGE_WRITES = String(agentPolicy.write === true);

  let text = "";
  let failure = null;
  try {
    const briefFile = path.join(dir, "BRIEF.md");
    fs.writeFileSync(
      briefFile,
      [
        system,
        "",
        "## Working agreement",
        "",
        action
          ? "You are running inside a checkout of the repository with full tooling.\nDo the work for real: read the codebase, edit files, run the test suite,\nand leave the workspace in the state you want committed. Canon commits your\nchanges to a branch and opens a pull request after this session ends."
          : "You are running inside a checkout of the repository with read-only tools.\nInspect the tree. Do not edit files or run mutating commands.",
        "Write the canon-result block to stdout as the last thing you print.",
        "",
        prompt,
      ].join("\n"),
    );
    text = await invokeCodingAgent({
      promptFile: briefFile,
      policy: agentPolicy,
      model: stage.model,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const parsed = failure ? null : parseResult(text);
  const outcomes = stage.outcomes ?? [];
  const valid = parsed && (outcomes.length === 0 || outcomes.includes(parsed.outcome));

  if (!valid) {
    const reason = failure
      ? `${mode === "coding-agent" ? "Coding agent" : "Agent"} invocation failed: ${failure}`
      : parsed
        ? `Outcome "${parsed.outcome}" is not one of: ${allowed}.`
        : "The agent did not return a canon-result block.";
    // Show what the agent actually said, so a failure is diagnosable from the
    // run issue instead of only from the workflow log.
    const said = responseSection(narrative(text), { title: "What the agent said" });
    await publish(
      issueNumber,
      stage.id,
      resultComment(
        { ...provenance(run, stage), status: "failed", summary: reason },
        [`### ${stage.name} — failed`, "", reason, said ? `\n${said}` : ""]
          .filter(Boolean)
          .join("\n"),
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Authority is enforced against the workspace, not the transcript. A stage that
  // wrote somewhere it was never granted fails here, before a patch is even cut.
  const violations = guardedViolations(stage);
  if (violations.length) {
    const reason =
      `This stage changed paths its authority forbids: ${violations.slice(0, 10).join(", ")}. ` +
      `Grant the matching capability in Canon or leave those files alone.`;
    git("checkout", "--", ".");
    await publish(
      issueNumber,
      stage.id,
      resultComment(
        { ...provenance(run, stage), status: "failed", summary: reason },
        `### ${stage.name} — failed\n\n${reason}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  // A read-only stage that modified the repository is a broken stage, not a
  // publishable one: its verdict was supposed to be about the code as it stands.
  if (!stage.producesCandidate) {
    const dirty = dirtyWorkspace();
    if (dirty.length) {
      const reason = `This stage is read-only but modified the workspace (${dirty.length} change${
        dirty.length === 1 ? "" : "s"
      }). Its verdict must be about the candidate commit as delivered.`;
      git("checkout", "--", ".");
      await publish(
        issueNumber,
        stage.id,
        resultComment(
          { ...provenance(run, stage), status: "failed", summary: reason },
          `### ${stage.name} — failed\n\n${reason}`,
        ),
      );
      process.exitCode = 1;
      return;
    }
  }

  const artifact = path.join(dir, `${stage.produces || "output"}.md`);
  fs.writeFileSync(artifact, text.replace(/```canon-result[\s\S]*?```/i, "").trim());

  // Everything this stage produced leaves as a patch. The trusted publisher job
  // validates it and is the only principal that may commit it.
  const captured = OUTBOX ? capturePatches(run, stage, OUTBOX) : null;
  const record = {
    ...provenance(run, stage),
    execution: mode,
    evaluatedSha: evaluatedSha || null,
    baseSha: evaluatedSha || headSha() || null,
    outcome: parsed.outcome,
    summary: parsed.summary ?? "",
    artifact,
    producesCandidate: stage.producesCandidate === true,
    attestsCandidate: stage.attestsCandidate === true,
    sourceFiles: captured?.sourceFiles ?? [],
    artifactFiles: captured?.artifactFiles ?? [],
    sourcePatchHash: captured?.sourceHash ?? null,
    artifactPatchHash: captured?.artifactHash ?? null,
    route: parsed.route ?? [],
    // The agent's real answer, carried to the publisher so the ledger shows the
    // work rather than a one-line stub.
    response: narrative(text),
  };

  if (OUTBOX) {
    fs.mkdirSync(OUTBOX, { recursive: true });
    fs.writeFileSync(
      path.join(OUTBOX, `${stage.id}.result.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    console.log(`Stage output handed to the publisher: ${stage.id}`);
    return;
  }

  // Local run outside Actions: no publisher job exists, so report directly.
  await publish(
    issueNumber,
    stage.id,
    resultComment(
      { ...record, response: undefined },
      [
        `### ${stage.name} — ${parsed.outcome}`,
        "",
        parsed.summary ?? "",
        "",
        responseSection(record.response),
        "",
        `Artifact: \`${artifact}\``,
        evaluatedSha ? `Commit evaluated: \`${evaluatedSha.slice(0, 12)}\`` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
}

if ((process.argv[1] ?? "").endsWith("run-stage.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
