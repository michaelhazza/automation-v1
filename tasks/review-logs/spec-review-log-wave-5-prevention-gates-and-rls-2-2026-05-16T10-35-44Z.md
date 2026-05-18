# Spec Review Log — wave-5-prevention-gates-and-rls — Iteration 2

- **Timestamp**: 2026-05-16T10:35:44Z
- **Spec commit (pre-iteration)**: a9bd35ec66d542f8c71c84d003e0c34ed3b2e2b4
- **Codex output**: `tasks/review-logs/_codex_wave-5-prevention-gates-and-rls_iter2_2026-05-16T10-35-44Z.txt`

## Findings (all from Codex; rubric pass surfaced no additional items)

FINDING #1
  Source: Codex (important)
  Section: §8 / §11 — `withAdminConnection` "logs to audit_events" claim
  Description: implementation logs to stderr (`console.warn`) with `source` + `reason`; `audit_events` insert deliberately omitted (FK / recursive-tx concerns documented in primitive header).
  Classification: mechanical (load-bearing claim contradicted by primitive's actual behaviour)
  Disposition: auto-apply
  [ACCEPT] §8 Tier 2 row — replaced "logs to audit_events" with the actual contract: structured stderr admin-bypass log with source + reason; cited the FK/recursive-tx constraint.

FINDING #2
  Source: Codex (important)
  Section: §8 — per-file tier verdict insufficient for mixed Tier 1 + Tier 2 files
  Classification: ambiguous → directional (artifact-granularity / safety call)
  Disposition: AUTO-DECIDED (accept)
  Reasoning: Conservative tenant-isolation default — mixed-posture files are exactly where forgotten Tier 1 callsites hide. Per-callsite granularity in `tier-categorisation.md` adds one extra column of work but eliminates the "stamp the file Tier 2, forget the one Tier 1 callsite inside it" failure mode.
  → routed to tasks/todo.md for deferred review

FINDING #3
  Source: Codex (critical)
  Section: §3 vs §6.1 vs §9.2 — "no new withOrgTx call sites" + "all Tier 1 migrated" = unsatisfiable for files without upstream context
  Classification: mechanical (internal contradiction — §6.1 already has the escape valve, §9.2 acceptance needed to mirror it)
  Disposition: auto-apply
  [ACCEPT] §9.2 — narrowed acceptance to "all Tier 1 callsites with chunk-0-verified upstream withOrgTx". Blocked callsites (no upstream context) are recorded in tier-categorisation.md and escalated; not migrated in this build. §9.10 PR summary adds a blocked-count column.

FINDING #4
  Source: Codex (important)
  Section: §5.3 / §9.10 — PP-SK1 baseline contract underspecified
  Classification: mechanical (load-bearing claim without contract)
  Disposition: auto-apply
  [ACCEPT] §5.3 — added Baseline contract paragraph: path `scripts/.gate-baselines/skill-registry-alignment.txt`, format `mismatch-count:<n>`, seed `mismatch-count:0` (post-Session-K), exit-1 semantics, forced-failure verification.

FINDING #5
  Source: Codex (important)
  Section: §5.3 / §13 — PP-SK1 Session K dependency missing from deconfliction
  Classification: mechanical (sequencing ordering bug — rubric class)
  Disposition: auto-apply
  [ACCEPT] §13 — added explicit "Session K's W4AA-DEBT-1 merges BEFORE N's chunk 0 seeds PP-SK1" sequencing row with reorder-on-slip contingency.

FINDING #6
  Source: Codex (minor)
  Section: §9.9 — PP-MC2 already closed in PR 332
  Classification: mechanical (stale state claim)
  Disposition: auto-apply
  [ACCEPT] §9.9 — removed PP-MC2 from the list of items this build closes; added a one-line note that PP-MC2 is already `[status:closed:pr:332]` and this build only verifies the gate remains present + passing.

FINDING #7
  Source: Codex (important)
  Section: §6.1 — RLS-policy claim broader than spec proves
  Classification: ambiguous on first read → mechanical (the chunk-0 artifact already records per-file tier verdicts and tenant tables touched; this is a small expansion of the existing artifact, not a posture shift)
  Disposition: auto-apply
  [ACCEPT] §6.1 — rephrased as "intended RLS contract" anchored on `RLS_PROTECTED_TABLES`; chunk 0 records the actual tenant key + policy reference per touched table in `tier-categorisation.md`.

FINDING #8
  Source: Codex (minor)
  Section: §7 — "remaining flags genuinely unused" overclaim
  Classification: mechanical (overconfident phrasing)
  Disposition: auto-apply
  [ACCEPT] §7 — rephrased as "candidate unused-file flags pending follow-up triage" (some may still be false positives needing further config tweaks; some will be real dead code).

FINDING #9
  Source: Codex (minor)
  Section: §4 / §8 / §9.3 — suppression form inconsistency (ADR vs reason= vs guard-ignore-next-line)
  Classification: mechanical (terminology drift)
  Disposition: auto-apply
  [ACCEPT] §4 — replaced the single-form description with an explicit bulleted list of the three accepted forms documented by the existing guard (ADR / reason="..." / guard-ignore-next-line); §8 and §9.3 reference "the three accepted forms enumerated in §4" rather than naming any one.

## Iteration 2 Summary

- Mechanical findings accepted:  8 (Codex #1, #3, #4, #5, #6, #7, #8, #9)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1 (Codex #2) — auto-decided ACCEPT
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (see tasks/todo.md)
- Spec commit after iteration:   (set after commit)
