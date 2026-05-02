# ChatGPT Spec Review Session — deferred-items-pre-launch — 2026-05-01T01-46-26Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-01-deferred-items-pre-launch-spec.md
- Branch: claude/deferred-items-pre-launch-5Kx9P
- PR: #247 — https://github.com/michaelhazza/automation-v1/pull/247
- Mode: manual
- Started: 2026-05-01T01:46:26Z
- **Verdict:** APPROVED (3 rounds)

---

## Round 1 — 2026-05-01T01:56:00Z

### ChatGPT Feedback (raw)
Executive summary: The spec is solid, tightly scoped, and executable. No architectural ambiguity. The main risks are around silent misses (coverage gaps), consistency across injection paths, and drift between "registry intent" and runtime behaviour.

1. Action registry drift risk (E-D3) — Severity: high — Category: improvement — Add defensive invariant/warning inside `checkRequiredIntegration` for known external tool namespaces + test case "Known external tool without tag logs warning".
2. Resume path parity (A-D1) — Severity: high — Category: bug — On resume, explicitly overwrite `runMetadata.threadContextVersionAtStart = threadCtx!.version`; spec invariant: resume always reflects latest context.
3. Prompt injection ordering contract — Severity: medium — Category: architecture — Thread context must be first block prepended, before external docs, memory, etc. Prevents nondeterministic composition.
4. Soft-delete joins: left join semantics guard (§2.3) — Severity: high — Category: bug — For leftJoin, isNull(deletedAt) MUST be in ON clause only; WHERE converts to inner semantics.
5. Group B move-to-ON null-safety edge case — Severity: medium — Category: improvement — Verify no downstream logic depends on missing rows being null before moving WHERE filter to ON.
6. Drive connection guard: org-level connections (§2.5) — Severity: high — Category: bug — Guard `conn.subaccountId !== subaccountId` would wrongly block null-subaccountId org-level connections. Proposed fix: `if (conn.subaccountId && conn.subaccountId !== subaccountId)`.
7. Integration lookup performance — Severity: medium — Category: improvement — Index required on (organisationId, subaccountId, providerType, status).
8. Thread context token discipline — Severity: medium — Category: improvement — Add truncation enforcement for ~500 token limit.
9. Migration safety (§2.4) — Severity: medium — Category: improvement — Add DO $$ BEGIN/EXCEPTION block to prevent deploy failure on policy-name drift.
10. Stub source UI fallback — Severity: low — Category: improvement — Lock that `'stub'` must never render with same visual style as `'canonical'`.

Overall verdict: APPROVED (with the 5 listed tweaks).

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Registry drift warning in checkRequiredIntegration | technical-escalated (high severity) | reject | reject (user: as recommended) | high | Scope expansion; naming-pattern heuristic is fragile and produces false positives; safe-default already documented |
| F2 — Explicit threadContextVersionAtStart on resume | technical | apply | auto (apply) | high | Genuine gap — Step 3 "same two lines" shorthand dropped the version write; critical for resume-path correctness |
| F3 — Prompt injection ordering invariant | technical | apply | auto (apply) | medium | Missing internal contract; prevents nondeterministic composition if other injection paths land later |
| F4 — Left join semantics guard (§2.3 Group C) | technical | apply | auto (apply) | high | leftJoin at ~499 in subaccountAgentService.ts — WHERE vs ON has different semantics; must be explicit |
| F5 — Group B null-safety checklist note | technical | apply | auto (apply) | medium | Mechanical clarification; prevents silent behavioural change if downstream code tests for null agents |
| F6 — Drive guard: org-level null subaccountId | technical-escalated (defer — uncertain) | defer | defer (user: as recommended) | high | Data model uncertainty; if subaccountId can be null, current guard wrongly blocks; deferred to verify |
| F7 — Integration lookup index requirement | technical | reject | auto (reject) | medium | Scope expansion; performance baseline deferred pre-production per spec-context.md |
| F8 — Thread context token truncation enforcement | technical-escalated (defer) | defer | defer (user: as recommended) | medium | YAGNI pre-production; guideline documented; defer until measurable in production |
| F9 — Migration DO $$ exception block | technical | reject | auto (reject) | medium | Over-engineering; drop-and-recreate fallback already provided; pre-production revert is sufficient |
| F10 — stub must not render as canonical | user-facing | apply | apply (user: as recommended) | low | Prevents future implementer giving stubs canonical trust signal; explicit constraint locks right behaviour |

