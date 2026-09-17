---
name: "Frontend standards"
description: "Frontend component, state, accessibility, and design-token standards."
applyTo: "{src,app,web,client}/**/*.{ts,tsx,js,jsx,vue,svelte}"
---

# Frontend standards

- Keep components small, presentational, and free of business logic.
- Fetch data through the shared data layer, never with ad-hoc calls inside components.
- Every interactive element needs an accessible name and keyboard support.
- Use design tokens; never hardcode colors, spacing, or font sizes.
- Handle loading, empty, and error states explicitly for every async view.
