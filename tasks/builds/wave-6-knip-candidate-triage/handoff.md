# Wave 6 Session P — Knip Candidate Triage: Handoff

**build_slug:** wave-6-knip-candidate-triage
**branch:** claude/wave-6-knip-candidate-triage
**PR:** #344 — https://github.com/michaelhazza/automation-v1/pull/344
**task_class:** Significant (light-pipeline — operator designation; no spec-coordinator)
**spec:** none (light-pipeline, no spec.md)
**plan:** none (light-pipeline, no plan.md)

---

## Phase 2 (BUILD) — complete

**Implemented chunks:**

| Chunk | Description | Commit |
|---|---|---|
| 0 | Triage verdicts — 184 candidate files classified | `fd297c25` |
| D1 | Delete 14 orphan client pages (page-split cascade) | `92e3bbda` |
| D2a | Delete BriefDetail + Subaccount downstream (26 files) | `a5fa19ba` |
| D2b | Delete Spend + lib + page-split singletons (21 files) | `6edb6259` |
| D3 | Delete client pulse/ directory (5 files) | `abc92d3a` |
| D4 | Delete client standalones (24 files) | `4b22d612` |
| D5a | Delete server service orphans (24 files) | `88985f62` |
| D5b | Delete server lib/routes/schemas/processors/tests (9 files) | `61701cc4` |
| W1 | Wire systemMonitor pg-boss registrations (4 jobs) | `4767abd0` |
| W2 | Wire skillIdempotencyKeysCleanup pg-boss registration | `28ab93ca` |
| F | knip.json entries for 31 spec-anchored / false-positive files | `30b3c1c7` |
| — | shared/types unused exports sweep — 172 KEEPs, 0 deletions | `73ee501b` |
| — | Close Wave-5 knip triage + add follow-up items to tasks/todo.md | `3b25122d` |
| — | Apply pr-reviewer findings on W1/W2 wires (4 should-fix items) | `4b3c82ce` |

**Outcome metrics:**
- Files deleted: 78 across chunks D1–D5b + 1 additional (refreshJobPure.ts, discovered dead post-F)
- pg-boss jobs wired: 5 (4 systemMonitor + 1 skillIdempotencyKeysCleanup)
- knip.json entries added: 31
- Unused files post-build: 0 (from 184)
- shared/types exports: 172 KEEPs, 0 deletions (existing baseline gate covers 167/172 items, grace 2026-08-14)

**Review posture — Significant, light-pipeline:**

- `spec-conformance`: skipped — not spec-driven (no spec.md). Policy-not-applicable.
- `adversarial-reviewer`: skipped — diff is file deletions + pg-boss registrations, does not match §5.1.2 security surface. Policy-not-applicable.
- `pr-reviewer`: APPROVED — 4 should-fix findings applied (commit `4b3c82ce`): teamSize 1→4 for system-monitor-triage per implementation plan §11, missing `withTimeout` wrappers on all 5 new workers, system-monitor-self-check wasn't rethrowing (legacy silent-swallow), missing `isTimeoutError` check + `job_timeout` log.
- `reality-checker`: skipped — operator designated light-pipeline; success criteria are deterministic (knip count = 0, builds pass). Policy-not-applicable.
- `dual-reviewer`: not run — operator designated light-pipeline. REVIEW_GAP below.
- `chatgpt-pr-review`: pending — Phase 3 mandatory.

**REVIEW_GAP entries:**

```
REVIEW_GAP: dual-reviewer | task-class: Significant | reason: operator designated light-pipeline; no Codex CLI confirmation required | operator-override: yes-2026-05-17T09:00:00Z | remediation: chatgpt-pr-review in Phase 3 serves as the primary second-opinion pass
```

**spec_deviations:** none

**Open issues for finalisation:** none

---

## LEARNING_FEEDBACK_PROPOSAL

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| knip.json FALSE-POSITIVE entries require a sibling rationale file (can't use inline comments — `JSON.parse` strict); PR body must link it | `spec-authoring-instructions` | ChatGPT R2 flagged the entry list as suspicious because there was no visible rationale. Rationale file existed but wasn't linked. This should be a spec-authoring instruction for any build touching knip.json. | |
| Before classifying a job handler file as DELETE, check if it just needs a missing WIRE: if the handler's imported services are live, it's almost certainly an unregistered job not dead code | `agent-instruction` → `builder` | wave-6 W1 chunk discovered 4 systemMonitor handlers were implemented but not registered. builder should apply this check before routing a handler to DELETE. | |
| `*.unit.ts` files outside the vitest include globs (`**/__tests__/**/*.test.ts`) are dead code — knip is correct to flag them | `agent-instruction` → `builder` | Prevents false alarms during knip triage when a standalone runner file appears as an unused candidate. | |

## Phase 3 (FINALISATION) — complete

**PR number:** #344
**chatgpt-pr-review log:** tasks/review-logs/chatgpt-pr-review-wave-6-knip-candidate-triage-2026-05-17T09-10-14Z.md
**spec_deviations reviewed:** n/a
**Doc-sync sweep verdicts:**
- architecture.md: yes — 7 edits (stale file paths removed; Active Monitoring jobs table added)
- capabilities.md: n/a: build / tooling change only
- integration-reference.md: no — checked agentTemplates, orgWorkspace, systemMonitor; zero stale references
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md: no — zero stale references
- CONTRIBUTING.md: n/a
- frontend-design-principles.md: n/a
- KNOWLEDGE.md: yes (3 entries added)
- spec-context.md: n/a (spec-review sessions only)
- docs/decisions/: no — no durable architectural choice requiring ADR
- docs/context-packs/: no — no anchor changes
- references/test-gate-policy.md: no — no gate posture changes
- references/spec-review-directional-signals.md: n/a
- docs/incident-response.md: n/a
- docs/testing-transition-plan.md: no
- .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md: n/a
- scripts/verify-*: no — no gate changes

**KNOWLEDGE.md entries added:** 3
**tasks/todo.md items removed:** 0 (prior session had already closed and filed correctly)
**ready-to-merge label applied at:** 2026-05-17T09:29:13Z
