# Spec review log — synthetos-foundation-refactor — iteration 2

- Spec: `tasks/builds/synthetos-foundation-refactor/spec.md`
- Spec commit at start: `5676dcfde1230935745a18911a53abe7947f654b`
- Codex output: `tasks/review-logs/_codex_synthetos_foundation_iter2_2026-05-09T07-17-14Z.txt`
- Codex returned 13 findings.

## Index

- Findings 1–13 (Codex)
- Rubric pass
- Summary

## Findings 1–13

### F1 — Stale Run Trace source count
Sections: §1.4, NG4, §4.4.1, §4.4.12, §11. Codex says "five tables" / "5+ event tables" still survives. Mechanical (inventory drift). **Auto-apply** — find/replace remaining occurrences.

### F2 — Phase 1B PR table points at wrong items
Sections: §8.1, §8.2. §8.2 still lists "1 PR for §4.3, 1 PR for §4.5" — needs to be "1 PR for §4.5, 1 PR for §4.4". Mechanical. **Auto-apply**.

### F3 — `partial` status conflicts with terminal-event closure
Sections: §3.6, §4.4.4. §3.6 says `partial` flows through `run_terminated`, but the terminal value list is `completed | failed | cancelled | aborted` — no `partial`. Mechanical. **Auto-apply** — verify against `shared/runStatus.ts` `TERMINAL_RUN_STATUSES` (need to read the actual file). If `partial` is not in the canonical set, remove the §3.6 reference. If it is, add to the terminal list.

### F4 — Risk Tier preservation mislabeled as policy override
Sections: §4.2.4, §4.2.6, §4.4.4. The new `deriveGateLevel` has a `preserved_existing` source, but §4.2.6 prose still says mismatches are "recorded as a `policyOverride`", and the Run Trace `tool_security_decision` payload only enumerates `tier_default | policy_override`. Mechanical. **Auto-apply** — fix §4.2.6 prose; add `preserved_existing` to the Run Trace payload type.

### F5 — Run Trace cursor doesn't encode full ordering tuple
Section: §4.4.5. Prose says ordering by `(timestamp, COALESCE(sequence_number, 0), source_table, id)` but the SQL cursor predicate compares only `(timestamp, sequence_number)` and the event shape has no source row id. Mechanical (contract drift). **Auto-apply** — add `sourceId: string | null` to the event base shape; encode the full tuple in the cursor; update the SQL predicate.

### F6 — INV-5 excludes the partial index that migrations add
Sections: INV-5, §4.1.3, §6.1, §6.5. INV-5 says "Schema changes are bounded to columns on two existing tables", but §4.1.3 adds a `controller_style` partial index. Mechanical. **Auto-apply** — amend INV-5 to allow the named partial index.

### F7 — Performance-test posture contradicts deferred baselines
Sections: §4.4.12, §7.5, §10. §4.4.12 still says "Performance: a synthetic run with 5,000 events queries in under 500ms"; §10 risk register row mentions "Performance baseline captured pre-merge". Both contradict §7.5 (deferred). Mechanical. **Auto-apply** — drop synthetic-test claim from §4.4.12; reword the §10 mitigation row.

### F8 — Open decisions hard-coded in implementation sections
Sections: §4.1.5, §4.4.3, §4.5.3, §5.2.5, §12.1-§12.6. The "Decision needed" items in §12 already have concrete defaults inline elsewhere (operator loop = 100; Run Trace limit 50/200; JSONB column location; separate CSV; placeholder rows). Mechanical. **Auto-apply** — convert each open decision to "Resolved" with the inline value as the verdict. The recommendation in each §12.x already states the answer; we just need to mark them resolved.

### F9 — Optional CI guard listed under mandatory CI anchors
Sections: §0.5, INV-15, §9.2. §0.5 says "CI-enforced contracts must be in place" then lists `verify-controller-style-mapping.sh` as "optional, advisory". Mechanical. **Auto-apply** — drop the optional gate from the mandatory anchor list (move it to a "Future advisory gates" note) so the framing isn't self-contradictory.

### F10 — Uninventoried `foundation.controller_style.rejected` event
Sections: INV-16, §4.1.6, §9.4. §4.1.6 introduces `foundation.controller_style.rejected` but INV-16 lists only five log codes. Mechanical (inventory drift). **Auto-apply** — add the event to INV-16 and §9.4.

### F11 — Models and Identity tab scope vs NG8
Sections: NG8, G7, §5.2.5, §9.3, §11, §12.6. NG8 says "AI and Models settings tab" not delivered (subaccount-level); §5.2.5 ships per-agent Models and Identity tab. The two are different surfaces. Mechanical (clarify the scope distinction). **Auto-apply** — reword NG8 to specify it's the subaccount-level Settings tab, not the per-agent Agent Config tab.

### F12 — Unique-constraint HTTP mapping blesses 500s
Section: §3.6. The "Unique-constraint mapping" paragraph says "standard 500-via-23505 mappings already in place via Express error middleware are unchanged" — that asserts 500 is the desired mapping for 23505, which is a weak claim. Mechanical. **Auto-apply** — reword to "no new unique constraints introduced; no new HTTP mappings required."

### F13 — Credential audit route test inventory drift
Sections: §5.4.4, §7.2. §5.4.4 mentions "Pure-function tests for any new formatters; route handler covered by existing route-test conventions" but §7.2 canonical inventory does not list this. Mechanical. **Auto-apply** — either add an entry to §7.2 (formatters test only — the route handler is covered by existing patterns) or trim the §5.4.4 row.

## Rubric pass

No new rubric findings. The iteration-1 fixes addressed the major rubric categories; iteration-2 Codex findings 1–13 cover the remaining drift.

## Iteration 2 Summary

- Mechanical findings accepted: 13
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: (set after commit)

Note on F3 (`partial` status): Codex flagged a contradiction between §3.6's `partial` claim and the four-element terminal-status list `(completed | failed | cancelled | aborted)`. Closer review against `shared/runStatus.ts` showed the spec's terminal-status list was wrong from the start: the canonical `TERMINAL_RUN_STATUSES` is `completed | failed | timeout | cancelled | loop_detected | compute_budget_exceeded | completed_with_uncertainty`. The fix replaces the wrong list with the canonical one and reroutes "partial" semantics through `completed_with_uncertainty` rather than inventing a new value.

Note on F8 (open decisions hard-coded): six of seven §12 entries had inline values committed elsewhere in the spec. The fix marks them RESOLVED and keeps §12.7 (feature-coordinator invocation) as the only OPEN item.
