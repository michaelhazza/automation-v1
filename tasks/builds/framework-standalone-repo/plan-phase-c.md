# Plan — framework-standalone-repo Phase C

> **Scope:** Steps 6–10 of `spec.md` § 8 Migration plan. Add `claude-code-framework` as a submodule, classify drift between the deployed `.claude/` tree and the published bundle, run `sync.js --adopt`, remove the in-repo `setup/portable/` bundle, point `CLAUDE.md` at the submodule, validate.
>
> **Branch:** `claude/review-dev-agent-setup-6SC3d` (carries Phase B prep commits `47048c35`, `3b154af0`).
>
> **Prereq verified:** `michaelhazza/claude-code-framework` exists at v2.4.0, default branch `main`, bundle published.

## Contents

- Substitution map
- Chunk 1 — Preflight classification (read-only)
- Chunk 2 — Conditional backport (only if Chunk 1 finds backportable drift)
- Chunk 3 — Add the submodule
- Chunk 4 — Self-adopt (two-pass)
- Chunk 5 — Remove the in-repo bundle
- Chunk 6 — Update CLAUDE.md
- Chunk 7 — Validate
- Chunk 8 — Commit + handoff update
- Risks
- Out of scope

---

## Substitution map (locked from inspection of deployed files)

| Placeholder | Value |
|---|---|
| `PROJECT_NAME` | `Automation OS` |
| `PROJECT_DESCRIPTION` | `an AI agent orchestration platform` |
| `STACK_DESCRIPTION` | `React, Express, Drizzle ORM (PostgreSQL), and pg-boss for job scheduling` |
| `COMPANY_NAME` | `Synthetos` |

Source: `.claude/agents/architect.md`, `.claude/agents/pr-reviewer.md`, `docs/frontend-design-principles.md` (deployed copies) cross-referenced against bundle templates with `{{...}}` placeholders.

---

## Chunk 1 — Preflight classification (read-only)

Author `scripts/framework-preflight-diff.mjs` (one-shot script, deleted in Chunk 8):

- Copy `applySubstitutions` + `normaliseContent` + `hashContent` constants from `setup/portable/sync.js` (~30 LOC).
- For each glob in `setup/portable/manifest.json#managedFiles`, expand against `setup/portable/` (bundle) and against repo root (deployed).
- For each pair `(bundlePath, deployedPath)`:
  1. Read bundle content. Apply substitutions iff `entry.substituteAt !== 'never'`. Normalise.
  2. Read deployed content. Normalise.
  3. Compare. Classify: **CLEAN**, **MISSING-DEPLOYED**, **MISSING-BUNDLE**, **DIFFERS**.
- For `DIFFERS`, emit a unified diff per file (3-line context). Full report → `tasks/builds/framework-standalone-repo/preflight-report.md`.
- Skip `doNotTouch` paths and `tasks/**` (manifest excludes them).

**Output:** human-readable report grouped by status; counts per category at the top.

**Acceptance:** report exists; operator (me) classifies each DIFFERS entry into:
- **(a) project customisation** — accept; yields `.framework-new` siblings on rebaseline adopt; discardable.
- **(b) framework drift to backport** — push up to `claude-code-framework`; bump to v2.4.1.
- **(c) accidental drift** — accept bundle version; overwrite locally before adopt.

---

## Chunk 2 — Conditional backport

If Chunk 1 finds any **bucket-b** entries:

- Clone `michaelhazza/claude-code-framework` to `/tmp/claude-code-framework`.
- Apply each bucket-b change on a branch in that repo.
- Bump `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` to **v2.4.1**.
- Push branch, open PR, merge, tag `v2.4.1`, push tag.
- Submodule in Chunk 3 pins to `v2.4.1`.

If zero bucket-b entries: skip entirely. Submodule pins to `v2.4.0`.

**Acceptance:** if executed, `gh api repos/michaelhazza/claude-code-framework/tags` shows `v2.4.1`; CHANGELOG documents the backport.

---

## Chunk 3 — Add the submodule

```bash
git submodule add https://github.com/michaelhazza/claude-code-framework.git .claude-framework
git -C .claude-framework checkout v2.4.X   # tag chosen in Chunk 2
git add .gitmodules .claude-framework
```

No commit yet — bundle with Chunks 4–7 into one Phase C commit.

**Acceptance:** `.claude-framework/` checked out at the pinned tag; `.gitmodules` records the URL; `sync.js`, `manifest.json`, etc. visible inside `.claude-framework/`.

---

## Chunk 4 — Self-adopt (two-pass)

**Pass 1 (first-run, empty substitutions):**

```bash
node .claude-framework/sync.js --adopt
```

Catalogues every deployed managed file by hash. Writes `.claude/.framework-state.json` with `substitutions: {}` and `files: { … }`.

**Pass 2 (rebaseline, populated substitutions):**

Edit `.claude/.framework-state.json`:
```json
"substitutions": {
  "PROJECT_NAME": "Automation OS",
  "PROJECT_DESCRIPTION": "an AI agent orchestration platform",
  "STACK_DESCRIPTION": "React, Express, Drizzle ORM (PostgreSQL), and pg-boss for job scheduling",
  "COMPANY_NAME": "Synthetos"
}
```

