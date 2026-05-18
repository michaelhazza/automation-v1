# chatgpt-spec-review log — browser-hardening-primitives

**Subject:** `tasks/builds/browser-hardening-primitives/spec.md`
**PR:** [#349](https://github.com/michaelhazza/automation-v1/pull/349)
**Mode:** MANUAL — operator pastes ChatGPT-web responses; spec-coordinator triages inline (SendMessage tool unavailable in this environment, so the chatgpt-spec-review agent was launched once and the round-by-round triage runs inline from the main session).
**Rounds run:** 3
**Verdict:** All 9 findings across R1+R2+R3 auto-applied inline. ChatGPT R3 verdict: "Everything else looks closeable." Operator instruction: "Lock the spec after this." Spec status flipped to `accepted`.

---

## Round 1 — 2026-05-18

### ChatGPT prompt sent

Standard chatgpt-spec-review Round 1 paste block: "Review this specification document for completeness, clarity, and implementation readiness. List your findings as numbered items, each with: Title, Severity, Category, Brief explanation. Focus on: missing contracts, ambiguous requirements, missing edge cases, internal inconsistencies, unresolved forward references. End with overall verdict."

### ChatGPT response (verbatim)

> Spec review: strong overall, but I'd flag 5 findings before plan/build.
>
> **Blocking: proxy-config source is still unresolved.** Phase 2 depends on a configured proxy, tenant overrides, and acceptance tests, but the source schema/UI/launch-options path is still an architect-pick open question. That weakens the file inventory lock and makes Phase 2 acceptance underspecified. Resolve Q10 before implementation.
>
> **Blocking: blocking-site parse_error / site_unavailable exits 0.** The exit contract only fails on outcome: 'fail'. For per-PR cached fixtures, parse_error is usually a harness breakage and should fail when the site mode is blocking. Otherwise the gate can silently pass when the detector parser breaks.
>
> **Should-fix: baseline weakening gate misses mode downgrades.** The gate covers tolerance widening / threshold lowering, but a site can be downgraded from blocking to nightly/advisory/disabled, which also weakens enforcement. Require the same approval trailer for mode weakening.
>
> **Should-fix: humanize CHECK constraint is weaker than contract.** Contract requires seed to be a non-negative integer, but migration only requires seed IS NOT NULL. Add JSON type + integer + >= 0 validation.
>
> **Should-fix: GeoIP DB writable path likely brittle.** Spec writes refreshed DB into infra/geoip/geolite2-city.mmdb, which is repo/source-tree shaped. In deployed/runtime contexts, this may be read-only or not shared with workers. Prefer an env-configured runtime data path with bundled fallback.
>
> Verdict: not quite spec-ready. Fix the first two before plan; the other three are likely PR-review churn if left as-is.

### Triage and decisions

| # | Finding | Class | Triage | Action taken |
|---|---|---|---|---|
| 1 | Q10 proxy-config source unresolved (blocking) | Scope (architect-pick boundary) | technical — auto-decide | Added RECOMMENDED default to §17 Q10: extend `subaccountSettings` with `proxyConfig JSONB` + `proxyLocaleOverrides JSONB` columns. Architect can deviate with documented rationale in `progress.md`. This addresses ChatGPT's "weakens file inventory lock" concern without re-opening the operator's grill decision to make this architect-pick. |
| 2 | `parse_error` exits 0 for blocking sites (blocking) | Technical bug | auto-apply | Changed §8.1 exit-code contract: failure set is now `{ 'fail', 'parse_error' }` for blocking-mode sites. `site_unavailable` stays non-failing with rationale (live-nightly site outages are legitimate; cached-fixture site_unavailable is near-impossible and a signal but not a block). Updated §10.5 no-silent-partial-success and §19.1 acceptance criteria. |
| 3 | Baseline gate misses mode downgrades (should-fix) | Technical gap | auto-apply | Extended `verify-baseline-weakening-approval.sh` scope in §5.1 row: gate now requires the trailer for both (a) tolerance widening / threshold lowering AND (b) mode downgrades (`blocking → nightly/advisory/disabled`, `nightly → advisory/disabled`, `advisory → disabled`). Mode upgrades pass silently. Updated §14 Flaky sites bullet to reference the trailer requirement. |
| 4 | humanize CHECK constraint too weak (should-fix) | Technical bug | auto-apply | Tightened §5.3 migration CHECK constraint to validate: `jsonb_typeof(humanize) = 'object'`, closed profile enum, seed is a JSON number, seed is integer (no fractional part), seed >= 0. |
| 5 | GeoIP DB writable path brittle (should-fix) | Technical / deployment | auto-apply | Split into bundled-fallback (`infra/geoip/geolite2-city.mmdb` checked into repo, first-boot / offline read-only fallback) and runtime data path (`process.env.GEOIP_RUNTIME_DIR / geolite2-city.mmdb`, default `/var/lib/synthetos/geoip/geolite2-city.mmdb`). Refresh job writes to runtime path only; reader prefers runtime over bundled if newer. If runtime path is unwritable, refresh fails loudly with `geoip.db.refresh.failed { step: 'runtime_dir_unwritable' }` and reader continues with bundled fallback. Updated §5.1, §8.4. |

**Why all five were classified technical (auto-apply) rather than user-facing:**
- Findings 2, 3, 4, 5 are pure mechanical / technical spec corrections — no operator-visible UX or product policy change.
- Finding 1 is a scope-boundary clarification — the operator had already grill-approved Q10 as architect-pick; ChatGPT is suggesting the spec underspecifies Phase 2. Auto-decide adds a recommended default without removing the architect's flexibility. If the operator wants Q10 fully resolved before build (per ChatGPT's "blocking" framing), they can override in chat — but the recommended default makes Phase 2 buildable as-is.

