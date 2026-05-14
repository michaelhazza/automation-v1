-- Migration 0344: Make ea_drafts.proposal_action_id UNIQUE.
--
-- REVIEW-F2 from the 2026-05-13 ChatGPT PR #296 round 2 review (session log
-- `tasks/review-logs/chatgpt-pr-review-claude-close-deferred-pa-v1-13lHR-2026-05-13T06-43-44Z.md`).
--
-- Context. `eaDraftService.createDraftWithProposal` builds the upstream
-- action-row idempotency key from `(agentRunId, kind, ownerUserId)`. The
-- same-commit code change in `server/services/eaDrafts/eaDraftService.ts`
-- adds a stable per-call discriminator (`targetRef` or a hash of `{ kind,
-- body }`) to that key so two drafts of the same kind from the same run +
-- owner no longer collapse onto a single `actions` row. This migration is
-- defence-in-depth: if a future caller re-introduces the collision, the
-- unique index turns the silent "second draft stuck idle" failure into a
-- loud DB unique-violation at the `ea_drafts` insert site, which the
-- transaction wrapper rolls back.
--
-- Invariant locked: one proposal action owns exactly one EA draft. The
-- spec amendment block dated 2026-05-13 (eighth pass — REVIEW-F2 from
-- ChatGPT PR #296 review) describes this invariant in
-- `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`.
--
-- Pre-check. `ea_drafts` was first introduced in the PA-V1 deploy and the
-- pre-amendment idempotency-key shape kept the FK 1:1 with the proposal
-- action in every observed flow. The only collision path required two
-- drafts of the same kind for the same `(agentRunId, ownerUserId)` within
-- the same run — a path not yet exercised in production. The CREATE UNIQUE
-- INDEX below will fail loudly and roll back if any pre-existing duplicates
-- exist; that is the correct outcome (duplicates indicate the bug has
-- already shipped and need dedup before the constraint can land).
--
-- Spec: docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md
-- §7.5 (invariant) + amendment block (REVIEW-F2 from PR #296 review).

-- Acquire ACCESS EXCLUSIVE on the table for the migration's duration.
LOCK TABLE ea_drafts IN ACCESS EXCLUSIVE MODE;

DROP INDEX IF EXISTS ea_drafts_proposal_action_idx;
CREATE UNIQUE INDEX ea_drafts_proposal_action_unique
  ON ea_drafts (proposal_action_id);
