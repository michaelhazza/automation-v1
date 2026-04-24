# PR Review Log — Universal Brief feature implementation

**Branch:** `claude/implement-universal-brief-qJzP8` vs `main`
**Reviewed:** 2026-04-22T00:00:00Z
**Scope:** Universal Brief — brief/chat system, artefact validators/backstops, rules engine, fast-path classifier, memory block precedence, clarifying/challenge capabilities, migrations 0193–0199

**Files reviewed (representative, not exhaustive):**
- `server/services/brief*.ts`, `server/services/rule*.ts`, `server/services/chatTriageClassifier*.ts`, `server/services/fastPathDecisionLogger.ts`, `server/services/memoryBlockRetrievalServicePure.ts`, `server/services/memoryEntryQualityService.ts`
- `server/routes/briefs.ts`, `server/routes/conversations.ts`, `server/routes/rules.ts`
- `server/db/schema/conversations.ts`, `server/db/schema/fastPathDecisions.ts`, `server/db/schema/memoryBlocks.ts`, `server/config/rlsProtectedTables.ts`
- `migrations/0193`–`0199`
- `server/tools/capabilities/askClarifyingQuestionsHandler.ts`, `challengeAssumptionsHandler.ts`
- `server/jobs/fastPathDecisionsPruneJob.ts`, `fastPathRecalibrateJob.ts`, `ruleAutoDeprecateJob.ts`
- `shared/types/briefResultContract.ts`, `briefFastPath.ts`, `briefRules.ts`, `briefSkills.ts`
- `client/src/pages/BriefDetailPage.tsx`, `LearnedRulesPage.tsx`

---

## Blocking findings

### 1. RLS policies on three new tables reference a session variable that is never set
**Severity:** Blocking — **non-architectural** (edit the migrations, align to existing pattern)
**Files:** `migrations/0194_conversations_polymorphic.sql` lines 45–49; `migrations/0195_fast_path_decisions.sql` lines 28–29

The policies use `current_setting('app.current_organisation_id', true)`. The entire rest of the codebase — `server/middleware/auth.ts:108`, `server/lib/createWorker.ts:125`, and every existing RLS migration (0079, 0080, 0081, 0167–0177, 0188, 0192) — uses `app.organisation_id` (no `current_` prefix). `docs/canonical-data-platform-p1-p2-p3-impl.md` line 623 explicitly locks this decision: *"Keep `app.organisation_id` as-is. The `current_` prefix applies only to the new principal variables."*

Consequences (both bad):
- If the migration runner is the table owner, RLS is ENABLED but **not enforced** on these tables (Postgres bypasses RLS for owners unless `FORCE ROW LEVEL SECURITY` is set). Migrations 0194/0195 also omit `FORCE ROW LEVEL SECURITY`. Net: silent Layer-1 bypass — `conversations`, `conversation_messages`, and `fast_path_decisions` are **not tenant-isolated at the DB layer**, defeating the whole point of enrolling them in `rlsProtectedTables.ts`.
- If the runner is NOT the owner (production-style deploy), every query (SELECT/INSERT/UPDATE) against these tables fails the policy because `current_setting('app.current_organisation_id', true)` returns NULL, `NULL::uuid` is NULL, `organisation_id = NULL` is NULL (treated as false), and `WITH CHECK` defaults to `USING` when omitted — so Brief creation returns 500 for everyone.

Also missing vs. 0079 canonical pattern:
- No `FORCE ROW LEVEL SECURITY`
- No `IS NOT NULL AND <> ''` guards before the `::uuid` cast (raw-cast throws on malformed input instead of fail-closing)
- No explicit `WITH CHECK` clause

**Fix:** Rewrite both policies to mirror `0079_rls_tasks_actions_runs.sql` exactly:
```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_org_isolation ON conversations
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```
Repeat for `conversation_messages` and `fast_path_decisions`. Note: this needs to be rolled as a new migration (e.g. `0200_fix_universal_brief_rls.sql` that `DROP POLICY` + re-creates) rather than editing 0194/0195 in place if they may already have run in any environment.

---

### 2. BriefDetailPage fetches `conversationId` from a route that does not exist
**Severity:** Blocking — **non-architectural**
**File:** `client/src/pages/BriefDetailPage.tsx` lines 69, 79–83, 136–142