### Commits

- Single inline edit pass to `tasks/builds/browser-hardening-primitives/spec.md` covering Findings 1–5.
- Spec frontmatter `Last updated:` bumped to `2026-05-18 (chatgpt-spec-review R1)`.

### Verdict

**Round 1 closed.** All 5 findings addressed inline. No user-facing decisions required (operator has standing visibility on the auto-decide for Finding 1 and can escalate if desired). Spec is ready for Phase 1 handoff to feature-coordinator unless the operator requests further ChatGPT rounds.

---

## Round 2 — 2026-05-18

### ChatGPT response (verbatim)

> Yes, 3 more worth tightening:
>
> **Blocking: R1 proxy default added only to Q10, not file inventory/migrations.** The recommended subaccountSettings columns now exist conceptually, but §5.2/§5.3 still do not list the modified schema or migration. Add conditional file/migration rows for `subaccountSettings.proxyConfig` + `proxyLocaleOverrides`.
>
> **Should-fix: telemetry regression event still excludes parse_error.** CI now treats `{ fail, parse_error }` as blocking failures, but `browser.detection.harness.run.regression` only emits on `outcome: 'fail'`. Either rename semantics to score regression only, or add a separate parser-break event.
>
> **Should-fix: runtimePath in telemetry may leak infra details.** `geoip.db.refreshed` now includes `runtimePath`. That is probably unnecessary operational detail. Prefer `{ previousVersion, newVersion, sizeBytes }` only, or a coarse `source: 'runtime' | 'bundled'`.
>
> Verdict: close after these. #1 is the only one I'd treat as must-fix.

### Triage and decisions

| # | Finding | Class | Triage | Action taken |
|---|---|---|---|---|
| R2-1 | R1 proxy default not propagated to §5.2/§5.3 | Technical (file inventory drift) | auto-apply | Added conditional row to §5.2 modified files for `server/db/schema/subaccountSettings.ts` (or equivalent) extending with `proxyConfig JSONB` + `proxyLocaleOverrides JSONB` columns. Added conditional migration row `<next-free>_subaccount_settings_add_proxy_config.sql` to §5.3 with CHECK constraints (`jsonb_typeof` validation; architect tightens at build time). Added new §7.5 documenting that the columns inherit the existing tenant RLS posture on `subaccountSettings`. Both rows are explicitly conditional on §17 Q10 default path — if the architect deviates, the rows are replaced with equivalent targets. |
| R2-2 | Regression event excludes parse_error | Technical (telemetry/contract mismatch) | auto-apply | Extended `browser.detection.harness.run.regression` trigger to fire on the full failure set `{ 'fail', 'parse_error' }` (matches the §8.1 exit-code contract). Added `outcome` field to the payload so consumers can distinguish score regression from parser breakage. Documented that `score`/`baselineScore`/`baselineTolerance` may be `null` when `outcome: 'parse_error'`. |
| R2-3 | `runtimePath` leaks infra detail | Technical (privacy/observability) | auto-apply | Removed `runtimePath` from `geoip.db.refreshed` payload. Added new event `geoip.db.source.selected { source: 'runtime' \| 'bundled' }` emitted once per session boot by `proxyAlignmentService` — gives engineers a coarse signal to verify the refresh job is taking effect without exposing the actual filesystem path. §12 telemetry registry table updated. |

