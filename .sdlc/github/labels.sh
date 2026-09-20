#!/usr/bin/env bash
set -euo pipefail

gh label create "feature" --color 1f6feb --description "New capability" --force
gh label create "bug" --color d1242f --description "Defect" --force
gh label create "chore" --color 6e7781 --description "Routine maintenance" --force
gh label create "tech-debt" --color 8250df --description "Maintainability work" --force
gh label create "security" --color bf3989 --description "Security work" --force
gh label create "needs-triage" --color 9a6700 --description "Awaiting triage" --force
gh label create "needs-info" --color bf8700 --description "Blocked on missing information" --force
gh label create "ready-for-design" --color 0969da --description "Requirements approved" --force
gh label create "ready-for-development" --color 1a7f37 --description "Design approved" --force
gh label create "dependencies" --color 6e7781 --description "Dependency updates" --force
gh label create "ci" --color 6e7781 --description "Pipeline changes" --force
gh label create "canon:start" --color 0969da --description "Starts a Canon orchestration run" --force
gh label create "canon-run" --color 0e8a16 --description "Canon orchestration run" --force
gh label create "awaiting-human" --color bf8700 --description "A human gate is open on this run" --force
gh label create "run-completed" --color 1a7f37 --description "Canon run finished successfully" --force
gh label create "run-failed" --color d1242f --description "Canon run failed" --force
gh label create "resource-conflict" --color d1242f --description "Two stages own the same resource in a run" --force
gh label create "sla-breached" --color d1242f --description "A human gate passed its response time" --force
gh label create "design-approved" --color 1a7f37 --description "Technical approach accepted" --force
gh label create "design-changes-required" --color bf8700 --description "Technical approach needs rework" --force
gh label create "changes-requested" --color bf8700 --description "Review requested changes" --force
gh label create "review-approved" --color 1a7f37 --description "Review approved the change" --force
gh label create "security-review" --color bf3989 --description "Needs a security review" --force
gh label create "docs-drift" --color 8250df --description "Documentation no longer matches the code" --force
gh label create "release-readiness" --color 0969da --description "Release readiness report" --force
gh label create "technical-audit" --color 8250df --description "Repository audit findings" --force
