# Plan — pa-v1-cleanup-batch

**Spec:** `tasks/builds/pa-v1-cleanup-batch/spec.md`
**Branch:** `claude/pa-v1-cleanup-batch`
**Build slug:** `pa-v1-cleanup-batch`
**Scope class:** Significant
**Highest migration on main:** `0359` (new migration starts at `0360`)
**Test-gate posture:** `static_gates_primary` (CI owns the full suite)

> **Executor notes.** Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

---

## Table of contents

1. Model-collapse check
2. Architecture Notes
   - 2.1 REQ-by-REQ spec-section quotes
   - 2.2 File-set enumeration
   - 2.3 REQ-M9 verification
   - 2.4 REQ-EA1 verification
   - 2.5 Adversarial atomicity file
   - 2.6 Migration numbering
   - 2.7 Risks and mitigations
3. Chunks
   - Chunk 0 — Architecture-notes anchor
   - Chunk 1 — voice_profiles schema alignment
   - Chunk 2 — Sidebar nav group re-order
   - Chunk 3 — Conformance log close-out + documentation pass
4. Risks and mitigations (consolidated)
5. Dependencies graph
6. Out of scope
7. Acceptance criteria

---

## 1. Model-collapse check

Not applicable. This is a multi-item conformance batch (DB column renames, Drizzle schema sync, service-mapping fix, frontend nav re-order). Nothing here is shaped like ingest → extract → transform → render; no step is doing work a frontier multimodal model could collapse into a single structured-output call. Standard CRUD / config-conformance work.

**Decision: reject collapse — feature is structural alignment, not pipeline-shaped.**

---

## 2. Architecture Notes

### 2.1 REQ-by-REQ spec-section quotes

For every REQ named in spec §1, the relevant PA-V1 spec quote is captured below verbatim from `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`. These are the contracts. Any divergence between this section and the spec text is a bug in this plan.

#### REQ-C1 — `ExternalSourceTriggerEvent` schema (spec §7.1)

> "**REQ-C1 amendment (2026-05-13): the as-built shape is a flat discriminated union — no outer envelope.** Each variant carries its identifying fields directly on the event object rather than nesting under `messageMetadata` / `eventMetadata` / `mentionMetadata`. The pre-amendment shape (nested metadata blocks) is rejected for V1; if a future spec needs the envelope back, it adds it explicitly."

**Status:** Spec was amended post-2026-05-12 to align with shipped code. Current `shared/types/externalSourceTrigger.ts` IS a flat discriminated union (three variants: `gmail_message_received`, `calendar_event_imminent`, `slack_mention`) — matches spec §7.1 post-amendment. **No code change required.**

#### REQ-C3 — `slack.list_channels` Zod `types` filter (spec §7.3)

> "`list_channels.input`: `{ types?: Array<'public_channel' | 'private_channel' | 'mpim' | 'im'> = ['public_channel'], excludeArchived: boolean = true }`."

**Status:** Current `shared/types/slackAction.ts:3-9` includes `types: z.array(z.enum(['public_channel','private_channel','mpim','im'])).default(['public_channel'])` plus `excludeArchived: z.boolean().default(true)`. Matches spec §7.3. **No code change required.**

#### REQ-C4 — `voice_profiles` schema alignment (spec §7.4 + §21.1)

> "**REQ-C4 amendment (2026-05-13): as-built schema simplifies the row — no separate `name` column (callers display by owner / scope), `sources` is an array column rather than a single-source enum, and the discriminated-on-source `sourceConfig` collapses into a single `source_config` jsonb that callers shape per-row.**
> - `sampleSize: int`
> - `lastDerivedAt: timestamptz`
> - `refreshConfig: jsonb` — caller-shaped per-row. V1 examples: `{ days: 30 }` for `'periodic'`; `{}` for `'manual'`.
> - `optOutAt: timestamptz | null`"

Spec §21.1 confirms DB column names: `sources text[]`, `source_config jsonb NOT NULL DEFAULT '{}'`, `sample_size int`, `last_derived_at timestamptz`, `refresh_policy text`, `refresh_config jsonb NOT NULL DEFAULT '{}'`, `opt_out_at timestamptz`.

**Status:** Real divergence. Current DB columns (migration 0328) are `sample_count`, `last_refreshed_at`, `opted_out_at`. Missing `source_config` and `refresh_config` columns entirely. Real schema migration required.

