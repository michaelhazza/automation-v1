# ChatGPT PR Review Session — claude-audit-system-agents-46kTN — 2026-04-27T08-36-18Z

## Session Info
- Branch: `claude/audit-system-agents-46kTN`
- PR: #216 — https://github.com/michaelhazza/automation-v1/pull/216
- Title: feat(system-agents): v7.1 migration — manager-role guard, cross-run idempotency, 14 new skills
- Started: 2026-04-27T08:36:18Z

---

## Round 1 — 2026-04-27T08-36-18Z

### ChatGPT Feedback (raw)

PR #216 is not merge-ready yet. I found 3 additional merge-blocking issues.

1. Org-scoped idempotency is declared but impossible
   skill_idempotency_keys.subaccount_id is NOT NULL, and the wrapper throws when context.subaccountId is missing, but several registry entries declare idempotency.scope: 'org'. Those org-level config skills will fail before execution. Fix by either supporting nullable/org keys properly or removing org-scope idempotency until schema supports it.

2. Idempotency hits leave new action rows unresolved
   executeWithActionAudit proposes an action before checking skill_idempotency_keys. On completed replay it returns cached payload immediately, but the newly proposed action is never locked, completed, failed, or cancelled. Replays can accumulate dangling action rows.

3. Parsed Zod input is not passed to handlers
   The wrapper parses into parsedInput, hashes that, then calls executor(), but the handler closures still capture raw input. Defaults/transforms used for idempotency may not match what the handler actually executes. Pass parsedInput into the handler path or make executeWithActionAudit accept an executor that receives processed input.

Already-known but still worth fixing before final: head-of-growth declares external reads that the manager guard will block, and request_hash is still only a 64-bit truncated digest. These are recorded in the PR notes/todo trail.

Verdict: fix the 3 above, then rerun unit tests + gates once.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Scope | Rationale |
|---------|--------|----------------|----------------|----------|-------|-----------|
| 1. Org-scoped idempotency declared but schema requires subaccount | technical | implement (switch the 4 `config_*` org-scope entries to `scope: 'subaccount'`) | implement (user "all as recommended") | high | standard | High-severity escalation. Schema (`subaccount_id NOT NULL`) and wrapper (line 2157-2159 throw guard) both enforce subaccount keying. The 4 `scope: 'org'` declarations (`config_create_agent`, `config_update_agent`, `config_activate_agent`, `config_create_subaccount`) are dead-end metadata that will throw at runtime if a caller ever supplies missing subaccount context. Switching to `'subaccount'` matches what is actually enforced; nullable-org alternative needs a migration + RLS policy revisit (out of scope). |
| 2. Idempotency hits leave action rows unresolved | technical | implement (close `proposed.actionId` to terminal status on every cached-return path) | implement (user "all as recommended") | high | standard | High-severity escalation. Wrapper proposes the action at line 2061, then on cached-completed replay returns at line 2218 without ever calling `markCompleted`/`markFailed` for the freshly-proposed row. Same dangling-row leak in `idempotency_collision` (2212), `previous_failure` (2261), `in_flight` (2230, 2255). Fix: mark the proposed row terminal (`completed` mirroring cached payload, or `failed`/`cancelled` for unrecoverable branches) before each early return. Mechanical, contained to the wrapper. |
| 3. Parsed Zod input not passed to handlers (Zod defaults drift between hash and execution) | technical | implement (change executor signature `() => Promise<unknown>` → `(processedInput) => Promise<unknown>`, thread `parsedInput` from line 2284 through; update ~70 call sites to use the parameter instead of closure-captured `input`) | implement (user "all as recommended") | high | architectural | High-severity AND architectural-scope escalation. The wrapper hashes `parsedInput` (with Zod `default()` materialised) but executors capture raw `input`. Any skill with Zod defaults (e.g. `config_link_agent.isActive` defaults true; `read_campaigns.include_ad_groups` defaults false) will have a key→handler value drift. Mechanical fix touches ~70 call sites in `skillExecutor.ts` but is a single-shot rename + parameter wiring. Architectural scope_signal because the executor contract is changed across the file. |
| 4. (already-known) head-of-growth declares `read_campaigns`/`read_analytics` blocked by manager guard | technical | defer (keep in `tasks/todo.md` line 1128) | defer (user "all as recommended") | medium | standard | Defer escalation. Already routed for human decision (option a vs b in the existing todo entry). Reversing the prior defer here would silently override a deliberate user choice; surfacing it preserves the audit trail. ChatGPT explicitly notes this is "already-known". |
| 5. (already-known) `request_hash` is 64-bit truncated digest | technical | defer (keep in `tasks/todo.md` line 1136) | defer (user "all as recommended") | medium | standard | Defer escalation. Already routed (introduce `computeRequestHashForIdempotency` returning full SHA-256). Same logic as #4 — surfacing the defer keeps the audit trail; reversing silently would override a prior call. |

### User Decision
User reply (verbatim): "all as recommended"

Resolution per item:
- 1: implement
- 2: implement
- 3: implement
- 4: defer (already in `tasks/todo.md`)
- 5: defer (already in `tasks/todo.md`)

### Implemented (this round)
_To be filled in after each commit lands._

---
