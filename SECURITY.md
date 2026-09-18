<!-- canon:begin — Canon owns this region. Edits inside it are replaced on reinstall. -->
# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub Security Advisories on this
repository. Do not open a public issue. Expect an acknowledgement within two business days.

## Controls in this repository

- Secret scanning: required
- Dependency scanning: required
- Static analysis: none
- Pull requests required: yes
- Minimum reviewers: 1
- Production approval required: yes

## Agent restrictions

Agents operating in this repository are bound by `AGENTS.md` and the deny rules in
`.github/hooks/security.json`. They may not read, write, or print secrets, and may not
run destructive commands against shared environments.
<!-- canon:end -->
