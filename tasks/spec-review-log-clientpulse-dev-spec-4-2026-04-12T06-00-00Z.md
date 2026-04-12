# Spec Review Log — clientpulse-dev-spec — Iteration 4

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `87723bf046029c6c8b06abc7613b613f6ae67d5b`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Codex status:** Not available (Codex review CLI is designed for code diffs, not document review — rubric-only review)
**Timestamp:** 2026-04-12T06:00:00Z

## Summary of iteration 4 pass

Focused rubric pass on:
- Cross-section invariant checks
- Dependency graph / build phase completeness
- Schema overlap checks  
- Remaining file inventory drift items

## Finding classifications

---

FINDING #1
  Source: Rubric-file-inventory-drift
  Section: §3.5 Sidebar config integration
  Description: `GET /api/my-sidebar-config` is described in §3.5 prose but has no route table entry and no route file identified. All other new routes in the spec have an explicit route table and a named route file.
  Classification: mechanical
  Reasoning: Consistent with the spec pattern — every other new route has a route table entry and a route file. The `my-sidebar-config` endpoint is load-bearing (Layout.tsx fetches it on every page load) but its implementation target (route file) is unspecified. Adding the route table and naming `server/routes/modules.ts` as the route file resolves the under-specification without scope change.
  Disposition: auto-apply

---

## Adjudication log

[ACCEPT] §3.5 — `GET /api/my-sidebar-config` missing route table and route file
  Fix applied: Added route table entry for `GET /api/my-sidebar-config` and designated `server/routes/modules.ts` as the route file (with note that a non-admin handler must be added alongside the system admin routes).

---

## Additional checks (no findings)

- **`canonical_metrics` table existence** — verified in codebase, consistent with spec references in §6.4. No finding.
- **`connector_configs.syncPhase`** — verified column exists with correct type in schema. No finding.
- **`reports` RLS** — `organisation_id` column confirmed in table DDL; §11 RLS notes consistent. No finding.
- **`org_subscriptions` unique index logic** — `cancelOrgSubscription` transitions to `'cancelled'` which falls outside the partial index; `assignSubscription` deactivates old row first. Consistent and correct. No finding.
- **Phase dependency ordering** — all 5 phases' dependencies verified against the spec's dependency declarations. No sequencing bug found.
- **No remaining `TODO`/`TBD` markers** requiring escalation — only the intentional `TODO(module-g)` bootstrap stub, which is by design.
- **`modules.module_ids` JSONB FK** — JSONB reference is application-level, not a FK. Consistent with Postgres design for pre-production flexibility. No finding.

---

## Iteration counts

- mechanical_accepted: 1
- mechanical_rejected: 0
- directional_or_ambiguous: 0

## Iteration 4 Summary

- Mechanical findings accepted:  1
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified to directional:   0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   87723bf046029c6c8b06abc7613b613f6ae67d5b (changes applied in-session, not yet committed)
