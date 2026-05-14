# Page Splits — Aggregate Build Plan

**Slug:** `page-splits`
**Status:** Implemented; PHASE 3 finalisation in progress.

The detailed plan for each sub-build lives in `tasks/builds/feat-split-<name>/plan.md`. This aggregate plan records execution order and chunk grouping for the umbrella build.

---

## Execution model

The 16 sub-builds were NOT executed via the standard `feature-coordinator` pipeline (no per-chunk `builder` dispatch, no per-chunk pr-reviewer). The operator authored each spec via `spec-reviewer`, then ran `spec-conformance` per build, then folded the implementation across all 16 splits into a single large commit (`395b3a56 refactor(client): split 18 monolithic pages along tab/region/atom seams`).

This is captured here for the finalisation record. The Phase 3 review pass (`chatgpt-pr-review` against the aggregate diff) is what catches any cross-split regressions.

---

## Chunk inventory (effective)

| # | Sub-build | Page-level source | Status |
|---|---|---|---|
| 1 | feat-split-layout | `client/src/components/Layout.tsx` | Implemented |
| 2 | feat-split-adminsubaccountdetailpage | `client/src/pages/AdminSubaccountDetailPage.tsx` | Implemented; operator-tab port grafted in during S2 |
| 3 | feat-split-usagepage | `client/src/pages/UsagePage.tsx` | Implemented; memory-utility tab port grafted in during S2 |
| 4 | feat-split-subaccountknowledgepage | `client/src/pages/SubaccountKnowledgePage.tsx` | Implemented |
| 5 | feat-split-workflowrunpage | `client/src/pages/WorkflowRunPage.tsx` | Implemented |
| 6 | feat-split-agentchatpage | `client/src/pages/AgentChatPage.tsx` | Implemented |
| 7 | feat-split-configassistantpage | `client/src/pages/ConfigAssistantPage.tsx` | Implemented |
| 8 | feat-split-invocationscard | `client/src/components/InvocationsCard.tsx` | Implemented |
| 9 | feat-split-onboardingwizardpage | `client/src/pages/OnboardingWizardPage.tsx` | Implemented |
| 10 | feat-split-orgchartpage | `client/src/pages/OrgChartPage.tsx` | Implemented |
| 11 | feat-split-orgsettingspage | `client/src/pages/OrgSettingsPage.tsx` | Implemented |
| 12 | feat-split-reviewqueuepage | `client/src/pages/ReviewQueuePage.tsx` | Implemented |
| 13 | feat-split-subaccountagenteditpage | `client/src/pages/SubaccountAgentEditPage.tsx` | Implemented |
| 14 | feat-split-subaccountagentspage | `client/src/pages/SubaccountAgentsPage.tsx` | Implemented |
| 15 | feat-split-systemagenteditpage | `client/src/pages/SystemAgentEditPage.tsx` | Implemented |
| 16 | feat-split-taskmodal | `client/src/components/TaskModal.tsx` | Implemented |

---

## Phase 3 sequence (this session)

1. S2 force-merge of `origin/main` into branch — 117 commits behind; auto-resolved doc/task per playbook, manually resolved 6 code-area conflicts (4 ours + 2 manual ports + 2 deletes for orphaned skill-analyzer files).
2. G4 regression guard — lint + typecheck on post-S2 branch.
3. Reconstructed aggregate artefacts (this plan, the aggregate spec, handoff, progress).
4. `current-focus.md` → status REVIEWING for `page-splits`.
5. PR open.
6. `chatgpt-pr-review` against aggregate code diff (excluding spec / plan / review-log files).
7. Doc-sync sweep.
8. KNOWLEDGE.md pattern cross-check.
9. todo.md cleanup.
10. `current-focus.md` → MERGE_READY; ready-to-merge label after final commit lands.
11. CI monitor + iterative fix loop.
12. Auto-merge.
