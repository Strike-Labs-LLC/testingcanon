#!/usr/bin/env node
/**
 * Canon uninstaller.
 *
 * Canon knows exactly what it installed, so removal is precise rather than a
 * guess. Canon-managed files are deleted, merge-managed files have only Canon's
 * region removed, and user-managed files are always left in place and listed so
 * you can decide.
 *
 * Usage:
 *   node .canon/uninstall.mjs [--target <repo root>] [--apply]
 *
 * Without --apply it prints the removal plan and changes nothing.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { MERGE_BEGIN, MERGE_END, hashContents } from "./canon-hash.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const targetIndex = args.indexOf("--target");
const target = resolve(targetIndex === -1 ? process.cwd() : args[targetIndex + 1]);

// A repository can hold several Canon flows, each installed under its own
// directory. This script always belongs to exactly one of them, so its own
// location -- not a hardcoded ".canon" -- decides which installation it reads
// and writes. Legacy single-flow installs resolve to ".canon" unchanged.
const canonRoot = dirname(fileURLToPath(import.meta.url));
const canonRel = relative(target, canonRoot) || ".canon";
const manifestPath = join(canonRoot, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`No ${canonRel}/manifest.json found — Canon is not installed in this repository.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const remove = [];
const clean = [];
const keep = [];

for (const entry of manifest.files ?? []) {
  const absolute = join(target, entry.path);
  if (!existsSync(absolute)) continue;
  if (entry.ownership === "user" || entry.resolution === "keep-customer") {
    keep.push(entry);
    continue;
  }
  if (entry.ownership === "merge") {
    clean.push(entry);
    continue;
  }
  const current = readFileSync(absolute, "utf8");
  if (hashContents(current) !== entry.hash)
    keep.push({ ...entry, purpose: "modified after install" });
  else remove.push(entry);
}

console.log(`Canon ${manifest.canonVersion} — ${manifest.blueprint?.name ?? "installation"}`);
console.log(
  `${remove.length} file(s) to delete, ${clean.length} to un-merge, ${keep.length} left for you.`,
);
for (const entry of remove) console.log(`  delete   ${entry.path}`);
for (const entry of clean) console.log(`  un-merge ${entry.path}`);
for (const entry of keep) console.log(`  keep     ${entry.path} (${entry.purpose})`);

if (!apply) {
  console.log("");
  console.log("Nothing was changed. Rerun with --apply to perform the removal.");
  process.exit(0);
}

for (const entry of remove) {
  rmSync(join(target, entry.path), { force: true });
}
for (const entry of clean) {
  const absolute = join(target, entry.path);
  writeFileSync(absolute, stripRegion(readFileSync(absolute, "utf8")));
}
rmSync(manifestPath, { force: true });
// Only this flow's own directory. Another flow's runtime may sit beside it,
// and removing one flow must never delete another's installation.
rmSync(join(target, canonRel), { recursive: true, force: true });
rmSync(join(target, "CONFLICTS.md"), { force: true });

console.log("");
console.log("Canon removed. Files listed as 'keep' are still in the repository.");

/** Drops Canon's marked region and leaves the rest of the file untouched. */
function stripRegion(contents) {
  const begin = contents.indexOf(MERGE_BEGIN);
  const end = contents.indexOf(MERGE_END);
  if (begin === -1 || end === -1 || end < begin) return contents;
  const beforeLine = contents.lastIndexOf("\n", begin);
  const afterLine = contents.indexOf("\n", end);
  const head = beforeLine === -1 ? "" : contents.slice(0, beforeLine + 1);
  const tail = afterLine === -1 ? "" : contents.slice(afterLine + 1);
  return `${head}${tail}`.trimStart();
}

void dirname;
