#!/usr/bin/env bash
# Canon: run a package script that this blueprint declares as a required check.
# Package manager: npm (detected by repository discovery).
#
# Usage: bash .canon/require-script.sh <npm-script> [optional]
#
# A required check whose script does not exist fails. `npm test --if-present`
# exits 0 on a repository with no tests, which turns a required gate green
# without running anything.
set -uo pipefail

SCRIPT="${1:-}"
MODE="${2:-required}"

if [ -z "$SCRIPT" ]; then
  echo "usage: require-script.sh <npm-script> [optional]" >&2
  exit 2
fi

if [ ! -f package.json ]; then
  echo "::error::package.json not found, so the required "$SCRIPT" check cannot run."
  exit 1
fi

HAS_SCRIPT="$(node -e 'const s=(require("./package.json").scripts)||{};process.stdout.write(s[process.argv[1]]?"yes":"no")' "$SCRIPT" 2>/dev/null || echo "no")"

if [ "$HAS_SCRIPT" != "yes" ]; then
  if [ "$MODE" = "optional" ]; then
    echo "notice: no "$SCRIPT" script in package.json; skipping (this check is optional)."
    exit 0
  fi
  echo "::error::This blueprint requires the "$SCRIPT" check, but package.json has no "$SCRIPT" script."
  echo "Add it under "scripts" in package.json, or change the requirement in Canon."
  exit 1
fi

npm run "$SCRIPT"
