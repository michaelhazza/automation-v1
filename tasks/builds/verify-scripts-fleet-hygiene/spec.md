# Stub: Verify-script fleet hygiene + index README

**Trigger to activate:** When the next CI-gate authoring round adds another `scripts/verify-*.sh` and the inconsistency cost shows up.

**Scope (one paragraph).** Consolidate the four items that converge on "make the `verify-*.sh` fleet self-documenting and consistent": CHATGPT-R1-PH3-3 (verify-script consolidation), CHATGPT-R1-PH3-2 (script naming conventions), GATES-2026-04-26-2 (`verify-rls-contract-compliance.sh` should skip `import type` lines), and `scripts/README.md` (currently absent — produce one that enumerates every gate, its trigger, and its fixture). One short hygiene build.

**Origin:** Verify-script consolidation items in legacy `tasks/todo.md`.
