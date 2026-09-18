---
name: security-review
description: Assess a change for security and privacy risk.
---

# Security review

Applies to Autonomous feature delivery (web application). Follow `AGENTS.md` first.

## Procedure

1. Identify new inputs, outputs, and trust boundaries.
2. Check authentication and authorization on every new path.
3. Check for injection, unsafe deserialization, and path traversal.
4. Check dependency changes for known vulnerabilities and license risk.
5. Confirm no secrets, tokens, or personal data appear in code, logs, or fixtures.
6. Rate each finding by severity and give a concrete remediation.

## Output

A security report with severities and remediations.