```ts
const [taskRes, artefactsRes] = await Promise.all([
  api.get<BriefMeta>(`/api/tasks/${briefId}`).catch(() => null),
  ...
]);
if (taskRes?.data) setBrief(taskRes.data);
if (taskRes?.data?.conversationId) { ... }
```

There is no `GET /api/tasks/:briefId` endpoint — only `GET /api/subaccounts/:subaccountId/tasks/:itemId` exists in `server/routes/tasks.ts`. Even if the client used the correct URL, the task response body does not include `conversationId` (I searched `server/routes/tasks.ts` + `server/services/taskService.ts` — no occurrences). Net: `taskRes` silently resolves to `null` via `.catch(() => null)`, `brief` stays `null`, `brief?.conversationId` is always undefined, and:
- The conversation messages fetch at lines 80–83 never runs → messages list is always empty.
- `handleSendReply` at line 136 returns early because `!brief?.conversationId` → user reply button does nothing.

**Fix:** Either (a) extend `POST /api/briefs` response + `GET /api/briefs/:briefId/artefacts` to also include `conversationId` and `briefMeta`, and load from `/api/briefs/:briefId` rather than `/api/tasks/`, or (b) add a `GET /api/briefs/:briefId` route in `server/routes/briefs.ts` that returns `{ id, title, status, conversationId }` by joining `tasks` → `conversations`. Option (b) is simpler given the Brief = task-with-subtype invariant.

---

### 3. Rules routes check `req.user.orgPermissions`, a field that does not exist
**Severity:** Blocking — **non-architectural**
**File:** `server/routes/rules.ts` lines 24, 65

```ts
const hasPermission = (req.user?.orgPermissions ?? []).includes(ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE);
```

`req.user` is typed as `JwtPayload` (`server/middleware/auth.ts:10`), which has only `{ id, organisationId, role, email }`. The resolved permission set lives in `req._orgPermissionCache: Set<string>` (same file, line 25), not on `req.user`. Consequence: `req.user.orgPermissions` is always `undefined`, the check always falls back to `[]`, `.includes(...)` is always `false`, so every attempt to set `isAuthoritative: true` — even by a user who actually has `org.rules.set_authoritative` — 403s.

Note that system_admin / org_admin bypass `requireOrgPermission` earlier in the middleware chain, so they reach the handler and hit this check too. For those two roles this particular check will also 403, which is a behavioural regression vs. the whole rest of the codebase (admin bypass).

**Fix:**
1. Use the cached Set: `(req._orgPermissionCache ?? new Set()).has(ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE)`, AND
2. Add an admin bypass: `if (req.user?.role === 'system_admin' || req.user?.role === 'org_admin') { /* skip check */ }`.
3. Better: promote this to a proper middleware (e.g. `requireOrgPermission(ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE)`) chained behind a body-inspection conditional, or split into two routes so the permission check lives in the middleware chain where bypass logic is already correct.

---

### 4. Rules routes use `req.user.organisationId`, not `req.orgId`
**Severity:** Blocking — **non-architectural**
**File:** `server/routes/rules.ts` lines 21, 51, 74, 94

```ts
organisationId: req.user!.organisationId,
```

`architecture.md` §Request extensions and §Key Patterns: *"`req.orgId` — resolved org (may differ from user.organisationId for system_admin)"*. For a system_admin using `X-Organisation-Id` to scope into another org, `req.user.organisationId` is their home (system) org but `req.orgId` is the target. Using `req.user.organisationId` in the rule CRUD means:
- system_admin can never create/list/patch/deprecate rules in any org other than their own.
- Worse, if a system_admin IS acting in another org, any rule they save ends up labelled with their home orgId while the RLS tx is set to the target org — row is written then immediately invisible (RLS filters out the mislabelled row).

**Fix:** Replace every `req.user!.organisationId` in this file with `req.orgId!`.

---

### 5. `patchRule` never clears `pausedAt` → resume operation is a no-op
**Severity:** Blocking — **non-architectural**
**File:** `server/services/ruleLibraryService.ts` lines 117–121

```ts
if (patch.status === 'paused') {
  updates.pausedAt = new Date();
} else if (patch.status === 'active') {
  updates.pausedAt = undefined;   // ← bug
}
```

