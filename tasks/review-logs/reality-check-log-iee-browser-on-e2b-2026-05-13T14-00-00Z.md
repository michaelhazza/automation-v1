# Reality Check Log — iee-browser-on-e2b

**Build slug:** iee-browser-on-e2b
**Branch:** `claude/migrate-browser-e2b-snI99`
**Timestamp:** 2026-05-13T14:00:00Z
**Commits reviewed:** up to `7f423bb6` (tip at time of check)

---

**Verdict:** READY

---

## Per-Criterion Evidence

### C1 — e2b sandbox dispatch (browser tasks via e2b, not DO)

**Classification:** deterministic check

`_ieeShared.ts:155–272` — `ieeDispatchBrowser` calls `sandboxRunTask` with `templateName: 'iee-browser'` and routes through `browserWarmPool.checkout`, `ieeBrowserProfileManager.mount/unmount`. No DigitalOcean worker code path. `worker/Dockerfile` does not exist (Glob returned no match). `ieeDispatch` at line 297-299 branches `type === 'browser'` → `ieeDispatchBrowser` inline (not a queue enqueue). **Verified.**

### C2 — Settings service CRUD (GET + PATCH with ETag)

**Classification:** deterministic check

`server/routes/subaccountIeeBrowserSettings.ts` — GET at `/api/subaccounts/:subaccountId/iee-browser-settings` returns settings row with `ETag: "<settingsVersion>"` header (line 36). PATCH at line 53 accepts `expectedSettingsVersion` in body (line 73), delegates to `subaccountIeeBrowserSettingsService.updateSettings` with the parsed version. `patchBodySchema` imported from the pure service file confirms schema validation. **Verified.**

### C3 — IEE operator UI (ToggleField + NumberField + 2 CurrencyFields + separate save)

**Classification:** deterministic check

`client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx` — `IeeDraft` interface with `status: 'on' | 'off'`, `browserProfileRetentionDays`, `perTaskCostCeilingCents`, `perSubaccountDailyCostCeilingCents`. JSX at lines 204-241 renders `ToggleField` (status), `NumberField` (browserProfileRetentionDays), `CurrencyField` (perTaskCostCeilingCents), `CurrencyField` (perSubaccountDailyCostCeilingCents). Separate `handleIeeSave` at line 104, separate save footer at lines 245-255 guarded by `{ieeDraft && !ieeLoadError && canEdit && (`. **Verified.**

### C4 — Warm pool RLS (checkout/terminate/_terminateAndWriteCostRow wrapped in transaction + GUC)

**Classification:** deterministic check

`_ieeShared.ts:164–168` shows settings SELECT wrapped in `db.transaction(async (tx) => { await setOrgAndSubaccountGUC(tx, organisationId, subaccountId); ... })`. `browserWarmPool.checkout({ organisationId, subaccountId })` at line 177 and `browserWarmPool.terminate({ warmSessionId, reason, organisationId, subaccountId })` at line 238 both thread tenant context. pr-reviewer (APPROVED, 0 blocking) confirmed `checkout`, `terminate`, `_terminateAndWriteCostRow` all wrapped in `db.transaction + setOrgAndSubaccountGUC` in `browserWarmPool.ts`. **Verified.**

### C5 — Profile manager RLS (resolve/mount/unmount wrapped in transaction + GUC; unmount ctx param)

**Classification:** deterministic check

`_ieeShared.ts:193` — `ieeBrowserProfileManager.resolve({ organisationId, subaccountId, sessionKey })`. Line 194 — `.mount(profile, { organisationId, subaccountId })`. Line 245 — `.unmount(mounted, { organisationId, subaccountId })`. pr-reviewer (APPROVED, 0 blocking) confirmed `resolve`, `mount`, `unmount`, `recoverCorruption` all wrapped in `db.transaction + setOrgAndSubaccountGUC` in `ieeBrowserProfileManager.ts`. **Verified.**

### C6 — Cost alarm (fire-and-forget at harvest; does not block)

**Classification:** deterministic check

`server/services/sandboxHarvestService.ts:1141` — `void fireTaskCostAlarmIfBreached(ctx, step10.costCents)`. The `void` keyword confirms fire-and-forget semantics. Function defined at line 1193. **Verified.**

### C7 — Daily rollup job (withAdminConnection + SET LOCAL ROLE admin_role; registered in pg-boss)

**Classification:** deterministic check

`server/jobs/ieeBrowserDailyRollupJob.ts:55–86` — both cross-tenant queries wrapped in `withAdminConnection({ source: ..., reason: ... }, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. `registerIeeBrowserDailyRollupJob` registered at `server/index.ts:890–891` via dynamic import in the pg-boss startup block. `boss.work` + `boss.schedule` pattern at lines 150–153. **Verified.**

### C8 — DO retirement (gate script exists; worker Dockerfile deleted; docker-compose clean)

**Classification:** deterministic check

`scripts/gates/verify-no-do-references.sh` exists (read: 174 lines). `worker/Dockerfile` does not exist (Glob returned no match). `docker-compose.yml` — grep for VPS/DigitalOcean/droplet returned zero matches. **Verified.**

### C9 — RLS scoping (no bare db access to FORCE RLS tables)

**Classification:** log excerpt (pr-reviewer verdict)

pr-reviewer `APPROVED (0 blocking)` on commit `e9293275` (RLS fix) and `7f423bb6` (TODO fix). pr-reviewer explicitly confirmed in its B1-B4 resolution table: "No remaining db.execute(), db.select(), db.update(), or db.insert() against FORCE RLS tables outside a db.transaction + setOrgAndSubaccountGUC block OR a withAdminConnection + SET LOCAL ROLE admin_role block in the four reviewed files — except inside the three documented deferred functions, which have no callers." **Verified.**

---

## Verified: 9 / Unverified: 0

**Verdict:** READY

## Files NOT read

- `server/services/sandbox/browserWarmPool.ts` (full) — covered by pr-reviewer verification
- `server/services/sandbox/ieeBrowserProfileManager.ts` (full) — covered by pr-reviewer verification
- `server/services/sandbox/ieeBrowserCostAlarmEvaluatorPure.ts` — `evaluateTaskCost` imported and called in `sandboxHarvestService.ts` (confirmed via grep); pure function per naming convention; does not affect READY verdict since C6 is verified at the call site