**All three are technical, mechanical fixes — no operator-visible UX or product policy change.** Self-consistency counts updated in §18 (telemetry events 10 → 11; migrations 2 → 3 with the new one being conditional on §17 Q10 default; §5.2 modified-file row count adjusted).

### Commits

- Inline edit pass to `tasks/builds/browser-hardening-primitives/spec.md` covering Findings R2-1 through R2-3.
- Spec frontmatter `Last updated:` bumped to `2026-05-18 (chatgpt-spec-review R2)`.

### Verdict

**Round 2 closed.** All 3 findings addressed inline. ChatGPT's own verdict was "close after these." Spec is ready for Phase 1 handoff to feature-coordinator unless the operator requests further ChatGPT rounds.

---

## Round 3 — 2026-05-18

### ChatGPT response (verbatim)

> One final nit only:
>
> **Should-fix: proxy migration CHECK is effectively a no-op.** The `proxy_locale_overrides` CHECK says object AND keys absent OR keys present, which accepts any object. Either remove the pretend validation, or tighten it to allow only `timezone`, `locale`, `language` keys with string values.
>
> Everything else looks closeable.

### Triage and decisions

| # | Finding | Class | Triage | Action taken |
|---|---|---|---|---|
| R3-1 | proxy_locale_overrides CHECK is a tautology | Technical (CHECK is `(X OR NOT X)` = always TRUE) | auto-apply | Replaced the tautological CHECK with a real validation: object shape + no extra keys outside `{timezone, locale, language}` (enforced via `(proxy_locale_overrides - 'timezone' - 'locale' - 'language') = '{}'::jsonb`) + each present key's value must be a string (`jsonb_typeof(...->'<key>') = 'string'` per key). Format reworked into multi-line CHECK with 1-vs-2 split so `proxy_config` and `proxy_locale_overrides` are clearly separate constraints. Architect MAY tighten further at build time (e.g. IANA timezone format validation via a CHECK function or Zod), but the per-key string + closed-key-set constraint is the binding minimum. |

### Commits

- Inline edit pass to `tasks/builds/browser-hardening-primitives/spec.md` covering Finding R3-1.
- Spec frontmatter `Status:` flipped from `reviewing` → `accepted` per spec-authoring-checklist §11 lifecycle.
- Spec frontmatter `Last updated:` bumped to `2026-05-18 (chatgpt-spec-review R3 — locked)`.

### Verdict

**Round 3 closed. SPEC LOCKED.** Operator instruction: "Lock the spec after this." Spec status is now `accepted`. ChatGPT verdict on the spec body: "Everything else looks closeable." No further chatgpt-spec-review rounds. Spec-coordinator proceeds to Step 9 (Handoff write) → Step 10 (current-focus → BUILDING) → Step 11 (end-of-phase prompt) → auto-commit.

---

## Cumulative tally

- **R1:** 5 findings → 5 auto-applied (Q10 default, parse_error exit code, mode-downgrade gate, humanize CHECK, GeoIP path).
- **R2:** 3 findings → 3 auto-applied (file inventory propagation, regression event extension, runtimePath leak).
- **R3:** 1 finding → 1 auto-applied (proxy_locale_overrides tautology).
- **Total:** 9 findings, 9 auto-applied (100% closure), 0 user-facing escalations, 0 rejected.

ChatGPT's final stance: closeable. Operator's final instruction: lock. Spec moves to handoff.
