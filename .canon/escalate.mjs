// Escalation sweep.
//
// Runs on a schedule. Any human stage that has been waiting longer than its agreed
// response time is escalated once and the run is labelled so it is visible.

import { loadGraph, readRun, writeRun, comment, addLabel, gh, RUN_LABEL, runtimeLabel } from "./state.mjs";
import { stageById } from "./engine.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";

async function main() {
  const graph = loadGraph();
  const issues = await gh(`/repos/${REPO}/issues?labels=${encodeURIComponent(RUN_LABEL)}&state=open&per_page=100`);

  for (const issue of issues) {
    let run;
    try {
      run = await readRun(issue.number);
    } catch {
      continue;
    }
    let changed = false;

    for (const [stageId, state] of Object.entries(run.stages)) {
      if (state.status !== "awaiting" || !state.deadline || state.escalated) continue;
      if (Date.parse(state.deadline) > Date.now()) continue;
      const stage = stageById(graph, stageId);
      if (!stage) continue;
      state.escalated = true;
      changed = true;
      await comment(
        issue.number,
        [
          `## SLA breached — ${stage.name}`,
          "",
          `Waiting since ${state.startedAt}, expected within ${stage.responseTimeHours}h.`,
          stage.escalateTo ? `Escalating to ${stage.escalateTo}.` : "No escalation contact is set.",
        ].join("\n"),
      );
      await addLabel(issue.number, runtimeLabel("sla-breached"));
    }

    if (changed) await writeRun(issue.number, graph, run);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
