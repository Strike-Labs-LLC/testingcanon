#!/usr/bin/env node
/**
 * Prints a removal plan from the install ledger. Does not delete anything.
 *
 *   node .canon/removal-plan.mjs [--target <repo root>]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashContents } from "./canon-hash.mjs";

const targetIndex = process.argv.indexOf("--target");
const target = resolve(targetIndex === -1 ? process.cwd() : process.argv[targetIndex + 1]);
const ledgerPath = join(target, ".canon", "install-ledger.json");
const manifestPath = join(target, ".canon", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("Canon is not installed here.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : { files: [] };
const ledgerByPath = new Map((ledger.files ?? []).map((row) => [row.path, row]));

console.log("Canon removal plan — review only. Nothing will be deleted.");
console.log("");

for (const entry of manifest.files ?? []) {
  const absolute = join(target, entry.path);
  const present = existsSync(absolute);
  const current = present ? hashContents(readFileSync(absolute, "utf8")) : null;
  const installed = ledgerByPath.get(entry.path);
  let classification = "Requires administrator review";
  if (entry.ownership === "user" || entry.resolution === "keep-customer") {
    classification = "Shared with customer configuration — do not remove";
  } else if (!present) {
    classification = "Already absent";
  } else if (current === entry.hash && installed?.installed) {
    classification = "Safe to remove";
  } else if (current !== entry.hash) {
    classification = "Modified since installation";
  }
  console.log(`${classification.padEnd(48)} ${entry.path}`);
}

console.log("");
console.log("Re-run only after an authorized administrator reviews this list.");
console.log("Use node .canon/uninstall.mjs --dry-run first. Never one-click destroy.");
