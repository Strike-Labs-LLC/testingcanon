// Land an approved candidate on the default branch.
//
//   node .canon/flows/beta-9de674/merge.mjs --issue <run issue>
//
// The gap this closes: a run approves commit X on a stage branch, someone pushes
// commit Y to that branch, and the merge ships Y under X's approvals. GitHub's
// merge API accepts an expected head SHA precisely for this; Canon always sends it,
// so a branch that moved after approval makes the merge fail instead of shipping
// unreviewed code.
//
// The commit the merge actually produced is written back into the run's release
// stamp as `releaseSha`. Tags and deployments are cut from that commit.

import fs from "node:fs";

import { gh, readRun, writeRun, loadGraph, comment, closeIssue } from "./state.mjs";
import { authorizationOf, approvedCandidate } from "./release.mjs";
import { useBrokeredToken } from "./canon-token.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "";

/** The merge commit is the release input, so the publishing step reads it from here. */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  fs.appendFileSync(file, `${name}=${value}\n`);
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`Merge blocked: ${message}`);
  process.exit(1);
}

/** The pull request in `state` whose head is exactly this commit. */
async function pullRequestFor(sha, state = "open") {
  const list = await gh(`/repos/${REPO}/pulls?state=${state}&per_page=100`);
  return list.find((pr) => pr.head?.sha === sha) ?? null;
}

async function main() {
  const issueNumber = Number(arg("issue"));
  if (!issueNumber) fail("no run issue was supplied.");

  // Merging the approved candidate is its own brokered operation: a token minted
  // for publishing a patch cannot land one.
  await useBrokeredToken("merge_candidate", { runId: issueNumber });

  const graph = loadGraph();
  const run = await readRun(issueNumber);
  const authorization = authorizationOf(run);
  if (!authorization) {
    fail(`run ${run.runId} carries no release authorization, so nothing may be merged.`);
  }

  const approved = approvedCandidate(run);
  if (!approved) fail(`run ${run.runId} carries no approved candidate commit.`);

  // Idempotent: the merge already happened and the stamp records the commit that
  // landed. Re-running the Release workflow must not fail on that.
  if (String(authorization.releaseSha ?? "").trim()) {
    console.log(`Approved commit ${approved} already merged as ${authorization.releaseSha}.`);
    setOutput("release_sha", authorization.releaseSha);
    return;
  }

  const pr = await pullRequestFor(approved);
  if (!pr) {
    // The approved commit may have merged in an earlier attempt that never wrote the
    // stamp. Recover it from the closed pull request rather than shipping unmerged code.
    const closed = await pullRequestFor(approved, "closed");
    if (closed?.merged_at && closed.merge_commit_sha) {
      run.release = {
        ...run.release,
        releaseSha: closed.merge_commit_sha,
        mergedPullRequest: closed.number,
      };
      await writeRun(issueNumber, graph, run);
      setOutput("release_sha", closed.merge_commit_sha);
      console.log(`Approved commit ${approved} was already merged as ${closed.merge_commit_sha}.`);
      return;
    }
    fail(
      `no open pull request has head ${approved.slice(0, 12)} — the approved commit. ` +
        "The branch moved after approval, so the approved code cannot be landed or released.",
    );
  }

  // Re-read the pull request head immediately before merging. The approval
  // attestation proves what the run judged; only this check proves the branch has not
  // moved since. Without it a push landing between approval and merge ships unreviewed
  // code under the run's approvals.
  const head = String(pr.head?.sha ?? "").trim();
  if (head !== approved) {
    fail(
      `pull request #${pr.number} now points at ${head.slice(0, 12)}, not the approved ` +
        `commit ${approved.slice(0, 12)}. The branch moved after approval.`,
    );
  }

  const reviews = await gh(`/repos/${REPO}/pulls/${pr.number}/reviews`);
  const native = (reviews ?? []).filter(
    (review) =>
      String(review.state).toUpperCase() === "APPROVED" &&
      String(review.commit_id ?? "") === approved,
  );
  if (native.length === 0) {
    fail(
      `pull request #${pr.number} has no native APPROVE review on ${approved.slice(0, 12)}. ` +
        "A Canon issue comment is not enough. Approve the pull request on that commit.",
    );
  }

  let merged;
  try {
    merged = await gh(`/repos/${REPO}/pulls/${pr.number}/merge`, {
      method: "PUT",
      body: JSON.stringify({
        // The contract: merge this exact commit or nothing.
        sha: approved,
        merge_method: "squash",
        commit_title: `${pr.title} (#${pr.number})`,
        commit_message: `Approved by Canon run ${run.runId} (#${issueNumber}) at commit ${approved}.`,
      }),
    });
  } catch (error) {
    fail(
      `GitHub refused the merge of ${approved.slice(0, 12)}: ${
        error instanceof Error ? error.message : String(error)
      }. The head commit no longer matches the approved commit.`,
    );
    return;
  }

  const releaseSha = merged?.sha;
  if (!releaseSha) fail("the merge returned no commit SHA, so nothing can be released.");

  run.release = { ...run.release, releaseSha, mergedPullRequest: pr.number };
  setOutput("release_sha", releaseSha);
  await writeRun(issueNumber, graph, run);
  await comment(
    issueNumber,
    [
      `## Merged`,
      "",
      `Approved commit \`${approved.slice(0, 12)}\` landed on \`${pr.base?.ref}\` as \`${releaseSha.slice(0, 12)}\`.`,
      "",
      "Releases and deployments for this run are cut from that commit.",
    ].join("\n"),
  );
  console.log(`Merged ${approved} as ${releaseSha}.`);
  if (run.source?.number) {
    await closeIssue(
      run.source.number,
      `Canon merged approved commit \`${approved.slice(0, 12)}\` as \`${String(releaseSha).slice(0, 12)}\`. Source closed after merge.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
