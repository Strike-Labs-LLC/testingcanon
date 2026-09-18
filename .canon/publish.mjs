// The trusted publisher.
//
// Stage jobs run agent output and hold no credential that can write to the
// repository. What they produce leaves the runner as a patch. This script — the
// only part of a tick that holds a publishing token — decides whether that patch
// may enter the repository, and is the principal that commits it.
//
//   node .canon/publish.mjs --issue <run issue> --inbox <dir> --outbox <dir>
//
// Every check below is deterministic. Nothing here asks a model anything.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { loadGraph, readRun, resultComment, responseSection, CANON_ROOT } from "./state.mjs";
import { stageById } from "./engine.mjs";
import { allowedToWrite, matchesAny, normalizePath } from "./paths.mjs";
import { useBrokeredToken } from "./canon-token.mjs";

/** Publication limits. A patch beyond these is reviewed by a person, not merged by a bot. */
const MAX_FILES = 200;
const MAX_BYTES = 2 * 1024 * 1024;

/** File extensions a source patch may never introduce. */
const FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".jar",
  ".war",
  ".class",
  ".pyc",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".pem",
  ".key",
  ".pfx",
  ".p12",
];

/** Credentials that must never be committed, whatever the stage was granted. */
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Every reason this patch may not be published.
 *
 * Returns a list, not a boolean: a stage author deserves to see all of what is
 * wrong at once, and the audit trail records the complete finding.
 */
export function validatePatch({ stage, record, patch, files, baseSha, headSha }) {
  const problems = [];
  if (!patch) return problems;

  if (!stage.producesCandidate) {
    problems.push(`${stage.name} is a read-only stage and may not change the repository.`);
  }
  if (!stage.tools?.write) {
    problems.push(`${stage.name} holds no write authority.`);
  }
  if (baseSha && headSha && baseSha !== headSha) {
    problems.push(
      `the candidate moved while the stage ran (patch is against ${baseSha.slice(0, 12)}, ` +
        `the branch is at ${headSha.slice(0, 12)}).`,
    );
  }
  if (record.sourcePatchHash && record.sourcePatchHash !== sha256(patch)) {
    problems.push("the patch does not match the hash the stage recorded for it.");
  }
  if (files.length > MAX_FILES) {
    problems.push(`the patch changes ${files.length} files, above the limit of ${MAX_FILES}.`);
  }
  if (Buffer.byteLength(patch, "utf8") > MAX_BYTES) {
    problems.push(`the patch is larger than the ${Math.round(MAX_BYTES / 1024)}KB limit.`);
  }
  if (/^GIT binary patch$/m.test(patch)) {
    problems.push("the patch contains binary content.");
  }

  for (const file of files) {
    if (!allowedToWrite(file, stage)) {
      problems.push(`\`${file}\` is outside the paths ${stage.name} may write.`);
    }
    if (
      matchesAny(
        file,
        FORBIDDEN_EXTENSIONS.map((ext) => `**/*${ext}`),
      )
    ) {
      problems.push(`\`${file}\` is a file type Canon does not publish.`);
    }
  }

  const added = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  if (SECRET_PATTERNS.some((re) => re.test(added))) {
    problems.push("the patch appears to contain a credential.");
  }

  return problems;
}

/** Files a unified diff touches. */
export function patchFiles(patch) {
  const files = new Set();
  for (const line of patch.split("\n")) {
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    const minus = line.match(/^--- a\/(.+)$/);
    const renameFrom = line.match(/^rename from (.+)$/);
    const renameTo = line.match(/^rename to (.+)$/);
    const copyFrom = line.match(/^copy from (.+)$/);
    const copyTo = line.match(/^copy to (.+)$/);
    const gitLine = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    for (const match of [plus, minus, renameFrom, renameTo, copyFrom, copyTo]) {
      if (match && match[1] && match[1] !== "/dev/null") files.add(normalizePath(match[1]));
    }
    if (gitLine) {
      files.add(normalizePath(gitLine[1]));
      files.add(normalizePath(gitLine[2]));
    }
  }
  return [...files];
}

function identify() {
  git("config", "user.name", "canon-bot");
  git("config", "user.email", "canon-bot@users.noreply.github.com");
}

/**
 * Point `origin` at an authenticated URL built from the brokered token.
 *
 * The checkout ran with `persist-credentials: false`, so the workspace holds no
 * credential at all until this runs — and the one it gets expires within the hour.
 */
