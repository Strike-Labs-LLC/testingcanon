// Runtime prerequisite verification. This runs before any stage is dispatched,
// and writes every failure to the run issue through start-run.mjs.
import { gh, runtimeLabel } from "./state.mjs";
import { verifyBrokerAccess } from "./canon-token.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";
const REQUIRED_RUNTIME_LABELS = [
  "run-failed",
  "run-completed",
  "awaiting-human",
  "resource-conflict",
  "sla-breached",
];

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

export async function collectPreflight(
  graph,
  issueNumber,
  dependencies = { gh, verifyBrokerAccess },
  environment = process.env,
) {
  const failures = [];
  const repository = environment.GITHUB_REPOSITORY || REPO;
  if (!repository) failures.push("GitHub did not identify the repository for this run.");

  try {
    await dependencies.verifyBrokerAccess({ runId: issueNumber });
  } catch (error) {
    failures.push(`Canon App or broker access: ${error instanceof Error ? error.message : String(error)}`);
  }

  const codingAgent = (environment.CANON_CODING_AGENT || "copilot").trim();
  if (codingAgent === "copilot" && !environment.COPILOT_GITHUB_TOKEN) {
    failures.push("Copilot is selected, but this workflow did not receive a Copilot-capable GitHub token. Confirm the organization allows Copilot coding agent requests.");
  }
  if (codingAgent === "claude" && !environment.ANTHROPIC_API_KEY) {
    failures.push("Claude is selected, but ANTHROPIC_API_KEY is not configured as a repository secret.");
  }
  if (codingAgent === "codex" && !environment.OPENAI_API_KEY) {
    failures.push("Codex is selected, but OPENAI_API_KEY is not configured as a repository secret.");
  }

  if (repository) {
    const read = (route, label, options = {}) =>
      canReadWith(dependencies.gh, route, label, failures, options);
    await read(`/repos/${repository}/actions/permissions`, "GitHub Actions policy");
    await read(`/repos/${repository}/rulesets`, "Branch ruleset support");
    await read(`/repos/${repository}/environments`, "GitHub environment support");
    if (graph.stages?.some((stage) => stage.execution === "coding-agent")) {
      await read(`/repos/${repository}/code-scanning/alerts?per_page=1`, "Code Security access", { optional: true });
    }
    const suffix = environment.CANON_LABEL_SUFFIX || "";
    const scopedLabel = (name) => `${name}${suffix}`;
    const labels = [
      environment.CANON_RUN_LABEL,
      environment.CANON_START_LABEL,
      ...REQUIRED_RUNTIME_LABELS.map(scopedLabel),
    ].filter(Boolean);
    for (const name of [...new Set(labels)]) {
      await read(`/repos/${repository}/labels/${encodeURIComponent(name)}`, `Required label ${name}`);
    }
    const environments = new Set((graph.stages ?? []).map((stage) => stage.environment).filter(Boolean));
    for (const name of environments) {
      await read(`/repos/${repository}/environments/${encodeURIComponent(name)}`, `Required environment ${name}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

async function canReadWith(request, route, label, failures, options = {}) {
  try {
    await request(route);
    return true;
  } catch (error) {
    if (options.optional) return false;
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function runPreflight(graph, issueNumber) {
  return collectPreflight(graph, issueNumber);
}