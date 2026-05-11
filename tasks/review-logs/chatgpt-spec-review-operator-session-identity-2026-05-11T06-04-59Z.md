# ChatGPT Spec Review Session — operator-session-identity — 2026-05-11T06-04-59Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md
- Branch: claude/evolve-session-identity-brief-17LO4
- PR: #286 — https://github.com/michaelhazza/automation-v1/pull/286
- Mode: manual
- Started: 2026-05-11T06:04:59Z

---

<!-- rounds appended below -->

## Round 1 — 2026-05-11T06:15:00Z

### ChatGPT Feedback (raw)
> 3 blockers (F1 connected_unverified contradictory semantics, F2 Chunk 4 re-creates credentialBrokerServicePure.ts, F3 allowed-subscriptions route mixes return shapes) + 3 tightenings (T1 §17.5b targets non-pure service, T2 rlsProtectedTables.ts misclassified, T3 Make Default concurrency prose overclaims SELECT FOR UPDATE) + 1 open question resolution (OQ3 subaccount-scoped consent). Verdict: CHANGES_REQUESTED. CEO read: directionally strong, 3 build-blocking consistency issues, 3 tightenings.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — `connected_unverified` semantics contradictory (self-declared connects unusable forever) | user-facing | apply (Option B — disclosure accepted → connected_usable) | apply (user-approved) | critical | Option A leaves early adopters with dead-on-arrival subscriptions; plan_verification_status carries the audit signal |
| F2 — Chunk 4 re-creates `credentialBrokerServicePure.ts` already owned by Chunk 2 | technical | apply | auto (apply) | high | Dependency ownership bug; builders may duplicate or skip Chunk 2 delivery |
| F3 — `allowed-subscriptions` route mixes `AiSubscriptionConnection` and platform-managed shapes | technical-escalated (high severity) | apply — scope route to operator_session only | apply (user-approved) | high | Route type contract violation; platform-managed rows stay in broker only |
| T1 — §17.5b acceptance test targets non-pure `credentialBrokerService` | technical | apply | auto (apply) | medium | Testing posture violation — service is not a pure function; use pure helper |
| T2 — `rlsProtectedTables.ts` listed under "New config files" | technical | apply | auto (apply) | low | Existing file is modified, not new; inventory locks become mechanical gates |
| T3 — Make Default concurrency prose overclaims `SELECT ... FOR UPDATE` coverage | technical | apply | auto (apply) | low | Lock only prevents race when a current default exists; 23505→409 is the no-default guard |
| OQ3 — Open Question §18.3 (subaccount vs org consent) unresolved | technical | apply — resolve in §18b | auto (apply) | low | Already encoded subaccount-scoped in spec; close the open question |
| IC-1 — §7.4 build-time gating still said `connected_unverified + self_declared` (integrity check) | technical | apply | auto (apply) | medium | Stale copy of text now updated in §11.1 after Option B |
| IC-2 — §11.1 Branch B response "For connected_unverified results" too broad (integrity check) | technical | apply | auto (apply) | low | Clarified to scope to `failed` plan detection outcomes only |
| IC-3 — `'unverified'` in `planVerificationStatus` type union has no write path (integrity check) | user-facing (ambiguous) | apply — remove from union | apply (user-approved) | low | `'failed'` already covers indeterminate tier; `'unverified'` was orphaned |

**Integrity check:** 3 issues found (IC-1 auto, IC-2 auto, IC-3 escalated). Post-integrity sanity: clean — no broken references, no empty sections.

### Applied (auto-applied technical + user-approved user-facing)
- [auto] F2: Chunk 4 wording updated — references existing file from Chunk 2, no re-creation
- [auto] T1: §17.5b first bullet retargeted to `credentialBrokerServicePure.orderResolvedCredentials` with static-gate complement
- [auto] T2: §8.4 renamed "New and modified config files"; `rlsProtectedTables.ts` annotated as Modified
- [auto] T3: §16.3 Make Default concurrency prose scoped to "when a current default row exists"; no-current-default case documented
- [auto] OQ3: §18b extended with subaccount-scoped consent resolution
- [auto] IC-1: §7.4 build-time gating text updated to `connected_usable + self_declared` (Option B)
- [auto] IC-2: §11.1 Branch B response 201 text scoped to `failed` plan detection outcomes only
- [user] F1 (Option B): §7.4 outcome table, §7.5 state machine (new initial transitions + Note on entry point), §11.1 disclosure gate, §11.1 build-time gating, §17.5 fourth bullet — all updated to reflect self-declaration + disclosure accepted → `connected_usable + self_declared`
- [user] F3: §12 Chunk 10 allowed-subscriptions route scoped to operator_session rows only; `listAllowedSubscriptionsForAgent` now queries directly rather than delegating to broker
- [user] IC-3: `'unverified'` removed from `planVerificationStatus` union in §7.1 Drizzle comment and §9.2 TypeScript type

**Top themes:** (1) Option B resolves the dead-on-arrival self-declaration flow by using `plan_verification_status` as the audit signal instead of gating broker access. (2) Chunk plan dependency ownership bugs are the most common mechanical spec error in this codebase — cross-check file ownership across chunks before locking. (3) Type union members need write paths; orphaned values become implementation traps.

---
