// Start a run: create the run issue that holds the run record, then hand off to the
// step workflow. Every run is a repository object — no external state store.

import { createRun, failRun } from "./engine.mjs";
import { loadGraph, createRunIssue, dispatchWorkflow, setOutput, comment, writeRun, addLabel, runtimeLabel } from "./state.mjs";
import { runPreflight } from "./preflight.mjs";

/**
 * The ticket body arrives through the environment only — never on the command
 * line — and is stored capped, so one enormous ticket cannot bloat every run
 * record or push a stage brief past the model's context window.
 */
export const SOURCE_BODY_LIMIT = 8 * 1024;

export function capSourceBody(raw) {
  const body = String(raw ?? "");
  if (body.length <= SOURCE_BODY_LIMIT) return body;
  return `${body.slice(0, SOURCE_BODY_LIMIT)}\n\n[truncated — read the full ticket on GitHub]`;
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const graph = loadGraph();
  const objective = arg("objective", "").trim();
  const trigger = arg("trigger", "workflow_dispatch");
  const issueNumber = arg("issue", "").trim();
  const sha = arg("sha", process.env.GITHUB_SHA ?? "").trim();
  const body = capSourceBody(process.env.CANON_SOURCE_ISSUE_BODY);
  const source = issueNumber
    ? {
        number: Number(issueNumber),
        url: process.env.CANON_SOURCE_ISSUE_URL ?? "",
        title: objective,
        body,
      }
    : null;
  const run = createRun(graph, {
    objective,
    trigger,
    baseSha: sha,
    candidateSha: sha,
    source,
  });

  const title = `Canon run ${run.runId}${objective ? `: ${objective.slice(0, 60)}` : ""}`;
  const issue = await createRunIssue(graph, run, title);

  await comment(
    issue.number,
    [
      `Run **${run.runId}** started from \`${trigger}\`.`,
      "",
      `Pipeline: ${graph.stages.map((s) => s.name).join(" → ")}`,
      "",
      "Human merge gates are satisfied by a native GitHub **Approve** review on the candidate SHA.",
      "`/canon <decision>` on this issue is recorded, but it does not replace the PR review.",
    ].join("\n"),
  );

  const preflight = await runPreflight(graph, issue.number);
  if (!preflight.ok) {
    failRun(run, "Preflight failed, so the run stopped before its first stage.", {
      code: "preflight",
      detail: preflight.failures,
    });
    await writeRun(issue.number, graph, run);
    await comment(
      issue.number,
      [
        "## Preflight failed",
        "",
        ...preflight.failures.map((failure) => `- ${failure}`),
        "",
        "Fix these repository prerequisites, then start a new run.",
      ].join("\n"),
    );
    await addLabel(issue.number, runtimeLabel("run-failed"));
    throw new Error(`Canon preflight failed: ${preflight.failures.join("; ")}`);
  }
  await comment(
    issue.number,
    [
      "## Preflight passed",
      "",
      "GitHub access, the Canon App, labels, environments, and agent configuration are ready.",
      ...(preflight.warnings?.length
        ? ["", "### Notes", ...preflight.warnings.map((note) => `- ${note}`)]
        : []),
    ].join("\n"),
  );

  // The ticket a person filed is where they look for progress, and it said
  // nothing while the run happened somewhere else. One line, once, pointing at
  // the run — the stage-by-stage detail stays on the run issue rather than
  // filling a product ticket with machine chatter.
  if (source?.number) {
    await comment(
      source.number,
      [
        `**${graph.name || "Canon"}** started on this ticket — run \`${run.runId}\`.`,
        "",
        `Follow it on #${issue.number}, where each stage posts what it did.`,
      ].join("\n"),
    ).catch(() => undefined);
  }

  setOutput("issue", String(issue.number));
  await dispatchWorkflow(process.env.CANON_STEP_WORKFLOW || "orchestration-step.yml", {
    run_issue: String(issue.number),
  });
  console.log(`Run issue #${issue.number} created.`);
}

if ((process.argv[1] ?? "").endsWith("start-run.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
