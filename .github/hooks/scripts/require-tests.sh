#!/usr/bin/env bash
# agentStop: an agent may not finish with a failing test suite.
# Contract differs from preToolUse: the decision field is "decision": "block" | "allow".
# The agentStop payload is JSON on stdin.
#
# This hook forces the model to continue, so every unnecessary block costs a full
# turn. It therefore runs in exactly one situation: a stage that may write, in a
# repository that really has a test command, on a stop the agent did not already
# reach through this hook.
set -uo pipefail

PAYLOAD="$(cat 2>/dev/null || true)"
[ -n "$PAYLOAD" ] || PAYLOAD='{}'

allow() {
  printf '{"decision":"allow"}\n'
  exit 0
}

# Already continued once by this hook: blocking again loops the agent.
if command -v jq >/dev/null 2>&1; then
  ACTIVE="$(printf '%s' "$PAYLOAD" | jq -r '.stopHookActive // .stop_hook_active // false' 2>/dev/null || echo false)"
  if [ "$ACTIVE" = "true" ]; then
    printf 'canon: stop_hook_active is true; not re-running the test suite.\n' >&2
    allow
  fi
fi

# Read-only stages cannot have broken anything, and are not asked to prove it.
if [ "${CANON_STAGE_WRITES:-false}" != "true" ]; then
  printf 'canon: this stage has no write authority; the test gate does not apply.\n' >&2
  allow
fi

COMMAND="${CANON_TEST_COMMAND:-}"
if [ -z "$COMMAND" ]; then
  printf 'canon: no test command is configured for this repository; allowing.\n' >&2
  allow
fi

# A package-script command is only meaningful when the package script exists.
case "$COMMAND" in
  *require-script.sh*|*npm\ test*|*pnpm\ test*|*yarn\ test*)
    if [ ! -f package.json ]; then
      printf 'canon: no package.json in this repository; the test gate does not apply.\n' >&2
      allow
    fi
    if command -v jq >/dev/null 2>&1; then
      HAS_TEST="$(jq -r '.scripts.test // empty' package.json 2>/dev/null || true)"
      if [ -z "$HAS_TEST" ]; then
        printf 'canon: package.json declares no "test" script; the test gate does not apply.\n' >&2
        allow
      fi
    fi
    ;;
esac

OUTPUT="$(eval "$COMMAND" 2>&1)"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  # GitHub rejects oversized hook responses, and a 4MB stack trace helps nobody.
  REASON="$(printf '%s' "$OUTPUT" | tail -n 40 | tail -c 2048 | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')"
  printf '{"decision":"block","reason":"Tests failed (%s). Fix them before finishing: %s"}\n' "$COMMAND" "$REASON"
  exit 0
fi

allow
