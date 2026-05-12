# PR Review Response — F1 Foundation Consolidation

**Date:** 2026-05-12
**PR:** `personal-assistant-v1`
**Reviewer finding addressed:** F1 — "PR implements predecessor primitives instead of consuming them"
**Operator decision:** Option B — **Reclassify as combined foundation + product PR** (do not split)
**Status:** Acknowledged + briefs updated; PR continues to merge under combined classification

---

## Contents

- [1. Acknowledgement](#1-acknowledgement)
- [2. Decision: Option B — Reclassify (not split)](#2-decision-option-b--reclassify-not-split)
- [3. How to review the combined PR](#3-how-to-review-the-combined-pr)
- [4. What is unchanged from the approved design](#4-what-is-unchanged-from-the-approved-design)
- [5. Mitigations for the larger combined surface](#5-mitigations-for-the-larger-combined-surface)
- [6. Next steps for the reviewer](#6-next-steps-for-the-reviewer)
- [Appendix: Quick decision summary](#appendix-quick-decision-summary)

## 1. Acknowledgement

The reviewer is correct. The original plan called for two sequenced PRs:

1. **`user-owned-agents`** — foundation primitive (single nullable `owner_user_id` column on `agents` / `agent_runs` / `integration_connections`, owner-aware credential broker, RLS clause, admin redaction policy).
2. **`personal-assistant-v1`** — first consumer of the foundation, sitting on top of merged user-owned-agents.

Both briefs locked this sequencing explicitly. `personal-assistant-v1/brief.md` §2 listed `user-owned-agents` as a **LOCKED PREDECESSOR — must merge before EA V1 build starts**. `user-owned-agents/brief.md` §7 said "EA V1 build starts only after `user-owned-agents` is merged."

The implementation phase collapsed this boundary. Migration `0327_user_owned_agents.sql` plus the credential broker changes, RLS clause, and redaction policy all landed inside the EA V1 PR rather than as a standalone predecessor PR. The builder should have returned a `PLAN_GAP` verdict (predecessor missing); it did not.

No security or correctness issue has been identified in the code itself — the issue is the merge boundary, not the implementation.

## 2. Decision: Option B — Reclassify (not split)

After weighing the two options the reviewer raised, the operator decision is to **reclassify this PR as a combined predecessor + product PR** and proceed with review under that scope, rather than splitting.

### Rationale

1. **Code is already implemented, tested, and in a working state.** Splitting costs roughly half a day of rebasing plus CI re-runs for organisational benefit only — no security, correctness, or design benefit.
2. **The foundation surface is small.** Three nullable columns, one CHECK constraint, one RLS clause, one additive credential-broker parameter, one redaction policy at the API serialisation layer. Reviewing it inline alongside the product surface is acceptable given the size.
3. **The original brief separation was an organisational discipline goal**, not a correctness requirement. The separation existed to keep PRs small and auditable; with both surfaces now visible together and explicitly mapped (see §3), reviewing them as one logical change does not compromise audit integrity.
4. **The locked design decisions are intact.** Schema shape (`owner_user_id`, no principal abstraction), strategic framing (foundation primitive proof, not personal-productivity replacement), V1 scope (Calendar reads auto + writes review-gated, Drive read-only V1, third-party sends review-gated), capability alignment with `WorkspaceAdapter` — all unchanged. The merge unit is the only delta.

### Trade-off accepted

The reviewer's preferred path (Option A — split) would have preserved smaller per-PR review surfaces and a cleaner audit trail. Option B accepts a larger combined review surface in exchange for shipping faster. A follow-on commit to the build playbook will reinforce the `PLAN_GAP` discipline so future predecessors are not collapsed.

## 3. How to review the combined PR

Treat the PR as **two logical sub-changes** for review purposes. File map below.

### Sub-change A — User-owned agents foundation

**Spec:** `tasks/builds/user-owned-agents/brief.md`

**Files (foundation):**
- `migrations/0327_user_owned_agents.sql` — three nullable columns + indexes + RLS clause
- `server/db/schema/agents.ts` — `owner_user_id` column declaration
- `server/db/schema/agentRuns.ts` — `owner_user_id` column declaration
- `server/db/schema/integrationConnections.ts` — `owner_user_id` column + partial unique index
- `server/services/credentialBrokerService.ts` — owner-aware lookup, `OWNER_MISMATCH` typed error
- API serialisation layer for `agent_runs` (Run Trace) + `memory_blocks` + `voice_profiles` — content redaction for non-owner viewers
- Tests for the broker invariants and redaction layer

**Review focus for this sub-change:**
- Schema correctness — `owner_user_id` nullable + index shape per brief §3.1–§3.2
- RLS clause safety — non-owners cannot read user-owned agent runs except for redacted-metadata admin views per brief §3.5–§3.6
- Credential broker invariants — `OWNER_MISMATCH` typed error on mismatch; no token leakage across owners; broker still works for existing subaccount-owned call sites (additive parameter)
- Redaction policy enforced at serialisation boundary, not at handler boundary (so all routes inherit the same redaction)
- Migration is purely additive — no backfill required; existing rows stay at `owner_user_id IS NULL` with no behaviour change

### Sub-change B — Personal Assistant V1 product

**Spec:** `tasks/builds/personal-assistant-v1/brief.md`

**Files (product):**
- `server/config/oauthProviders.ts` — `google_calendar` provider entry
- `server/config/actionRegistry.ts` — Calendar actions (read + review-gated write per §3.2 of EA V1 brief), Slack agent actions
- `server/config/c.ts` — Executive Assistant system-agent template
- `server/config/capabilityGroups.ts` — UI grouping layer over existing capability taxonomy
- `server/services/calendar/*` — Calendar action handlers
- `server/services/slack/*` — Slack action handlers (beyond existing outbound notify)
- `server/services/voiceProfileService.ts` + `server/db/schema/voiceProfiles.ts` — VoiceProfile primitive
- `server/routes/webhooks/googleWebhook.ts` — Gmail push + Calendar reminders
- `server/jobs/gmailInboxPollJob.ts` — 5-minute polling fallback
- `server/db/schema/agentTriggers.ts` — event-type enum extension (`gmail_message_received`, `calendar_event_imminent`, `slack_mention`)
- `server/db/schema/eaDrafts.ts` — drafts queue
- Migration extensions for the seed EA agent row and the trigger event-type enum
- Three mockups under `prototypes/personal-assistant-v1/`

**Review focus for this sub-change:**
- Capability surface alignment with existing `WorkspaceAdapter` (no artificial regression vs subaccount-owned agents)
- Review-gating of all third-party sends (`send_email`, `slack.post_message`, Calendar `create_event` / `update_event` / `respond_to_invite`); auto-allow restricted to operator's own self-DM and Gmail Drafts
- `delete_event` MUST NOT be registered in V1 (deferred per brief §3.2)
- VoiceProfile resource: explicit `owner_user_id` / `subaccount_id` / `org_scope` columns with CHECK constraint that exactly one is set per row; does not revive principal abstraction (brief §3.11 anti-revival note)
- Memory remains per-agent (no `scope_type` / `scope_id`) per brief §3.12 + user-owned-agents §3.4
- Three V1 use cases scoped: daily briefing (07:00 cron + Slack DM), inbox triage + drafts (Gmail poll + webhook trigger), meeting prep (calendar imminent trigger). #4 + #5 deferred.

## 4. What is unchanged from the approved design

- **Schema shape** — single `owner_user_id` column, no `principal_type` enum, no `scope_type` on memory blocks. Matches `user-owned-agents` §0 Option B as ratified by the operator on 2026-05-12.
- **Strategic framing** — foundation primitive proof, not a personal-productivity replacement. Explicit non-goal vs Claude / ChatGPT / Codex preserved in EA V1 §0.5.2.
- **V1 scope decisions** — Calendar = read + review-gated write; Drive = read-only V1 (writes deferred); third-party sends review-gated; auto-send to self only. Locked per EA V1 §0.5.4 + §4 q1.
- **Reuse acceptance criterion** — a stub second user-owned agent must work with the same primitives without EA-specific branching (EA V1 §0.5.3). The reviewer should validate this against the actual code.
- **Privacy boundary** — owner sees own content; admins see redacted metadata by default; break-glass override writes a typed audit event and notifies the user (user-owned-agents §3.6).
- **Capability alignment** — surface matches existing `WorkspaceAdapter` floor; no artificial regression for user-owned agents.

## 5. Mitigations for the larger combined surface

To keep the review safe despite the larger surface:

- **Explicit file map (§3 above)** so each logical sub-change can be reviewed independently in turn.
- **Briefs preserved unchanged** so the design rationale remains auditable. `user-owned-agents/brief.md` now carries an "Implementation status" callout near the top noting the consolidation; the brief body is unchanged.
- **Decision provenance points** — EA V1 brief §0.5.5 now lists the foundation consolidation as decision #5 in the decision-trail record.
- **Build-playbook follow-up** — a separate commit to the build playbook will reinforce the `PLAN_GAP` discipline so future predecessor primitives are not collapsed into product PRs. Tracking item: `tasks/todo.md` (to be added in the doc-sync sweep).

## 6. Next steps for the reviewer

If the reclassification is accepted, please:

1. Proceed with review against both sub-changes (A foundation, B product) per the file map in §3.
2. Apply the per-sub-change review focus listed above.
3. Flag any finding that genuinely required the split path (e.g., a foundation-layer issue that would have been caught earlier as an isolated review) so we can capture it for the build-playbook update.

If reclassification is NOT accepted and the split is required:

1. Reply on the PR indicating split required.
2. The next session will execute Option A — extract foundation files into a new PR `user-owned-agents`, merge first, rebase EA V1 on top, resubmit.

## Appendix: Quick decision summary

| Question | Answer |
|---|---|
| Was the foundation supposed to be a separate PR? | Yes — per both briefs as approved |
| Did the builder build it inline anyway? | Yes — boundary collapsed during implementation phase |
| Should the builder have returned PLAN_GAP? | Yes — that is the documented mechanism for this situation |
| Is the code itself problematic? | No — implementation appears correct; the issue is the merge unit |
| What is the operator decision? | Option B — reclassify as combined PR, do not split |
| Is the original design still intact? | Yes — both briefs preserved, all locked decisions hold |
| What changes for the reviewer? | Larger review surface; file-map provided to break it into two logical reviews |
| What changes for future builds? | Build playbook reinforcement on PLAN_GAP discipline (separate follow-on) |

## End of response
