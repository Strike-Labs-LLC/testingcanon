// Release authorization.
//
// A release may only be created for a commit that a completed Canon run approved.
// Tags are not an authorization mechanism: pushing `v1.2.3` proves nothing about
// Product → Planning → Dev → Review → QA → Release Review → Human Approval.
//
//   node .canon/flows/beta-9de674/release.mjs candidate --issue <run issue>
//   node .canon/flows/beta-9de674/release.mjs authorize --issue <run issue> [--sha <sha>]
//   node .canon/flows/beta-9de674/release.mjs verify --sha <sha>
//   node .canon/flows/beta-9de674/release.mjs publish --issue <run issue> --tag <tag> --sha <sha>
//
// `authorize` resolves the approved SHA for a specific run and fails when that run
// did not complete its governance path. `verify` answers the inverse question for a
// commit that already exists (a published release, a pushed tag): is there a run
// that approved exactly this SHA?

import fs from "node:fs";

import { gh, decodeRun, readRun, RUN_LABEL } from "./state.mjs";
import { useBrokeredToken } from "./canon-token.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`Release blocked: ${message}`);
  process.exit(1);
}

/** Human gates that ended in a non-approving outcome. */
export function rejectedGates(run) {
  return Object.entries(run.stages ?? {})
    .filter(([, state]) => {
      const outcome = String(state?.outcome ?? "").toLowerCase();
      return (
        outcome.includes("reject") ||
        outcome.includes("changes_required") ||
        outcome.includes("blocked")
      );
    })
    .map(([id]) => id);
}

/**
 * The release authorization a completed run carries, or null.
 *
 * Provenance is judged on the stages that attested the commit (review, QA,
 * security, human approval) — the stamp records exactly which ones and at which
 * SHA. Earlier stages that ran before the code existed are not evidence about the
 * commit and are not treated as contradictions.
 */
export function authorizationOf(run) {
  const release = run?.release;
  if (!release || release.authorized !== true || !release.sha) return null;
  if (run.status !== "completed") return null;
  if (rejectedGates(run).length > 0) return null;
  // The authorization must name the run's own candidate commit.
  const candidate = String(run.candidateSha ?? "").trim();
  if (candidate && release.sha !== candidate) return null;
  // Every attestation recorded in the stamp must be for that same commit.
  const attestations = Array.isArray(release.attestations) ? release.attestations : [];
  if (attestations.some((entry) => entry.sha && entry.sha !== release.sha)) return null;
  return release;
}

/**
 * The exact commit the run approved, before any merge.
 *
 * This is the commit verification checks out and tests, and the only commit
 * `.canon/flows/beta-9de674/merge.mjs` may land. It never consults `releaseSha`: asking "what did the
 * run approve?" must be answerable before the merge exists, otherwise verification
 * and merge deadlock on each other.
 */
export function approvedCandidate(run) {
  const authorization = authorizationOf(run);
  if (!authorization) return null;
  return String(authorization.sha ?? "").trim() || null;
}

/**
 * The commit a tag may point at.
 *
 * Fails closed. A run that produced code (it has a candidate commit) may only be
 * released from the commit `.canon/flows/beta-9de674/merge.mjs` recorded after GitHub accepted a
 * merge of exactly the approved SHA. There is no fallback to the feature-branch
 * candidate: "merge failed, release anyway" is not a state Canon can reach.
 *
 * Runs that never produced code (documentation-only or specification runs) carry
 * no candidate, so the approved commit is the only commit there is.
 */
export function releaseCommit(run) {
  const authorization = authorizationOf(run);
  if (!authorization) return null;
  const merged = String(authorization.releaseSha ?? "").trim();
  if (merged) return merged;
  const candidate = String(run?.candidateSha ?? "").trim();
  if (candidate) return null;
  return String(authorization.sha ?? "").trim() || null;
}

async function loadRuns() {
  const issues = await gh(
    `/repos/${REPO}/issues?state=all&labels=${encodeURIComponent(RUN_LABEL)}&per_page=100`,
  );
  const runs = [];
  for (const issue of issues) {
    try {
      runs.push({ issue: issue.number, run: decodeRun(issue.body ?? "") });
    } catch {
      // Not a run record; ignore.
    }
  }
  return runs;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  fs.appendFileSync(file, `${name}=${value}\n`);
}

/**
 * Pre-merge. Resolves the exact approved candidate commit so verification can check
 * out and test it. Deliberately does not require a merge to have happened: the merge
 * runs after verification.
 */
async function candidate() {
  const issueNumber = Number(arg("issue"));
  if (!issueNumber) fail("no run issue was supplied. Release runs downstream of an approved run.");

  const run = await readRun(issueNumber);
  if (run.status !== "completed") {
    fail(
      `run ${run.runId} is \`${run.status}\`, not \`completed\`. Finish the run before releasing.`,
    );
  }
  const rejected = rejectedGates(run);
  if (rejected.length) fail(`run ${run.runId} has unresolved outcomes at: ${rejected.join(", ")}.`);

  const approved = approvedCandidate(run);
  if (!approved) fail(`run ${run.runId} carries no release authorization.`);

  console.log(`Run ${run.runId} approved ${approved}.`);
  setOutput("approved_sha", approved);
  setOutput("run_id", run.runId);
  setOutput("run_issue", String(issueNumber));
}

