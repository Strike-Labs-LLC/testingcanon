<!-- canon:begin — Canon owns this region. Edits inside it are replaced on reinstall. -->
# Contributing

## Workflow

1. Open an issue using one of the forms in `.github/ISSUE_TEMPLATE/`.
2. Wait for triage to confirm the item meets the Definition of Ready in `AGENTS.md`.
3. Branch from `main` using `type/short-description`.
4. Implement the change with tests and documentation.
5. Open a pull request using the template. Fill in every gate.
6. Address review feedback until the required approvals are recorded.

## Rules

- Branching: trunk based.
- All changes ship through a pull request with at least 1 approving review(s).
- Tests: unit (required), integration (required), e2e (optional).
- Security scanning: secret scanning (required), dependency scanning (required).
- Documentation: architecture (required), api (required), runbook (optional).
- Production deployments require explicit human approval.
- Staging deploys automatically from the default branch.

## Working with agents

Agents follow `AGENTS.md` and the stage definitions in `.github/agents/`. If an agent's
output is wrong, fix the blueprint and regenerate rather than editing generated files.
<!-- canon:end -->