Re-run `node .claude-framework/sync.js --adopt`. Sync compares each deployed file against `applySubstitutions(bundle, populated_map)`. Clean matches → rewritten (lossless, identical content). Mismatches → flagged customised + `.framework-new` sibling.

**Acceptance:** `.claude/.framework-state.json` has populated map; customised-count matches Chunk 1 bucket-a tally; `.framework-new` siblings discarded (already-authoritative in deployed tree).

---

## Chunk 5 — Remove the in-repo bundle

```bash
git rm -rf setup/portable/
git rm -f scripts/build-portable-framework.ts
git rm -f scripts/lift-framework-to-standalone-repo.sh   # lift done; framework repo exists
```

Sweep CI: `.github/workflows/ci.yml` has a `portable_framework_tests` job referencing `setup/portable/`. Remove the job (framework repo runs its own CI). Repointing CI at the submodule is deferred.

Sweep docs: `grep -rn "setup/portable" CLAUDE.md architecture.md DEVELOPMENT_GUIDELINES.md docs/ references/ KNOWLEDGE.md scripts/`. Update or delete every match. Tasks-archive references stay (history).

**Acceptance:** `setup/portable/` absent; CI job removed; grep clean across reference docs; `npm run lint && npm run typecheck && npm run build:server && npm run build:client` all pass (bundle wasn't imported by app code).

---

## Chunk 6 — Update CLAUDE.md

Update `### Framework version` (currently points at `setup/portable/.claude/`):

> Canonical version + changelog: lives in the [claude-code-framework](https://github.com/michaelhazza/claude-code-framework) repo, mounted here as a submodule at `.claude-framework/`. Adoption state: `.claude/.framework-state.json` (per-file hashes, framework version, substitutions). Deployment marker: `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` (records what's deployed; may lag framework `main`). Upgrade: `git submodule update --remote .claude-framework && node .claude-framework/sync.js`. Detail: `.claude-framework/.claude/CHANGELOG.md § Upgrade protocol`.

Also rewrite any inline `setup/portable/sync.js` references → `.claude-framework/sync.js`.

**Acceptance:** `CLAUDE.md` grep clean for `setup/portable`; `validate-setup` agent (Chunk 7) passes.

---

## Chunk 7 — Validate

```bash
node .claude-framework/sync.js --check
```

Expected: exit 0 (framework adopted, no drift). Invoke `validate-setup` agent (now resident at `.claude-framework/.claude/agents/validate-setup.md`).

If `--check` returns non-zero, the failures are real drift — investigate before continuing.

**Acceptance:** `sync.js --check` exit 0; `validate-setup` reports green; `npm run lint && npm run typecheck` still pass; targeted grep confirms no test or script imports from `setup/portable/`.

---

## Chunk 8 — Commit + handoff update

Single commit on the branch:
```
feat(framework): adopt claude-code-framework as submodule (vX.Y.Z); remove in-repo bundle
```

Files in this commit:
- `.gitmodules` (added)
- `.claude-framework` (submodule pointer)
- `.claude/.framework-state.json` (added)
- `setup/portable/**` (deleted, ~150 files)
- `scripts/build-portable-framework.ts` (deleted)
- `scripts/lift-framework-to-standalone-repo.sh` (deleted)
- `scripts/framework-preflight-diff.mjs` (deleted — one-shot)
- `.github/workflows/ci.yml` (portable_framework_tests job removed)
- `CLAUDE.md` (framework-version section updated; grep-clean of `setup/portable`)
- `architecture.md` / `DEVELOPMENT_GUIDELINES.md` / `docs/**` / `references/**` / `KNOWLEDGE.md` (any `setup/portable` references updated)

Update `tasks/builds/framework-standalone-repo/handoff.md` with "Phase C complete" section: pinned framework version, customised-file count, bucket-b backports executed (if any), link to preflight report.

Update `tasks/current-focus.md` active block to describe this branch with status `REVIEWING` (PR pending) or `MERGE_READY` after Phase C lands.

**Acceptance:** clean commit on the branch; handoff + current-focus updated; preflight-report.md retained as audit trail.

---

## Risks specific to Phase C

| Risk | Mitigation |
|---|---|
| Empty-substitution first-run --adopt catalogues files with current-shape hash; rebaseline pass would re-flag them if hashes don't line up. | Two-pass adopt is the workflow. Bucket-a tally from Chunk 1 is the ground truth — if rebaseline customised-count diverges, stop and reconcile. |
| `verify-rls-coverage` or another grep-based CI gate scans `setup/portable/` and fails after removal. | Chunk 5 sweeps `scripts/gates/`, `scripts/verify-*` for `setup/portable` references before commit. |
| Submodule URL inconsistency across machines (SSH vs HTTPS). | `.gitmodules` uses canonical HTTPS URL; local SSH override via `~/.gitconfig insteadOf` if needed. |
| Indirect refs to `setup/portable/` in CLAUDE.md / architecture.md / migration steps. | Chunk 5 grep sweep across all reference docs. |
| `tasks/**` artefacts under `framework-standalone-repo/` are historical; should NOT be substituted or moved. | `tasks/**` in manifest's `doNotTouch`; sync excludes. Verified. |

---

## Out of scope

- Phase D (first NEW target repo onboards).
- Phase E/F.
- Repointing CI to run framework tests against the submodule.
- Renaming the branch — disruptive given prep commits already there; PR title + final commit message carry meaning.

---

## End of plan

