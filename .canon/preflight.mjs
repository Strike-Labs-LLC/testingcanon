// Runtime prerequisite verification. This runs before any stage is dispatched,
// and writes every failure to the run issue through start-run.mjs.
import { gh } from "./state.mjs";
import { verifyBrokerAccess } from "./canon-token.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";
const REQUIRED_RUNTIME_LABELS = [
  "run-failed",
  "run-completed",
  "awaiting-human",
  "resource-conflict",
  "sla-breached",
];

/** The org policy a Copilot-backed run depends on, named exactly as GitHub names it. */
export const COPILOT_POLICY_NOTE =
  'Copilot is selected. If stages fail with a Copilot authorization error, enable the ' +
  'organization policy "Allow use of Copilot CLI billed to the organization" and make sure ' +
  "the model each stage requests is enabled for the organization.";

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when GitHub refused a read because the plan does not include the feature,
 * rather than because the run is misconfigured. A plan limitation is reported,
 * never treated as a blocker: the run can still complete without rulesets.
 */
export function isPlanLimitation(error) {
  const text = message(error);
  if (!/\b403\b|forbidden/i.test(text)) return false;
  return /upgrade|plan|not available for|advanced security|only available|billing/i.test(text);
}

export async function collectPreflight(
  graph,
  issueNumber,
  dependencies = { gh, verifyBrokerAccess },
  environment = process.env,
) {
  const failures = [];
  const warnings = [];
  const repository = environment.GITHUB_REPOSITORY || REPO;
  if (!repository) failures.push("GitHub did not identify the repository for this run.");

  try {
    await dependencies.verifyBrokerAccess({ runId: issueNumber });
  } catch (error) {
    failures.push(`Canon App or broker access: ${message(error)}`);
  }

  const codingAgent = (environment.CANON_CODING_AGENT || "copilot").trim();
  if (codingAgent === "copilot") {
    if (!environment.COPILOT_GITHUB_TOKEN) {
      // The workflow passes GITHUB_TOKEN through as COPILOT_GITHUB_TOKEN. An empty
      // value means the generated workflow is wrong, never that the user forgot a
      // secret. Installation tokens cannot call /user, so no probe is made here:
      // Copilot authorization is proven by the first agent stage.
      failures.push(
        "The workflow did not pass GITHUB_TOKEN to the Copilot CLI. Regenerate the package from Canon.",
      );
    } else {
      warnings.push(COPILOT_POLICY_NOTE);
    }
  }
  if (codingAgent === "claude" && !environment.ANTHROPIC_API_KEY) {
    failures.push("Claude is selected, but ANTHROPIC_API_KEY is not configured as a repository secret.");
  }
  if (codingAgent === "codex" && !environment.OPENAI_API_KEY) {
    failures.push("Codex is selected, but OPENAI_API_KEY is not configured as a repository secret.");
  }

  if (repository) {
    const read = (route, label, options = {}) =>
      canReadWith(dependencies.gh, route, label, failures, warnings, options);

    // GET /actions/permissions requires the Administration permission, which the
    // Actions GITHUB_TOKEN can never hold. It is not checked: a 403 there says
    // nothing about whether the run can proceed.

    // Rulesets and environment listing are advisory: GitHub refuses both on plans
    // that do not include them, and a run completes without either.
    await read(`/repos/${repository}/rulesets`, "Branch ruleset support", { advisory: true });
    await read(`/repos/${repository}/environments`, "GitHub environment support", { advisory: true });
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
      await read(`/repos/${repository}/labels/${encodeURIComponent(name)}`, `Required label ${name}`, {
        remedy: "Run .sdlc/github/labels.sh, then start a new run.",
      });
    }
    const environments = new Set((graph.stages ?? []).map((stage) => stage.environment).filter(Boolean));
    for (const name of environments) {
      await read(`/repos/${repository}/environments/${encodeURIComponent(name)}`, `Required environment ${name}`);
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

async function canReadWith(request, route, label, failures, warnings, options = {}) {
  try {
    await request(route);
    return true;
  } catch (error) {
    if (options.optional) return false;
    if (options.advisory && isPlanLimitation(error)) {
      warnings.push(`${label}: ${message(error)} Canon will skip it for this run.`);
      return false;
    }
    failures.push(`${label}: ${message(error)}${options.remedy ? ` ${options.remedy}` : ""}`);
    return false;
  }
}

export async function runPreflight(graph, issueNumber) {
  return collectPreflight(graph, issueNumber);
}
