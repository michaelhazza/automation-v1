# Skill Analyzer Restore — Agent Coverage + UI Entry Point

Architect plan. Scope: close the two gaps the current restore does not cover (new `systemAgents` rows, draft->active status promotion) and surface a restore action on the results page for any job whose backup is still `active`.

Task class: **Significant** — touches schema capture shape, service logic, API surface, and UI. Cross-domain (server + client). No new patterns; reuses the existing `ConfigBackupEntity` generic envelope.

---

## Table of Contents

1. Architecture Notes
2. Stepwise Implementation Plan
3. Per-Chunk Detail
4. UX Considerations
5. Open Questions

---

## 1. Architecture Notes

### 1.1 Entity type — `system_agent` with full snapshot, not `system_agent_existence`

**Decision:** snapshot full agent rows (existence + mutable state), keyed by `entityType: 'system_agent'`. Not an existence-only set.

**Why:** the analyzer currently only mutates `status` on existing agents (draft->active for the ones it just created), but the surface is already larger than that sentence implies — `captureSkillAnalyzerEntities` today snapshots `defaultSystemSkillSlugs` under `system_agent_skills`. Merging both into a single `system_agent` entity with the full mutable field-set (the fields `systemAgentService.updateAgent` accepts) collapses two entity types into one, keeps the snapshot future-proof if the analyzer ever starts editing `masterPrompt` or `description` on existing agents, and makes the restore algorithm symmetric with the existing `system_skill` handling.

**Rejected alternatives:**
- **Existence set only (`{ id }[]`)** — fails to carry the data needed to revert `status` on an agent the analyzer mutated from `draft` to `active` between backup and restore. (A `draft` agent that existed pre-backup and was promoted during Execute must revert to `draft`.) Also fails the "what about masterPrompt tomorrow" test.
- **Keep `system_agent_skills` separate, add a new `system_agent_existence` type** — three entity types doing what one can. Strictly more code.
- **Full row snapshot including immutable audit columns (`createdAt`, `createdBy`)** — unnecessary; restore only needs fields the analyzer touches or could touch.

### 1.2 Soft-delete via `deletedAt`, not `status: 'inactive'`

**Decision:** agents created after the backup are reverted via `deletedAt = now()`. Agents existing in the backup but with mutated fields are reverted in place.

**Why:** the soft-delete column is already the canonical "hidden from the app" signal — every consumer already filters `isNull(systemAgents.deletedAt)`. `status = 'inactive'` is a third state alongside `draft` and `active` that is barely used elsewhere and would require downstream code to learn a new filter. `deletedAt` also mirrors the existing skill strategy (`isActive = false` for skills serves the same role — the "hidden but referentially intact" flag). FK references from `agents.systemAgentId`, `agentEmbeddings.systemAgentId`, and hierarchy slots stay intact because `deletedAt` is a timestamp column, not a row removal.

**Trade-off:** a soft-deleted agent row still counts against `system_agents_slug_idx` (UNIQUE on `slug`). If the analyzer's agent creation is re-run after a restore, the slug-lookup idempotency path in `skillAnalyzerService` (near lines 1232–1238) will NOT find the soft-deleted row (it filters `isNull(deletedAt)`) and will attempt a fresh insert, which will unique-violate on slug. This is acceptable because (a) the one-shot restore contract means the job is terminal after restore, and (b) the create-on-conflict case is outside this task's scope. Flagged in test considerations so pr-reviewer verifies the path throws a clean error, not a raw Postgres exception.

### 1.3 FK integrity and restore ordering

**Decision:** restore order inside the transaction is:
1. Revert `system_skills` snapshotted rows (existing-before-backup skills).
2. Deactivate `system_skills` created after backup (`isActive = false`).
3. Revert `system_agents` snapshotted rows in place (skill slug arrays, status, name, description, masterPrompt, hierarchy fields).
4. Soft-delete `system_agents` created after backup (`deletedAt = now()`).

No FK risk between these steps — `defaultSystemSkillSlugs` is a jsonb array of slugs, not a FK; skill rows do not reference agent rows; agent rows do not reference skill rows. Ordering is chosen to match the existing service's shape (skills first) and minimize diff surface.

### 1.4 Dry-run mode — YES, via `?dryRun=true` query param

**Decision:** extend `POST /api/system/skill-analyser/jobs/:jobId/restore` to accept `?dryRun=true`. Dry-run returns the same counts shape the real restore returns, computed by a read-only `describeRestore(backupId, orgId)` service method — no transactional rollback, no `skill_versions` writes that would need to be ignored.