Drizzle's `.set({ field: undefined })` omits the field from the `UPDATE` statement entirely (undefined is treated as "don't touch this column"). To clear a column you must pass `null`. Net effect: once a rule is paused, calling `PATCH /api/rules/:id { status: 'active' }` returns 200 but leaves `paused_at` set, so `listRules` still classifies the rule as `paused` (see `rowToRuleRow` at line 23, which checks `if (row.pausedAt) status = 'paused'`). Users cannot resume paused rules via the UI.

**Fix:** `updates.pausedAt = null as unknown as undefined;` — or better, use the typed insert helper with nullable:
```ts
} else if (patch.status === 'active') {
  updates.pausedAt = null;
}
```
Also add a pure-module test: *Given a rule that was paused yesterday, When patchRule is called with `{ status: 'active' }`, Then the returned row has status='active' AND a subsequent listRules with status='active' includes it.*

---

### 6. LearnedRulesPage treats `api.get` return as the body, not the axios response
**Severity:** Blocking — **non-architectural**
**File:** `client/src/pages/LearnedRulesPage.tsx` lines 37–39

```ts
const result = await api.get<RuleListResult>(`/api/rules?${params}`);
setRules(result.rules);
setTotalCount(result.totalCount);
```

`client/src/lib/api.ts` exports a raw axios instance — `api.get<T>(...)` resolves to `AxiosResponse<T>`, not `T`. `result.rules` is therefore `undefined`, `setRules(undefined)` either crashes the `LearnedRulesTable.map` call or renders an empty list. `result.totalCount` is the axios `statusText`-adjacent `undefined` — the count badge shows "undefined rules".

Contrast `BriefDetailPage.tsx` line 75, where the same author correctly reads `artefactsRes.data ?? []`.

**Fix:** Change to:
```ts
const result = await api.get<RuleListResult>(`/api/rules?${params}`);
setRules(result.data.rules);
setTotalCount(result.data.totalCount);
```
Also add a Given/When/Then test: *Given a logged-in user with 5 saved rules, When LearnedRulesPage mounts, Then the table renders 5 rows AND the heading reads "5 rules".*

---

### 7. `findOrCreateBriefConversation` SELECT is missing `organisationId` filter AND is race-prone
**Severity:** Blocking — **non-architectural**
**File:** `server/services/briefConversationService.ts` lines 38–57

```ts
const [existing] = await db
  .select()
  .from(conversations)
  .where(and(
    eq(conversations.scopeType, input.scopeType),
    eq(conversations.scopeId, input.scopeId),
  ))
  .limit(1);
if (existing) return existing;
// ... INSERT path
```

Two issues:
1. The SELECT is cross-org. It is saved by the `conversations_unique_scope` unique index (which is also cross-org, which is itself a smell — migration 0194 should make it unique per org), but if the lookup ever finds a conversation belonging to another org, the caller receives a row outside their tenant. Today UUID v4 collisions make this effectively impossible, but the code pattern is wrong and the static-gate `verify-org-scoped-writes.sh` may flag it. Add `eq(conversations.organisationId, input.organisationId)` to the SELECT.
2. Classic SELECT-then-INSERT race. Two concurrent POST `/api/briefs` requests for the same `scopeId` both get empty SELECT, both try to INSERT, one hits the unique-index violation and throws a raw Postgres error to the client (500 instead of the expected reconciliation). Brief creation from the global ask bar is naturally single-user-serial but Slack/API hits can race.

**Fix:** Use `INSERT ... ON CONFLICT (scope_type, scope_id) DO NOTHING RETURNING *`, then if no row was returned, re-SELECT. Or wrap in `db.transaction()` with a `SELECT ... FOR UPDATE` advisory lock. Also add `organisationId` to the SELECT as a defensive filter.

---

### 8. `fastPathDecisionLogger.recordFastPathOutcome` updates across orgs
**Severity:** Blocking — **non-architectural**
**File:** `server/services/fastPathDecisionLogger.ts` lines 60–67

```ts
await db
  .update(fastPathDecisions)
  .set({ downstreamOutcome: outcome, outcomeAt: new Date(), ... })
  .where(eq(fastPathDecisions.briefId, briefId));
```

