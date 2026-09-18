// Start a run: create the run issue that holds the run record, then hand off to the
// step workflow. Every run is a repository object — no external state store.

import { createRun } from "./engine.mjs";
import { loadGraph, createRunIssue, dispatchWorkflow, setOutput, comment, writeRun, addLabel, runtimeLabel } from "./state.mjs";
import { runPreflight } from "./preflight.mjs";

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
  const source = issueNumber
    ? {
        number: Number(issueNumber),
        url: process.env.CANON_SOURCE_ISSUE_URL ?? "",
        title: objective,
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
    run.status = "failed";
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
  await comment(issue.number, "## Preflight passed\n\nGitHub access, the Canon App, labels, environments, rulesets, and agent configuration are ready.");

  setOutput("issue", String(issue.number));
  await dispatchWorkflow(process.env.CANON_STEP_WORKFLOW || "orchestration-step.yml", {
    run_issue: String(issue.number),
  });
  console.log(`Run issue #${issue.number} created.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
