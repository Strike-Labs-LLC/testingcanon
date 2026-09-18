---
name: "Backend standards"
description: "Backend API, validation, authorization, and error-handling standards."
applyTo: "{src,server,api,services}/**/*.{ts,js,py,go,java,rb,cs}"
---

# Backend standards

- Validate and type all external input at the request boundary.
- Keep business logic out of controllers and route handlers.
- All data access goes through the repository or service layer.
- Authorize every endpoint explicitly; never rely on the client to hide actions.
- Return structured errors with a stable machine-readable code.
- Every endpoint needs an integration test covering success and denial.
