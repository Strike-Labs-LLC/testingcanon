# Testing

> Scaffold generated from the SDLC blueprint. Fill in the sections marked TODO.

## Resolved test plan

Canon resolved these commands from this repository. A tier with no command has no
job, no required check, and no hook.

- Unit: none — Unit: none — this repository has no package manifest.
- Integration: none — Integration: none — this repository has no package manifest.
- E2E: none — E2E: none — this repository has no package manifest.

## Running the suite

```bash
npx --yes html-validate "**/*.html"
npx --yes linkinator . --recurse --silent --skip "^https?://" --skip "node_modules|[.]canon|[.]sdlc"
```

## Standards

No testing standards file is generated for a repository without tests.
