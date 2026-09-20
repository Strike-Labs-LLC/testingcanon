// Run state, stored in the repository — no external service.
//
// The run record lives as JSON inside the body of a GitHub issue labelled `canon-run`.
// Every stage result is posted as a comment carrying a machine-readable marker, so the
// full history of a run is auditable in the issue timeline.

import fs from "node:fs";
import path from "node:path";

const API = process.env.GITHUB_API_URL || "https://api.github.com";
const REPO = process.env.GITHUB_REPOSITORY || "";
// Read at call time, never cached: trusted jobs replace this with a short-lived
// brokered installation token after the module has already been imported.
const token = () => process.env.GITHUB_TOKEN || "";

/**
 * Where this flow's runtime lives, and which run issues belong to it. A
 * repository may run several flows at once, so each flow's workflows export
 * `CANON_ROOT` and `CANON_RUN_LABEL`; the unprefixed defaults are the legacy
 * single-flow layout.
 */
export const CANON_ROOT = process.env.CANON_ROOT || ".canon";
export const RUN_LABEL = process.env.CANON_RUN_LABEL || "canon-run";
export const START_LABEL = process.env.CANON_START_LABEL || "canon:start";
export const LABEL_SUFFIX = process.env.CANON_LABEL_SUFFIX || "";
export const runtimeLabel = (name) => `${name}${LABEL_SUFFIX}`;
export const RESULT_MARKER = "canon:result";
export const RUN_BLOCK_START = "<!-- canon:run -->";
export const RUN_BLOCK_END = "<!-- /canon:run -->";

export async function gh(route, init = {}, overrideToken = "") {
  const url = route.startsWith("http") ? route : `${API}${route}`;
  const { token: _ignored, ...request } = init;
  const response = await fetch(url, {
    ...request,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${overrideToken || token()}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${route} failed (${response.status}): ${detail}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

export function loadGraph(root = CANON_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, "graph.json"), "utf8"));
}

/** Render the run record as an issue body: a readable summary plus the JSON block. */
export function encodeRun(graph, run) {
  const rows = graph.stages.map((stage) => {
    const state = run.stages[stage.id] ?? {};
    const outcome = state.outcome ? ` — ${state.outcome}` : "";
    return `| ${stage.name} | ${state.status ?? "pending"}${outcome} | ${state.iterations ?? 0} |`;
  });
  // A failed run says why on the face of the record, not only in the JSON and
  // not only in a comment further down the thread.
  const failure = run.failure
    ? [
        `**Stopped:** ${run.failure.reason}`,
        ...(run.failure.detail ?? []).map((line) => `- ${line}`),
        "",
      ]
    : [];
  return [
    `**Run ${run.runId}** — status: \`${run.status}\``,
    "",
    run.objective ? `Objective: ${run.objective}` : "",
    "",
    ...failure,
    "| Stage | Status | Runs |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "<details><summary>Run record (do not edit)</summary>",
    "",
    RUN_BLOCK_START,
    "```json",
    JSON.stringify(run, null, 2),
    "```",
    RUN_BLOCK_END,
    "",
    "</details>",
  ].join("\n");
}

export function decodeRun(body) {
  const start = body.indexOf(RUN_BLOCK_START);
  const end = body.indexOf(RUN_BLOCK_END);
  if (start === -1 || end === -1) throw new Error("No Canon run record found in this issue.");
  const block = body.slice(start + RUN_BLOCK_START.length, end);
  const json = block
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(json);
}

export async function readRun(issueNumber) {
  const issue = await gh(`/repos/${REPO}/issues/${issueNumber}`);
  const run = decodeRun(issue.body ?? "");
  if (typeof run.stateVersion !== "number") run.stateVersion = 0;
  return run;
}

/**
 * Write the run record, refusing to overwrite a newer one.
 *
 * The record lives in an issue body, which has no transactions. Two writers — a
 * tick and a human decision arriving at the same moment — would otherwise
 * last-write-wins, silently dropping a recorded outcome. Every write increments
 * `stateVersion` and re-reads first: if the stored version moved since this copy
 * was loaded, the write is rejected and the caller re-runs against fresh state.
 */
