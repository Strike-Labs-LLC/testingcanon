#!/usr/bin/env node
/**
 * Canon installer.
 *
 * Copies the compiled package into the repository without destroying local
 * work. Every file is classified against the manifest already installed:
 *
 *   new           — not in the repository yet, written
 *   unchanged     — identical to what Canon last wrote, skipped
 *   updated       — Canon changed it and the local copy was untouched, replaced
 *   merged        — merge-managed, Canon's region replaced, your text preserved
 *   preserved     — user-managed and already present, left alone
 *   conflict      — Canon-managed but locally edited, written to *.canon-new
 *   removed       — Canon used to install it and no longer does
 *
 * Conflicts never overwrite. They are listed in CONFLICTS.md with the exact
 * command to accept or discard each one.
 *
 * Usage:
 *   node .canon/flows/beta-9de674/install.mjs [--target <repo root>] [--dry-run] [--force]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashContents, mergeRegion } from "./canon-hash.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

// This script ships as `<package>/.canon/flows/beta-9de674/install.mjs`. The manifest sits next
// to it, and every manifest path is relative to the package root one level up.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const target = resolve(value("--target", process.cwd()));
const dryRun = flag("--dry-run");
const force = flag("--force");

const manifest = readJson(join(scriptDir, "manifest.json"));
if (!manifest) {
  fail("No .canon/flows/beta-9de674/manifest.json in this package. Re-download the package from Canon.");
}

const canonRoot = relative(packageRoot, scriptDir) || ".canon";
const previous = migrate(readJson(join(target, canonRoot, "manifest.json")));
const previousByPath = new Map(previous.files.map((entry) => [entry.path, entry]));

const results = [];

for (const entry of manifest.files) {
  const incoming = readText(join(packageRoot, entry.path));
  if (incoming === null) {
    results.push({ ...entry, action: "missing-in-package" });
    continue;
  }
  results.push(plan(entry, incoming));
}

// Files a previous Canon install put here that this compile no longer emits.
const currentPaths = new Set(manifest.files.map((entry) => entry.path));
for (const entry of previous.files) {
  if (currentPaths.has(entry.path)) continue;
  if (!existsSync(join(target, entry.path))) continue;
  results.push({ ...entry, action: "removed" });
}

function plan(entry, incoming) {
  const absolute = join(target, entry.path);
  if (!existsSync(absolute)) return { ...entry, action: "new", contents: incoming };

  const existing = readText(absolute) ?? "";
  const existingHash = hashContents(existing);
  const recordedHash = previousByPath.get(entry.path)?.hash ?? "";
  const locallyEdited = recordedHash !== "" && existingHash !== recordedHash;
  const firstInstallCollision = recordedHash === "" && existingHash !== entry.hash;

  if (existingHash === entry.hash) return { ...entry, action: "unchanged" };
  if (entry.ownership === "user") return { ...entry, action: "preserved" };
  if (entry.ownership === "merge") {
    return { ...entry, action: "merged", contents: mergeRegion(existing, incoming) };
  }
  if ((locallyEdited || firstInstallCollision) && !force) {
    return { ...entry, action: "conflict", contents: incoming, existing };
  }
  return { ...entry, action: "updated", contents: incoming };
}

const conflicts = results.filter((result) => result.action === "conflict");

if (!dryRun) {
  for (const result of results) {
    const absolute = join(target, result.path);
    if (result.action === "removed") {
      rmSync(absolute, { force: true });
      continue;
    }
    if (result.action === "conflict") {
      write(`${absolute}.canon-new`, result.contents);
      continue;
    }
    if (["new", "updated", "merged"].includes(result.action)) {
      write(absolute, result.contents);
    }
  }
  const installed = {
    ...manifest,
    files: results
      .filter((result) => result.action !== "removed" && result.action !== "missing-in-package")
      .map((result) => {
        if (result.action === "conflict" || result.action === "preserved") {
          return {
            ...result,
            hash: hashContents(result.existing ?? readText(join(target, result.path)) ?? ""),
            ownership: "user",
            resolution: result.action === "conflict" ? "keep-customer" : "preserved",
          };
        }
        return {
          path: result.path,
          hash: result.hash,
          ownership: result.ownership,
          purpose: result.purpose,
          resolution: result.action,
        };
      }),
  };
  write(join(target, canonRoot, "manifest.json"), `${JSON.stringify(installed, null, 2)}\n`);
  write(
    join(target, canonRoot, "install-ledger.json"),
    `${JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        files: results.map((result) => ({
          path: result.path,
          action: result.action,
          packageHash: result.hash,
          installed: ["new", "updated", "merged"].includes(result.action),
        })),
      },
      null,
      2,
    )}\n`,
  );
  if (conflicts.length) write(join(target, "CONFLICTS.md"), conflictReport(conflicts));
  else rmSync(join(target, "CONFLICTS.md"), { force: true });
}

report();

function report() {
  const counts = {};
  for (const result of results) counts[result.action] = (counts[result.action] ?? 0) + 1;
  console.log(`Canon ${manifest.canonVersion} — ${manifest.blueprint.name}`);
  console.log(`Target: ${target}${dryRun ? " (dry run, nothing written)" : ""}`);
  for (const [action, count] of Object.entries(counts).sort()) {
    console.log(`  ${action.padEnd(18)} ${count}`);
  }
  if (conflicts.length) {
    console.log("");
    console.log(`${conflicts.length} file(s) you edited were not overwritten.`);
    console.log("Review CONFLICTS.md, then rerun with --force to accept Canon's version.");
    process.exitCode = 2;
  }
}

function conflictReport(list) {
  const lines = [
    "# Canon install conflicts",
    "",
    `Canon ${manifest.canonVersion} did not overwrite ${list.length} file(s) because they were edited after the last install.`,
    "Canon's version of each file is next to it with a `.canon-new` suffix.",
    "",
    "| File | Purpose | Accept Canon's version | Keep yours |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of list) {
    lines.push(
      `| \`${item.path}\` | ${item.purpose} | \`mv ${item.path}.canon-new ${item.path}\` | \`rm ${item.path}.canon-new\` |`,
    );
  }
  lines.push(
    "",
    `After resolving every row, rerun \`node ${canonRoot}/install.mjs\` so the manifest matches the repository.`,
    "",
  );
  return lines.join("\n");
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`  wrote ${relative(target, path)}`);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path) {
  const text = readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Accepts manifests from older Canon exports so upgrades never need a reinstall. */
function migrate(raw) {
  if (!raw || !Array.isArray(raw.files)) return { files: [] };
  return {
    ...raw,
    files: raw.files
      .filter((entry) => entry && typeof entry.path === "string")
      .map((entry) => ({
        path: entry.path,
        ownership: entry.ownership ?? "canon",
        purpose: entry.purpose ?? "Generated file",
        hash: entry.hash ?? "",
      })),
  };
}

function fail(message) {
  console.error(`Canon install failed: ${message}`);
  process.exit(1);
}
