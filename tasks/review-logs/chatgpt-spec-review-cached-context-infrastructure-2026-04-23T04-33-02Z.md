# ChatGPT Spec Review Session — cached-context-infrastructure — 2026-04-23T04-33-02Z

## Session Info
- Spec: `docs/cached-context-infrastructure-spec.md`
- Branch: `claude/cached-context-infrastructure-fcVmS`
- PR: #180 — https://github.com/michaelhazza/automation-v1/pull/180
- Started: 2026-04-23T04:33:02Z

---

## Round 1 — 2026-04-23T04-33-02Z

### ChatGPT Feedback (raw)

Executive summary

This is a very strong spec. It cleanly translates the brief into enforceable contracts, and more importantly, it respects the boundaries and invariants from the brief without drifting into "clever" implementations.

At this stage, we're not looking for redesign. We're looking for:
- brittleness under real usage
- over/under-specification
- places where implementation will "guess" instead of follow a rule

There are no structural blockers. This is implementable as-is. The feedback below is about tightening a few high-risk edges.

High-confidence callouts (flagged areas)

§3.6 Attachment UX — verdict: one of the strongest parts of the spec. Correct call: backend primitive = packs, user mental model = documents + optional bundles. That separation is clean and durable.

One improvement (important but small): Auto-pack reuse is based on exact document set — correct, but missing one UX invariant: **Order independence must be explicit in UX, not just backend.** Add (one line in §3.6.4 or §3.6.7): "Document sets are considered identical regardless of selection order." Why: prevents confusion when suggestion fires "unexpectedly"; aligns UX with prefix-hash behaviour.

§6.2 documentPackService — core contracts. Conceptually correct, but one risk: implicit coupling between auto-pack identity and future behaviour. Auto-pack = canonical representation of document set. Good, but becomes load-bearing for dedup, suggestions, attachments, bundle promotion.

Missing guardrail: **Auto-pack identity must be stable and independent of attachment context.** Why: prevents future bugs where same docs in different subaccounts diverge, or same docs but different lifecycle flags accidentally fork packs.

promoteToNamedBundle (in-place) is right. Subtle risk: **Missing invariant: promotion must not change identity.** Add explicitly: "Promoting an auto-pack to a named bundle must not alter its membership, identity, or prefix hash." Why: prevents accidental mutation during promotion; protects cache reuse; protects snapshot integrity.

suggestBundle return shape: conceptually solid. Only improvement: **Add explicit determinism requirement:** "The suggestion decision must be deterministic for a given document set and user state." Why: avoids flickering suggestions; avoids race conditions under concurrent edits.

§7.2 chipKind discriminator: correct for v1. Bundle → one 📦 chip, auto-pack → expanded 📄 chips. Aligns with mental model, simplicity, bundle as abstraction layer. One thing to lock in: **A bundle chip always represents a single attachment unit, regardless of its underlying document count.** Why: prevents future UI from "expanding sometimes"; keeps mental model stable.

Real risks

1. "Auto-pack explosion" edge case: optimised for reuse, but consider — user repeatedly creates slightly different doc sets, each becomes a new auto-pack. Result: hidden proliferation of auto-packs, potential performance and storage issues later. Fix (brief-level, not implementation): add principle "The system should guard against unbounded growth of auto-created packs over time." Don't solve it now — just signal it.

2. Snapshot integrity vs live data drift: correctly snapshot document versions and re-hash on read. Good. But missing explicit failure mode: **What happens on mismatch?** Add one explicit rule (important): "If a snapshot integrity check fails, the run must fail immediately and surface a system-level error." Why: prevents silent corruption; avoids undefined behaviour.

3. Budget enforcement split (subtle complexity): assembly-time enforcement + router-time enforcement (runCostBreaker). Correct. But the spec assumes developers will "understand the split." Add one clarifying sentence: "Assembly-time validation prevents invalid requests; runtime cost enforcement handles execution-time variance and fallback behaviour." Why: removes ambiguity; prevents duplicate enforcement logic.

