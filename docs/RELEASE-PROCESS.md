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

1. Specification Writer — Product Manager
2. Solution Architect — Architect
3. Engineering Manager — Engineering Manager
4. Feature Coder — Coder
5. Test Author — Tester
6. QA Verifier — QA
7. Code Reviewer — Code Reviewer
8. Security Reviewer — Security Auditor
9. Technical Auditor — Release Reviewer
10. Release Notes Author — Release Engineer
11. Release Gatekeeper — Release Reviewer

## Transitions

- Specification Writer → Solution Architect: Always
- Solution Architect → Engineering Manager: Always
- Engineering Manager → Feature Coder: Always
- Feature Coder → Test Author: Always
- Test Author → Feature Coder: If failed
- Test Author → QA Verifier: If passed
- QA Verifier → Feature Coder: If failed
- QA Verifier → Code Reviewer: If passed
- Code Reviewer → Feature Coder: If changes required
- Code Reviewer → Security Reviewer: If approved
- Security Reviewer → Feature Coder: If failed
- Security Reviewer → Technical Auditor: If passed
- Technical Auditor → Feature Coder: If changes required
- Technical Auditor → Release Notes Author: If approved
- Release Notes Author → Release Gatekeeper: Always
- Release Gatekeeper → Feature Coder: If blocked
