---
name: "Desktop runtime standards"
description: "Desktop runtime, packaging, and native-bridge standards."
applyTo: "{desktop,electron,src-tauri,tauri}/**/*.*"
---

# Desktop runtime standards

- Keep native capability behind an explicit, audited bridge API.
- Never expose file system, shell, or process APIs directly to renderer code.
- Sign and version every packaged build; record the release SHA.
- Desktop runtime: Electron.
