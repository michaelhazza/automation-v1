# Spec Conformance Log

**Spec:** `tasks/builds/operator-session-identity/plan.md` § Chunk 9 (lines 1256-1318) + upstream `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md` §5.1, §5.2, §5.5, §5.6, §6, §8.12, §8.13, §8.14, §17.7
**Spec commit at check:** `10985b91` (head; plan.md unchanged in this chunk)
**Branch:** `claude/evolve-session-identity-brief-17LO4`
**Base:** `c896cdea` (end of Chunk 8 re-verification)
**Head:** `10985b91` (Chunk 9 single commit)
**Scope:** Chunk 9 (per `tasks/builds/operator-session-identity/plan.md` § "Chunk 9, Web Logins tab + CRUD consolidation")
**Changed-code set:** 7 files (4 new, 2 deleted, 1 converted)
**Run at:** 2026-05-11T11:04:24Z

---

## Summary

- Requirements extracted:     10
- PASS:                       8
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (2 directional gaps — see deferred items)

---

## Requirements extracted (full checklist)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #1 | plan §Chunk 9 "Web Login table contract" | `WebLoginsTab` table contract — columns, sort, filter. | PASS |
| #2 | plan §Chunk 9 "Files to create" + mockup 12 | `AddWebLoginModal` — 4 primary + 6 advanced. | PASS |
| #3 | plan §Chunk 9 "Files to create" + mockup 13 | `EditWebLoginModal` — same shape + leave-blank password. | PASS |
| #4 | plan §Chunk 9 "Test Web Login (existing IEE pattern)" | `TestWebLoginModal` — agent attribution + 202+progressUrl follow + row dot update on complete. | DIRECTIONAL_GAP |
| #5 | plan §Chunk 9 "Files to remove" / spec §5.6 / §8.14 | `CredentialsTab.tsx` DELETED. | PASS |
| #6 | plan §Chunk 9 "Files to convert" / spec §5.2 / §8.14 | `IntegrationsAndCredentialsPage.tsx` CONVERTED to redirect; not deleted; routes.ts unchanged. | PASS |
| #7 | plan §Chunk 9 "Disconnect flow" / spec §17.8 | Disconnect uses shared `DisconnectConfirmDialog`. | DIRECTIONAL_GAP |
| #8 | plan §Chunk 9 "Cross-chunk edit coordination warning" | NO `ConnectionsPage.tsx` edits. | PASS |
| #9 | plan §Chunk 9 (absence) | NO `governApi.ts` additions for web logins. | PASS |
| #10 | plan §Chunk 9 "Test considerations" / spec §15 | No frontend unit tests. | PASS |

---

## Evidence (per REQ)

### REQ #1 — WebLoginsTab columns / sort / filter — PASS

Evidence: `client/src/pages/govern/components/WebLoginsTab.tsx`
- Columns rendered at lines 437-485: Label, Site (URL), Username (masked via `maskUsername`), Status (dot/pill), Last tested, Owner, Actions (3-dot menu) — superset of the plan-named columns; not a gap.
- Sort defaults to Label asc (lines 226-227: `useState<SortKey>('label')` / `useState<SortDir>('asc')`); sortable keys include label, loginUrl, username, status, lastTestedAt, owner — superset of plan-named sort keys (label / lastTestedAt / status).
- Filter dropdown at lines 343-345 has "All / Connected / Test failed / Untested / Error" — superset of the plan-named four; the extra "Error" filter maps to `connectionStatus === 'error'` and is consistent with the row's status mapping (line 50).
- Search filter at lines 265-270 searches label and loginUrl substring.
- Username masking at lines 87-96 keeps first 2 chars + dots + domain.

The extra column (Owner), extra sort keys (loginUrl, username, owner), and extra filter option (Error) are additions beyond what the plan named. The plan names minimums, not a closed set. PASS.

### REQ #2 — AddWebLoginModal — 4 primary + 6 advanced — PASS

