---
name: "Infrastructure standards"
description: "Infrastructure, CI/CD, secrets, and least-privilege standards."
applyTo: "{infra,terraform,deploy,charts,.github/workflows}/**/*.{tf,yml,yaml,hcl}"
---

# Infrastructure standards

- Infrastructure changes are reviewed by an owner listed in CODEOWNERS.
- No credentials in source; use the platform secret store.
- Pin action and image versions; never track a floating tag.
- Grant least privilege for every role, token, and service account.
- Production changes require the environment approval configured in GitHub.