### Applied
- [auto] §2.2 Step 3: explicit `runMetadata.threadContextVersionAtStart = threadCtx!.version` overwrite on resume
- [auto] §2.2: added "Prompt injection ordering invariant" section — thread context is always first
- [auto] §2.3 Group B: added null-safety checklist note before moving WHERE to ON
- [auto] §2.3 Group C: added left join semantics guard note for subaccountAgentService.ts ~499
- [user] §2.6 Step 3: added explicit constraint that `'stub'` must not render with `'canonical'` visual style

### Top themes
Injection path consistency (F2, F3), join-filter placement precision (F4, F5), boundary validation gaps (F6, F10).

---

## Round 2 — 2026-05-01T02:10:00Z

### ChatGPT Feedback (raw)
"This is it. You've closed every meaningful gap." Overall verdict: APPROVED. Two remaining tweaks: (1) Drive guard hard-locks all connections as subaccount-scoped — fix with null-safe check. (2) Thread context growth unconstrained despite ~500 token guideline — add deterministic MAX_ITEMS = 20 cap with slice().

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| R2-F1 — Drive guard: forward-safe null check | user-facing | apply | apply (user: as recommended) | medium | Resolves R1/F6 defer; null check preserves org-level connection validity without behaviour change for subaccount-scoped connections |
| R2-F2 — Thread context MAX_ITEMS=20 cap | technical-escalated (previously user-deferred R1/F8) | apply | apply (user: as recommended) | medium | Mechanism changed from "token counting" (heuristic) to "item counting" (deterministic) — no longer YAGNI |

### Applied
- [user] §2.5: guard updated to `if (conn.subaccountId && conn.subaccountId !== subaccountId)` with explicit org-level note
- [user] §2.2: `formatThreadContextBlock` now has `const MAX_ITEMS = 20` with `slice(0, MAX_ITEMS)` on tasks and decisions

### Top themes
R1 deferred items resolved with concrete mechanisms; no new gaps surfaced.

---

## Round 3 — 2026-05-01T02:15:00Z

### ChatGPT Feedback (raw)
"Stop iterating the spec. Move to build." One tiny inconsistency: §2.5 acceptance criteria still says `conn.subaccountId === subaccountId` guard; should match the null-safe guard now in the implementation section.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| R3-F1 — §2.5 acceptance criteria wording mismatch | technical | apply | auto (apply) | low | Mechanical wording inconsistency — criteria didn't reflect the null-safe guard applied in R2 |

### Applied
- [auto] §2.5 acceptance criteria: updated to "conn.subaccountId must be null (org-level) or match subaccountId"

### Top themes
Wording consistency — no functional gaps remaining.

---

## Final Summary
- Rounds: 3
- Auto-accepted (technical): 5 applied | 2 rejected | 0 deferred
- User-decided: 3 applied | 1 rejected | 2 deferred (both resolved as applies in R2 — net 0 remaining)
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / deferred-items-pre-launch: none (R1 defers resolved in R2)
- KNOWLEDGE.md updated: yes (2 entries — subaccount null-safe guard pattern; spec step-shorthand side-effect pattern)
- architecture.md updated: n/a
- capabilities.md updated: n/a
- integration-reference.md updated: no — no new integration scope, capability, or status changed; §2.1 wires enforcement for existing integrations only
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a
- spec-context.md updated: no — spec aligns with existing framing; no new accepted_primitives or convention_rejection changes implied
- frontend-design-principles.md updated: n/a
- PR: #247 — spec changes ready at https://github.com/michaelhazza/automation-v1/pull/247