#### REQ-CAL2 — Calendar `create_event`/`update_event` risk tier (spec §8.2)

> "Tier 4 — `create_event` / `update_event` create / mutate records visible to attendees. Internal-record write, third-party visibility limited to invited attendees (not a customer-broadcast). Tier 4, not Tier 6, because the user is the calendar owner and the third-party visibility is consent-based (attendees opted in by accepting the invite)."

**Status:** Current `server/config/actionRegistry/calendar.ts` lines 58-79 (create_event) and 81-102 (update_event) carry `riskTier: 4` with `defaultGateLevel: 'review'`. Matches spec §8.2 row exactly. **No code change required.**

#### REQ-CAL3-naming — Calendar write-action error codes (spec §8.4)

> "**REQ-CAL3-naming amendment (2026-05-13): the handler emits per-state-machine error codes** rather than the umbrella `missing_draft_context`:
> - missing row → `DRAFT_NOT_FOUND` (404)
> - `ea_drafts.ownerUserId !== ctx.ownerUserId` → `DRAFT_OWNER_MISMATCH` (403)
> - proposal not approved → `DRAFT_NOT_APPROVED` (422)
> - send already in flight → `DRAFT_SEND_IN_FLIGHT` (409)"

**Status:** Spec was amended post-2026-05-12 to match shipped code. Current `server/services/calendar/calendarActionService.ts:170,181,188,195` use exactly these codes. The owner-userId mismatch check is present at line 178-183. **No code change required.**

#### REQ-T8 — Dedup key formats (spec §7.1)

> "**Dedup key (REQ-T8 amendment 2026-05-13).** Per-event-type shape, all canonicalised by `externalSourceTriggersPure.deriveDedupKey`:
> - `gmail_message_received` → `dedup_key = messageId`
> - `calendar_event_imminent` → `dedup_key = '{calendarEventId}@{startAt}@{minutesUntilStart}'`
> - `slack_mention` → `dedup_key = '{channelId}@{messageTs}'`"

**Status:** Current `server/services/triggers/externalSourceTriggersPure.ts:13-22` returns exactly these shapes. **No code change required.**

#### REQ-EA1 — EA default skill allowlist (spec §13.2)

> "`read_inbox, send_email, calendar.* (6), slack.* (6), read_data_source, fetch_url, scrape_structured, update_memory_block, notify_operator, ea.daily_briefing, ea.inbox_triage, ea.meeting_prep, ea.home_widget.summary`. Platform meta-skills are provided by `server/config/universalSkills.ts` and always in scope."

**Status:** Migration `0343_ea_home_widget_spec_align.sql` (already merged, lines 26-50) writes the full spec-conforming allowlist to `system_agents.default_org_skill_slugs`. Universal skills cover the rest. **No code change required.**

#### REQ-EA3 — Partial unique index axis (spec §13.4)

> "A defence-in-depth partial unique index `(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'` on `agents` table (REQ-EA3 amendment 2026-05-13 — uniqueness is per-org, not per-subaccount, because a single user has one EA across their entire org regardless of which subaccount context they enter)."

**Status:** Migration `0332_executive_assistant_seed.sql:64-66` already creates `agents_personal_assistant_per_user_idx ON agents(organisation_id, owner_user_id) WHERE slug = 'executive-assistant' AND deleted_at IS NULL`. Matches spec §13.4 amendment. **No code change required.**

#### REQ-M9 — Stall job 7-day proposal expiry (spec §20.4)

> "At 7 days... the PROPOSAL row is **system-rejected** — transitioned to `status = 'rejected'` with `metadata_json.systemExpired = true` + `metadata_json.expired_after_7d = true`... Sweep is owned by the proposal primitive, NOT `eaDraftService`."

**Status:** `server/jobs/workflowGateStallNotifyJob.ts:124-135` already implements the 7-day proposal sweep with `metadata.systemExpired = true` and `reason: 'expired_after_7d'`. **No code change required.**

#### REQ-EA4 — `home_widget.refreshPolicy` (spec §13.1)

> "EA's declaration: `{ ..., refreshPolicy: 'on_login' }`"

**Status:** Migration `0343_ea_home_widget_spec_align.sql:19-25` writes `refreshPolicy = 'on_login'`. **No code change required.**

