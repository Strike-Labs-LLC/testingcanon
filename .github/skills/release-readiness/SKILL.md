---
name: release-readiness
description: Decide whether a candidate build may be released.
---

# Release readiness

Applies to Bug triage fix verify (web application). Follow `AGENTS.md` first.

## Procedure

1. Confirm every required gate passed on the candidate commit.
2. Review migrations and their rollback path.
3. Confirm monitoring and alerting cover the change.
4. Write the release notes and the rollback plan.
5. Report ACCEPTED FOR APPROVAL or RELEASE BLOCKED with the specific risk.

## Output

A release readiness decision with notes and a rollback plan.
