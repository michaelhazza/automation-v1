# Spec review plan — iteration 3

- Spec path: `tasks/llm-observability-ledger-generalisation-spec.md`
- Spec commit at start: `2b5668c`
- Spec-context commit at start: `00a67e9` (confirmed framing current as of 2026-04-16; pre-production, rapid-evolution, static-gates primary)
- MAX_ITERATIONS: 5 (lifetime cap)
- This iteration: 3 of 5
- Remaining after this one: 2
- Stopping heuristic: two consecutive mechanical-only rounds. Iter-2 had 2 directional findings, so iter-3 is the first candidate for a clean round. If iter-3 is clean, iter-4 must also be clean to exit early.
- Iter-2 HITL resolution applied before starting iter-3:
  - C2.4 (Top calls by cost): already landed in spec §11 (getTopCalls docstring, data-source table, endpoint row, §11.5 tab columns, §11.6 detail drawer, §19.6 TopCallRow + example). Prototype header already says "Top individual calls by cost" (line 990). Prototype row ordering cost-descending verified (rows 1-10: $0.1824 → $0.0081). No prototype header edit required.
  - C2.7 (Mockup UI controls): already landed in spec §11.4.1 (auto-refresh, Refresh, Export CSV, View all, decorative footer links). §17 Deferred entry already written. Prototype footer links still used `<a href="#">` — edited to `<span>` per §11.4.1 decorative treatment in this iteration.