**Why:** the UI needs accurate counts for the confirmation dialog ("N skills reverted, M skills deactivated, K agents soft-deleted, L agents reverted"). Guessing from the backup's `entities.length` is wrong because some entities may already match current state (no-op reverts).

**Rejected alternative:** separate endpoint `GET .../restore/preview`. Adds a route for no benefit — the dry-run flag on the existing route is idiomatic and keeps the two paths colocated.

### 1.5 Audit trail for agent soft-deletes

**Decision:** log via the structured logger (`logger.info` with `{ backupId, agentId, action: 'soft-delete' }`), not a new audit table. No agent-versions table exists; creating one for this is scope creep. The `configBackups.restoredAt` + `restoredBy` fields plus the backup's `entities[]` payload are the persistent audit trail — the backup itself records who restored what and when.

### 1.6 Permission gate

**Decision:** use the existing `requireSystemAdmin` guard already applied to every route in `server/routes/skillAnalyzer.ts` (line 29). No new permission key. Skill Analyzer is a system-admin-only surface; restore follows the surface.

### 1.7 One-shot contract is preserved

`configBackupService.restoreBackup` already atomically claims the backup (status='active' -> 'restored' in one UPDATE). A second click returns 409. The UI button must go `disabled` after first success/failure and must refetch `GET /backup` on page mount so a claim made from another tab is reflected.

---

## 2. Stepwise Implementation Plan

Five chunks, ordered by dependency. Each is independently testable.

1. **Snapshot schema extension** — change capture to emit `system_agent` full-snapshot entities.
2. **Restore logic extension** — consume `system_agent` entities, soft-delete post-backup agents, revert snapshotted agents.
3. **Dry-run API + backup-exists read** — `describeRestore` service method + `?dryRun=true` on the restore route. `GET /backup` response already carries what the UI needs (`id`, `status`, `createdAt`, `restoredAt`).
4. **UI: restore entry point on results page** — extend the existing Execute-step restore affordance so it also shows on the Results step whenever a backup with status `active` exists for the job.
5. **Docs update** — reflect the new entity shape in `architecture.md` skill-analyzer / config-backup section.

Each chunk leaves the app in a working state. Chunk 2 depends on chunk 1's snapshot shape. Chunk 3 depends on chunk 2. Chunk 4 depends on chunk 3's API. Chunk 5 is docs-only.

---

## 3. Per-Chunk Detail

### Chunk 1 — Snapshot schema extension

**Files to modify**
- `server/services/configBackupService.ts` — `captureSkillAnalyzerEntities()`

**Contract change**
- Replace the current `system_agent_skills` emission with `system_agent` emission. Shape:
  ```
  { entityType: 'system_agent', entityId: agent.id, snapshot: {
      defaultSystemSkillSlugs, status, name, description, masterPrompt,
      agentRole, agentTitle, parentSystemAgentId,
  }}
  ```
- Only include agents where `isNull(deletedAt)` at backup time (same as today).
- Existence set is implicit — "which ids appear as entities" defines membership.

**Error handling**
- No new errors. Capture runs inside the existing transaction.

**Test considerations (for pr-reviewer)**
- Backup taken with N agents captures N `system_agent` entities — none missing.
- Soft-deleted agents at backup time are NOT captured (preserves current behavior).
- Restore path in chunk 2 receives the new entity type cleanly.

**Dependencies:** none.

**Migration note:** no DB migration. `configBackups.entities` is already `jsonb` with no per-key shape constraint. Existing backups on production created with the old `system_agent_skills` shape must still restore correctly — see chunk 2 back-compat branch.

### Chunk 2 — Restore logic extension

**Files to modify**
- `server/services/configBackupService.ts` — `restoreSkillAnalyzerEntities()` + the public `restoreBackup` return type.

**Contract change**

`restoreSkillAnalyzerEntities` returns:
```
{
  skillsReverted: number;
  skillsDeactivated: number;
  agentsReverted: number;
  agentsSoftDeleted: number;  // NEW
}
```