export async function writeRun(issueNumber, graph, run) {
  const expected = typeof run.stateVersion === "number" ? run.stateVersion : 0;
  let current = null;
  try {
    current = await readRun(issueNumber);
  } catch {
    current = null; // First write, or an unreadable body: fall through to the write.
  }
  if (current && (current.stateVersion ?? 0) !== expected) {
    const error = new Error(
      `The run record changed while this job was working (expected version ${expected}, ` +
        `found ${current.stateVersion ?? 0}). Nothing was written.`,
    );
    error.code = "CANON_STATE_CONFLICT";
    throw error;
  }
  run.stateVersion = expected + 1;
  run.updatedAt = new Date().toISOString();
  await gh(`/repos/${REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ body: encodeRun(graph, run) }),
  });
}

export async function createRunIssue(graph, run, title) {
  await ensureLabel(RUN_LABEL, "0e8a16", "Canon orchestration run");
  return gh(`/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body: encodeRun(graph, run), labels: [RUN_LABEL] }),
  });
}

export const CONFLICT_LABEL = runtimeLabel("resource-conflict");

/**
 * Open a human-escalation issue, or return the open one that already exists.
 *
 * Conflicts repeat every tick until a person resolves them, so the issue is keyed
 * by title: one issue per run and lock, never a new issue per tick.
 */
export async function ensureIssue(title, body, labels = []) {
  const query = encodeURIComponent(`repo:${REPO} is:issue is:open in:title "${title}"`);
  try {
    const found = await gh(`/search/issues?q=${query}`);
    const match = (found.items ?? []).find((item) => item.title === title);
    if (match) return match;
  } catch {
    // Search is best-effort; fall through and create the issue.
  }
  for (const label of labels) await ensureLabel(label, "d1242f", "Canon escalation");
  return gh(`/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels }),
  });
}

export async function ensureLabel(name, color, description) {
  try {
    await gh(`/repos/${REPO}/labels/${encodeURIComponent(name)}`);
  } catch {
    await gh(`/repos/${REPO}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color, description }),
    }).catch(() => null);
  }
}

