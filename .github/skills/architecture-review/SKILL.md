---
name: architecture-review
description: Evaluate a technical design before implementation starts.
---

# Architecture review

Applies to Autonomous production engineering (web application). Follow `AGENTS.md` first.

## Procedure

1. Confirm the design satisfies every acceptance criterion.
2. Check data model changes, migrations, and backwards compatibility.
3. Check boundaries: which module owns which responsibility.
4. Identify failure modes, retries, and idempotency needs.
5. Compare against existing patterns in the repository; prefer the boring option.
6. Record the decision as an ADR under docs/adr/ when it is hard to reverse.

## Output

An approval or a specific list of design changes required.