Logic additions:
1. **Back-compat branch:** if any entity has `entityType === 'system_agent_skills'` (old backups), keep the current behavior — update `defaultSystemSkillSlugs` only. Increment `agentsReverted`.
2. **New branch:** if `entity.entityType === 'system_agent'`, update the full mutable field-set on the row where id matches AND `isNull(deletedAt)`. Increment `agentsReverted` when the update returned a row.
3. **Post-backup agents:** collect `backupAgentIds = entities.filter(e => e.entityType === 'system_agent' || e.entityType === 'system_agent_skills').map(e => e.entityId)`. Select all current `systemAgents` with `isNull(deletedAt)`. For any id NOT in `backupAgentIds`, set `deletedAt = now()`. Increment `agentsSoftDeleted`.
4. **Guard against mixed-shape backups:** if any `system_agent_skills` entity is present in `entities`, DO NOT run the post-backup agents soft-delete step. That code path was written before existence tracking; we cannot distinguish "agent created after backup" from "agent existed but wasn't snapshotted because only its skill slugs were tracked." Old backups are restore-compatible but do not get the new agent soft-delete behavior. Log `logger.warn` noting the limitation so operators can spot legacy-backup restores.

**Route impact**
- `server/routes/skillAnalyzer.ts` restore route returns the new service shape unchanged (passthrough). Client must tolerate the new field (chunk 4).

**Error handling**
- Existing transaction wrapper holds. If any step throws, the backup status stays `restored` (it was claimed at the start) — this is the existing behavior and acceptable: a half-applied restore is the user's problem to diagnose, same as today.

**Test considerations**
- Fresh backup (new shape) restore deletes only post-backup agents; does not touch backup-era agents' `deletedAt`.
- Old backup (legacy `system_agent_skills` shape) restore still reverts slug arrays; emits the warn log; does NOT soft-delete any agent.
- Status-promoted agent (`draft`->`active` during Execute) reverts to `draft` via the full-snapshot path.
- Agent created by analyzer and then skill-attached: restore soft-deletes the agent AND deactivates its skills. Run order: skills first, then agents. Both succeed in the same transaction.
- Agent created by analyzer but Phase 1 partially failed (agent exists, no skills attached): restore soft-deletes the agent. No skill-level work needed.
- Agent snapshotted in backup then hard-deleted between backup and restore: the UPDATE returns zero rows; do not increment `agentsReverted`. No throw.
- After restore, re-running the same analyzer job's Execute must fail cleanly on the soft-deleted agent's slug collision (see §1.2 trade-off). Verify the error surfaces as a structured service throw, not a raw Postgres exception.

**Dependencies:** chunk 1.

### Chunk 3 — Dry-run + API surface

**Files to modify**
- `server/services/configBackupService.ts` — add `describeRestore({ backupId, organisationId })` that reads the backup and current state, computes would-be counts, and returns `{ skillsReverted, skillsDeactivated, agentsReverted, agentsSoftDeleted }`. No writes.
- `server/routes/skillAnalyzer.ts` — the restore route (`POST /api/system/skill-analyser/jobs/:jobId/restore`) reads `req.query.dryRun === 'true'` and routes to `describeRestore` instead of `restoreBackup`.
- `configBackupService.getBackupBySourceId` already returns `{ id, scope, label, status, createdAt, restoredAt }` — no change needed. The UI already consumes this via `GET /jobs/:jobId/backup`.

**Contract**
- `POST /api/system/skill-analyser/jobs/:jobId/restore?dryRun=true` — returns the counts shape, HTTP 200, no mutation, no status flip.
- Without `dryRun=true` — existing behavior (claim + restore).
- `describeRestore` signature:
  ```
  describeRestore(params: { backupId: string; organisationId: string }): Promise<{
    skillsReverted: number; skillsDeactivated: number;
    agentsReverted: number; agentsSoftDeleted: number;
  }>
  ```
- Throws `{ statusCode: 404, message: 'Backup not found' }` if not found.
- Throws `{ statusCode: 409, message: 'Backup has already been restored' }` if `status !== 'active'`. Parity with the real restore — previewing a consumed backup is never useful.

**Error handling**
- Route continues to use `asyncHandler`. Errors bubble through the service-throw-shape contract.

**Test considerations**
- Dry-run on an active backup returns counts consistent with what real restore would produce.
- Dry-run on a restored backup returns 409.
- Real restore after a dry-run still succeeds — dry-run must not accidentally mutate backup status or write `skill_versions` rows.
- Query param precedence: `?dryRun=true` is the only accepted truthy value. `?dryRun=1` or `?dryRun=yes` reads as false. (Explicit strict comparison — do not use loose coercion.)
- Legacy backup (old `system_agent_skills` shape) dry-run returns `agentsSoftDeleted: 0` because the real restore skips that step for mixed-shape backups (§1.4 of chunk 2).

**Dependencies:** chunk 2.

### Chunk 4 — UI: restore entry point on results page

