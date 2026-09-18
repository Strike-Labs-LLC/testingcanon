// One tick of the run loop.
//
//   node .canon/flows/beta-9de674/tick.mjs plan    --issue N   pick the ready stages, assign human gates
//   node .canon/flows/beta-9de674/tick.mjs advance --issue N   apply posted results, route, re-dispatch
//
// `plan` and `advance` are the only writers of the run record, so parallel stage jobs
// never race on the issue body.

import {
  loadGraph,
  readRun,
  writeRun,
  comment,
  listComments,
  trustedResults,
  dispatchWorkflow,
  setOutput,
  addLabel,
  stampRelease,
  ensureIssue,
  CONFLICT_LABEL,
} from "./state.mjs";
import {
  readyStages,
  startStage,
  recordOutcome,
  finalize,
  failUnreportedStages,
  allowedDecisions,
  verifyTimeline,
  appendTimeline,
  auditHead,
  lockConflicts,
  holdStage,
  handoffsFor,
} from "./engine.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function humanAssignment(stage, run) {
  const decisions = allowedDecisions(stage);
  const lines = [
    `## ${stage.name} — waiting on a person`,
    "",
    // canDecide() is fail-closed: with no assignee it rejects every actor,
    // repository owners included. Saying "the repository owners" here promised
    // an authority the runtime then refuses, leaving the gate stuck with no
    // explanation. Say what is actually true and how to unstick it.
    stage.assignee
      ? `Assigned to: ${stage.assignee}`
      : "**Assigned to: nobody.** This gate names no approver, so no decision on it" +
        " can be accepted — not even from a repository owner. Set an assignee on" +
        " this stage in Canon and recompile the package to unblock the run.",
    "",
    stage.instructions || stage.task || "Review the upstream artifact and record a decision.",
    "",
    ...handoffContract(stage, run),
    "Record your decision by replying with one of:",
    "",
    ...decisions.map((d) => `- \`/canon ${d}\` — ${d.replace(/_/g, " ")}`),
    "",
    stage.responseTimeHours
      ? `Expected within ${stage.responseTimeHours}h${stage.escalateTo ? `, then escalated to ${stage.escalateTo}` : ""}.`
      : "",
    `Run: ${run.runId}`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * Refuse to act on a run whose audit trail does not verify.
 *
 * The record lives in an editable issue body. If the hash chain is broken, the
 * transitions Canon would reason from are no longer trustworthy, so the run stops
 * and says where the trail was altered instead of continuing on bad history.
 */
async function requireIntactTrail(issueNumber, graph, run) {
  const check = verifyTimeline(run);
  if (check.ok) return true;
  run.status = "failed";
  await writeRun(issueNumber, graph, run);
  await comment(
    issueNumber,
    [
      "## Audit trail broken",
      "",
      `Transition ${check.at ?? "?"} no longer matches its recorded hash: ${check.reason}.`,
      "",
      "The run record was edited outside Canon, so the run is halted. Start a new run;",
      "do not edit the run record by hand.",
    ].join("\n"),
  );
  await addLabel(issueNumber, "run-failed");
  return false;
}

/**
 * Ask a person to resolve a resource conflict.
 *
 * Two stages hold the same compiled lock and both became ready. Canon proceeds with
 * one, holds the other, and opens a single issue naming the resource, the stages,
 * and the two ways out.
 */
async function escalateConflict(issueNumber, run, conflict) {
  const title = `Resource conflict: ${conflict.lock} (run ${run.runId})`;
  const created = await ensureIssue(
    title,
    [
      `Run #${issueNumber} reached a point where two stages own the same resource and both became ready.`,
      "",
      `- Resource lock: \`${conflict.lock}\``,
      `- Proceeding: **${conflict.proceeding.name}**`,
      `- Held: **${conflict.held.name}**`,
      "",
      "Canon will not let two stages write the same resource at once. Resolve it by either:",
      "",
      "1. narrowing the ownership so exactly one stage owns the resource, or",
      "2. connecting the two stages in the blueprint so they run in sequence.",
      "",
      `The held stage stays blocked until this is settled. Recompile and start a new run after the change.`,
    ].join("\n"),
    [CONFLICT_LABEL],
  ).catch(() => null);
  await comment(
    issueNumber,
    `**${conflict.held.name}** is held: it shares the resource lock \`${conflict.lock}\` with ` +
      `**${conflict.proceeding.name}**.${created?.number ? ` Escalated in #${created.number}.` : ""}`,
  );
  return created?.number ?? null;
}

/** A short, verifiable fingerprint of the run's transition history. */
async function postAuditDigest(issueNumber, run) {
  const head = auditHead(run);
  if (!head) return;
  await comment(
    issueNumber,
    `<!-- canon:audit ${JSON.stringify({ runId: run.runId, seq: run.timeline.length, head })} -->\n` +
      `Audit checkpoint — ${run.timeline.length} transitions, chain head \`${head}\`. ` +
      "Any later edit to the run record will not match this checkpoint.",
  );
}

/** What this stage was handed, and the commit that evidence is bound to. */
function handoffContract(stage, run) {
  const handoffs = handoffsFor(run, stage.id);
  if (handoffs.length === 0) return [];
  return [
    "Handed to you:",
    "",
    ...handoffs.map(
      (h) =>
        `- ${h.from} — ${h.outcome ?? "no outcome"}${h.artifact ? ` (\`${h.artifact}\`)` : ""}` +
        `${h.sha ? ` at commit \`${String(h.sha).slice(0, 12)}\`` : ""}`,
    ),
    "",
  ];
}

async function plan(issueNumber) {
  const graph = loadGraph();
  const run = await readRun(issueNumber);
  if (!(await requireIntactTrail(issueNumber, graph, run))) return;
  let ready = readyStages(graph, run);

  // Resource contention is a human decision, never a race.
  const held = new Set();
  for (const conflict of lockConflicts(ready)) {
    if (held.has(conflict.held.id) || held.has(conflict.proceeding.id)) continue;
    const escalation = await escalateConflict(issueNumber, run, conflict);
    holdStage(run, conflict.held.id, conflict.lock, escalation);
    held.add(conflict.held.id);
  }
  ready = ready.filter((stage) => !held.has(stage.id));

  const agents = [];
  const gated = [];

  for (const stage of ready) {
    if (stage.executor === "human") {
      startStage(run, stage.id, "human");
      const state = run.stages[stage.id];
      if (stage.responseTimeHours) {
        state.deadline = new Date(Date.now() + stage.responseTimeHours * 3600_000).toISOString();
      }
      await comment(issueNumber, humanAssignment(stage, run));
      continue;
    }
    startStage(run, stage.id, "ai");
    const entry = {
      stage: stage.id,
      name: stage.name,
      attempt: run.stages[stage.id].attempt,
      // Compiled lock group: stages owning the same resource serialize on it.
      lock: stage.concurrency || `stage-${stage.id}`,
    };
    if (stage.environment) gated.push({ ...entry, environment: stage.environment });
    else agents.push(entry);
  }

  finalize(graph, run);
  await writeRun(issueNumber, graph, run);

  setOutput("agents", { include: agents });
  setOutput("gated", { include: gated });
  setOutput("has_agents", agents.length ? "true" : "false");
  setOutput("has_gated", gated.length ? "true" : "false");
  // The reporter job needs the planned set so a stage that vanished without
  // publishing anything is recorded as a failure rather than passing silently.
  setOutput("planned", [...agents, ...gated].map((s) => s.stage).join(","));
  setOutput("status", run.status);

  console.log(`Ready: ${[...agents, ...gated].map((s) => s.stage).join(", ") || "none"}`);
}

async function advance(issueNumber) {
  const graph = loadGraph();
  const run = await readRun(issueNumber);
  if (!(await requireIntactTrail(issueNumber, graph, run))) return;
  const comments = await listComments(issueNumber);
  const { accepted, rejected } = trustedResults(comments, run, run.cursor ?? 0);

  for (const bad of rejected) {
    run.cursor = Math.max(run.cursor ?? 0, bad.commentId);
    appendTimeline(run, "result-rejected", { stage: bad.stage ?? null, detail: bad.reason });
    await comment(
      issueNumber,
      `Ignored a \`canon:result\` marker in comment ${bad.commentId}: ${bad.reason}. ` +
        "Run state only accepts results from the workflow execution Canon dispatched.",
    );
  }

  // Results are applied one at a time and each one is re-validated against the run
  // as it stands after the previous one. A batch can contain a rework decision and
  // a stage result produced before that rework: the second is no longer trustworthy
  // once the first has been applied, so it must be re-checked, not applied blindly.
  for (const result of accepted) {
    run.cursor = Math.max(run.cursor ?? 0, result.commentId);
    const source = comments.find((c) => c.id === result.commentId);
    const recheck = source ? trustedResults([source], run, result.commentId - 1) : null;
    if (recheck && recheck.accepted.length === 0) {
      const reason = recheck.rejected[0]?.reason ?? "it no longer matches the run state";
      appendTimeline(run, "result-superseded", { stage: result.stage ?? null, detail: reason });
      await comment(
        issueNumber,
        `Discarded the result for \`${result.stage}\` in comment ${result.commentId}: ${reason}. ` +
          "An earlier result in this batch changed the run, so this one describes superseded work.",
      );
      continue;
    }
    const applied = recordOutcome(graph, run, result.stage, result);
    if (applied?.staleGeneration) {
      await comment(issueNumber, `Discarded the result for \`${result.stage}\`: ${applied.error}`);
    }
  }

  // A stage that was dispatched but published no trusted result did not complete.
  const unreported = failUnreportedStages(run);
  for (const stageId of unreported) {
    await comment(
      issueNumber,
      `Stage \`${stageId}\` ended without publishing a trusted result. ` +
        "The run is marked failed: an infrastructure failure never counts as a completed stage.",
    );
  }

  finalize(graph, run);
  stampRelease(run, graph);
  await writeRun(issueNumber, graph, run);
  await postAuditDigest(issueNumber, run);

  if (run.status === "running") {
    await dispatchWorkflow("orchestration-step.yml", { run_issue: String(issueNumber) });
    console.log("Re-dispatched the next tick.");
    return;
  }

  if (run.status === "awaiting_human") {
    await addLabel(issueNumber, "awaiting-human");
    console.log("Run is waiting on a human decision.");
    return;
  }

  await comment(
    issueNumber,
    [
      `## Run ${run.runId} — ${run.status}`,
      "",
      ...graph.stages.map((s) => {
        const state = run.stages[s.id] ?? {};
        return `- ${s.name}: ${state.status}${state.outcome ? ` (${state.outcome})` : ""}`;
      }),
    ].join("\n"),
  );
  await addLabel(issueNumber, run.status === "completed" ? "run-completed" : "run-failed");
  if (run.status === "completed" && run.source?.number) {
    await comment(
      run.source.number,
      `Canon candidate evidence is complete for run ${run.runId}. Source stays open until the PR is merged.`,
    );
  }
}

const mode = process.argv[2];
const issueNumber = Number(arg("issue"));
const run = mode === "advance" ? advance(issueNumber) : plan(issueNumber);
run.catch((error) => {
  console.error(error);
  process.exit(1);
});
