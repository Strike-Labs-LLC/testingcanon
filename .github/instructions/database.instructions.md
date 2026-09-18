---
name: "Database standards"
description: "Database schema, migration, naming, and access-control standards."
applyTo: "{migrations,db,prisma,supabase}/**/*.{sql,ts,js,py}"
---

# Database standards

- Every schema change ships as a forward migration with a documented rollback.
- Migrations must be backwards compatible with the currently deployed release.
- Never write destructive statements without an explicit, reviewed plan.
- Name tables and columns in lowercase snake_case; keep naming consistent.
- Every table carries a stable id, created_at, updated_at, and tenant scope where applicable.
- Row-level access rules are part of the migration, not an afterthought.
