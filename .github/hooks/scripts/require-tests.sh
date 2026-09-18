#!/usr/bin/env bash
# agentStop: an agent may not finish with a failing test suite.
# Contract differs from preToolUse: the decision field is "decision": "block" | "allow".
# The agentStop payload is JSON on stdin; it is drained (and ignored) rather than read from argv.
set -uo pipefail
cat >/dev/null 2>&1 || true

COMMAND="${CANON_TEST_COMMAND:-bash .canon/require-script.sh test}"
OUTPUT="$(eval "$COMMAND" 2>&1)"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  REASON="$(printf '%s' "$OUTPUT" | tail -n 40 | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')"
  printf '{"decision":"block","reason":"Tests failed (%s). Fix them before finishing: %s"}\n' "$COMMAND" "$REASON"
  exit 0
fi

printf '{"decision":"allow"}\n'
