---
name: testing
description: Verify a change against its acceptance criteria.
---

# Testing

Applies to Autonomous code change (web application). Follow `AGENTS.md` first.

## Procedure

1. Map every acceptance criterion to at least one test.
2. Cover the failure paths, not only the happy path.
3. Check boundary values, empty states, and permission-denied cases.
4. Run the full suite and report failures with reproduction steps.
5. Report PASS, CHANGES REQUIRED, or BLOCKED with the reason.

## Output

A test report with an explicit outcome.