4. Cache identity vs provider behaviour: prefix_hash + assembledPrefixHash defined cleanly. Missing: **Provider cache is best-effort, not guaranteed.** Add principle: "Cache identity guarantees determinism on our side, but cache hits depend on provider behaviour and are not guaranteed." Why: prevents false assumptions; important for debugging.

5. Degraded classification (slight ambiguity): "degraded = includes unexpected cache miss." Risk: mixes quality issues with infra variability. Recommendation clarify: "Degraded reflects suboptimal execution conditions, not necessarily incorrect output." Small wording tweak, big clarity gain.

Minor polish (optional)

1. Naming consistency: uses "bundle" and "named bundle" interchangeably. Pick one primary label and stick to it in UI sections.

2. "prefix_hash" vs "assembledPrefixHash": handled correctly technically. Just add one line: "prefix_hash refers to per-pack identity; assembledPrefixHash refers to call-level identity." Avoids confusion later.

3. Suggestion dismissal permanence: says "permanent dismissal per (user, doc-set)." Good. Consider adding: "Dismissal does not prevent manual bundle creation." Prevents edge-case UX confusion.

Final verdict

Strong:
- Clear separation of primitives
- Excellent UX abstraction layer
- Deterministic system design
- Strong invariants carried from brief
- Correct use of existing infrastructure

Fixed from brief phase (correctly):
- avoided overengineering
- avoided RAG creep
- avoided UI complexity
- avoided multiple budget systems

What remains: no redesign needed. Only tighten a few invariants, clarify edge behaviours, prevent future misinterpretation.

Bottom line: this spec is ready for implementation. If you implement exactly what's written, you'll get predictable behaviour, strong observability, minimal rework later.

### Recommendations and Decisions

13 discrete findings parsed from round 1. All classified as mechanical-additive (small invariant or clarification lines that tighten existing behaviour without changing scope or direction).

User decision: **all: as recommended** (accept all 13, apply all, including the deferred-signal treatment on F6 and the 2 mockup-line touches for F11).

| # | Finding | Classification | Disposition | Spec/artefact changes |
|---|---------|----------------|-------------|----------------------|
| F1 | Order-independence UX invariant — "Document sets are identical regardless of selection order" | mechanical | **applied** | §3.6.4 new paragraph + §3.6.7 invariant #9 cross-reference |
| F2 | Auto-pack identity must be stable and independent of attachment context | mechanical | **applied** | §6.2 invariant #6 added |
| F3 | Promotion must not alter membership, identity, or prefix hash | mechanical | **applied** | §6.2 invariant #7 added, listing the three columns that change and the columns/rows that do not |
| F4 | suggestBundle determinism requirement | mechanical | **applied** | §3.6.4 "Determinism" paragraph + §6.2 invariant #8 |
| F5 | Bundle chip always represents a single attachment unit | mechanical | **applied** | §3.6.7 invariant #8 added |
| F6 | Guard against unbounded auto-pack growth (signal only) | mechanical (deferred signal) | **applied** | §12.16 new deferred entry + §14 R11 risk row |
| F7 | Snapshot integrity mismatch → fail-fast, system-level error | mechanical | **applied** | §6.4 new invariant box above the assembly-flow steps |
| F8 | Budget enforcement split clarifying sentence | mechanical | **applied** | §6.5 new paragraph on "Division of enforcement responsibilities" |
| F9 | Cache identity guarantees determinism on our side; provider cache hits are not guaranteed | mechanical | **applied** | §4.4 new paragraph "Cache identity vs provider cache behaviour" |
| F10 | Degraded = suboptimal execution conditions, not incorrect output | mechanical | **applied** | §4.6 `degraded` bullet extended with the clarifying sentence |
| F11 | Naming consistency — "bundle" primary, "named bundle" only when contrasting with auto-packs | mechanical | **applied** | §3.6.1 new "Naming rule" paragraph; `mockup-upload-document.html` line 302 tightened ("named bundle" → "bundle" in UI help text); `mockup-attach-docs.html` line 399 and `index.html` line 199 left intact (mockup-only explainer + dev-facing description, both appropriately contrastive) |
| F12 | Hash glossary line — per-pack vs call-level | mechanical | **applied** | §4.4 new "Hash glossary" block at the top of the section |
| F13 | Dismissal does not prevent manual bundle creation | mechanical | **applied** | §3.6.4 new "Dismissal scope" paragraph |