#### REQ-EA5 — `home_widget.titleTemplate` (spec §13.1)

> "EA's declaration: `{ ..., titleTemplate: '${agent.displayName}', ... }`"

**Status:** Migration `0343_ea_home_widget_spec_align.sql:22` writes `titleTemplate = '${agent.displayName}'`. **No code change required.**

#### REQ-M15 — Personal nav group placement (spec §14.1)

> "`client/src/config/sidebar.ts` `buildNavItems` factory gains a new `personal` group rendered at the TOP of the sidebar, above `Operate` / `Build` / `Govern`."

**Status:** REAL divergence. Current `client/src/config/sidebar.ts:9` declares order `top → work → projects → agents → personal → company → ...`. Personal renders at position 5, not at the top. Per §14.1 it must render at TOP, above the workspace-mode sections (`work`, `projects`, `agents`). Code change required.

#### Adversarial — `createDraftWithProposal` atomicity

**Status:** `server/services/eaDrafts/eaDraftService.ts:98-133` wraps both `actionService.proposeAction({ ..., tx })` and `tx.insert(eaDrafts)` inside `db.transaction(async (tx) => { ... })`. Atomicity in place. `actionService.proposeAction` accepts the `tx` param (line 91-95). **No code change required.**

### 2.2 File-set enumeration (post-#291 + post-#313)

For each REQ, the file paths the fix touches. Items marked "no change" are listed for traceability — the chunk plan still emits a one-line note for them so the reviewer can confirm the architect's reading.

| REQ | Touch? | File(s) |
|---|---|---|
| REQ-C1 | NO | `shared/types/externalSourceTrigger.ts` (verified flat — matches spec amendment) |
| REQ-C3 | NO | `shared/types/slackAction.ts` (verified `types` field present — matches spec) |
| **REQ-C4** | **YES** | `migrations/0360_voice_profiles_schema_align.sql` + `.down.sql` (CREATE); `server/db/schema/voiceProfiles.ts` (MODIFY); `server/services/voiceProfile/voiceProfileService.ts` (MODIFY); `shared/types/voiceProfile.ts` (MODIFY — rename Zod field names) |
| REQ-CAL2 | NO | `server/config/actionRegistry/calendar.ts` (verified Tier 4 + review gate — matches spec) |
| REQ-CAL3-naming | NO | `server/services/calendar/calendarActionService.ts` (verified codes + ownership check — matches spec amendment) |
| REQ-T8 | NO | `server/services/triggers/externalSourceTriggersPure.ts` (verified `deriveDedupKey` shapes — match spec amendment) |
| REQ-EA1 | NO | `migrations/0343_ea_home_widget_spec_align.sql` (already merged — allowlist matches §13.2) |
| REQ-EA3 | NO | `migrations/0332_executive_assistant_seed.sql:64-66` (already merged — matches §13.4 amendment) |
| REQ-M9 | NO | `server/jobs/workflowGateStallNotifyJob.ts:124-135` (verified 7-day sweep — matches §20.4) |
| REQ-EA4 | NO | `migrations/0343_ea_home_widget_spec_align.sql` (already merged — refreshPolicy 'on_login') |
| REQ-EA5 | NO | `migrations/0343_ea_home_widget_spec_align.sql` (already merged — titleTemplate `${agent.displayName}`) |
| **REQ-M15** | **YES** | `client/src/config/sidebar.ts` (MODIFY); `client/src/config/__tests__/buildNavItems.test.ts` (MODIFY) |
| Adversarial atomicity | NO | `server/services/eaDrafts/eaDraftService.ts:98-133` (verified atomicity present) |

**Net effect:** the 13 in-scope items decompose into TWO real code-change surfaces:

1. `voice_profiles` schema + Drizzle + service + Zod column-name alignment (REQ-C4).
2. Sidebar nav group re-order (REQ-M15).

The other 11 items are already conformant — most because the spec was amended (post-2026-05-12, dated 2026-05-13 in the spec text itself) to align with shipped code, and a few because prior PRs (specifically migration `0343_ea_home_widget_spec_align` and `0344_ea_drafts_proposal_action_unique`) closed the remaining gaps.

