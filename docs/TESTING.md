# Testing

> Scaffold generated from the SDLC blueprint. Fill in the sections marked TODO.

## Requirements

- Unit: required
- Integration: required
- End-to-end: optional

## Running the suite

```bash
bash .canon/require-script.sh test
bash .canon/require-script.sh test:integration
bash .canon/require-script.sh test:e2e
```

A check the blueprint marks as required fails when the matching npm script is missing.
Pass `optional` as a second argument to allow a skip.

## Standards

See `.github/instructions/tests.instructions.md`.
