# System Skills — seed source only

As of Phase 0 of the Skill Analyzer v2 feature, system skills are stored in
the `system_skills` Postgres table. The `.md` files in this directory are a
**seed source** only — they exist so a fresh environment can populate the DB
on first setup, and so engineers can review skill metadata in source control.

**Runtime reads and writes go to the DB**, not these files. The
`systemSkillService` (`server/services/systemSkillService.ts`) is DB-backed.
The Skill Analyzer (`/api/system/skill-analyser/...`) writes new and updated
skills directly to the `system_skills` table.

## When to edit a `.md` file vs. the DB

- **Edit a `.md` file** when you are bootstrapping a new skill that has no
  corresponding TypeScript handler yet, or when you want a skill to be part
  of the seed set for fresh environments. Then run `npm run skills:backfill`
  to upsert the row into the DB.
- **Edit the DB row** (via the Skill Analyzer UI or via the
  `PATCH /api/system/skills/:slug` route for visibility) for any post-seed
  change. Re-running the backfill will OVERWRITE DB rows from the `.md`
  files, so do not edit a `.md` file for a runtime change you want to keep
  — the next backfill run would clobber it.

## Adding a new system skill

Two-step process — both must be in the same PR:

1. **Add the handler** in `server/services/skillExecutor.ts`. Each skill is
   one entry in the `SKILL_HANDLERS` registry constant. The key must match
   the slug you use in the `.md` file.
2. **Add the `.md` file** with the same slug as the filename. Frontmatter
   should include `name`, `description`, `isActive`, and `visibility` (one
   of `none`, `basic`, `full`). The body should include a `## Parameters`
   section (auto-parsed into the Anthropic tool definition) and an
   `## Instructions` section (injected into the agent's system prompt).

Then run `npm run skills:backfill` to upsert the DB row.

The server's startup validator (`validateSystemSkillHandlers` in
`server/services/systemSkillHandlerValidator.ts`) refuses to boot if any
active `system_skills` row references a `handler_key` that does not exist
in `SKILL_HANDLERS`. This is the fail-fast gate against the "data refers to
code" drift.

## Backfill script

Run on first setup or after editing seed files:

```bash
npm run skills:backfill
```

The script:
- Parses every `.md` file in this directory via the pure parser at
  `server/services/systemSkillServicePure.ts`.
- Validates that every slug resolves to a key in `SKILL_HANDLERS` — fails
  fast and exits non-zero on any unregistered slug, listing the offenders.
- Upserts each parsed row into `system_skills` by `slug`. Idempotent.

## See also

- `docs/skill-analyzer-v2-spec.md` §10 Phase 0 — full Phase 0 contract
- `server/services/systemSkillService.ts` — DB-backed service
- `server/services/skillExecutor.ts` — `SKILL_HANDLERS` registry
- `server/services/systemSkillHandlerValidator.ts` — startup validator
