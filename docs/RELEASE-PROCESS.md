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

1. Delivery Orchestrator — Engineering Orchestrator
2. Requirements Analyst — Product Manager
3. Acceptance Criteria Author — Product Manager
4. Feature Coder — Coder
5. Code Reviewer — Code Reviewer
6. Test Author — Tester
7. QA Verifier — QA
8. Release Gatekeeper — Release Reviewer
9. Deployment Runner — DevOps Deploy

## Transitions

- Delivery Orchestrator → Requirements Analyst: Always
- Requirements Analyst → Acceptance Criteria Author: Always
- Acceptance Criteria Author → Feature Coder: Always
- Feature Coder → Code Reviewer: Always
- Feature Coder → Test Author: Always
- Code Reviewer → Feature Coder: If changes required
- Test Author → Feature Coder: If failed
- Code Reviewer → QA Verifier: If approved
- Test Author → QA Verifier: If passed
- QA Verifier → Feature Coder: If failed
- QA Verifier → Release Gatekeeper: If passed
- Release Gatekeeper → Deployment Runner: If approved
- Release Gatekeeper → Feature Coder: If blocked
