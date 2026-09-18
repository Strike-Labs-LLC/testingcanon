// Start a run: create the run issue that holds the run record, then hand off to the
// step workflow. Every run is a repository object — no external state store.

import { createRun } from "./engine.mjs";
import { loadGraph, createRunIssue, dispatchWorkflow, setOutput, comment } from "./state.mjs";

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

  setOutput("issue", String(issue.number));
  await dispatchWorkflow("orchestration-step.yml", { run_issue: String(issue.number) });
  console.log(`Run issue #${issue.number} created.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
