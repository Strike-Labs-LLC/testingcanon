#!/usr/bin/env bash
# Appends agent activity to the audit log. Observational only: it never blocks.
# The event label is the one thing passed as an argument (it is fixed by the hook config).
# Everything about the event itself is read from the JSON on stdin.
set -uo pipefail

EVENT="${1:-event}"
PAYLOAD="$(cat 2>/dev/null || true)"
[ -n "$PAYLOAD" ] || PAYLOAD='{}'

TOOL_NAME="-"
if command -v jq >/dev/null 2>&1; then
  PARSED="$(printf '%s' "$PAYLOAD" | jq -r '.toolName // .tool_name // "-"' 2>/dev/null || true)"
  [ -n "$PARSED" ] && TOOL_NAME="$PARSED"
fi

# Never write into the worktree. Every stage denies .sdlc/**, so an in-repo
# audit log fails the stage. Runner temp is uploaded as an Actions artifact.
ROOT="${RUNNER_TEMP:-/tmp}/canon-audit/${GITHUB_RUN_ID:-local}"
LOG="${CANON_AUDIT_LOG:-$ROOT/$EVENT.jsonl}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EVENT" "${GITHUB_ACTOR:-local}" "$TOOL_NAME" >> "$LOG" 2>/dev/null || true
exit 0
