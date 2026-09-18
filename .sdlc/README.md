# .sdlc — canonical SDLC specification

Everything in `AGENTS.md`, `.github/`, and `docs/` is compiled from these files by the
Autonomous code change pipeline builder.

| File | Purpose |
| --- | --- |
| `blueprint.yml` | Vendor-neutral specification of the whole pipeline |
| `blueprint.json` | The same blueprint, re-importable into the builder |
| `lifecycle.yml` | Stages, order, entry, exits, and transitions |
| `quality-gates.yml` | Merge and release gates |
| `agent-routing.yml` | Stage-to-agent routing for programmatic assignment |
| `compliance.yml` | Security posture, audit events, change control |
| `github-setup.json` | Repository settings that are not files (rulesets, environments, labels) |

To change the pipeline, edit the blueprint in the builder and re-export. Do not hand-edit
the generated files.
