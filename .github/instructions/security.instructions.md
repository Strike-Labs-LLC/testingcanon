---
name: "Security-sensitive code"
description: "Standards for security-sensitive code such as auth, payments, and billing."
applyTo: "**/{auth,security,payments,billing}/**/*.*"
---

# Security-sensitive code

- Changes here require a security review before merge.
- Never log tokens, passwords, or personal data.
- Use vetted libraries for cryptography, hashing, and session handling.
- Fail closed: on any error, deny access.
- Add a regression test for every security fix.
