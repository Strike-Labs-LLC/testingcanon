---
name: "Testing standards"
description: "Test structure, coverage, and reliability standards."
applyTo: "**/*.{test,spec}.{ts,tsx,js,jsx,py,go}"
---

# Testing standards

- One behaviour per test; the test name states the behaviour.
- Assert on observable behaviour, not implementation details.
- Cover failure and permission-denied paths, not only the happy path.
- No sleeps or network calls to third parties; use fixtures and fakes.
- A skipped or deleted test requires a written justification in the pull request.
- Unit tests: required.
- Integration tests: required.
- End-to-end tests: optional.
