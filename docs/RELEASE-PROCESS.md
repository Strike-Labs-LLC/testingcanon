# Release process

> Scaffold generated from the SDLC blueprint. Fill in the sections marked TODO.

## Gates

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: unit (required), integration (required), e2e (optional).
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments require explicit human approval.
- Staging deploys automatically from the default branch.

## Stages

1. Bug Triage — Product Manager
2. Coder — Coder
3. Code Reviewer — Code Reviewer
4. Fix Verification — Tester
5. Bug Closeout — Engineering Orchestrator

## Transitions

- Bug Triage → Coder: Always
- Coder → Code Reviewer: Always
- Coder → Fix Verification: Always
- Code Reviewer → Bug Closeout: If approved
- Fix Verification → Bug Closeout: If passed
- Code Reviewer → Coder: If changes required
- Fix Verification → Coder: If failed