This is unusual but defensible: the conformance log was written on 2026-05-12 — a snapshot of code-vs-spec at that moment. The spec was subsequently amended to lock the as-built shape as authoritative for V1 (the spec document carries dated amendment lines for each REQ); two follow-up migrations (0343, 0344) closed the items that needed real code work at the time. What remained on the deferred-batch list AND still needs work on 2026-05-15 is REQ-C4 (DB column rename + extra jsonb columns) and REQ-M15 (sidebar order).

The conformance-log entry for each "no change" REQ resolves to "spec amendment ratified the shipped shape" or "prior PR closed the gap" — both paths are documented in the spec text and the migration files cited above.

### 2.3 REQ-M9 verification

Pre-existing primitive covers it. `server/jobs/workflowGateStallNotifyJob.ts` already sweeps proposal rows at the 7-day threshold and transitions to `rejected` with `metadata.systemExpired = true`. The spec §20.4 quoted text matches the implementation comment at lines 124-135 (the comment cites "spec §5.1 + REQ-M9" directly). **No code change required.** The plan documents this as the resolution for REQ-M9; Chunk 3 records it in the conformance log close-out.

### 2.4 REQ-EA1 verification

Migration `0343_ea_home_widget_spec_align.sql` (already merged on main) writes the spec §13.2 allowlist to `system_agents.default_org_skill_slugs` for the executive-assistant row. The 7 platform-meta skills (`ask_clarifying_question`, `request_clarification`, `read_workspace`, `web_search`, `read_codebase`, `search_agent_history`, `read_priority_feed`) are covered by `server/config/universalSkills.ts` and are always in scope regardless of the per-agent allowlist. **No additional explicit listing required.** REQ-EA1 is conformant; the plan documents this.

### 2.5 Adversarial atomicity file (createDraftWithProposal)