function authenticateGit(token) {
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const host = server.replace(/^https?:\/\//, "");
  git("remote", "set-url", "origin", `https://x-access-token:${token}@${host}/${repo}.git`);
}

function apply(patchFile) {
  execFileSync("git", ["apply", "--index", "--whitespace=nowarn", patchFile], {
    encoding: "utf8",
  });
}

function head() {
  try {
    return git("rev-parse", "HEAD");
  } catch {
    return "";
  }
}

/** Land the stage's source changes on its own branch and open a pull request. */
function publishSource(run, stage, patchFile) {
  const attempt = run.stages?.[stage.id]?.attempt ?? 0;
  const branch = `canon/${run.runId}/${stage.id}/${run.generation ?? 1}-${attempt}`;
  identify();
  git("checkout", "-B", branch);
  apply(patchFile);
  git("commit", "-m", `${stage.name}: ${run.objective || run.runId}`);
  try {
    git("fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`);
    const expected = git("rev-parse", `refs/remotes/origin/${branch}`);
    git("push", `--force-with-lease=refs/heads/${branch}:${expected}`, "origin", `HEAD:${branch}`);
  } catch {
    git("push", "-u", "origin", `HEAD:${branch}`);
  }
  const sha = head();

  let url = null;
  try {
    url = execFileSync(
      "gh",
      [
        "pr",
        "create",
        "--head",
        branch,
        "--title",
        `${stage.name}: ${run.objective || run.runId}`,
        "--body",
        `Published by Canon for run #${run.issue ?? run.runId}, stage \`${stage.id}\`, from validated patch \`${sha256(
          readIfExists(patchFile),
        ).slice(0, 12)}\`.`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    // A pull request already exists for this branch; the branch is the record.
  }
  return { branch, sha, url };
}

/** Commit the stage's artifacts to the run's artifact branch. */
function publishArtifacts(run, stage, patchFile) {
  const branch = `canon/${run.runId}/artifacts`;
  identify();
  try {
    git("fetch", "origin", `${branch}:refs/remotes/origin/${branch}`);
    git("checkout", "-B", branch, `origin/${branch}`);
  } catch {
    git("checkout", "-B", branch);
  }
  apply(patchFile);
  git("commit", "-m", `Canon: ${stage.name} artifact (run ${run.runId})`);
  git("push", "--force-with-lease", "origin", branch);
  return { branch, sha: head() };
}

function writeResult(outbox, stageId, body) {
  fs.mkdirSync(outbox, { recursive: true });
  fs.writeFileSync(path.join(outbox, `${stageId}.md`), body, "utf8");
}

async function main() {
  const issueNumber = Number(arg("issue"));
  const inbox = arg("inbox", `${CANON_ROOT}/inbox`);
  const outbox = arg("outbox", `${CANON_ROOT}/outbox`);
  if (!issueNumber) throw new Error("No run issue was supplied.");
  if (!fs.existsSync(inbox)) {
    console.log("Nothing to publish.");
    return;
  }

  // The publisher's only credential: minted by Canon for this repository, this
  // workflow run, and this operation, and expired within the hour.
  const token = await useBrokeredToken("publish_patch", { runId: issueNumber });
  authenticateGit(token);

  const graph = loadGraph();
  const run = await readRun(issueNumber);
  const entries = fs.readdirSync(inbox);

  // Failure results are already final: a failed stage produced no patch, and its
  // report is passed through to the reporter untouched.
  for (const file of entries.filter((name) => name.endsWith(".md"))) {
    writeResult(outbox, file.replace(/\.md$/, ""), readIfExists(path.join(inbox, file)));
  }

  for (const file of entries.filter((name) => name.endsWith(".result.json"))) {
    const record = JSON.parse(readIfExists(path.join(inbox, file)) || "{}");
    const stage = stageById(graph, record.stage);
    if (!stage) continue;

    const sourceFile = path.join(inbox, `${stage.id}.source.patch`);
    const artifactFile = path.join(inbox, `${stage.id}.artifacts.patch`);
    const sourcePatch = fs.existsSync(sourceFile) ? readIfExists(sourceFile) : "";

    let change = null;
    let persisted = null;
    let refusal = null;

    if (sourcePatch.trim()) {
      const files = patchFiles(sourcePatch);
      // Compare against the branch the patch was cut from, not the workspace head.
      let branchHead = "";
      try {
        git("fetch", "origin", process.env.CANON_DEFAULT_BRANCH || "main");
        branchHead = git("rev-parse", `origin/${process.env.CANON_DEFAULT_BRANCH || "main"}`);
      } catch {
        branchHead = record.baseSha ?? "";
      }
      const problems = validatePatch({
        stage,
        record,
        patch: sourcePatch,
        files,
        baseSha: record.baseSha,
        headSha: branchHead,
      });
      if (problems.length) {
        refusal =
          `Canon refused to publish this stage's changes:\n\n` +
          problems.map((p) => `- ${p}`).join("\n");
      } else {
        try {
          git("checkout", "--detach", record.baseSha);
          change = publishSource(run, stage, sourceFile);
        } catch (error) {
          refusal = `Publication failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }

    if (!refusal && fs.existsSync(artifactFile) && readIfExists(artifactFile).trim()) {
      try {
        persisted = publishArtifacts(run, stage, artifactFile);
      } catch (error) {
        refusal = `The artifact could not be committed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }

    if (refusal) {
      writeResult(
        outbox,
        stage.id,
        resultComment(
          {
            ...record,
            response: undefined,
            status: "failed",
            outcome: undefined,
            summary: refusal.split("\n")[0],
          },
          `### ${stage.name} — failed\n\n${refusal}`,
        ),
      );
      process.exitCode = 1;
      continue;
    }

    writeResult(
      outbox,
      stage.id,
      resultComment(
        {
          ...record,
          // The agent's prose belongs in the visible comment, not in the
          // machine-readable marker.
          response: undefined,
          candidateSha: change?.sha ?? null,
          branch: change?.branch ?? null,
          pullRequest: change?.url ?? null,
          artifactCommit: persisted?.sha ?? null,
          artifactBranch: persisted?.branch ?? null,
          publishedBy: process.env.GITHUB_JOB || "publish",
        },
        [
          `### ${stage.name} — ${record.outcome}`,
          "",
          record.summary ?? "",
          "",
          responseSection(record.response),
          "",
          record.artifact ? `Artifact: \`${record.artifact}\`` : "",
          persisted?.sha
            ? `Artifact committed: \`${persisted.sha.slice(0, 12)}\` on \`${persisted.branch}\``
            : "",
          record.evaluatedSha
            ? `Commit evaluated: \`${String(record.evaluatedSha).slice(0, 12)}\``
            : "",
          change?.sha ? `New candidate commit: \`${change.sha.slice(0, 12)}\`` : "",
          change ? `Changes: ${change.url ?? `branch \`${change.branch}\``}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
}

if ((process.argv[1] ?? "").endsWith("publish.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