No `organisationId` filter on the WHERE clause. `briefId` is a UUID so collision is unlikely, but `architecture.md` §Key Patterns explicitly requires org scoping on every query. The callsite at `briefCreationService.ts:54` does have `organisationId` available — just thread it through.

**Fix:** Add `organisationId` parameter and include it in the WHERE:
```ts
.where(and(
  eq(fastPathDecisions.briefId, briefId),
  eq(fastPathDecisions.organisationId, organisationId),
))
```

---

### 9. `applyBlockQualityDecay` caps each org at 500 blocks silently; update missing org filter
**Severity:** Blocking — **non-architectural**
**File:** `server/services/memoryEntryQualityService.ts` lines 319–362

Two issues:
1. `.limit(500)` at line 340 — any org with >500 memory_blocks gets only the first 500 decayed; the rest silently never decay. Because ordering isn't explicit either, which 500 get picked is unstable. Hermes-tier customers with large rule libraries will experience stuck quality scores.
2. Both UPDATEs at lines 350–353 and 357–359 use `eq(memoryBlocks.id, row.id)` with no `organisationId` filter. The SELECT at line 325 did scope by org, so functionally-safe, but the pattern is flagged by `verify-org-scoped-writes.sh` and violates the "every service write filters by organisationId" rule.

**Fix:**
1. Either remove the `.limit(500)` (process all), or batch in pages of 500 with an `orderBy(memoryBlocks.id)` and a cursor.
2. Add `eq(memoryBlocks.organisationId, organisationId)` to both UPDATE WHERE clauses.

---

