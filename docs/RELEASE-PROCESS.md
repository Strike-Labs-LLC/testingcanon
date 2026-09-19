# Release process

> Scaffold generated from the SDLC blueprint. Fill in the sections marked TODO.

## Gates

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: this repository has no test command; no test gate is enforced.
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments are automatic once gates pass.
- Staging deploys automatically from the default branch.

## Stages

1. Requirements Analyst — Product Manager
2. Acceptance Criteria Author — Product Manager
3. Feature Coder — Coder
4. Test Author — Tester
5. QA Verifier — QA
6. Code Reviewer — Code Reviewer
7. Release Gatekeeper — Release Reviewer

## Transitions

- Requirements Analyst → Acceptance Criteria Author: Always
- Acceptance Criteria Author → Feature Coder: Always
- Feature Coder → Test Author: Always
- Test Author → Feature Coder: If failed
- Test Author → QA Verifier: If passed
- QA Verifier → Feature Coder: If failed
- QA Verifier → Code Reviewer: If passed
- Code Reviewer → Feature Coder: If changes required
- Code Reviewer → Release Gatekeeper: If approved
- Release Gatekeeper → Feature Coder: If blocked