**Files to modify**
- `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` — load backup metadata via `GET /api/system/skill-analyser/jobs/:jobId/backup` when a job is loaded; store it in wizard state; pass to the results step and execute step.
- `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` — add a "Revert previous execution" action in the step header, visible only when a backup with `status: 'active'` exists for this job.
- `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` — update the existing `canRestore` check so restore is available not only after an Execute in the same session but whenever `backupStatus === 'active'` for the job. Extend `RestoreResult` to include `agentsSoftDeleted` and surface it in the success banner ("N agents soft-deleted, L agents reverted").
- No new files; no new route in `client/src/App.tsx`.

**UX contract**
- On Results and Execute steps, when `backupStatus === 'active'`:
  1. Show a secondary button labeled `Revert previous execution`.
  2. On click, POST `?dryRun=true` and open a confirmation dialog showing the four counts. Show a spinner while dry-run is in-flight. Handle the zero-op case ("This backup would not change anything currently — nothing to revert.") by still allowing Confirm (it's a no-op but preserves the one-shot status flip).
  3. On Confirm, POST the real restore. Disable the button immediately on click.
  4. On success, show a success banner with actual counts; button stays disabled. Refetch the backup so the pill flips to `restored`.
  5. On 409 (already restored in another tab), show "This backup has already been restored." and refetch `GET /backup` to sync state.
  6. On other errors, show the error message; leave button enabled to retry.
- Empty/no-backup state: button is not rendered (not rendered-disabled — entirely absent). Job row still shows the existing `backup available` / `restored` pill in the list view (already implemented).

**Permission**
- Implicit — all Skill Analyzer pages already require system-admin. No new client-side guard. The server guard (`requireSystemAdmin` in `server/routes/skillAnalyzer.ts` line 29) is authoritative.

**Test considerations**
- Open a results page for a job whose backup is `restored` -> button hidden, pill shows `restored`.
- Open a results page for a job with no backup -> button hidden.
- Open a results page for a job with an `active` backup -> button visible, dry-run fetches counts correctly.
- Confirm restore -> real POST fires, button disables, success banner shows.
- Open the same page in a second tab, restore in first tab, click restore in second tab -> 409 banner shows, state refetches, button hides.
- Counts match between dry-run and actual restore for the same backup within a single session (should be exact if no other mutation happens concurrently).
- The Results step already ships with the Execute step's restore button in the flow — verify no duplicate buttons render when the wizard is on the Execute step for a job with a completed execution.

**Dependencies:** chunk 3.

### Chunk 5 — Docs update

**Files to modify**
- `architecture.md` — the skill-analyzer section and/or the config-backup section. Update the entity-type list to show `system_agent` replacing `system_agent_skills`, mention the dry-run route, and note the soft-delete-by-`deletedAt` strategy for agents created after backup.
- `docs/capabilities.md` — no change; the restore capability is already described at the category level, and the editorial rules forbid mentioning internal table names / service names in customer-facing sections.

**Dependencies:** chunks 1–4 merged.

---

## 4. UX Considerations

States to handle on the Skill Analyzer Results step (and Execute step):

| State | Visible controls | Notes |
|---|---|---|
| No backup exists for this job | No restore button | Applies to every job whose Execute phase never ran or produced zero mutations (phantom backup was cleaned up). |
| Backup exists, status `active` | `Revert previous execution` button | Dry-run fetches counts on click, not on mount — avoids a request per page load. |
| Backup exists, status `restored` | Informational pill "Previous execution reverted on {date}" | Matches the list-view pill treatment. |
| Backup exists, status `expired` | No button (future-proof — no expiry logic exists yet) | Display as inert restored-style pill. |
| Dry-run in progress | Spinner on the button | Button disabled. |
| Confirm dialog open | Counts displayed, Confirm / Cancel | `Confirm` disabled while dry-run still running. |
| Restore in progress | Spinner, button disabled | Non-cancelable. |
| Restore complete | Success banner with counts, button hidden/disabled | Existing backup pill flips to `restored`. |
| Restore failed | Error banner, button re-enabled | User may retry — but real failure usually means another tab won the claim, in which case subsequent attempts 409 cleanly. |

No WebSocket work needed — restore is synchronous and a single user's explicit action. The list-view pill (`backup available` vs `restored`) already reflects post-restore state on the next list fetch.

Permission-wise: the entire Skill Analyzer is already system-admin-gated. No additional visibility logic required.

---

## 5. Open Questions

None — all of the user's validation questions are addressed in §1. If during implementation the real-restore vs dry-run count drift proves flaky (race between two admins), consider tightening by running `describeRestore` inside the same transaction as `restoreBackup` and returning the pre-flight counts as part of the success payload. That is a follow-up, not part of this plan.
