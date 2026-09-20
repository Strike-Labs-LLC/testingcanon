/**
 * Content hashing for the Canon install manifest.
 *
 * Mirrors `src/features/blueprint/emit/hash.ts` in the Canon compiler: FNV-1a
 * 64-bit over UTF-8 bytes with CRLF normalized to LF. It detects local edits,
 * it is not a security primitive.
 */

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function hashContents(contents) {
  const bytes = new TextEncoder().encode(String(contents).replace(/\r\n/g, "\n"));
  let hash = OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return `canon1:${hash.toString(16).padStart(16, "0")}`;
}

export const MERGE_BEGIN = "canon:begin";
export const MERGE_END = "canon:end";

/**
 * Replaces the Canon-owned region of a merge-managed file, preserving
 * everything a human wrote outside the markers. When the existing file has no
 * markers, Canon's region is appended rather than replacing the file.
 */
export function mergeRegion(existing, incoming) {
  const begin = existing.indexOf(MERGE_BEGIN);
  const end = existing.indexOf(MERGE_END);
  if (begin === -1 || end === -1 || end < begin) {
    return `${existing.trimEnd()}\n\n${incoming.trimEnd()}\n`;
  }
  const beforeLine = existing.lastIndexOf("\n", begin);
  const afterLine = existing.indexOf("\n", end);
  const head = beforeLine === -1 ? "" : existing.slice(0, beforeLine + 1);
  const tail = afterLine === -1 ? "" : existing.slice(afterLine + 1);
  return `${head}${incoming.trimEnd()}\n${tail}`;
}
