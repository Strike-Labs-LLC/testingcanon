---
name: "AI integration standards"
description: "Standards for model calls, prompts, and AI output handling."
applyTo: "**/{ai,llm,prompts,agents}/**/*.*"
---

# AI integration standards

- Pin the model name and record it with every request.
- Validate model output against a schema before it reaches business logic.
- Never send secrets, credentials, or personal data in a prompt.
- Set timeouts, retries, and a deterministic fallback for every model call.
- AI integration: None.
