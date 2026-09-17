#!/usr/bin/env bash
# Denies destructive database commands.
# Hook contract: the event arrives as a JSON object on stdin, e.g.
#   {"sessionId":"…","toolName":"str_replace_editor","toolArgs":{"path":"src/a.ts", … }}
# Exit 0 always; the decision is the JSON printed on stdout. Never read argv for event data.
set -uo pipefail

PAYLOAD="$(cat 2>/dev/null || true)"
[ -n "$PAYLOAD" ] || PAYLOAD='{}'

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n'
}

allow() {
  printf '{"permissionDecision":"allow"}\n'
  exit 0
}

deny() {
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$(json_escape "$1")"
  exit 0
}

# Fail closed: without jq the payload cannot be parsed, so the guardrail cannot be enforced.
if ! command -v jq >/dev/null 2>&1; then
  deny "Canon hooks require jq to parse the tool call. Install jq on this runner (GitHub-hosted runners include it) or remove .github/hooks."
fi

if ! printf '%s' "$PAYLOAD" | jq -e . >/dev/null 2>&1; then
  deny "Canon hooks received a tool call that is not valid JSON and cannot be evaluated."
fi

# The tool Copilot is about to run, e.g. "str_replace_editor" or "bash".
TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.toolName // .tool_name // ""')"
# The tool's arguments object. Fall back to the whole event so a payload that inlines its
# arguments at the top level is still inspected rather than silently allowed.
TOOL_ARGS="$(printf '%s' "$PAYLOAD" | jq -c 'if (.toolArgs? // .tool_args?) then (.toolArgs // .tool_args) else . end')"

# Value of a single named argument, empty when absent.
tool_arg() {
  printf '%s' "$TOOL_ARGS" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null
}

# Every string anywhere in the arguments, one per line. Used when the argument name varies
# by tool (path / file_path / filePath) or when content must be scanned as a whole.
arg_strings() {
  printf '%s' "$TOOL_ARGS" | jq -r '[.. | strings] | .[]' 2>/dev/null
}

# The shell command a shell-ish tool is about to run, however the tool names that argument.
tool_command() {
  local value
  for key in command cmd script run input commandLine command_line; do
    value="$(tool_arg "$key")"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return 0
    fi
  done
  arg_strings | tr '\n' ' '
}

DENY='drop[[:space:]]+(table|database|schema)|truncate[[:space:]]+table|delete[[:space:]]+from[[:space:]]+[a-z_]+[[:space:]]*;|psql[^ ]*prod'

COMMAND="$(tool_command)"
[ -n "$COMMAND" ] || allow

if printf '%s' "$COMMAND" | grep -Eiq -e "$DENY"; then
  deny "Destructive database statements are blocked. Write a reversible migration and let the pipeline apply it."
fi

allow
