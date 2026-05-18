# chatgpt-plan-review — browser-hardening-primitives

**Date:** 2026-05-18
**Plan:** tasks/builds/browser-hardening-primitives/plan.md
**Mode:** manual

---

## Session info

- **Build slug:** browser-hardening-primitives
- **Spec status:** LOCKED (accepted 2026-05-18) after 4 spec-reviewer iterations + 3 chatgpt-spec-review rounds
- **Plan author:** architect sub-agent
- **Total chunks:** 11 (Phase 1: 4 / Phase 2: 4 / Phase 3: 3)
- **Architect deviations to validate:**
  1. Chunk 3 has 12 files vs the ≤5 file rule (argued under ≤1 logical responsibility — uniform per-site corpus expansion)
  2. Spec referenced non-existent `subaccountSettings` table; architect resolved by extending existing `subaccount_iee_browser_settings`
- **Architect-pick items punted:**
  - Item 7: e2b SDK not installed → cached fixtures only
  - Item 8: tenant proxy-config UI deferred → disclosure copy ships but unrendered

---

## Round 1 — 2026-05-18

**Adjudication mode:** main-session adjudication (SendMessage tool unavailable to continue the chatgpt-plan-review sub-agent). Main session applied the same triage rules the sub-agent would have used (technical vs user-facing) and logged the round here.

### Findings

#### Finding 1 (BLOCKING) — Nightly downgraded to cached fixtures only

**ChatGPT statement (verbatim):**
> The spec allows per-PR cached fixtures if e2b is unavailable, but says Phases 2/3 depend on nightly real-e2b as the primary regression gate. The plan resolves Q7 as "nightly also cached fixtures for V1," which removes the only live browser-fingerprint gate. Phase 2/3 should pause, or nightly must be real-e2b before accepting proxy/humanize.

**Spec evidence verified:**
- Line 63: "Nightly runs hit live external sites for the full 30-site suite as advisory signal."
- Line 158 (§5.1 CI workflow row): "nightly advisory cron (live sites, <15 min budget)"
- Line 335 (§8.1): "Nightly: cron `0 3 * * *` UTC, advisory" against live e2b
- Line 377 (§9): "Phase 2 (Proxy alignment) depends on Phase 1 harness being e2b-backed (harness verifies no regression on live browser fingerprint)"

**Triage:** USER-FACING (product/scope decision — do we ship without a live regression gate?).

**Operator decision (2026-05-18, via AskUserQuestion):** "Ship V1 with cached-only + framing departure". Architect punt accepted as a documented spec deviation.

**Actions taken:**
- `plan.md § Section 1` item 7 strengthened: framing-departure language; cross-reference to chatgpt-plan-review R1 finding 1; cross-reference to handoff `spec_deviations:` field; post-V1 follow-up `BHP-2` added to `tasks/todo.md`.
- `plan.md § Section 4` updated with Round 1 outcomes summary.
- `handoff.md` new `## Spec deviations` section added recording the framing departure.
- `tasks/todo.md` new item `BHP-2 — Wire live-e2b nightly run once the e2b SDK lands` appended.

---

#### Finding 2 (BLOCKING) — Baseline-approval gate timing bug

**ChatGPT statement (verbatim):**
> The plan says the gate greps the merge commit message. But the gate runs as a PR pre-step before the squash commit exists. It needs to inspect PR commits, PR body, or a dedicated approval file/trailer already present in the branch.