**Mockups touched:** 1 file (`mockup-upload-document.html`) — single UI-copy tightening, no structural change.

**Commit:** round-1 changes committed as a single commit per the spec-review agent's contract (auto-commit-and-push after each round). Commit `3005d64`.

---

## Round 2 — skipped

The user progressed directly from round 1 → round 3 feedback (no interim round 2 was pasted into the session).

---

## Round 3 — 2026-04-23 (applied)

### ChatGPT Feedback (raw)

Pasted by the user. 8 top-level findings + a 3-item "minor polish" set = 10 discrete items. All framed as "no redesign, tighten invariants, protect against future 'well-intentioned' changes." No blockers.

### User decision

**"all: as recommended"** — apply all 10 items.

### Parallel scope change — vocabulary rename

Before applying round 3 findings, the user instructed: *"make sure you've completely replaced 'pack' with 'bundle', I mean at the schema level as well, before we go ahead and build this feature so we're not creating confusing code debt later"*.

Executed as a separate commit (`82987a8`). Spec, frontend-design-principles, KNOWLEDGE.md, dev brief, mockups all renamed: `document_packs` → `document_bundles`, `pack_resolution_snapshots` → `bundle_resolution_snapshots`, `packId` → `bundleId`, `documentPackService` → `documentBundleService`, `findOrCreateAutoPack` → `findOrCreateUnnamedBundle`, all error codes `CACHED_CONTEXT_PACK_*` → `CACHED_CONTEXT_BUNDLE_*`, routes `/api/document-packs/*` → `/api/document-bundles/*`, plus prose. Round 3 findings applied against the renamed spec.

### Recommendations and Decisions (round 3)

| # | Finding | Classification | Disposition | Spec/artefact changes |
|---|---------|----------------|-------------|----------------------|
| R3-F1 | Cross-tenant hash identity invariant — content-based hashes may collide across tenants; cross-tenant cache reuse is expected and safe | mechanical | **applied** | §4.4 new paragraph "Cross-tenant hash identity" extending the existing hash glossary |
| R3-F2 | Snapshot isolation invariant — resolution fully isolates a run from subsequent bundle/document mutations | mechanical | **applied** | §6.3 new "Run isolation invariant" paragraph under the service header |
| R3-F3 | Suggestion detection must operate on indexed lookups, not full attachment scans | mechanical | **applied** | §6.2 invariants list item #9 |
| R3-F4 | `assembly_version` bump invalidates cache reuse but NOT existing snapshots — append-only semantics | mechanical | **applied** | §4.4 new paragraph "Assembly-version bumps are non-destructive" |
| R3-F5 | New `degraded_reason` diagnostic enum column on `agent_runs` — internal-only, not user-facing | mechanical (schema addition) | **applied** | §4.6 contract extended with `DegradedReason` type + precedence rule + example rows; §5.8 schema adds `degraded_reason text` column + partial index; §6.6 step 8 updated to record the reason; §6.6 terminal UPDATE extended with `degraded_reason = :degradedReason` |
| R3-F6 | HITL retry must re-run resolution + assembly against current state, not reuse previous snapshot | mechanical | **applied** | §6.6 step 4 rewritten to spell out fresh `executionBudgetResolver.resolve` + `bundleResolutionService.resolveAtRunStart` + `contextAssemblyEngine.assembleAndValidate` on the post-approval retry |
| R3-F7 | Strengthen §12.16 from "should guard" to "system MUST support future lifecycle management" | mechanical | **applied** | §12.16 rewritten to declare required future work (not aspirational); dismissal hash decoupling noted as survivability feature |
| R3-F8a | Document rename does not affect prefix-hash identity | mechanical | **applied** | §5.1 notes extended with the invariant statement |
| R3-F8b | Token counts computed at version-write, not at assembly time | mechanical | **applied** | §5.2 notes extended — assembly-time recomputation is forbidden; future optimisations must trigger new version writes |
| R3-F8c | Bundle deletion is wrapper-only — does not cascade to documents, snapshots, or runs | mechanical | **applied** | §6.2 new `softDelete` behavior block itemising what is NOT cascaded (documents, snapshots, agent_runs) |