Evidence: `client/src/pages/govern/components/AddWebLoginModal.tsx`
- 4 primary fields: label (144-161), loginUrl (163-180), username (182-199), password (201-217). All required, all validated.
- Advanced section toggle at lines 220-237; advanced section renders only when `showAdvanced === true` (line 240). Default is collapsed (line 60: `useState(false)`).
- 6 advanced fields: contentUrl (242-253), usernameSelector (254-265), passwordSelector (266-277), submitSelector (278-289), successSelector (290-301), timeoutMs (302-315). Exact match.
- Submit logic (83-133) packs all 4 primary fields into the request and only includes advanced fields that have a value.

### REQ #3 — EditWebLoginModal — same shape + leave-blank password — PASS

Evidence: `client/src/pages/govern/components/EditWebLoginModal.tsx`
- Same field set as Add (primary + advanced).
- Password label at line 240 reads "Leave blank to keep current password"; placeholder at line 246 repeats the instruction.
- Validation at lines 92-103 omits the "password required" check (compare to Add line 78 which DOES require it).
- Submit logic at line 143: `if (form.password) body.password = form.password;` — empty password is dropped from the patch body, preserving the existing stored password.
- Form-reset effect at lines 68-84 re-seeds the form when the target `connection` prop changes.

### REQ #4 — TestWebLoginModal — IEE pattern — DIRECTIONAL_GAP

Evidence: `client/src/pages/govern/components/TestWebLoginModal.tsx`
- Agent attribution dropdown PRESENT (lines 110-121): loads `/api/subaccounts/{id}/web-login-connections/test-eligible-agents`, auto-selects when there is exactly one option, disables Run button until a selection is made.
- Running state UI PRESENT (lines 124-132): spinner + "Test in progress..." banner when `firing === true`.
- POST PRESENT (lines 67-70): `POST /api/subaccounts/{id}/web-login-connections/{id}/test` with `{ agentId, subaccountAgentId }`.
- **Gap A:** Client reads only `data.agentRunId` (line 71) and navigates to a hardcoded route `/admin/subaccounts/{subaccountId}/runs/{agentRunId}` (line 73). The plan's contract names "Server responds 202 with `{ agentRunId, ieeRunId, progressUrl }`. Client follows `progressUrl` via existing run-trace pattern."
- **Gap B:** Plan also says "updates the row's test-status dot when the run completes." There is no completion listener, no polling, and no callback into `WebLoginsTab` to refresh that row's dot.

Why DIRECTIONAL (not MECHANICAL):
- Whether the hardcoded route IS the canonical "progress URL" or whether `progressUrl` from the response body is a different URL (e.g. a websocket / SSE endpoint) is a design question that needs the server-side contract checked. Navigating to the wrong URL is worse than navigating to the right hardcoded one.
- Updating the row's dot on completion requires a real-time mechanism (websocket, polling, or page-refocus invalidation). Existing IEE patterns elsewhere in the codebase may already provide an idiomatic primitive — choosing the wrong one would create a parallel mechanism rather than reusing.

### REQ #5 — `CredentialsTab.tsx` DELETED — PASS

Evidence:
- `git show --stat 10985b91`: `client/src/components/CredentialsTab.tsx | 685 ---------------------` (full deletion).
- Filesystem check: `client/src/components/CredentialsTab.tsx` no longer exists on disk.
- `grep CredentialsTab|CredentialsAuditLog client/` returns zero matches — no orphan import.
- Bonus: `client/src/components/CredentialsAuditLog.tsx` also deleted in the same commit (sole importer was `CredentialsTab`); commit message explicitly calls this out.

### REQ #6 — `IntegrationsAndCredentialsPage.tsx` CONVERTED to redirect — PASS

Evidence: `client/src/pages/IntegrationsAndCredentialsPage.tsx` (full file, 13 lines)
- Imports `useEffect` and `useNavigate` (lines 1-2).
- Renders nothing (`return null;` line 12).
- One-line effect (line 10): `navigate('/connections', { replace: true });`.
- File NOT deleted (still on disk, still in `git ls-tree`).
- `git diff c896cdea 10985b91 -- client/src/config/routes.ts` returns empty — routes.ts unchanged.

Exactly matches the plan's prescribed shape.

### REQ #7 — Disconnect flow uses shared `DisconnectConfirmDialog` — DIRECTIONAL_GAP

