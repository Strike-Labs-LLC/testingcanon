# Release process

> Scaffold generated from the SDLC blueprint. Fill in the sections marked TODO.

## Gates

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: unit (required), integration (required), e2e (optional).
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments are automatic once gates pass.
- Staging deploys automatically from the default branch.

## Stages

1. Feature Coder — Coder
2. Code Reviewer — Code Reviewer
3. Test Suite Runner — Tester
4. Deployment Runner — DevOps Deploy

## Transitions

- Feature Coder → Code Reviewer: Always
- Code Reviewer → Test Suite Runner: If approved
- Code Reviewer → Feature Coder: If changes required
- Test Suite Runner → Deployment Runner: If passed
- Test Suite Runner → Feature Coder: If failed