export async function addLabel(issueNumber, name) {
  await gh(`/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: [name] }),
  }).catch(() => null);
}

export async function listCanonIssues() {
  return gh(`/repos/${REPO}/issues?state=all&labels=${encodeURIComponent(RUN_LABEL)}&per_page=100`);
}

export async function comment(issueNumber, body) {
  return gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function closeIssue(issueNumber, commentBody) {
  if (commentBody) await comment(issueNumber, commentBody);
  return gh(`/repos/${REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
}

export async function listComments(issueNumber) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gh(
      `/repos/${REPO}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Trusted stage results, newer than the run cursor.
 *
 * A comment is audit output, not authority. Anyone with write access — or any
 * automation with an issues token — can paste a `canon:result` marker. A result is
 * only allowed to move the state machine when all of the following hold:
 *
 *   1. it was posted by a bot/GitHub App identity (a workflow run), not a human;
 *   2. the comment has never been edited after creation;
 *   3. it names this run, a stage that is currently `running`, and the exact
 *      single-use ticket + attempt that `plan` issued for that stage attempt;
 *   4. it declares the workflow run that produced it;
 *   5. it evaluated the run's current candidate commit — unless it reports a
 *      failure, which is not a verdict about the candidate at all.
 *
 * Rule 5 exists so a verdict cannot count for a commit it never looked at. A
 * `status: "failed"` report claims nothing about the candidate: it says the
 * stage could not produce a verdict, and it can only fail the run, never
 * advance it. Holding failures to rule 5 rejected every one of them — a stage
 * that dies before or during the agent call has no evaluated commit to name —
 * so the real reason (an agent CLI refusal, a policy denial, a checkout error)
 * was discarded and the run recorded the generic "ended without publishing a
 * trusted result" instead. Every other rule above still applies to a failure,
 * including the unguessable per-attempt ticket, so this forges nothing.
 *
 * Anything else is returned as rejected so the run can say so out loud.
 */
export function trustedResults(comments, run, cursor = run?.cursor ?? 0) {
  const accepted = [];
  const rejected = [];

  for (const item of comments) {
    if (item.id <= cursor) continue;
    const match = item.body?.match(/<!--\s*canon:result\s+([\s\S]*?)-->/);
    if (!match) continue;

    let payload;
    try {
      payload = JSON.parse(match[1]);
    } catch {
      rejected.push({ commentId: item.id, reason: "the result marker is not valid JSON" });
      continue;
    }

    const entry = { commentId: item.id, ...payload };
    const author = item.user?.login ?? "unknown";
    const isMachine = item.user?.type === "Bot" || Boolean(item.performed_via_github_app);
    if (!isMachine) {
      rejected.push({ ...entry, author, reason: `posted by @${author}, not by a workflow run` });
      continue;
    }
    if (item.created_at && item.updated_at && item.created_at !== item.updated_at) {
      rejected.push({ ...entry, author, reason: "the comment was edited after it was posted" });
      continue;
    }
    if (!payload.runId || !run?.runId || payload.runId !== run.runId) {
      rejected.push({ ...entry, author, reason: "it does not name this run" });
      continue;
    }

    const state = run?.stages?.[payload.stage];
    if (!state) {
      rejected.push({ ...entry, author, reason: `"${payload.stage}" is not a stage of this run` });
      continue;
    }
    if (state.status !== "running") {
      rejected.push({
        ...entry,
        author,
        reason: `${payload.stage} is \`${state.status}\`, not running`,
      });
      continue;
    }
    if (!state.ticket || payload.ticket !== state.ticket || payload.attempt !== state.attempt) {
      rejected.push({
        ...entry,
        author,
        reason: `the execution ticket for ${payload.stage} does not match`,
      });
      continue;
    }
    if (!payload.workflowRunId) {
      rejected.push({ ...entry, author, reason: "it names no workflow run" });
      continue;
    }
    // The generation the attempt was dispatched in. If the work was sent back for
    // rework while this stage was executing, its verdict is about superseded work.
    if (payload.generation && state.generation && payload.generation !== state.generation) {
      rejected.push({
        ...entry,
        author,
        reason: `it was produced for generation ${payload.generation}; ${payload.stage} is on generation ${state.generation}`,
      });
      continue;
    }
    const candidate = String(run.candidateSha ?? "").trim();
    const reportsFailure = payload.status === "failed";
    if (candidate && !reportsFailure && !payload.evaluatedSha) {
      rejected.push({ ...entry, author, reason: "it names no evaluated commit" });
      continue;
    }
    // A failure that does name a commit is still held to it: a stale report
    // from a superseded candidate is not this candidate's failure.
    if (candidate && payload.evaluatedSha && payload.evaluatedSha !== candidate) {
      rejected.push({
        ...entry,
        author,
        reason: "it evaluated a commit that is not the candidate",
      });
      continue;
    }

    accepted.push(entry);
  }

  return { accepted, rejected };
}

/** Back-compat shape: trusted results only. */
export function resultsSince(comments, cursor, run) {
  return trustedResults(comments, run ?? { stages: {} }, cursor).accepted;
}

export function resultComment(payload, visible) {
  return `${visible}\n\n<!-- ${RESULT_MARKER} ${JSON.stringify(payload)} -->`;
}

/**
 * The agent's real answer, rendered into the run issue.
 *
 * A one-line summary reads like a template; the run should show what the agent
 * actually wrote. Long responses are folded so the thread stays readable.
 */
export function responseSection(text, { title = "Response" } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return "";
  if (body.length <= 1200) return `${body}`;
  return `<details><summary>${title}</summary>\n\n${body}\n\n</details>`;
}

