# Spec Review Iteration 2 — Wave 5 Session M (LAEL Phase 1+2 + Hermes Tier 1)

- **Spec:** `tasks/builds/wave-5-lael-phase-1-and-2/spec.md`
- **Spec commit at start of iter 2:** `6135de00f394bef867f14b47dfac3dba089aac2a`
- **Iteration:** 2 of 5 (lifetime)

---

## Codex findings (3)

### FINDING #1 — §5.2 / §5.3 / §8 frontend pass-through mechanism not specified
- **Source:** Codex
- **Description:** §8 only names `MemoryEditDrawer`; the other three frontend edit surfaces aren't named; no mechanism describes how the route query param actually gets populated from the AgentRunLivePage click context.
- **Classification:** mechanical (file inventory drift + load-bearing claim without mechanism).
- **Disposition:** auto-apply — add three more frontend edit-drawer rows to §8 and a "Frontend pass-through mechanism" paragraph to §5.2.

### FINDING #2 — §2 Risk surface "money-handling paths" claim contradicted by §6.1
- **Source:** Codex
- **Description:** Risk surface says "no money-handling path changes" but §6.1 changes a cost API aggregation field.
- **Classification:** mechanical (clarification: H1 is reporting, not billing/payment).
- **Disposition:** auto-apply — narrow phrase to "no billing/payment paths"; explicit callout that H1 is reporting-only.

### FINDING #3 — §11 deferred items: grouped LAEL-§9-items-1-6 enumeration has fabricated item names
- **Source:** Codex
- **Description:** Bullet enumerates six items ("admin-visible drop/gap metrics, trigger-based FK enforcement, run.created event, causal grouping, deeper layer attributions, per-run kill-switch") which do not appear in canonical LAEL §9.
- **Classification:** mechanical (incorrect cross-reference — fabricated content). Verified by grep against `tasks/live-agent-execution-log-spec.md` §9; none of the six named items exist there.
- **Disposition:** auto-apply — replace with an accurate enumeration of LAEL §9's actual 13 deferred items (by name) with a generic "this build addresses none of them" verdict; preserve `[status:v2-backlog]` per-item tag for spec-conformance grep.

## Rubric findings

None new — R2-FRONTEND-EDIT-SURFACES and R2-DEFERRED-ITEMS overlap with Codex findings.

## Edits applied (mechanical)

1. **[ACCEPT] §2 Risk surface (FINDING #2):** clarified phrasing to "no billing/payment paths" + explicit "H1 is reporting-only" callout.
2. **[ACCEPT] §5.2 frontend pass-through mechanism (FINDING #1):** added a new paragraph naming the four edit drawers and pinning the mechanism (drawer reads runId from launching context → appends query param → no inferred attribution).
3. **[ACCEPT] §8 frontend edit-surface rows (FINDING #1):** added three more rows (`MemoryBlockEditDrawer`, `PolicyRuleEditDrawer`, `DataSourceEditDrawer`) with chunk-0 hedges.
4. **[ACCEPT] §11 deferred items (FINDING #3):** rewrote the LAEL-§9 bullet to accurately enumerate all 13 canonical items by their actual names + generic "this build addresses none of them" verdict; added per-item `[status:v2-backlog]` tags to all six bullets for spec-conformance grep.

## Iteration 2 Summary

- Mechanical findings accepted:  3
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after commit)

---
