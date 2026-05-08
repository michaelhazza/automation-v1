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

**Resolution will be appended below once operator answers.**

### Spec commit timeline

| Stage | Commit |
|---|---|
| Spec at end of spec-reviewer iter 5 | `ec39dc30` (committed earlier in the build) |
| ChatGPT round 1 mechanical edits applied | (this commit) |
| Item A operator-decision applied | (next commit, pending operator response) |

### Round status

**Round 1 status:** mechanical edits applied (7 of 9 findings: 1, 3, 4, 5, B, C, D). Operator-decision pending on item A. Item 2 confirmed no-change.

Continue to round 2 only if operator wants further ChatGPT review after item A is resolved. Otherwise, proceed to Step 9 (handoff write).