export async function dispatchWorkflow(workflowFile, inputs) {
  const ref = process.env.CANON_DEFAULT_BRANCH || "main";
  await gh(`/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref, inputs }),
  });
}

/** Write a value to the step output file so later jobs can read it. */
export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!file) {
    console.log(`${name}=${serialized}`);
    return;
  }
  fs.appendFileSync(file, `${name}<<CANON_EOF\n${serialized}\nCANON_EOF\n`);
}

/**
 * Stamp the release authorization onto a completed run.
 *
 * This is the only place a commit becomes releasable: the run reached an exit with no
 * rejecting outcome, so the commit it was evaluated against is the approved SHA.
 * `.canon/release.mjs` reads this stamp; nothing else may authorize a release.
 *
 * Provenance is built from *attesting* stages — review, QA, security, human
 * approval — because only their verdict is a claim about a commit. Planning and
 * design stages legitimately run before the code exists; requiring them to carry
 * the final SHA would make every real pipeline permanently unreleasable. Their
 * earlier SHAs are recorded as history, not as a blocker.
 */
export function stampRelease(run, graph = null) {
  if (run.status !== "completed" || run.release?.authorized) return run;
  const rejected = Object.values(run.stages ?? {}).some((state) => {
    const outcome = String(state?.outcome ?? "").toLowerCase();
    return (
      outcome.includes("reject") ||
      outcome.includes("changes_required") ||
      outcome.includes("blocked")
    );
  });
  if (rejected) return run;

  // The approved commit is the run's candidate — the commit the development and
  // review stages actually evaluated. GITHUB_SHA is only the commit this workflow
  // job happens to run on, and is used solely when the run never produced code.
  const produced = String(run.candidateSha ?? "").trim();
  const sha =
    produced ||
    (Object.values(run.stages ?? {}).some((s) => s?.evaluatedSha)
      ? ""
      : process.env.GITHUB_SHA || "");
  if (!sha) return run;

  const attesting = new Set(
    (graph?.stages ?? []).filter((stage) => stage.attestsCandidate).map((stage) => stage.id),
  );
  // Without a graph (older bundles) every completed stage is treated as attesting,
  // which is the conservative reading.
  const isAttesting = (id) => (graph ? attesting.has(id) : true);

  const entries = Object.entries(run.stages ?? {});
  const stale = entries.filter(
    ([id, state]) =>
      isAttesting(id) &&
      state?.status === "done" &&
      state.evaluatedSha &&
      state.evaluatedSha !== sha,
  );
  if (stale.length) {
    run.release = {
      authorized: false,
      sha,
      reason:
        `these stages approved a different commit than the one being released: ` +
        stale.map(([id]) => id).join(", "),
    };
    return run;
  }

  const attestations = entries
    .filter(([id, state]) => isAttesting(id) && state?.status === "done")
    .map(([id, state]) => ({ stage: id, outcome: state.outcome ?? null, sha }));

  run.release = {
    authorized: true,
    sha,
    // Set by `.canon/merge.mjs` once the candidate actually lands on the default
    // branch. A tag is cut from this, never from whatever ref the job ran on.
    releaseSha: run.release?.releaseSha ?? null,
    attestations,
    ref: process.env.GITHUB_REF_NAME || "",
    approvedAt: new Date().toISOString(),
  };
  return run;
}

/**
 * True only when the login is one of the principals named on the gate.
 *
 * Repository write access is deliberately NOT sufficient. "The release manager
 * approves production" must not silently become "anyone who can push approves
 * production", so authority comes from the compiled approval policy alone.
 * Team refs (`org/team`) are checked through team membership.
 */
export async function canDecide(login, assignee) {
  const actor = String(login ?? "").toLowerCase();
  if (!actor) return false;
  const refs = String(assignee ?? "")
    .split(/[\s,]+/)
    .map((v) => v.replace(/^@/, ""))
    .filter(Boolean);
  if (refs.length === 0) return false;

  for (const ref of refs) {
    if (!ref.includes("/")) {
      if (ref.toLowerCase() === actor) return true;
      continue;
    }
    const [org, team] = ref.split("/", 2);
    try {
      const membership = await gh(`/orgs/${org}/teams/${team}/memberships/${login}`);
      if (membership && membership.state === "active") return true;
    } catch {
      // Not a member, or the token cannot read the team. Fail closed.
    }
  }
  return false;
}
