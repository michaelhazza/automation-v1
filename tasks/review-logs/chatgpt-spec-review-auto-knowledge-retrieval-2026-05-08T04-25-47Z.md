# ChatGPT Spec Review Log — auto-knowledge-retrieval

**Spec:** `tasks/builds/auto-knowledge-retrieval/spec.md`
**Build slug:** `auto-knowledge-retrieval`
**Branch:** `auto-knowledge-retrieval`
**Spec-reviewer (Codex) prior pass:** 5 iterations, 20 mechanical findings applied, lifetime cap reached.
  Final report: `tasks/review-logs/spec-review-final-auto-knowledge-retrieval-2026-05-08T04-25-47Z.md`
**Mode:** manual (operator-driven, ChatGPT-web responses pasted into the session)

---

## Round 1 — operator review of full spec

(skeleton — sections appended in subsequent edits)

### Findings inventory

ChatGPT-web review surfaced 5 explicit flagged-question areas plus 4 additional findings (A through D in operator's notes). Total: 9 distinct findings.

| # | Finding | Class | Disposition |
|---|---|---|---|
| 1 | Two-pointer version model — verdict correct; tighten with explicit invariant: `retrieval_version_id` MUST always reference a version whose full chunk set exists for `active_embedding_model`. | mechanical | applied |
| 2 | Per-document embedding model — verdict correct; do NOT simplify to global pointer. | confirmed (no change) | logged |
| 3 | Observability event volume — only flagged area genuinely needing adjustment. Add hard constraint: `retrieval.summary` payloads MUST be bounded with deterministic caps on rejected arrays, manifests, chunk ids. | mechanical | applied |
| 4 | Always-available degradation copy — posture correct (do NOT silently truncate). Tighten wording: `"Some always-available documents could not be loaded due to context limits."` -> `"Context limits prevented some always-available documents from loading."` | mechanical | applied |
| 5 | Five-tier CHECK constraints — shape correct (named nullable FK columns, not polymorphic scope models). Add invariant: `Exactly one scope tier may be active per row. Organisation scope is represented by all scope FK columns being NULL.` | mechanical | applied |
| A | `always_available` starvation risk — operators may mark too many docs as always_available. Spec degrades gracefully (good); pressure-test threshold/telemetry/UI caps. | **operator-decision** | **PENDING** |
| B | Rejected-candidate persistence payload size — `belowThreshold.sample` and `aboveThreshold` arrays may explode. Combine with item 3: deterministic caps, percentile sampling, top-N near-threshold. | mechanical (folded into item 3) | applied |
| C | Tie-break determinism — spec mentions deterministic tiebreaks but should explicitly state final comparator chain. Suggested: `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`. | mechanical | applied |
| D | Chunk-grouping aggregation semantics — formal invariant: `Document relevance is determined by the highest-scoring chunk, not aggregate chunk scores.` Prevents accidental averaging/sum/overweight of large documents. | mechanical | applied |

### Mechanical edits applied (this round)

**Edit 1 — §13.1 + §16.** Added invariant block requiring `retrieval_version_id` to always reference a version whose full chunk set exists for `active_embedding_model`. Chunking job MUST NOT flip the pointer until all chunks for the new version are embedded under the active generation. Tested at the pure-function boundary by asserting that `documentRetrievalServicePure` rejects any `(retrieval_version_id, active_embedding_model)` tuple whose chunk count is below the version's expected total. §16 self-consistency table updated with the corresponding load-bearing-claim entry.

**Edit 3 + B — §11.4 (new) + §6.7 + §16.** New §11.4 "Bounded payload constraint (hard invariant)" pinning deterministic top-N truncation per array: `rejected.aboveThreshold` capped at top 50 by `finalScore` DESC with truncation indicator, `rejected.belowThreshold.sample` at top 20, `rejected.modeExcluded` at top 50 by `updated_at` DESC, `loaded[i].chunkIds` unbounded per loaded document, `alwaysAvailable` unbounded (operator-pinned), `referenceOnlyManifest` unbounded but per-entry token cost capped (§18 Q4). Truncation rule deterministic (sort + slice) so replays produce identical payloads. N values are constants in `retrievalObservabilityService`. If telemetry shows payloads still problematic, the next move is the deferred dedicated `retrieval_events` table (§15) — not raising caps. §6.7 cross-references §11.4 with: "Payload bounding is non-negotiable: see §11.4 for the deterministic truncation contract that every emitter must satisfy before persisting an event." §16 self-consistency entry added.

**Edit 4 — §10.5.** Operator-facing copy reworded:
- before: `"Some always-available documents could not be loaded due to context limits."`
- after: `"Context limits prevented some always-available documents from loading."`

Cleaner causal phrasing per operator note. Single point of change; no other section references the old copy.

**Edit 5 — §4.1 + §16.** Added invariant block after the five-tier table in §4.1:

> Exactly one scope tier may be active per `reference_document_data_sources` row. Organisation scope is represented by all scope FK columns being NULL (`subaccount_id`, `agent_id`, `scheduled_task_id`, `task_instance_id` all NULL). The other four tiers each have exactly one of those columns non-NULL. Enforced by a CHECK constraint at the table level (Phase 1 migration `0290`); the constraint shape names the four FK columns explicitly so a future tier addition is a deliberate spec amendment, not an emergent shape.

Justification for named-FK over polymorphic shape included in the spec block. §16 self-consistency entry added.

**Edits C + D — §10.8 (new) + §17 + §16.** New §10.8 "Ranking determinism (hard invariant)" with:
- Determinism statement: two replays MUST produce byte-identical `loaded`, `rejected.aboveThreshold`, `rejected.belowThreshold.sample` arrays.
- Final comparator chain: `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`. The `id` ASC tiebreaker is the determinism anchor.
- Document-level relevance invariant: document `finalScore` IS the maximum chunk `finalScore`; implementations MUST NOT average / sum / overweight documents with more chunks. Tested by constructing a document with one high-score chunk + many low-score chunks and asserting it does not outrank a single high-scoring memory block.

§17 testing posture extended to name both invariants in the `retrievalServicePure.test.ts` test list. §16 self-consistency entry added.

### Confirmed (no change)

**Item 2 — Per-document embedding model.** Operator verdict: correct; do NOT simplify to global pointer. Rationale: per-document allows rolling migration, avoids global all-or-nothing sweeps, prevents lockstep reindex events, enables future quality experimentation, keeps retrieval operational during migrations. The spec's framing (old generation retained, atomic pointer flip, retrieval pinned to `active_embedding_model`) is solid. No edit applied.

### Pending operator decision — Item A

**Risk:** if operators mark too many docs as `always_available`, retrieval quality collapses (auto-pool gets crowded out), and the context budget is consumed by pinned content before semantic ranking can contribute. The spec already degrades gracefully at runtime (§10.5: `degraded` flag, no silent truncation, operator-visible copy), but there is no preventive surface — operators learn the threshold by triggering it.

**Choice:** include lightweight always_available telemetry / threshold language in v1, or defer.

The operator-decision prompt (presented in chat) asks for: warning thresholds + operator telemetry + soft UI cap, OR defer to post-v1 backlog.

**Resolution (operator decision):** option (a) — include lightweight always-available starvation telemetry now. No hard cap, no UI block, no new tables, no new migrations. Metrics derived from existing `agent_execution_events` and `reference_documents`.

#### Edit A — §11.5 (new) + §11.3 + §10.5 + §16 + §17

**New §11.5 "Always-available capacity telemetry (preventive surface)"** inserted after §11.4 (anchor chosen as a sibling of §11.4 — both are observability-stack subsections; §11.5 sits naturally adjacent to the bounded-payload contract). Contents:

- Two engineering-only metrics, both derived queries (no new columns, no new tables):
  - `retrieval.always_available.doc_count` per org (count over `reference_documents` where `mode = 'always_available'`).
  - `retrieval.always_available.token_cost` per org (sum over `reference_document_versions.token_count` for that pinned set; column already maintained for runtime budget calc in `retrievalServicePure`).
- Soft warning in the Documents tab when an org's pinned set exceeds **either** threshold: `doc_count >= 30` OR `token_cost >= 30000`. Banner copy: *"This organisation has N always-available documents (~M tokens). Large pinned sets can push other relevant context out of the budget. Consider switching less-critical documents to Auto mode."* Banner links to documents tab filtered to `mode = always_available`.
- Threshold values are constants in `retrievalObservabilityService` for v1; **configurability is deferred to post-launch** (spec amendment when per-org overrides land on `organisations`).
- New telemetry event `retrieval.always_available.mode_changed` emitted into existing `agent_execution_events` whenever a document's `mode` column transitions to or from `always_available`. Payload: `{ organisationId, documentId, oldMode, newMode, actorUserId, occurredAt }`. Bounded by structure (fixed shape, no arrays); covered by §11.4 contract.
- Cross-refs: §10.5 (runtime degradation), §11.4 (payload bounding), §15 (deferred hard caps).

**§11.3 internal telemetry surfaces** — added one bullet pointing readers at §11.5: *"Always-available capacity per org (`doc_count`, `token_cost` aggregate, mode-change history). See §11.5 …"* — keeps the engineering-only telemetry catalogue complete in one place.

**§10.5 No-silent-partial-success** — appended one paragraph cross-referencing §11.5: *"The runtime degradation path above is paired with a preventive surface at §11.5 …"* — preserves the §10.5 runtime safety-net framing while making the preventive-vs-reactive split explicit for future readers.

**§16 self-consistency** — new load-bearing-claim entry: *"Always-available starvation has a preventive surface, not just runtime degradation"* with mechanism mapping to §11.5 (derived metrics, soft-warning thresholds, mode-change event) paired with §10.5 runtime safety net.

**§17 testing posture** — added one Vitest entry under `retrievalServicePure.test.ts`: pure-function predicate `shouldShowAlwaysAvailableWarning({ docCount, tokenCost })` returns `true` when `docCount >= 30` OR `tokenCost >= 30000`, with boundary tests at threshold and threshold-minus-one. Threshold predicate is the only deterministic-testable surface in §11.5; the metric queries themselves are read-only DB lookups against existing tables and don't warrant their own pure-function tests.

**Surgical-edits compliance:** no drive-by reformatting; no other sections touched. New section, three insertions, one new self-consistency row, one new test row. Total ~30 lines of new spec content.

### Spec commit timeline

| Stage | Commit |
|---|---|
| Spec at end of spec-reviewer iter 5 | `ec39dc30` (committed earlier in the build) |
| ChatGPT round 1 mechanical edits applied | `48d8c7b6` |
| Item A operator-decision applied (option a — telemetry now) | (this commit) |

### Round status

**Round 1 status:** all 9 findings resolved. Mechanical edits (7): items 1, 3, 4, 5, B, C, D — applied in `48d8c7b6`. Item 2 confirmed no-change. Item A applied in this commit (option a — lightweight starvation telemetry included in v1 scope).

**Next step:** operator decision — continue to Round 2 (further ChatGPT pass on the spec), or proceed directly to Step 9 (handoff write).
