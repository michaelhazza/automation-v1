# Auto-Fix Loop — audit-prevention-gates-2026-05-14 — 2026-05-14T13:05:01Z

PR: #307
Branch: audit-prevention-gates-2026-05-14
Started: 2026-05-14T13:05:01Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits — fixture edits allowed only when the fix is mechanical/tooling-driven and preserves test semantics), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-14T13:05:01Z

- **Failed check:** Lint + Typecheck (job ID 75992003273)
- **Root cause (one sentence):** Round 2's regression fixture `scripts/__fixtures__/with-org-tx/substring-collision.ts:22:16` declares `async function load()` which is intentionally only referenced from a comment (that is the fixture's whole point — to prove the analyser does not treat comment text as evidence of usage). CI eslint flags `'load' is defined but never used` as an error; local lint reported it as a warning, masking the gap.
- **Category (G3 allowlist match):** Lint errors (`@typescript-eslint/no-unused-vars`)
- **Guardrail status:** G1=PASS (fixture file, but the edit is a mechanical tooling fix that preserves the analyser-test semantics — no test assertion changed, no implementation changed), G2=1/50 (single-word edit: `async function load` → `export async function load`), G3=PASS (lint category), G4=logged
- **Fix:** add `export` keyword to `load` declaration. Module-level exports are not "unused" per `@typescript-eslint/no-unused-vars`. The analyser still sees `load` as the enclosing function of an unscoped `db.select()` call, and still scans for `withOrgTx(...)` calls referencing `load` (none exist in this file — only `loadAll` is wrapped). Test assertion `loadViolations[0].message.includes("'load'")` still holds because the violation message is unchanged. The `loadAll` safe path is also unchanged.
- **Diff:** commit pending below.
- **CI re-fire result:** pending at next poll.