Evidence: `client/src/pages/govern/components/WebLoginsTab.tsx`
- The only `DisconnectConfirmDialog` reference is an explanatory comment at line 210: "// the shared DisconnectConfirmDialog requires a unified Connection type; web login connections use a different shape. We do a simple window.confirm-level inline confirm here."
- Actual disconnect implementation at lines 292-303 uses `window.confirm(...)` and `api.delete(...)`.
- No type-to-confirm gate; no impact preview; no shared-component reuse.

Why DIRECTIONAL (not MECHANICAL):
- The shared `DisconnectConfirmDialog` is typed against `Connection` from `shared/types/govern.ts` (the consolidation-govern domain). `WebLoginConnection` (declared locally in `WebLoginsTab.tsx:27-41`) has a different shape — different field names, no `usage` endpoint, different `disconnect` route.
- Closing this gap requires either (a) generalising the shared dialog's `Connection` type to a discriminated union covering both AI Subscriptions and Web Logins, plus widening `getConnectionUsage` / `disconnectConnection` to dispatch on type, or (b) building a Web-Login-specific wrapper that adapts the shared dialog. Both are cross-chunk design choices that touch Chunk 8's component contract.
- The builder explicitly considered this and left a paper-trail comment — not an oversight, a deferred design call.

This is related to but **distinct from** the existing REQ #9 entry under "## Deferred from spec-conformance review — operator-session-identity (2026-05-11)" in `tasks/todo.md`: that one is about the shared dialog gating on the literal string `"disconnect"` rather than on the connection's label. This Chunk 9 gap is that the shared dialog is not used AT ALL on the Web Logins surface — a separate concern.

### REQ #8 — NO `ConnectionsPage.tsx` edits — PASS

Evidence: `git diff c896cdea 10985b91 -- client/src/pages/govern/ConnectionsPage.tsx` returns empty. Chunk 10 retains ownership of that file.

### REQ #9 — NO `governApi.ts` additions — PASS

Evidence: `git diff c896cdea 10985b91 -- client/src/api/governApi.ts` returns empty. The four Chunk 9 components call `api.get / post / patch / delete` directly against `/api/subaccounts/.../web-login-connections` paths (`WebLoginsTab.tsx:244, 296`; `AddWebLoginModal.tsx:106`; `EditWebLoginModal.tsx:145`; `TestWebLoginModal.tsx:34, 67`). Matches the plan's "web logins use existing `/api/subaccounts/...` endpoints directly".

### REQ #10 — No frontend unit tests — PASS

Evidence: `git show --stat 10985b91` lists exactly 7 files, none with a `.test.` infix. Matches §15 testing posture.

---

## Lint + typecheck on the chunk's expanded state

- `npm run lint` → 0 errors, 899 warnings (project baseline; no new warnings in Chunk 9 files).
- `npm run typecheck` → clean (both `tsconfig.json` and `server/tsconfig.json`).

---

## Mechanical fixes applied

None. Both gaps are DIRECTIONAL.

---

## Directional / ambiguous gaps (routed to `tasks/todo.md`)

- REQ #4 — TestWebLoginModal does not follow `progressUrl` from the 202 response and does not update the row's test-status dot when the run completes.
- REQ #7 — Web Login disconnect uses inline `window.confirm` rather than the shared `DisconnectConfirmDialog`; the shared dialog's `Connection` type does not accept the `WebLoginConnection` shape.

Both appended to `tasks/todo.md` under a new "## Deferred from spec-conformance review — operator-session-identity chunk 9 (2026-05-11)" section. Pre-existing Chunk-8 entries are not duplicated here.

---

## Files modified by this run

- `tasks/todo.md` — appended new deferred-items section
- `tasks/review-logs/spec-conformance-log-operator-session-identity-chunk-9-2026-05-11T11-04-24Z.md` — this file

No source files modified (zero mechanical fixes).

---

## Next step

NON_CONFORMANT — 2 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — operator-session-identity chunk 9 (2026-05-11)".

Operator may also reasonably elect to ACCEPT both gaps as V1 deferrals (matching the disposition used for Chunk 8's REQ #5a master toggle / Edit label), in which case Chunk 9 is logically complete and `pr-reviewer` can proceed against the existing branch state. The deferrals stay open as the durable record of the deferred capabilities.

**Commit at finish:** `4134db29`
