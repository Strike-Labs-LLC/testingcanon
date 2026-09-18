// Resume a run from a human decision.
//
// Two inputs, one contract:
//   1. A native GitHub pull request review (APPROVE / REQUEST_CHANGES) on the
//      exact candidate SHA. That is the merge gate.
//   2. `/canon <decision>` on the run issue, for non-merge notes only.
//
// Only a principal named on the gate may decide it.

import {
  loadGraph,
  readRun,
  writeRun,
  comment,
  dispatchWorkflow,
  canDecide,
  stampRelease,
  gh,
  listCanonIssues,
} from "./state.mjs";
import { recordOutcome, finalize, allowedDecisions, stageById } from "./engine.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function mapReviewState(state) {
  const value = String(state ?? "").toUpperCase();
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes_requested";
  return null;
}

async function issueForRunId(runId) {
  const issues = await listCanonIssues();
  return issues.find((issue) => (issue.body ?? "").includes(`"runId": "${runId}"`)) ?? null;
}

async function issueFromPullRequest(prNumber) {
  if (!prNumber) return null;
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = await gh(`/repos/${repo}/pulls/${prNumber}`);
  const branch = String(pr.head?.ref ?? "");
  const match = branch.match(/^canon\/([^/]+)\//);
  if (match) {
    const issue = await issueForRunId(match[1]);
    if (issue) return { issue, sha: pr.head?.sha ?? "", pr };
  }
  const issues = await listCanonIssues();
  const hit = issues.find((issue) => (issue.body ?? "").includes(pr.head?.sha ?? "___"));
  return hit ? { issue: hit, sha: pr.head?.sha ?? "", pr } : null;
}

async function applyDecision({ issueNumber, actor, decision, note, sha }) {
  const graph = loadGraph();
  const run = await readRun(issueNumber);
  const waiting = graph.stages.filter((s) => run.stages[s.id]?.status === "awaiting");
  if (waiting.length === 0) {
    await comment(issueNumber, `@${actor} this run is not waiting on a decision right now.`);
    return;
  }

  const named = arg("stage");
  if (!named && waiting.length > 1) {
    await comment(
      issueNumber,
      `@${actor} more than one gate is open. Name the stage: ${waiting
        .map((s) => `\`${s.id}\``)
        .join(", ")}.`,
    );
    return;
  }
  const stage = named ? stageById(graph, named) : waiting[0];
  if (!stage || run.stages[stage.id]?.status !== "awaiting") {
    await comment(
      issueNumber,
      `@${actor} that stage is not waiting. Waiting stages: ${waiting.map((s) => s.id).join(", ")}.`,
    );
    return;
  }

  const allowed = allowedDecisions(stage);
  if (!allowed.includes(decision)) {
    await comment(
      issueNumber,
      `@${actor} \`${decision}\` is not a valid decision for **${stage.name}**. Use one of: ${allowed
        .map((d) => `\`${d}\``)
        .join(", ")}.`,
    );
    return;
  }

  if (!(await canDecide(actor, stage.assignee))) {
    await comment(
      issueNumber,
      `@${actor} only ${stage.assignee || "an approver named on this gate"} can decide **${stage.name}**. A GitHub review from anyone else is ignored.`,
    );
    return;
  }

  const candidate = String(run.candidateSha ?? "").trim();
  if (sha && candidate && sha !== candidate) {
    await comment(
      issueNumber,
      `@${actor} reviewed ${sha.slice(0, 12)}, but the candidate is ${candidate.slice(0, 12)}. Approve the latest candidate commit.`,
    );
    return;
  }

  recordOutcome(graph, run, stage.id, {
    outcome: decision,
    summary: note || `${decision.replace(/_/g, " ")} by @${actor} via pull request review`,
    artifact: null,
    evaluatedSha: sha || candidate || null,
    route: [],
  });
  run.status = run.status === "awaiting_human" ? "running" : run.status;
  finalize(graph, run);
  stampRelease(run, graph);
  await writeRun(issueNumber, graph, run);

  await comment(
    issueNumber,
    `Recorded **${decision.replace(/_/g, " ")}** for ${stage.name} by @${actor} (native PR review). Continuing the run.`,
  );
  if (run.status === "running") {
    await dispatchWorkflow(process.env.CANON_STEP_WORKFLOW || "orchestration-step.yml", {
      run_issue: String(issueNumber),
    });
  }
}

async function main() {
  const event = arg("event");
  if (event === "pull_request_review") {
    const decision = mapReviewState(arg("review_state"));
    if (!decision) return;
    const prNumber = Number(arg("pr"));
    const found = await issueFromPullRequest(prNumber);
    if (!found) {
      console.log("No Canon run is bound to this pull request.");
      return;
    }
    await applyDecision({
      issueNumber: found.issue.number,
      actor: arg("actor"),
      decision,
      note: arg("body", ""),
      sha: arg("sha", "") || found.sha,
    });
    return;
  }

  const issueNumber = Number(arg("issue"));
  const actor = arg("actor");
  const body = arg("body", "");
  const match = body.match(/\/canon\s+([a-z_]+)([\s\S]*)/i);
  if (!match) return;
  await applyDecision({
    issueNumber,
    actor,
    decision: match[1].toLowerCase(),
    note: match[2].trim(),
    sha: "",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
