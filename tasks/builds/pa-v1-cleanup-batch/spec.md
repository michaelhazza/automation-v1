---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: pa-v1-cleanup-batch
output_location: tasks/builds/pa-v1-cleanup-batch/spec.md
---

# Wave 2 Session D — Personal Assistant V1 cleanup batch

Single coordinated PR closing the 12 spec-conformance REQ items + 1 adversarial item deferred from Personal Assistant V1 (PR #291, merged 2026-05-12).

This build is NOT a refactor. It is a multi-item conformance batch with schema, service, and frontend touches.

---

## 1. Scope

Closes the following `tasks/todo.md` items from sections "Deferred from spec-conformance review — personal-assistant-v1 (2026-05-12)" and "Deferred adversarial findings — personal-assistant-v1 (2026-05-12)":

- **Backend / schema (8)**: REQ-C1, REQ-C3, REQ-C4, REQ-CAL2, REQ-CAL3-naming, REQ-T8, REQ-EA1, REQ-EA3, REQ-M9
- **Frontend (3)**: REQ-EA4, REQ-EA5, REQ-M15
- **Adversarial (1)**: createDraftWithProposal non-atomic

**Total: 12 items.**

## 2. Goals

1. Conform every backend/schema REQ to spec §<ref> as the conformance log named.
2. Conform every frontend REQ to spec §<ref> as the conformance log named.
3. Fix the createDraftWithProposal non-atomic adversarial finding (wrap in transaction OR document race semantics).
4. No behaviour change beyond what each REQ's contract requires.
5. PA-V1 spec-conformance log shows zero remaining open REQ items after this PR merges.

## 3. Non-Goals

- No changes to PA-V1 spec or PA-V2 spec.
- No PA-V2 work — PA-V2 has its own track.
- No expansion of PA-V1 features beyond what each REQ's spec section names.
- No drive-by lint cleanup, no commingling with other refactors.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary` per `docs/spec-context.md`.
- PA-V1 spec is the authoritative contract. Each REQ item below references its spec section directly.
- The PA-V1 subsystem touches: `server/services/{personalAssistant*, calendar*, voice*, externalAgent*}`, `server/routes/{personal-*, calendar-*}`, `shared/types/personalAssistant.ts`, `client/src/pages/personal-*`, `client/src/components/personal-*`, `migrations/*`. Architect's chunk-0 sweep enumerates the exact file set.
- The architect's chunk 0 confirms each REQ's source line in the spec-conformance log (`tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12*.md`) before drafting fixes.
## 5. Items — Backend / schema

For each item: architect reads the spec section the conformance log named, drafts the minimal fix, implements, verifies via targeted Vitest if pure-helper logic.

### 5.1. REQ-C1 — `ExternalSourceTriggerEvent` schema simplified from spec §7.1

Fix: restore the full schema shape per spec §7.1. If product decided the simplified shape is correct, update the spec instead — but default is to conform code to spec.

Acceptance: schema matches spec §7.1; targeted Vitest for trigger-event parsing passes.

### 5.2. REQ-C3 — `slack.list_channels` Zod schema missing `types` filter

Fix: add `types` filter to Zod schema per spec.

Acceptance: Zod accepts the `types` field; targeted Vitest passes.

### 5.3. REQ-C4 — `voice_profiles` schema diverges from spec §7.4 contract

Fix: align schema with spec §7.4. Migration adds/renames columns as needed.

Acceptance: migration lands; schema matches spec §7.4.

### 5.4. REQ-CAL2 — Calendar `create_event` / `update_event` risk tier mismatch

Fix: align risk-tier assignment with spec.

Acceptance: risk-tier matches spec for both action types.

### 5.5. REQ-CAL3-naming — Calendar write-action error codes differ from spec §8.4

Fix: align error code names with spec §8.4.

Acceptance: error codes match spec; targeted grep confirms no legacy names remain in calendar service.

### 5.6. REQ-T8 — Dedup key formats diverge from spec §7.1

Fix: align dedup key format with spec §7.1.

Acceptance: dedup key generation matches spec; targeted Vitest passes.

### 5.7. REQ-EA1 — EA default skill allowlist incomplete vs spec §13.2

Fix: extend the default allowlist to include every skill spec §13.2 names.

Acceptance: allowlist matches spec; targeted Vitest passes.

### 5.8. REQ-EA3 — Partial unique index axis differs from spec §13.4

Fix: migration adjusts the partial unique index axis per spec §13.4.

Acceptance: migration lands; index matches spec.

### 5.9. REQ-M9 — Stall job 7-day proposal expiry path

Fix: implement the 7-day expiry path per spec section. Stall job marks proposals as expired after 7 days.

Acceptance: targeted Vitest covers the expiry path.

## 6. Items — Frontend

### 6.1. REQ-EA4 — EA `home_widget` refreshPolicy differs from spec §13.1

Fix: align `refreshPolicy` with spec §13.1 (likely change from interval-based to event-based or vice versa per spec).

Acceptance: refresh policy matches spec.

### 6.2. REQ-EA5 — EA `home_widget.titleTemplate` hardcoded

Fix: parameterise the title template per spec. Likely: read from config OR derive from EA state.

Acceptance: title is derived, not hardcoded; targeted Vitest passes.

### 6.3. REQ-M15 — Personal nav group placement

Fix: place the Personal nav group at the spec-mandated position in `client/src/components/Layout.tsx` (or equivalent post-#313 split).

Acceptance: visual placement matches spec mockup; manual operator confirmation in the PR.
## 7. Items — Adversarial

### 7.1. createDraftWithProposal non-atomic (likely-hole)

Source: PA-V1 adversarial finding.

Fix: wrap `createDraftWithProposal` in a single transaction so the draft + proposal land atomically (or neither does).

File: architect identifies during chunk-0 sweep — likely in the PA service or proposal service.

Acceptance: targeted Vitest with a forced mid-transaction failure confirms both rows roll back together.

## 8. Migrations

Expected migrations (architect numbers sequentially):

| Migration | Purpose | Items |
|---|---|---|
| `<NNNN>_voice_profiles_schema_align.sql` (+ down) | Align voice_profiles to spec §7.4 | REQ-C4 |
| `<NNNN>_ea_partial_unique_index.sql` (+ down) | Adjust partial unique index axis | REQ-EA3 |
| `<NNNN>_pa_dedup_key_format.sql` (+ down) | OPTIONAL — only if dedup key is stored | REQ-T8 |

Each migration uses `IF EXISTS` / `IF NOT EXISTS` guards and has a paired `.down.sql`.

## 9. Acceptance Criteria

A build is complete when ALL of the following hold:

1. Every item in §5, §6, §7 is implemented per its fix description.
2. `npm run build:server` exits 0.
3. `npm run lint` exits 0.
4. New migrations land with paired `.down.sql`.
5. PA-V1 spec-conformance log shows zero remaining open REQ items.
6. `tasks/todo.md` items listed in §1 marked `[status:closed:pr:<num>]` in the merge commit.
7. The Personal nav group placement is visually confirmed by the operator in the PR (frontend acceptance).

## 10. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: spec-conformance log re-read + file-set sweep + migration numbering + plan write
- **Chunks 1-3**: backend / schema items (9 items, group by file)
- **Chunk 4**: frontend items (3 items)
- **Chunk 5**: adversarial atomicity fix
- **Chunk 6**: spec-conformance + pr-reviewer + final review pass

## 11. Out of Scope

- PA-V1 worth-confirming items (3) — `dispatch()` org filter, dispatch rate-cap scope, `assembleThreadSummaryPrompt` prompt-injection surface. These stay v2-backlog with `[status:v2-backlog]` rationale.
- PA-V2 work — separate track, separate spec.
- LAEL integration with PA-V1 — separate v2 work.
