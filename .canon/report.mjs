// Post the results the stage jobs produced.
//
// Trust boundary: stage jobs execute agent output, so they hold no permission to
// write to the run ledger. They drop their finished `canon:result` comment in an
// outbox directory, and this job — which runs no agent code and holds only
// `issues: write` — posts them. An agent therefore cannot forge, edit, or
// suppress a ledger entry even if it fully controls its own runner.
//
// A stage that was planned but left no result is reported as an infrastructure
// failure, so silence can never look like success.

import fs from "node:fs";
import path from "node:path";
import { comment, resultComment, readRun, CANON_ROOT } from "./state.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function collect(dir) {
  const results = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [stage, body] of collect(full)) results.set(stage, body);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    results.set(entry.name.replace(/\.md$/, ""), fs.readFileSync(full, "utf8"));
  }
  return results;
}

async function main() {
  const issueNumber = Number(arg("issue"));
  const dir = arg("outbox", `${CANON_ROOT}/outbox`);
  const planned = arg("stages", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = collect(dir);
  for (const [stage, body] of results) {
    await comment(issueNumber, body);
    console.log(`Posted result for ${stage}.`);
  }

  if (!planned.length) return;
  const run = await readRun(issueNumber).catch(() => null);
  for (const stage of planned) {
    if (results.has(stage)) continue;
    const state = run?.stages?.[stage] ?? {};
    const reason =
      "The stage job ended without publishing a result (runner failure, timeout, or cancellation).";
    await comment(
      issueNumber,
      resultComment(
        {
          stage,
          runId: run?.runId ?? null,
          attempt: state.attempt ?? null,
          ticket: state.ticket ?? null,
          workflowRunId: process.env.GITHUB_RUN_ID || null,
          workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
          job: process.env.GITHUB_JOB || null,
          status: "failed",
          summary: reason,
        },
        `### ${stage} — failed\n\n${reason}`,
      ),
    );
    console.log(`Reported missing result for ${stage}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
