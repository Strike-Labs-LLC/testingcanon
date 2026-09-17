// Brokered publishing credentials.
//
// No job in this repository holds a long-lived credential that can publish. The
// Canon GitHub App's private key never leaves Canon's backend; a trusted job
// proves its own identity to Canon using the GitHub Actions OIDC token, and Canon
// returns a short-lived, repository-scoped installation token for exactly one
// operation.
//
//   const token = await brokerToken("publish_patch");
//
// This is a two-step exchange, both using the same OIDC proof: first Canon
// authorizes this run against .canon/identity.json and issues a short-lived
// lease, then the lease is presented to mint the actual token. The lease is
// held only in this process's memory for the remainder of the job — it is
// never printed, never written to a file, and never passed between jobs
// (a GitHub Actions job output is plain text, visible to anyone who can read
// this repository's Actions runs, for the lease's whole lifetime).
//
// Fails closed. If the broker is unreachable, the OIDC token is unavailable, or
// Canon declines the request, the job stops — it never falls back to GITHUB_TOKEN,
// because GITHUB_TOKEN is precisely the credential this design removes.

import { readFileSync } from "node:fs";

/** Operations Canon will mint a token for. Each is scoped separately. */
export const OPERATIONS = [
  "publish_patch",
  "merge_candidate",
  "create_release_tag",
  "create_release",
];

/** The audience Canon requires in the OIDC token it verifies. */
export const CANON_AUDIENCE = "https://canon.app/github-publisher";

/** Held only in this process's memory. Never printed, never written out. */
let cachedLease = null;

/** The non-secret account/blueprint/repository IDs this package was compiled with. */
function loadIdentity() {
  try {
    const raw = readFileSync(new URL("./identity.json", import.meta.url), "utf8");
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "This repository has no .canon/identity.json. Recompile the package from Canon " +
        "with a saved, repository-bound flow before running a job that publishes.",
    );
  }
}

/** A short-lived run lease, fetched once per job and reused while it has life left. */
async function obtainLease() {
  if (cachedLease && Date.parse(cachedLease.expiresAt) - Date.now() > 60_000) {
    return cachedLease.token;
  }
  const identity = loadIdentity();
  const authorizeUrl = (
    process.env.CANON_AUTHORIZE_URL || "https://usecanon.app/api/public/runtime/authorize"
  ).trim();
  const response = await fetch(authorizeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await oidcToken()}`,
    },
    body: JSON.stringify({
      canonOrganizationId: identity.accountId,
      blueprintId: identity.blueprintId,
      blueprintVersion: identity.blueprintVersion,
      repositoryId: process.env.GITHUB_REPOSITORY_ID || "",
      repository: process.env.GITHUB_REPOSITORY || "",
      githubRunId: process.env.GITHUB_RUN_ID || "",
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || "",
      workflowSha: process.env.GITHUB_WORKFLOW_SHA || "",
    }),
  });
  const detail = await response.text();
  if (!response.ok) {
    throw new Error(`Canon declined to authorize this run (${response.status}): ${detail}`);
  }
  const body = JSON.parse(detail || "{}");
  if (!body.lease) throw new Error("Canon returned no run lease.");
  cachedLease = { token: body.lease, expiresAt: body.expiresAt };
  return body.lease;
}

/** The Actions OIDC id-token for the Canon audience. */
async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || "";
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || "";
  if (!url || !requestToken) {
    throw new Error(
      "This job cannot request an OIDC token. Add `id-token: write` to its permissions.",
    );
  }
  const response = await fetch(`${url}&audience=${encodeURIComponent(CANON_AUDIENCE)}`, {
    headers: { authorization: `Bearer ${requestToken}` },
  });
  if (!response.ok) {
    throw new Error(`The Actions OIDC provider refused the request (${response.status}).`);
  }
  const body = await response.json();
  if (!body?.value) throw new Error("The Actions OIDC provider returned no token.");
  return body.value;
}

/**
 * A short-lived installation token for one operation on this repository.
 *
 * @param {string} operation one of OPERATIONS
 * @param {{ runId?: string | number }} context the Canon run this work belongs to
 */
export async function brokerToken(operation, context = {}) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(`Unknown publishing operation \`${operation}\`.`);
  }
  const broker = (
    process.env.CANON_BROKER_URL || "https://usecanon.app/api/public/runtime/token"
  ).trim();
  if (!broker || broker.includes("placeholder")) {
    throw new Error(
      "CANON_BROKER_URL is not set to a real Canon broker, so no publishing token can be obtained. " +
        "Install the Canon GitHub App on this repository.",
    );
  }

  const lease = await obtainLease();

  const response = await fetch(broker, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await oidcToken()}`,
      "x-canon-lease": lease,
    },
    body: JSON.stringify({
      operation,
      canonRunId: String(context.runId ?? ""),
      repository: process.env.GITHUB_REPOSITORY || "",
      repositoryId: process.env.GITHUB_REPOSITORY_ID || "",
      runId: process.env.GITHUB_RUN_ID || "",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || "",
      workflowRef: process.env.GITHUB_WORKFLOW_REF || "",
      workflowSha: process.env.GITHUB_WORKFLOW_SHA || "",
    }),
  });

  const detail = await response.text();
  if (!response.ok) {
    throw new Error(
      `Canon refused to issue a \`${operation}\` token (${response.status}): ${detail}`,
    );
  }
  const body = JSON.parse(detail || "{}");
  if (!body.token) throw new Error("Canon returned no token.");
  return body.token;
}

/**
 * Configure Git and the GitHub API clients in this process to use a brokered
 * token. The checkout persisted no credentials, so this is the only way a
 * trusted job can push at all.
 */
export async function useBrokeredToken(operation, context = {}) {
  const token = await brokerToken(operation, context);
  process.env.GITHUB_TOKEN = token;
  process.env.GH_TOKEN = token;
  return token;
}
