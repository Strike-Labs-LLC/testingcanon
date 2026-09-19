// Path glob matching, shared by the stage runner and the trusted publisher.
//
// Both sides must agree exactly on what a stage's write globs mean: the runner
// uses them to fail early, the publisher uses them as the last word before
// anything reaches the repository. One implementation, one meaning.

/** `**` crosses directories, `*` does not, everything else is literal. */
export function globToRegExp(glob) {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("\u0000")
    .replace(/\u0000\u0000\//g, "(?:.*/)?")
    .replace(/\u0000\u0000/g, ".*")
    .replace(/\u0000/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function matchesAny(file, globs) {
  return (globs ?? []).some((glob) => globToRegExp(glob).test(file));
}

/** Normalise a repository-relative path the way git reports it. */
export function normalizePath(file) {
  return String(file ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\.\//, "");
}

/**
 * The paths a stage may write.
 *
 * Ownership, when declared, is the allow list. A stage that declares no owned
 * paths is bounded only by its deny globs — Canon does not invent an allow list
 * the modeller never expressed.
 */
export function allowedToWrite(file, stage) {
  const policy = stage?.tools ?? {};
  if (matchesAny(file, policy.denyPaths ?? [])) return false;
  const owned = stage?.ownership?.paths ?? [];
  if (!owned.length) return true;
  return (
    matchesAny(file, owned) ||
    owned.some((glob) => file === glob || file.startsWith(`${glob.replace(/\/$/, "")}/`))
  );
}
