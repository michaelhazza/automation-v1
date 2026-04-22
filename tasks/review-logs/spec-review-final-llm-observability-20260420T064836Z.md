# Spec Review Final Report — llm-observability-ledger-generalisation

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit at start of lifetime review:** `2b5668c` (iter-1 started here)
**Spec commit at finish:** `2b5668c` + 4 iter-3-HITL edits + 4 iter-4 mechanical edits (uncommitted; author commits when ready)
**Spec-context commit:** `00a67e9`
**Iterations run:** 4 of 5 lifetime cap
**Exit condition:** converged — four consecutive rounds applied with HITL clean, Codex stopped producing analytical output on iter-4, rubric clean after iter-4 mechanical fixes.

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----|----|----|----|----|----|----|
| 1 | many | several | many (C2–C15, R1–R2) | some | 0 | 0 | none |
| 2 | many | some | most (C2.1–C2.8) | few | 2 (C2.4, C2.7) | 0 | resolved via iter-2 checkpoint |
| 3 | 9 | a few | 8 mechanical (§§11.3/19.5a/19.6/19.5-split/§14.2/§12.4/prototype margin) | 1 (duplicate of iter-2 C2.6) | 0 | 1 (finding #6 `caller_cancel`) | resolved via iter-3 checkpoint (`apply`) |
| 4 | 0 (truncated twice) | 4 | 4 (R1–R4) | 0 | 0 | 0 | none |

---

## Mechanical changes applied across the lifetime review

Grouped by spec section.

### §1.1 / §1.2 — Executive summary & assertions
- Four-provider adapter parity language added (iter-2 C2.1).
- A1 wording updated to mention `verify-no-direct-adapter-calls.sh` and explicit four-adapter list (iter-1).

### §3.1 — In-scope goals
- Goal 3 stale site-count fixed: "all four direct `anthropicAdapter.call()` sites... three in `skillAnalyzerJob.ts` and one in `skillAnalyzerService.ts`" (iter-4 R1).

### §3.1 point 2 / §4.2 / §8 TOC / §8.5 / §16.1 — Four-provider references
- Language across every parity callout made explicit and consistent: anthropic / openai / gemini / openrouter (iter-2 C2.1).

### §5 / §6 / §7 — Data model + router
- `sourceId` for analyzer = `skill_analyzer_jobs.id` named (iter-2 C2.2).
- Overhead-row per-tab matrix added; new `OverheadRow` contract in §19.4 (iter-2 C2.3).
- System-caller enumeration, `marginMultiplier` override note, phase-4 readiness language tightened (iter-2 C2.8).

### §7.4 / §11.5 / §19.4 — SourceTypeRow cross-references
- Three references to "§19.5" updated to "§19.5.2" after iter-3 sub-section split (iter-4 R2).

### §8.1 — Adapter abort-reason convention
- Reworded so the analyzer migration is described as wiring the `caller_timeout` path exactly; user-cancel deferred to §17 (iter-3 HITL).

### §10.5 / §16.3 — P3 verification
- Verification step 4 narrowed from UI-cancel to `SKILL_CLASSIFY_TIMEOUT_MS` path with `abort_reason = 'caller_timeout'` (iter-3 HITL).

### §11.2 — Service docstrings
- `getTopCalls` ranked by cost desc (iter-2 C2.4 HITL — renamed from "by revenue").
- `getByProviderModel` live-read deferred work now listed in §17 (iter-4 R3 source; §17 added the matching entry).

### §11.3 — Endpoint table
- Response envelope payload types named; uniform `{data, meta}` per §19.9 (iter-3 mechanical #2).

### §11.4.1 — Controls implemented in P4
- Added — documents auto-refresh (60s refetchInterval), Refresh button, Export CSV (client-side), View all, decorative footer links (iter-2 C2.7 HITL).

### §11.6 — Detail drawer
- Link description tightened to reflect §19.6 nullability contract — organisation link renders only when `organisationId` non-null; same for subaccount (iter-4 R4).

### §12.4 — Archive job
- Extracted named pure helper `computeArchiveCutoff(retentionMonths, now)` into `llmLedgerArchiveJobPure.ts`; §14.5 and §14.8a updated (iter-3 mechanical #10).

### §14.2 — Schema file inventory
- Stale `TASK_TYPES` change language removed (iter-3 mechanical #9).

### §14 — Direct-adapter site inventory
- 4th direct-adapter site added: `server/services/skillAnalyzerService.ts:2063` (iter-1).
- §10.4 added as the service-layer migration site; §14.2 / §14.3 file table aligned to match (iter-1).

### §15.2 — P2 gate state
- Both analyzer files explicitly whitelisted; gate passes green on P2 (iter-3 mechanical #1).

### §17 — Deferred Items
- Added real-footer-link-destinations entry (iter-2 C2.7).
- Added user-cancel wiring for analyzer (iter-3 HITL).
- Added `cost_aggregates` `provider_model` + `avg_latency_ms` deferral (iter-4 R3).

### §19 — Contracts appendix
- §19.3 `grossProfit.margin` updated to 20.6 (matches prototype after iter-3 fix).
- §19.4 new `OrgRow` / `OverheadRow` shape (iter-2 C2.3).
- §19.5 split into §19.5.1 SubacctRow / §19.5.2 SourceTypeRow / §19.5.3 ProviderModelRow (iter-3 mechanical #5).
- §19.5a new `DailyTrendRow` (iter-2 C2.5); `profitCents` removed (iter-3 mechanical #3).
- §19.6 `TopCallRow` / `CallDetail` enriched with `organisationId` + `subaccountId` + link-target nullability rules (iter-3 mechanical #4); `revenueCents` nullable with overhead-row example (iter-2 C2.4 HITL).

### Prototype `prototypes/system-costs-page.html`
- Top calls header renamed to "by cost" (iter-2 C2.4 HITL).
- KPI Gross Profit margin 25.6% → 20.6% (iter-3 mechanical #8).
- Tab-status string copy polished (iter-2 C2.6).

---

## Rejected findings

- Iter-3 finding #7 — duplicate of iter-2 C2.6 (prototype illustrative data, not numerical truth). Rejected as already-dispositioned.
- Iter-1/iter-2 Codex findings that suggested frontend tests, performance baselines, feature flags, or staged rollout — all rejected against `docs/spec-context.md` convention_rejections. Not itemised here because each was rejected on the same rule.

---

## Directional and ambiguous findings (resolved via HITL)

### Iter-2 HITL
- **C2.4 — "Top calls" renamed from "by revenue" to "by cost."** Decision: apply. Modification: keeps non-billable rows (analyzer / system); ORDER BY cost_raw DESC; mockup header + subhead updated; `TopCallRow.revenueCents` made nullable with a second overhead-row example.
- **C2.7 — §11.4.1 "Controls implemented in P4."** Decision: apply-with-modification. Added `refetchInterval: 60000` for auto-refresh; explicit Refresh button; client-side CSV export; View all as anchor scroll + limit bump to 50; decorative footer links per §11.4.1 with real destinations deferred to §17.

### Iter-3 HITL
- **3.1 — `caller_cancel` required by §10.5 but not wired in §10.1.** Classification: ambiguous. Decision: apply (narrow verification to timeout-only; defer user-cancel wiring to §17). The `abort_reason` CHECK constraint preserves `caller_cancel` as a valid schema-level value so future wiring needs no migration. §8.1 reworded to remove "wires this exactly" claim about user-cancel.

---

## Open questions deferred by `stop-loop`

None. All HITL findings across the lifetime review were resolved with `apply` or `apply-with-modification`; no `stop-loop` or `reject` decisions.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The human has adjudicated every directional finding that surfaced across four iterations. However:

- **Framing did not drift** during the review — `docs/spec-context.md` was referenced on every iteration and the spec's framing section stayed aligned. Pre-production, commit-and-revert, static-gates-first posture held throughout.
- **Codex produced less output on iter-4 than iter-1–3.** Two iter-4 attempts both truncated before producing analytical findings (the first stopped after prompt read; the second stopped mid-prototype file-content stream). This is consistent with "the spec has converged and Codex has less to say" but could also reflect a Codex CLI quirk on the Windows PowerShell sandbox. The rubric pass on iter-4 still surfaced 4 genuine mechanical findings, so the lack of Codex output did not mean zero findings.
- **Iter-5 lifetime slot is not consumed.** One iteration remains under the lifetime cap. If substantive edits land against this spec during implementation (beyond the four iter-4 mechanical fixes), the remaining iteration can be spent on a follow-up review cycle. If the spec goes to implementation as-is, iter-5 is not needed and the spec is done from a review perspective.

**Recommended next step:** read the spec's framing sections (§framing, §1, §3) one more time, confirm the four in-scope goals match your current intent, then:

1. Commit the 8 uncommitted spec edits (4 from iter-3 HITL + 4 from iter-4 rubric) as a single "post-spec-review cleanup" commit.
2. Begin implementation against P1 (ledger + router + adapter plumbing).

---

## Lifetime counter

- Iterations used: 4 of 5
- Remaining: 1
- Next iteration trigger: either substantive spec edits during implementation, OR explicit human request to run iter-5 (e.g. after stakeholder feedback). Do not auto-invoke iter-5 on minor edits.
