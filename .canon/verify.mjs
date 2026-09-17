#!/usr/bin/env node
/**
 * `canon verify` — proves the installation is real.
 *
 * Uploading files is not the same as installing a system. This checks, in the
 * repository itself, that every file Canon installed is present, that
 * Canon-managed files still match what Canon compiled, that the orchestration
 * graph parses and its stages line up with the agent files on disk, and that
 * every workflow the graph depends on exists.
 *
 * Usage:
 *   node .canon/verify.mjs [--target <repo root>] [--json]
 *
 * Exit code 0 means the installation is sound; 1 means it is not.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hashContents } from "./canon-hash.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const targetIndex = args.indexOf("--target");
const target = resolve(targetIndex === -1 ? process.cwd() : args[targetIndex + 1]);

const failures = [];
const warnings = [];

const manifestPath = join(target, ".canon", "manifest.json");
if (!existsSync(manifestPath)) {
  finish([
    { check: "manifest", message: ".canon/manifest.json is missing — Canon is not installed." },
  ]);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const attestationPath = join(target, ".canon", "attestation.json");
if (existsSync(attestationPath)) {
  try {
    const attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
    for (const entry of attestation.files ?? []) {
      const absolute = join(target, entry.path);
      if (!existsSync(absolute)) {
        failures.push({
          check: "attestation",
          message: `${entry.path} is listed in the attestation but missing.`,
        });
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
      if (entry.sha256 && actual !== entry.sha256) {
        failures.push({
          check: "attestation",
          message: `${entry.path} does not match the compiled SHA-256.`,
        });
      }
    }
    if (attestation.signed !== true) {
      warnings.push({
        check: "attestation",
        message:
          "Package attestation is unsigned. Treat this export as a prototype digest, not a trusted signature.",
      });
    }
  } catch (error) {
    failures.push({
      check: "attestation",
      message: `attestation.json could not be read: ${error.message}`,
    });
  }
}
if (existsSync(join(target, "CONFLICTS.md"))) {
  failures.push({
    check: "conflicts",
    message: "Unresolved install conflicts. Installation is not verified.",
  });
}

// 1. Every installed file is present, and Canon-managed files are unmodified.
for (const entry of manifest.files ?? []) {
  const absolute = join(target, entry.path);
  if (!existsSync(absolute)) {
    failures.push({
      check: "missing-file",
      message: `${entry.path} is missing (${entry.purpose}).`,
    });
    continue;
  }
  if (entry.ownership !== "canon") continue;
  const actual = hashContents(readFileSync(absolute, "utf8"));
  if (actual !== entry.hash) {
    if (entry.path.startsWith(".canon/")) {
      failures.push({
        check: "modified-runtime",
        message: `${entry.path} no longer matches the compiled runtime.`,
      });
    } else {
      warnings.push({
        check: "modified-file",
        message: `${entry.path} was edited after installation. Canon will replace it on the next install.`,
      });
    }
  }
}

// 2. The orchestration graph parses and points only at files that exist.
const graphPath = join(target, ".canon", "graph.json");
if (!existsSync(graphPath)) {
  failures.push({ check: "graph", message: ".canon/graph.json is missing — no run can start." });
} else {
  let graph = null;
  try {
    graph = JSON.parse(readFileSync(graphPath, "utf8"));
  } catch (error) {
    failures.push({
      check: "graph",
      message: `.canon/graph.json is not valid JSON: ${error.message}`,
    });
  }
  if (graph) {
    const ids = new Set((graph.stages ?? []).map((stage) => stage.id));
    if (!graph.entry) failures.push({ check: "graph", message: "The graph has no entry stage." });
    else if (!ids.has(graph.entry)) {
      failures.push({
        check: "graph",
        message: `The graph entry "${graph.entry}" is not a defined stage.`,
      });
    }
    for (const stage of graph.stages ?? []) {
      if (stage.agentFile && !existsSync(join(target, stage.agentFile))) {
        failures.push({
          check: "agent-file",
          message: `Stage "${stage.name}" points at ${stage.agentFile}, which is not in the repository.`,
        });
      }
    }
    for (const edge of graph.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        failures.push({
          check: "graph",
          message: `Transition ${edge.id} references a stage that does not exist.`,
        });
      }
    }
  }
}

// 3. The workflows that drive a run exist. The expected list comes from the
// compiled package itself — graph.json records the workflows compiled with it,
// and the manifest is the fallback — so renaming a workflow never breaks this.
const expectedWorkflows = new Set(
  (graphWorkflows() ?? []).concat(
    (manifest.files ?? [])
      .map((entry) => entry.path)
      .filter((path) => /^\.github\/workflows\/.+\.ya?ml$/.test(path)),
  ),
);
if (expectedWorkflows.size === 0) {
  warnings.push({
    check: "workflow",
    message: "This package declares no workflows, so nothing will drive a run.",
  });
}
for (const workflow of expectedWorkflows) {
  if (!existsSync(join(target, workflow))) {
    failures.push({
      check: "workflow",
      message: `${workflow} is missing — nothing will drive a run.`,
    });
  }
}

// 4. Node can execute the runtime.
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  failures.push({
    check: "runtime",
    message: `Node ${process.versions.node} is too old; the Canon runtime needs Node 20 or newer.`,
  });
}

finish(failures);

function finish(list) {
  const ok = list.length === 0;
  if (asJson) {
    console.log(JSON.stringify({ ok, failures: list, warnings }, null, 2));
  } else {
    console.log(`Canon verify — ${manifestName()}`);
    for (const item of warnings) console.log(`  warn  ${item.message}`);
    for (const item of list) console.log(`  FAIL  ${item.message}`);
    console.log(ok ? "  Installation verified." : `  ${list.length} problem(s) found.`);
  }
  process.exit(ok ? 0 : 1);
}

function graphWorkflows() {
  try {
    const parsed = JSON.parse(readFileSync(join(target, ".canon", "graph.json"), "utf8"));
    return Array.isArray(parsed.workflows) ? parsed.workflows : null;
  } catch {
    return null;
  }
}

function manifestName() {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).blueprint?.name ?? "installation";
  } catch {
    return "installation";
  }
}
