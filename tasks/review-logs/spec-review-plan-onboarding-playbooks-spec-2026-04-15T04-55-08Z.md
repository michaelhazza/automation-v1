# Spec Review Plan — onboarding-playbooks-spec

- **Spec path:** `/home/user/automation-v1/docs/onboarding-playbooks-spec.md`
- **Spec commit at start:** `5091665fda537a681aa1c5a35544334f0ec37f04`
- **Spec-context commit:** `9024828f0612dde13a196342482a8c0ce3bc7a34`
- **Expected iteration count cap:** 5 (MAX_ITERATIONS)
- **Stopping heuristic:** two consecutive mechanical-only rounds → stop before cap
- **Prior iterations for this spec:** 0 (no `spec-review-checkpoint-onboarding-playbooks-spec-*` files found)
- **Codex availability:** installed (`/opt/node22/bin/codex`, v0.120.0) but **NOT authenticated** in this environment; interactive `codex login --device-auth` is not available in the sandbox.

## Pre-loop context check result

- Spec framing claims (§12.3, §14) declare **six Growthbook feature flags** (`feature.playbook_action_call`, `feature.schedule_picker_v2`, `feature.unified_knowledge_page`, `feature.playbook_run_modal_v2`, `feature.onboarding_tab`, `feature.daily_brief_template`).
- `spec-context.md` declares `feature_flags: only_for_behaviour_modes`, `rollout_model: commit_and_revert`, and `convention_rejections` includes `"do not add feature flags for new migrations"`.
- The user's framing note §4 reinforces: "Migrations ship without feature flags."
- **Mismatch confirmed.** Step B of the pre-loop context check requires a HITL checkpoint before iteration 1 begins.

## Action

Write pre-loop HITL checkpoint `spec-review-checkpoint-onboarding-playbooks-spec-1-2026-04-15T04-55-08Z.md` and block. Iteration 1 does not start until the feature-flag posture is resolved (either: (a) the spec is updated to strip feature flags and use commit-and-revert, (b) the spec-context.md is updated to permit feature flags for this spec's phases and the human confirms that is intentional, or (c) the human confirms the mismatch is deliberate and we should review the spec as-is).

The checkpoint also bundles high-signal rubric findings noticed while reading the spec for the context check, so the human has one place to handle the biggest architectural and mechanical problems before iteration 1 runs. Codex unavailability is noted — a full Codex pass is not possible in this environment.