**Verified correctness bug:** chunk 4's CI workflow contract explicitly says the gate is a "pre-step on the per-PR job" — at that point the squash commit does not exist yet. Architect's mitigation in Section 1 was inverted: it claimed the gate scans the merge commit, which would always pass (because there's no merge commit) or always fail (because no trailer is there yet).

**Triage:** TECHNICAL (mechanical fix; gate must scan branch commits).

**Actions taken (auto-applied):**
- `plan.md § Section 1` "Baseline-weakening gate correctness against squash merges" risk rewritten to "Baseline-weakening gate runs PRE-merge"; mitigation now specifies `git log origin/main..HEAD --format=%B` (branch commits) and the `fetch-depth: 0` CI requirement.
- `plan.md § Chunk 2 Contracts` updated: trailer regex specified; branch-commit scan documented; self-test fixture extended with case (viii) "trailer present in non-tip branch commit is sufficient".
- `plan.md § Chunk 2 Error-handling strategy` updated: detached-HEAD / empty-range diagnostic; `actions/checkout fetch-depth: 0` CI prerequisite documented in gate header.
- `plan.md § Chunk 4 Contracts` updated: CI workflow MUST set `actions/checkout fetch-depth: 0`.
- `plan.md § Section 3` per-chunk risk row for chunk 2 rewritten to reflect the corrected gate timing.

---

#### Finding 3 (SHOULD-FIX) — Approval authority weakened

**ChatGPT statement (verbatim):**
> Spec says the trailer must reference an approved reviewer list. Plan changes this to "non-empty handle" and punts allowlist. That weakens the governance control. At minimum, pin @michaelhazza as the only accepted V1 approver.

**Spec evidence verified:**
- Line 500 (§14): "the `Baseline-Weakening-Approved-By:` trailer must reference a reviewer with explicit approval authority for the harness (architect locks the exact reviewer list at build time; default = platform team leads)."

**Triage:** TECHNICAL (architect punted on the allowlist mechanism but explicitly named `@michaelhazza` as the V1 reviewer in the same item-6 prose; spec requires the gate to enforce, not just document).

**Actions taken (auto-applied):**
- `plan.md § Section 1` item 6 resolution updated: V1 allowlist is `{ '@michaelhazza', 'michaelhazza' }` enforced in the gate; expanding the allowlist is a one-line gate-script edit (not a baseline-weakening event).
- `plan.md § Chunk 2 Contracts` updated: allowlist enforcement specified; diagnostic message format pinned; self-test case (vii) "wrong-handle-rejected" added.
- `plan.md § Chunk 2 Error-handling strategy` updated: allowlist mismatch exit-1 path documented.
- `plan.md § Section 3` per-chunk risk row for chunk 2 added: "Reviewer allowlist not enforced ⇒ governance posture weakened".

---

### Round 1 verdict

- 3 findings raised; 3 findings closed.
- 2 BLOCKING findings resolved (finding 1 via operator-ratified framing departure; finding 2 via technical fix).
- 1 SHOULD-FIX finding resolved (finding 3 via technical fix).
- Plan-gate is now ready for the operator to declare proceed / revise / abort.

**Files modified this round:**
- `tasks/builds/browser-hardening-primitives/plan.md`
- `tasks/builds/browser-hardening-primitives/handoff.md`
- `tasks/todo.md`
- This session log

---

## Round 2 — 2026-05-18

**Operator instruction:** "final feedback, lock after this".

### Findings

#### Finding 4 (BLOCKING) — Proxy credentials stored as plain JSONB

**ChatGPT statement (verbatim):**
> Chunk 5 defines proxyConfig JSONB with { url, username?, password? }. That puts credentials directly into tenant settings. Use the existing secrets/credential storage pattern, or encrypt the credential fields at rest and add explicit redaction tests.

**Triage:** TECHNICAL (canonical pattern exists at `server/services/credentialBrokerService.ts` — `issueCredential` + `injectIntoEnvironment` — already proven on Slack / Calendar / OAuth paths).

**Actions taken (auto-applied):**
- `plan.md § Chunk 5 Module shape`: `proxyConfig` JSONB shape changed to `{ url: string, credentialId?: string }`; never stores raw credentials. Cross-referenced as R2 finding 4 fix.
- `plan.md § Chunk 5 Contracts`: migration CHECK constraint hardened to forbid `username` / `password` / `secret` keys at the database layer; `url` required string; `credentialId` optional string.
- `plan.md § Chunk 6 Module shape`: redaction test added to the pure-test suite (asserts assembled `ProxyAlignment` carries zero credential material when input has a `credentialId`).
- `plan.md § Chunk 8 Module shape + Contracts`: credentials injected via `credentialBrokerService.injectIntoEnvironment` at sandbox-launch time; envelope carries only `proxyUrlEnvKey` (env-var name) not the credential itself; harness reads from `process.env[taskPayload.proxyUrlEnvKey]`. Credentials never appear in `taskPayload`, never appear in `/workspace/input.json`, never appear in telemetry.
- `plan.md § Section 3` per-chunk risk rows added for chunks 5, 6, 8 covering the credential-handling discipline.

---

#### Finding 5 (SHOULD-FIX) — Bundled GeoLite2 DB licensing/compliance risk

**ChatGPT statement (verbatim):**
> The plan commits geolite2-city.mmdb into the repo. MaxMind says GeoLite users must keep data up to date and delete old databases within 30 days of a new release, and redistribution can require a commercial redistribution licence depending on use. Prefer shipping no binary and downloading at deploy/runtime with GEOIP_LICENCE_KEY, with fallback disabled if unavailable.

**Triage:** TECHNICAL (architecture-affecting but mechanical — no bundled binary, deploy-time bootstrap, graceful degradation when `GEOIP_LICENCE_KEY` is unset).

**Actions taken (auto-applied):**
- `plan.md § Chunk 7 Files` revised: removed `infra/geoip/geolite2-city.mmdb` + `infra/geoip/LICENSE.txt`; added `infra/geoip/README.md` (operator-facing licensing posture) + `infra/geoip/.gitignore` (blocks `*.mmdb`) + `scripts/bootstrap-geoip-db.sh` (deploy-time fetcher).
- `plan.md § Chunk 7 Module shape`: reader is runtime-path-only; no bundled fallback; returns null from every lookup when file is absent; emits `geoip.db.source.selected { source: 'runtime' | 'unavailable' }`.
- `plan.md § Chunk 7 Contracts`: deploy-time bootstrap discipline pinned; `GEOIP_LICENCE_KEY` unset = no GeoIP + clean degradation (proxy still works at network level); licensing-posture section added.
- `plan.md § Chunk 7 Error-handling strategy`: added "Runtime DB absent entirely" path → reader returns null + emits `geoip_db_unavailable` → chunk 6 service returns null ProxyAlignment → proxy alignment cleanly skipped; "licence_key_missing" pre-check path added.
- `plan.md § Chunk 7 Acceptance signals`: revised to reference `bootstrap-geoip-db.sh` and the runtime-path-only reader behaviour.
- `plan.md § Section 3` chunk 7 risk row about bundled-binary repo bloat REPLACED with the licensing-compliance row + the no-binary mitigation.

---

### Round 2 verdict

- 2 findings raised; 2 findings closed.
- 1 BLOCKING finding resolved (finding 4 via technical fix using the canonical `credentialBrokerService` pattern).
- 1 SHOULD-FIX finding resolved (finding 5 via technical fix — no bundled binary, deploy-time bootstrap, graceful degradation).
- Operator instructed "lock after this" — **plan is LOCKED**. No further chatgpt-plan-review rounds. Proceeding to plan-gate.

**Files modified this round:**
- `tasks/builds/browser-hardening-primitives/plan.md`
- `tasks/builds/browser-hardening-primitives/handoff.md`
- This session log

---

## Final session summary

| Round | Findings | BLOCKING closed | SHOULD-FIX closed | Status |
|---|---|---|---|---|
| R1 | 3 | 2 | 1 | closed |
| R2 | 2 | 1 | 1 | closed |
| **Total** | **5** | **3** | **2** | **PLAN LOCKED** |

All 5 findings closed by a mix of operator-ratified framing departures (1) and technical auto-applied fixes (4). Plan status: LOCKED 2026-05-18. Next: `feature-coordinator` plan-gate → per-chunk `builder` loop.
