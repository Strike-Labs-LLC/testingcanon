#!/usr/bin/env bash
# Applies the Canon-generated GitHub configuration. Every payload in this folder
# is already in GitHub's REST schema; nothing here is a Canon wrapper.
set -euo pipefail

REPO="${CANON_REPO:-YOUR-ORG/YOUR-REPO}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Applying rulesets to $REPO"
for f in "$DIR"/ruleset-*.json; do
  name="$(jq -r '.name' "$f")"
  id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" | head -1 || true)"
  if [ -n "$id" ]; then
    gh api --method PUT "repos/$REPO/rulesets/$id" --input "$f" >/dev/null
    echo "  updated $name ($id)"
  else
    gh api --method POST "repos/$REPO/rulesets" --input "$f" >/dev/null
    echo "  created $name"
  fi
done

echo "Applying environments to $REPO"
for f in "$DIR"/environment-*.json; do
  name="$(jq -r '.environment_name' "$f")"
  body="$(jq -c '.body' "$f")"

  # Resolve reviewer refs to GitHub IDs. An unresolved reviewer is a hard failure:
  # an environment with an empty reviewer list is not an approval gate.
  resolved='[]'
  for ref in $(jq -r '.body.reviewers[]? | "\(.type):\(.ref)"' "$f"); do
    type="${ref%%:*}"
    value="${ref#*:}"
    if [ "$type" = "user" ]; then
      id="$(gh api "users/$value" --jq '.id')"
      resolved="$(jq -c --argjson id "$id" '. + [{type:"User",id:$id}]' <<<"$resolved")"
    else
      org="${value%%/*}"
      slug="${value#*/}"
      id="$(gh api "orgs/$org/teams/$slug" --jq '.id')"
      resolved="$(jq -c --argjson id "$id" '. + [{type:"Team",id:$id}]' <<<"$resolved")"
    fi
  done

  body="$(jq -c --argjson r "$resolved" '.reviewers = $r' <<<"$body")"
  echo "$body" | gh api --method PUT "repos/$REPO/environments/$name" --input - >/dev/null
  echo "  applied $name"

  branches="$(jq -r '.custom_branch_policies[]?' "$f")"
  for branch in $branches; do
    gh api --method POST "repos/$REPO/environments/$name/deployment-branch-policies" \
      -f name="$branch" >/dev/null 2>&1 || true
  done
done

echo "Creating labels"
bash "$DIR/labels.sh"

echo "Done."
