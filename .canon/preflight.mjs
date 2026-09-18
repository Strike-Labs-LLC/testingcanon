// Runtime prerequisite verification. This runs before any stage is dispatched,
// and writes every failure to the run issue through start-run.mjs.
import { gh, runtimeLabel } from "./state.mjs";
import { verifyBrokerAccess } from "./canon-token.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";

async function canRead(route, label, failures, options = {}) {
  try {
    await gh(route);
    return true;
  } catch (error) {
    if (options.optional) return false;
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function runPreflight(graph, issueNumber) {
  const failures = [];
  if (!REPO) failures.push("GitHub did not identify the repository for this run.");

  try {
    await verifyBrokerAccess({ runId: issueNumber });
  } catch (error) {
    failures.push(`Canon App or broker access: ${error instanceof Error ? error.message : String(error)}`);
  }

  const codingAgent = (process.env.CANON_CODING_AGENT || "copilot").trim();
  if (codingAgent === "copilot" && !process.env.COPILOT_GITHUB_TOKEN) {
    failures.push("Copilot is selected, but this workflow did not receive a Copilot-capable GitHub token. Confirm the organization allows Copilot coding agent requests.");
  }
  if (codingAgent === "claude" && !process.env.ANTHROPIC_API_KEY) {
    failures.push("Claude is selected, but ANTHROPIC_API_KEY is not configured as a repository secret.");
  }
  if (codingAgent === "codex" && !process.env.OPENAI_API_KEY) {
    failures.push("Codex is selected, but OPENAI_API_KEY is not configured as a repository secret.");
  }

  if (REPO) {
    await canRead(`/repos/${REPO}/actions/permissions`, "GitHub Actions policy", failures);
    await canRead(`/repos/${REPO}/rulesets`, "Branch ruleset support", failures);
    await canRead(`/repos/${REPO}/environments`, "GitHub environment support", failures);
    if (graph.stages?.some((stage) => stage.execution === "coding-agent")) {
      await canRead(`/repos/${REPO}/code-scanning/alerts?per_page=1`, "Code Security access", failures, { optional: true });
    }
    for (const name of [process.env.CANON_RUN_LABEL, process.env.CANON_START_LABEL, runtimeLabel("run-failed")].filter(Boolean)) {
      await canRead(`/repos/${REPO}/labels/${encodeURIComponent(name)}`, `Required label ${name}`, failures);
    }
    for (const stage of graph.stages ?? []) {
      if (!stage.environment) continue;
      await canRead(`/repos/${REPO}/environments/${encodeURIComponent(stage.environment)}`, `Required environment ${stage.environment}`, failures);
    }
  }

  return { ok: failures.length === 0, failures };
}