async function authorize() {
  const issueNumber = Number(arg("issue"));
  if (!issueNumber) fail("no run issue was supplied. Release runs downstream of an approved run.");

  const run = await readRun(issueNumber);
  if (run.status !== "completed") {
    fail(
      `run ${run.runId} is \`${run.status}\`, not \`completed\`. Finish the run before releasing.`,
    );
  }
  const rejected = rejectedGates(run);
  if (rejected.length) fail(`run ${run.runId} has unresolved outcomes at: ${rejected.join(", ")}.`);

  const authorization = authorizationOf(run);
  if (!authorization) fail(`run ${run.runId} carries no release authorization.`);

  const requested = arg("sha", "").trim();
  if (requested && requested !== authorization.sha) {
    fail(
      `requested commit ${requested.slice(0, 12)} is not the approved commit ${authorization.sha.slice(0, 12)}.`,
    );
  }

  const shipping = releaseCommit(run);
  if (!shipping) {
    fail(
      `run ${run.runId} approved ${authorization.sha.slice(0, 12)} but that commit was never merged ` +
        "into the default branch. Canon releases only merged commits: re-run the Release workflow " +
        "after the merge succeeds, or resolve why the merge was refused.",
    );
  }
  console.log(
    `Run ${run.runId} approved ${authorization.sha} at ${authorization.approvedAt}` +
      (shipping !== authorization.sha ? `, merged as ${shipping}.` : "."),
  );
  setOutput("sha", shipping);
  setOutput("approved_sha", authorization.sha);
  setOutput("run_id", run.runId);
  setOutput("run_issue", String(issueNumber));
}

async function verify() {
  const sha = arg("sha", process.env.GITHUB_SHA || "").trim();
  if (!sha) fail("no commit to verify.");

  const runs = await loadRuns();
  const match = runs.find(({ run }) => {
    const authorization = authorizationOf(run);
    if (!authorization) return false;
    return authorization.sha === sha || releaseCommit(run) === sha;
  });
  if (!match) {
    fail(
      `commit ${sha.slice(0, 12)} was not approved by any Canon run. ` +
        "Releases and production deployments must come from an approved run, not from an ad-hoc tag.",
    );
  }
  console.log(`Commit ${sha.slice(0, 12)} approved by run ${match.run.runId} (#${match.issue}).`);
  setOutput("run_issue", String(match.issue));
  setOutput("run_id", match.run.runId);
}

// Cuts the tag and creates the release with tokens Canon brokers for exactly those
// two operations. No repository code runs in this job, and no marketplace action is
// handed a publishing credential: the two API calls are made here, directly.
async function publish() {
  const issueNumber = Number(arg("issue"));
  const tag = arg("tag").trim();
  const sha = arg("sha").trim();
  if (!issueNumber) fail("no run issue was supplied.");
  if (!tag) fail("no release tag was supplied.");
  if (!sha) fail("no release commit was supplied.");

  // The job holds no credential of its own, so the first brokered token is also what
  // reads the run record back.
  await useBrokeredToken("create_release_tag", { runId: issueNumber });

  // Re-checked here rather than trusted from the previous step: this is the job that
  // actually publishes, so it verifies its own authorization.
  const run = await readRun(issueNumber);
  const authorization = authorizationOf(run);
  if (!authorization) fail(`run ${run.runId} carries no release authorization.`);
  const shipping = releaseCommit(run);
  if (!shipping) fail(`run ${run.runId} has no merged commit to release.`);
  if (shipping !== sha) {
    fail(
      `commit ${sha.slice(0, 12)} is not the merged commit ${shipping.slice(0, 12)} for run ${run.runId}.`,
    );
  }

  const existing = await gh(`/repos/${REPO}/git/ref/${encodeURIComponent(`tags/${tag}`)}`).catch(
    () => null,
  );
  if (existing?.object?.sha && existing.object.sha !== sha) {
    fail(`tag ${tag} already points at ${String(existing.object.sha).slice(0, 12)}.`);
  }
  if (!existing) {
    await gh(`/repos/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
    });
    console.log(`Tagged ${sha.slice(0, 12)} as ${tag}.`);
  }

  await useBrokeredToken("create_release", { runId: issueNumber });
  const release = await gh(`/repos/${REPO}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: tag,
      generate_release_notes: true,
      body: [
        `Released from Canon run ${run.runId} (#${issueNumber}).`,
        `Approved commit: ${authorization.sha}`,
        `Released commit: ${sha}`,
      ].join("\n"),
    }),
  });
  console.log(`Published release ${tag}: ${release.html_url ?? ""}`);
}

if ((process.argv[1] ?? "").endsWith("release.mjs")) {
  const handler = { candidate, authorize, verify, publish }[process.argv[2]];
  if (!handler) {
    console.error(
      "Usage: node .canon/flows/beta-9de674/release.mjs <candidate|authorize|verify|publish> [--issue N] [--sha SHA] [--tag TAG]",
    );
    process.exit(1);
  }
  handler().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