### 10. `ruleAutoDeprecateJob` iterates all orgs from outside any org-scoped tx
**Severity:** Blocking — **architectural** (requires rethinking the job's DB access)
**File:** `server/jobs/ruleAutoDeprecateJob.ts` lines 9–32

The job does `db.select({ id: organisations.id }).from(organisations).limit(500)` and then `applyBlockQualityDecay(org.id)` per org — all outside any `withOrgTx` / `withAdminConnection` block.

Consequences:
- `memory_blocks` is RLS-protected (`rlsProtectedTables.ts` entry at line 169). Without `app.organisation_id` set OR `SET LOCAL ROLE admin_role`, the inner SELECT in `applyBlockQualityDecay` returns zero rows on every org. Job runs, logs "0 decayed, 0 deprecated" every night, never does anything.
- Even the `organisations` select happens outside an org tx.
- `limit(500)` silently caps the job at 500 orgs — not a concern today but worth flagging.

**Fix:** Route through `withAdminConnection({ source: 'rule-auto-deprecate' }, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })` for the org enumeration, then wrap each per-org iteration in `withOrgTx({ organisationId: org.id, source: 'rule-auto-deprecate' }, async () => applyBlockQualityDecay(org.id))` so `app.organisation_id` is set for the per-org work. Same pattern for `fastPathDecisionsPruneJob.ts` and `fastPathRecalibrateJob.ts` — both hit RLS-protected `fast_path_decisions`.

---

## Strong recommendations

### S1. Permissions keys are declared in code but not seeded into any migration
**File:** `server/lib/permissions.ts` lines 84–88; no SQL in `migrations/0193`–`0199`

The five new keys (`org.briefs.read`, `org.briefs.write`, `org.rules.read`, `org.rules.write`, `org.rules.set_authoritative`) are consumed by `requireOrgPermission(...)` in routes, which checks membership in `permission_set_items.permission_key`. Nothing adds these keys to existing permission sets for existing orgs. Consequence: on any deployed production org, non-admin users all 403 out of the new Brief/Rules UI. Admins bypass so it works in dev, but it'll break for agency staff on day one. Existing migrations 0078 and 0117 both include `INSERT INTO permissions (key, description, group_name)` examples you can copy.

**Suggested test:** *Given an existing org with a "Staff" permission set, When migration 0193 runs, Then the "Staff" set includes `org.briefs.read` AND `org.briefs.write` AND attempts to GET `/api/briefs/:id/artefacts` return 200.*

### S2. No skill definition file for `ask_clarifying_questions` / `challenge_assumptions`
**Files:** `server/skills/` — only `ask_clarifying_question.md` (singular) exists

The migration 0196 masterPrompt references `ask_clarifying_questions` (plural) and `challenge_assumptions`. Handlers in `server/tools/capabilities/` exist and are wired into `SKILL_HANDLERS` in `skillExecutor.ts:1456`, so runtime dispatch works. But the "File-based definitions" pattern documented in `architecture.md` §Skill System expects an `*.md` file with frontmatter (`visibility`, parameters, instructions). Without the .md, these capabilities won't render in the config assistant or skill studio UIs, and there's a risk the skill visibility cascade (migration 0074 pattern) won't flag them correctly.

**Fix:** Add `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md` with matching frontmatter + parameter docs.

### S3. Pure-module tests for rule conflict detector parse are thin
**File:** `server/services/ruleConflictDetectorServicePure.ts` + `server/services/__tests__/ruleConflictDetectorPure.test.ts`

The pure parser silently drops items on any validation failure (`continue`). In a malformed LLM response where every conflict is malformed, this returns `{ conflicts: [] }` — indistinguishable from "no real conflicts". Production will silently let users save conflicting rules.

**Suggested tests:**
- *Given an LLM response where `conflicts[0].existingRuleId` references an ID NOT in `candidatePool`, When parseConflictReportPure runs, Then that item is dropped AND the dropped-count is logged/returned.*
- *Given an LLM response with 3 conflicts of kinds `['direct_contradiction', 'invalid_kind', 'subset']`, When parseConflictReportPure runs, Then the returned array has 2 items (invalid_kind filtered).*
- *Given an LLM response with `confidence: 1.5`, When parseConflictReportPure runs, Then the item is dropped.*

### S4. `briefSimpleReplyGeneratorPure.ts` emits canned "See CRM data" strings that never render real data
**File:** `server/services/briefSimpleReplyGeneratorPure.ts` lines 41–87

The `cheap_answer` path short-circuits around the Orchestrator and returns hardcoded rows like `[{ metric: 'Current MRR', value: 'See revenue data' }]`. The UI will render a structured result that looks like real data but is a placeholder. This is noted in the spec but the contract promise is `source: 'canonical'` (line 24) — users will see a properly sourced-looking result with `freshnessMs` absent and no indication this is a stub. This isn't a blocker because `cheap_answer` is only emitted by the tier-1 classifier on very specific query patterns, but it's a trust/UX risk.

**Fix:** Either (a) change `source` to a new `'canned'` or `'stub'` literal (add to `BriefResultSource` in `shared/types/briefResultContract.ts`), or (b) remove the cheap_answer path from `chatTriageClassifierPure.ts` until real data resolvers land. Option (b) is simpler and faster.

### S5. `chatTriageClassifier.classifyWithLlm` — `postProcess` callback discards return value
**File:** `server/services/chatTriageClassifier.ts` lines 67–70

```ts
postProcess: (content: string) => {
  parseLlmDecision(content, input);
},
```

The parse is called to validate-throw; fine. But the parse is then re-run at line 72 `return parseLlmDecision(response.content, input)`. Double parse per LLM call. Micro-optimisation, but also easy to mis-edit into a real bug. Capture the result:
```ts
let parsed: FastPathDecision | null = null;
const response = await routeCall({
  ...,
  postProcess: (content) => { parsed = parseLlmDecision(content, input); },
});
return parsed ?? parseLlmDecision(response.content, input);
```

### S6. No test covers the Phase 4 orchestrator gates firing end-to-end
**Files:** `migrations/0196_orchestrator_clarify_challenge_gates.sql`; handlers exist but integration is text-in-prompt only.

The masterPrompt text update is the only gate wiring. There's no runtime test that asserts "when `clarifyingEnabled=false`, the orchestrator does NOT invoke `ask_clarifying_questions`" or "when `estimatedCostCents > 20` AND `sparringEnabled=true`, `challengeOutput` is populated on the emitted ApprovalCard". Since the gates are prompt-only, regression is easy. A trajectory test fixture (`tests/trajectories/`) that pins the expected tool call sequence per gate input would catch drift.

### S7. `rankByPrecedencePure` never filters by organisationId within the candidates
**File:** `server/services/memoryBlockRetrievalServicePure.ts` lines 59–84

The pure function trusts its caller to pre-filter candidates to the correct org. The input type doesn't enforce this — an `organisationId` field exists but is never used in the ranking logic. A caller that accidentally passes mixed-org candidates would silently rank cross-org rules into the same precedence list.

**Fix:** At the top of `rankByPrecedencePure`, add:
```ts
const inOrg = input.candidates.filter(c => c.organisationId === input.organisationId);
const active = inOrg.filter(...);
```
Trivial defence-in-depth.

### S8. `writeConversationMessage` emits websocket events outside a transaction boundary
**File:** `server/services/briefConversationWriter.ts` lines 69–101

The row is inserted (line 69) then websocket events are emitted (line 87 onwards). If the insert's tx rolls back but the emit already happened (e.g. the outer authenticate-wrapping tx rolls back due to a later error), clients see an "artefact appeared" event for a row that was never persisted. Standard outbox pattern fix.

**Fix:** Either (a) defer emits until after the outer tx commits (listen for `res.finish` and batch), or (b) accept the low probability and flag as non-blocking — but in that case the loading spec in `docs/universal-brief-dev-spec.md` should call it out.

---

## Nits

### N1. `briefArtefactValidatorPure.validateBase` doesn't validate `artefactId` is a well-formed UUID
**File:** `server/services/briefArtefactValidatorPure.ts` line 145

Just `requireString`. A capability emitting `artefactId: ""` passes validation. Consider adding a simple regex check; not worth blocking.

### N2. Backstop pure module has TODO at the call-site
**File:** `server/services/briefArtefactBackstop.ts` lines 33–35

`TODO(phase-6.4-resolvers)` is fine for a phased rollout but `idScopeCheck` and `scopedTotals` being `undefined` means the backstop is a no-op for every real capability. Worth a prominent comment in `getBriefArtefacts` or similar that this check is not yet active, so later PRs don't assume the backstop is enforcing.

### N3. `conversations_unique_scope` index is cross-org
**File:** `migrations/0194_conversations_polymorphic.sql` line 21

`CREATE UNIQUE INDEX conversations_unique_scope ON conversations (scope_type, scope_id);` — doesn't include `organisation_id`. Today UUID collisions across orgs are effectively impossible, but the index semantically belongs as `(organisation_id, scope_type, scope_id)`.

### N4. `conversations.scope_id` is declared UUID but `scopeType='agent'` may point to `subaccount_agents.id` or `agents.id` depending on context
**File:** `server/db/schema/conversations.ts` line 10

Both are UUIDs so the column type is fine, but there's no FK and no discriminator logic in the service. Comment the schema with which scope_type maps to which parent table, or the next reader will guess wrong.

### N5. `ruleTeachabilityClassifierPure.ts` uses `new Date()` inline
**File:** `server/services/ruleTeachabilityClassifierPure.ts` line 74

```ts
userContext.suggestionBackoffUntil > new Date()
```
Pure convention (see `architecture.md` §Pure helper convention) prefers an injected clock. Not a hard violation — no side effect, just non-deterministic. Most existing pure files take a `now: Date` parameter; worth matching the convention.

### N6. `generateSimpleReply` uses `crypto.randomUUID()` inside a Pure module
**File:** `server/services/briefSimpleReplyGeneratorPure.ts` lines 20, 104, 119

Same non-determinism concern as N5 — random UUIDs make unit tests require mocking or opaque `.toMatch(/^[0-9a-f-]+$/)` assertions. Consider accepting an `artefactIdProvider: () => string` injection.

### N7. `getBriefArtefacts` pulls all message artefacts and flattens — no pagination
**File:** `server/services/briefCreationService.ts` lines 96–125

A long-running Brief conversation with dozens of refinements could accumulate hundreds of artefacts. The route `GET /api/briefs/:briefId/artefacts` has no limit or cursor, and `BriefDetailPage.tsx` expects the full list. Fine for V1 but worth flagging before marketing demos.

---

## Summary

| Tier | Count |
|------|-------|
| Blocking | 10 (1 architectural, 9 non-architectural) |
| Strong Recommendations | 8 |
| Nits | 7 |

**Verdict:** Do not merge. The RLS misnaming (finding 1) and the BriefDetailPage wiring break (finding 2) alone make the feature non-functional at the tenant isolation + primary UX level. Most fixes are small, surgical edits; the only architectural blocker (finding 10 — jobs bypassing the admin/org tx contract) needs a modest refactor. After the ten blockers are fixed, re-run `pr-reviewer` before merge.