**Schema surface change:** 1 new nullable text column (`agent_runs.degraded_reason`) + 1 partial index. Low-risk, additive, matches existing `run_outcome` pattern. The spec's migration 0209 grows by two SQL statements.

**Mockups touched:** 0 — all round 3 findings are backend/contract-only.

**Commit:** round-3 changes committed as commit `47776dd` per the spec-review agent's contract.

---

## Round 4 — 2026-04-23 (applied)

### ChatGPT Feedback (raw)

Pasted by the user. 7 top-level findings + 3-item minor polish set = 9 discrete items. ChatGPT's verdict: *"very close to production-final. No blockers. ~6 high-value refinements will materially reduce long-term risk."*

### User decision

**"all: as recommended"** — apply all 9 items.

### Recommendations and Decisions (round 4)

| # | Finding | Classification | Disposition | Spec/artefact changes |
|---|---------|----------------|-------------|----------------------|
| R4-F1 | Snapshot ↔ document-version FK invariant — every `(documentId, documentVersion)` pair must resolve to an existing row; version rows never deleted | mechanical | **applied** | §5.2 notes extended with two named invariants: "Version rows are immutable" and "Snapshot ↔ version-row guarantee" |
| R4-F2 | Prefix-hash collision policy as explicit design assumption — no runtime fallback | mechanical | **applied** | §4.4 new paragraph "Hash-collision policy (design assumption)" below the non-destructive assembly-version paragraph |
| R4-F3 | Bundle-mutation concurrency invariant — resolution reads must be version-locked or transactionally consistent | mechanical | **applied** | §6.3 new paragraph "Resolution is version-locked against concurrent bundle edits" — specifies `REPEATABLE READ` / `SELECT FOR KEY SHARE` / version-retry as three acceptable implementations |
| R4-F4 | Token-drift aggregability — signals must remain joinable per model family and document type for future estimator calibration | mechanical | **applied** | §4.6 new "Drift-data aggregability invariant" paragraph documenting the join path across `agent_runs` / `llm_requests` / `bundle_resolution_snapshots` / `reference_documents` — no schema addition needed |
| R4-F5 | HITL retry breach-type independence — retry breach classification is recomputed independently from original | mechanical | **applied** | §6.6 step 4 extended: "Retry breach classification is independent" — explicit statement that a cross-dimension retry (e.g. first `max_input_tokens` → retry `per_document_cap`) still terminates as `hitl_second_breach` |
| R4-F6 | Bundle utilization = worst-case across tiers | mechanical | **applied** | §3.6.6 new "Aggregation invariant" paragraph + §6.7 post-thresholds note — both specify `max(utilizationRatio)` then threshold, with conservative-bias rationale |
| R4-F7a | Version row immutability as a named invariant | mechanical | **applied (subsumed into R4-F1 edit)** | §5.2 first bullet now reads as a named invariant with explicit no-update / no-delete / no-soft-delete statement |
| R4-F7b | Single-attachment-per-parent invariant | mechanical (judgment call) | **applied (idempotent-not-rejected wording)** | §6.2 `attach` notes rewritten with named "Single-attachment-per-parent invariant"; deliberate UX choice: double-attach is idempotent, not an error — enforcement is structural via the partial unique index. Flagged to user; they approved with "all as recommended" |
| R4-F7c | Snapshot insert idempotency as a named invariant | mechanical | **applied** | §5.6 concurrency-invariant section gets a new "Snapshot-insert idempotency (named invariant)" paragraph below the existing invariant |

**Schema surface change:** 0 — all round 4 items are prose-only invariants. No new columns, no new tables, no new routes.

**Mockups touched:** 0.

**Commit:** round-4 changes committed as a single commit per the spec-review agent's contract.