File: `server/services/eaDrafts/eaDraftService.ts`. Function: `eaDraftService.createDraftWithProposal` (lines 79-134). Already wraps both inserts in `db.transaction(async (tx) => { ... })` and threads the `tx` into `actionService.proposeAction({ ..., tx })`. The atomicity contract is in place; the spec amendment block for §7.5 (`proposalActionId` 1:1 invariant, REVIEW-F2 from PR #296) ratifies the current shape. Migration `0344_ea_drafts_proposal_action_unique.sql` is the defence-in-depth UNIQUE index that catches any future idempotency-key regression as a loud DB error rather than a silent stuck draft. **No code change required.**

### 2.6 Migration numbering

Only one migration is required for this build:

| REQ | Migration filename | Paired .down.sql |
|---|---|---|
| REQ-C4 | `migrations/0360_voice_profiles_schema_align.sql` | `migrations/0360_voice_profiles_schema_align.down.sql` |

**Why one migration, not two or three?**

- REQ-EA3 (partial unique index) was already addressed by migration 0332 line 64-66.
- REQ-T8 dedup-key shape is not a stored value — it's derived at fire time by `deriveDedupKey` and inserted as the existing `dedup_key text` column. The persisted column shape is unchanged; only the derivation function matters and it already matches spec. The plan does NOT include a `0361_pa_dedup_key_format.sql` migration referenced as optional in spec §8 — that migration would persist the dedup-key shape, but the shape is computed, not stored.
- REQ-EA1, REQ-EA4, REQ-EA5 were all addressed by migration 0343.

### 2.7 Risks and mitigations

| Risk | Mitigation |
|---|---|
| **voice_profiles column-rename ordering during migration** — three columns rename (`sample_count`→`sample_size`, `last_refreshed_at`→`last_derived_at`, `opted_out_at`→`opt_out_at`). Postgres `ALTER TABLE ... RENAME COLUMN` is atomic; the only ordering risk is the partial index `voice_profiles_state_refresh_idx` that references `last_refreshed_at` and `opted_out_at`. | Drop the index first, then rename, then re-create the index with the new column names. The migration's `.down.sql` reverses the order: drop new index, rename back, re-create old index. Both directions land as a single transaction wrap. RLS policy does NOT reference the renamed columns (the policy uses `owner_user_id`, `organisation_id`, `org_scope`) so the policy survives the rename without touch. |
| **RLS policy survives column renames** — Postgres ALTER COLUMN RENAME preserves policies that don't reference the renamed columns, but `verify-rls-coverage.sh` runs in CI and would flag any drop. | Migration adds NO `DROP POLICY`. Policy is unchanged. CI's RLS gate confirms. |
| **Drizzle schema vs migration column-name drift** — if the Drizzle schema edit lands before the migration is applied to a dev DB, runtime reads/writes will reference columns that don't exist yet. | Migration ships in same commit as Drizzle schema edit and service-code edit. The chunk's commit message instructs local devs to run `npm run db:migrate` before booting. CI runs migrations as part of test setup. |
| **Service-layer column-name references after rename** — `voiceProfileService.ts:154` reads `profile.lastRefreshedAt` (the OLD Drizzle field name). After the rename, the Drizzle field becomes `lastDerivedAt`. Any miss elsewhere → typecheck failure. | TypeScript typecheck catches all references at compile time. The chunk's verification commands include `npm run typecheck`. |
| **Voice-profile provisioning path** — the first-run wizard `/personal/setup` POST handler creates `voice_profiles` rows. If not updated, new rows will have `{}` defaults for `sourceConfig`/`refreshConfig` instead of the spec example `{ gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }` and `{ days: 30 }`. | The chunk requires updating every provisioning + refresh call site. The plan's per-chunk file list names every site. The `{}` default is acceptable when the caller does not specify config (preserves Postgres NOT NULL invariant). |
| **Sidebar nav INVARIANT comment** — `client/src/config/sidebar.ts:7-11` carries an explicit comment "INVARIANT: NavGroup declaration order IS the visual render order. MUST emit items in this group sequence: top → work → projects → agents → personal → company → ..." | Update the comment in the same edit as the re-order so it stays the source of truth. Update the buildNavItems test to assert the new order. |
| **Sidebar visual regression** — pages rendering nav items rely on the existing order for visual layout. | This IS the desired regression per spec §14.1. The change is intentional; the test update locks the new shape. The acceptance criterion §7 of this plan requires operator visual confirmation in the PR. |
| **No pre-existing duplicate voice_profile rows** that would block a unique-index re-create. | The voice_profiles table has no unique constraint on the renamed columns; the partial indexes are not unique. No collision risk. The `.down.sql` re-creates the old non-unique indexes. |
| **Down migration loses jsonb data in new columns** — when reverting, `source_config` and `refresh_config` are dropped. | Correct behaviour — the `.down.sql` returns the schema to its pre-0360 shape, which had no such columns. Any data in those columns is lost on revert. Document this in the `.down.sql` header. |
| **Existing rows have NULL `sample_count` / `last_refreshed_at` / `opted_out_at`** — the rename preserves NULLs; new jsonb columns get `'{}'` default. | The migration adds `NOT NULL DEFAULT '{}'` for the two new jsonb columns, so existing rows get `{}` (not NULL). Compatible with the Drizzle schema that declares the field as `jsonb().notNull().default(sql\`'{}'\`)`. |

---

## 3. Chunks

### Chunk 0 — Architecture-notes anchor

**Type:** Documentation. No code edits in this chunk.

**Deliverable:** this `plan.md` document. The "Architecture Notes" section (§2 above) IS Chunk 0's output.

- **spec_sections:** all 13 in-scope items + adversarial finding (see Architecture Notes §2.1)
- **files:**
  - `tasks/builds/pa-v1-cleanup-batch/plan.md` (CREATE — this file)
- **contracts:** the plan locks the file-set, migration number, and chunk boundaries the executor will follow
- **error_handling:** N/A (doc chunk)
- **targeted_tests:** none — pure-doc chunk
- **dependencies:** none

**Verification commands:** none at this stage — Chunk 0 produces no code.

---

### Chunk 1 — voice_profiles schema alignment (REQ-C4)

**Goal:** Align the `voice_profiles` table with PA-V1 spec §7.4 + §21.1 column-for-column. Rename three columns. Add two jsonb columns with `NOT NULL DEFAULT '{}'`. Update the Drizzle schema. Update the Zod row schema. Update service-layer reads/writes that reference the old column names. Provisioning paths (first-run wizard) that create rows now populate the new jsonb columns per spec §13.4 step 6.

- **spec_sections:** REQ-C4 / PA-V1 §7.4 + §21.1
- **files:**
  - `migrations/0360_voice_profiles_schema_align.sql` (CREATE)
  - `migrations/0360_voice_profiles_schema_align.down.sql` (CREATE)
  - `server/db/schema/voiceProfiles.ts` (MODIFY — Drizzle column-name updates; two new jsonb columns; update partial-index column references)
  - `shared/types/voiceProfile.ts` (MODIFY — rename Zod fields `sampleCount`→`sampleSize`, `lastRefreshedAt`→`lastDerivedAt`, `optedOutAt`→`optOutAt`; add `sourceConfig` and `refreshConfig` jsonb record fields)
  - `server/services/voiceProfile/voiceProfileService.ts` (MODIFY — switch reads/writes from old field names to new; persist `sourceConfig`/`refreshConfig` jsonb at provisioning + refresh paths; remove the hardcoded `refreshConfig: null` at line 153 and read from the actual row)
  - `server/services/voiceProfile/voiceProfileServicePure.ts` (VERIFY — already uses `lastDerivedAt`/`refreshConfig` names; expect zero edits but verify in chunk execution)
  - `server/services/voiceProfile/__tests__/voiceProfileServicePure.test.ts` (VERIFY — already uses spec-aligned names; expect zero edits)
  - `server/routes/voiceProfiles.ts` (VERIFY — only forwards service results; no column-name references; expect zero edits)
  - `server/jobs/voiceProfileRefreshJob.ts` (MODIFY if it touches renamed columns directly — verify and edit only if needed)
  - `server/services/voiceProfile/__tests__/voiceProfileColumnAlignment.test.ts` (CREATE — targeted Vitest unit test asserting the Drizzle select returns spec-named fields)
- **Module shape:**
  - *Public interface this chunk exposes:* `voice_profiles` row shape matches spec §21.1 column-for-column: `(id, organisation_id, owner_user_id, subaccount_id, org_scope, sources text[], source_config jsonb NOT NULL DEFAULT '{}', sample_size int, profile_json, state, refresh_policy, refresh_config jsonb NOT NULL DEFAULT '{}', last_derived_at, opt_out_at, created_at, updated_at)`. The Drizzle row type `typeof voiceProfiles.$inferSelect` reflects the new shape. Service exports (`deriveProfile`, `refreshProfile`, `listProfiles`, `getProfile`, `optOut`, `reActivate`) keep their existing public signatures.
  - *What stays hidden behind it:* the migration's DROP-INDEX → RENAME-COLUMN → ADD-COLUMN → CREATE-INDEX ordering; the service's internal mapping between Drizzle field names and the spec-aligned Zod row shape; the choice to wrap the rename + index re-create in a single migration vs. splitting into two.
- **contracts:**
  - DB columns match spec §21.1 column-for-column.
  - Drizzle schema exports field names `sampleSize`, `lastDerivedAt`, `optOutAt`, `sourceConfig`, `refreshConfig`.
  - Service-layer paths that read/write the table use the new field names.
  - Existing public service API signatures and return shapes are unchanged.
  - The Zod row schema in `shared/types/voiceProfile.ts` exports `sampleSize`, `lastDerivedAt`, `optOutAt`, `sourceConfig`, `refreshConfig`.
  - Migration uses `IF EXISTS` / `IF NOT EXISTS` guards on index drop/create. Column renames use `ALTER TABLE ... RENAME COLUMN`. The `.down.sql` reverses each step in reverse order and drops the two new jsonb columns.
- **error_handling:**
  - Service throws keep the existing `{ statusCode, errorCode }` shape (`PROFILE_NOT_FOUND` 404, `SAMPLER_EMPTY` 422, `VOICE_PROFILE_OWNERSHIP_MISMATCH` 403). No new error types.
  - Migration failure modes: RENAME on missing column → migration aborts (correct — implies upstream state divergence). ADD COLUMN on existing column → no-op via `IF NOT EXISTS` guard.
  - Down-migration data loss in jsonb columns documented in `.down.sql` header.
- **targeted_tests:**
  - Authored new test (Vitest): `server/services/voiceProfile/__tests__/voiceProfileColumnAlignment.test.ts` — assert the Drizzle row select returns fields `sampleSize`, `lastDerivedAt`, `optOutAt`, `sourceConfig`, `refreshConfig`; assert the row schema parses with the spec-aligned shape. The test uses Vitest (`import { test, expect } from 'vitest'`). Do NOT use `node:test`, `node:assert`, or `npx tsx` harnesses.
  - Re-run existing `voiceProfileServicePure.test.ts` to confirm `shouldRefresh` continues to accept `lastDerivedAt`/`refreshConfig` arguments. The pure test already uses these names; the change here is upstream (the service now reads them from the DB row instead of hardcoding `null`).
- **dependencies:** none (this chunk runs first; everything else is independent)

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run db:generate` — confirm Drizzle generates a no-op migration after the schema edit (proves Drizzle schema matches DB after migration 0360 applies)
- `npx vitest run server/services/voiceProfile/__tests__/voiceProfileServicePure.test.ts`
- `npx vitest run server/services/voiceProfile/__tests__/voiceProfileColumnAlignment.test.ts`

### Chunk 2 — Sidebar nav group re-order (REQ-M15)

**Goal:** Move the `personal` nav group from its current mid-sidebar position (after `agents`, position 5) to the TOP, immediately after `top` and before `work`. Spec §14.1 specifies "at the TOP of the sidebar, above `Operate` / `Build` / `Govern`" — the current sidebar uses different group labels (`work`, `projects`, `agents`, `company`, `organisation`) than the spec terms (`Operate`, `Build`, `Govern`), but the visual intent is clear: Personal entries appear before workspace-mode sections.

Per spec §14.1 the group:
- Renders entries data-driven from `useUserOwnedAgents()`.
- Is hidden entirely when the hook returns empty.
- Is visible regardless of which Workspace / Org / System view-mode is active.

The current code already satisfies all four behaviours — only the position is wrong.

- **spec_sections:** REQ-M15 / PA-V1 §14.1
- **files:**
  - `client/src/config/sidebar.ts` (MODIFY) — re-order the `NavGroup` union; update the INVARIANT comment at lines 7-11; move the `personal` emission block (currently lines 244-257) to immediately after the `top` group emission (around line 113) and before the `work` group emission
  - `client/src/config/__tests__/buildNavItems.test.ts` (MODIFY) — update order assertions to match the new group sequence
- **Module shape:**
  - *Public interface this chunk exposes:* the ordered list returned by `buildNavItems(ctx)`. After this chunk the group sequence is `top → personal → work → projects → agents → company → clientpulse → organisation → support → platform → footer`.
  - *What stays hidden behind it:* the per-item field shape (`group`, `kind`, `key`, `label`, `to`, `iconKey`, `badge`, `manageTo`, `onClick`) is unchanged; the conditional gates on workspace-mode and permissions are unchanged; only the order of items in the returned array shifts.
- **contracts:**
  - `NavGroup` union declares groups in render order: `top → personal → work → projects → agents → company → clientpulse → organisation → support → platform → footer`.
  - `buildNavItems` emits items in that order.
  - The `personal` group is hidden when `userOwnedAgents.length === 0` (unchanged from current behaviour).
- **error_handling:** N/A — pure config edit
- **targeted_tests:**
  - `client/src/config/__tests__/buildNavItems.test.ts` — assert the new order. Use Vitest. Update the existing order assertions; add cases that verify:
    - With `userOwnedAgents.length > 0`, the first `'personal'`-group item appears before any `'work'`-group item.
    - With `userOwnedAgents.length === 0`, no `'personal'`-group item is emitted at all.
- **dependencies:** none (independent of Chunk 1; touches a disjoint file set)

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx vitest run client/src/config/__tests__/buildNavItems.test.ts`

---

### Chunk 3 — Conformance log close-out + documentation pass

**Goal:** Mark each REQ in the PA-V1 conformance log as resolved with a one-line note pointing at the spec amendment OR the prior PR that closed it. Update `tasks/todo.md` items per spec §9 acceptance criterion 6 (`[status:closed:pr:<num>]`). No code edits.

This chunk converts the "spec amended to lock as-built" finding from a reviewer-private observation into a public, durable record so future conformance checks land at the same conclusion without re-deriving it.

- **spec_sections:** N/A — meta-documentation
- **files:**
  - `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md` (MODIFY — append a "Close-out notes (2026-05-15, pa-v1-cleanup-batch)" section that lists, per REQ, the resolution path and the spec line / migration / PR that proves it)
  - `tasks/todo.md` (MODIFY — flip the 12 deferred items + 1 adversarial item from open to `[status:closed:pr:<num>]`; the executor leaves a placeholder `<pending>` if the PR is not yet open and updates after merge)
  - `tasks/builds/pa-v1-cleanup-batch/progress.md` (CREATE OR MODIFY — record decisions made in Chunk 0 so future sessions don't repeat the spec-amendment discovery)
- **Module shape:**
  - *Public interface this chunk exposes:* the conformance log now carries an explicit resolution for every REQ named in spec §1; `tasks/todo.md` no longer surfaces these items as open work.
  - *What stays hidden behind it:* the meta-decision rationale (why the spec was amended in some places vs. why prior PRs landed in others) lives in `progress.md` as a one-paragraph narrative rather than per-REQ verbiage.
- **contracts:**
  - Conformance log carries a one-line resolution per REQ.
  - `tasks/todo.md` flips each item to closed status.
- **error_handling:** N/A
- **targeted_tests:** none — pure documentation
- **dependencies:** Chunk 1 + Chunk 2 (so the close-out can reference the actual landed migration number and the sidebar edit)

**Verification commands:** none — pure documentation. Lint and typecheck are not relevant to `.md` edits.

---

## 4. Risks and mitigations (consolidated)

(See Architecture Notes §2.7 for the full table; consolidated here for the executor's quick reference.)

1. **voice_profiles column-rename ordering** — drop indexes that reference renamed columns first, rename, then re-create indexes. RLS policy survives (does not reference renamed columns). Both directions wrapped in a single migration.
2. **Drizzle vs migration drift** — chunk lands both in the same commit; CI runs migrations before tests.
3. **Service-layer column-name references** — TypeScript typecheck catches all references at compile time.
4. **Provisioning code path** — first-run wizard must persist `sourceConfig` and `refreshConfig` jsonb at row creation; service contract documents the shape; `'{}'` default is acceptable when no config supplied.
5. **Sidebar visual regression** — intentional per spec §14.1; nav-order test locks the new shape; operator visually confirms in PR (acceptance criterion §7).
6. **Down-migration data loss in new jsonb columns** — correct behaviour; `.down.sql` header documents it.
7. **Voice profile RLS policy** — `verify-rls-coverage.sh` (CI) confirms policy unchanged. No `DROP POLICY` in this migration.

---

## 5. Dependencies graph

```
Chunk 0 (plan.md)              [no deps — this doc]
   │
   ▼
Chunk 1 (REQ-C4 schema)        [no deps on other chunks]
Chunk 2 (REQ-M15 sidebar)      [no deps on other chunks; can run in parallel with Chunk 1]
   │ │
   └─┴────► Chunk 3 (conformance log close-out)  [depends on Chunks 1 + 2 for the PR number]
```

Chunks 1 and 2 are independent — they touch disjoint file sets (backend schema/service vs. frontend config) and can be implemented in either order or in parallel. Chunk 3 references the landed work, so it runs last.

---

## 6. Out of scope

- **REQ-P6** (`external_trigger_dedup` RLS `subaccount_admin` vs `system_admin`) — intentionally excluded per spec §1 + user instructions.
- **PA-V2 work** — separate track.
- **LAEL integration** — separate v2 work.
- **Drive-by lint cleanup** — explicit non-goal in spec §3.
- **Spec edits** — the conformance log's resolution path is to document where the spec was amended, NOT to amend the spec further. The spec amendment lines dated 2026-05-13 are authoritative.

---

## 7. Acceptance criteria

Mirror of spec §9 with chunk-mapped responsibilities:

1. `npm run build:server` exits 0 (after Chunk 1).
2. `npm run build:client` exits 0 (after Chunk 2).
3. `npm run lint` exits 0 across the build.
4. `npm run typecheck` exits 0 across the build.
5. Migration `0360_voice_profiles_schema_align.sql` lands with paired `.down.sql` (Chunk 1).
6. PA-V1 spec-conformance log shows zero remaining open REQ items after this PR merges (Chunk 3).
7. `tasks/todo.md` items listed in spec §1 marked `[status:closed:pr:<num>]` in the merge commit (Chunk 3).
8. The Personal nav group placement is visually confirmed by the operator in the PR — the operator opens the running client and confirms Personal entries appear above Tasks / Calendar / Workflows (Chunk 2 visual-confirmation gate).

CI owns full test-gate verification. Targeted tests authored in Chunks 1 and 2 cover the new logic locally per `static_gates_primary` posture.
