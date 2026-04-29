# Pre-Prod Tenancy — Implementation Progress

## Phase 1 — RLS registry triage classification ([spec round 7 — commit a9135930])

### Pre-flight summary
- Branch tip CI gate count: 67 violations (61 unregistered + 4 stale + 2 caller-level)
- Authored by: Claude Sonnet 4.6 subagent (Task 1.2)
- Date: 2026-04-29

### §3.4.1 — Unregistered tenant tables (61)

| Table | Owning migration | Has policy? | Verdict | Notes |
|---|---|---|---|---|
| `account_overrides` | 0067_intervention_outcomes_and_overrides.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `action_events` | 0016_hitl_action_system.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `action_resume_events` | 0035_phase1a_policy_engine_and_resume.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `agent_conversations` | 0006_ai_agents.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `agent_prompt_revisions` | 0058_agent_prompt_revisions.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `agent_triggers` | 0029_phase_1_2_memory_entities_triggers.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `agents` | 0006_ai_agents.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `board_configs` | 0008_workspace_board.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `config_backups` | 0117_config_backups.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `config_history` | 0114_config_history.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `connector_configs` | 0044_integration_layer_canonical_schema.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `executions` | 0000_wandering_firedrake.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `feedback_votes` | 0060_inbox_feedback_attachments.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `geo_audits` | 0110_geo_audits.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `goals` | 0057_goals_system.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `hierarchy_templates` | 0025_agent_hierarchy_and_templates.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `iee_artifacts` | 0070_iee_execution_environment.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `iee_runs` | 0070_iee_execution_environment.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `iee_steps` | 0070_iee_execution_environment.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `intervention_outcomes` | 0067_intervention_outcomes_and_overrides.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `llm_inflight_history` | 0191_llm_inflight_history.sql | no | allowlist | Schema comment: "Reads are system-admin only and intentionally cross-tenant (same posture as llm_requests_archive)." `organisation_id` nullable. All three §3.3.1 criteria hold: not per-org ownership data, cross-tenant forensic ledger, all reads sysadmin-gated. [ref: spec §3.3.1] |
| `mcp_server_configs` | 0053_mcp_server_configs.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `mcp_tool_invocations` | 0154_mcp_tool_invocations.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `org_agent_configs` | 0043_org_level_agent_execution.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `org_budgets` | 0024_llm_router.sql | no | register-with-new-policy | `organisation_id` NOT NULL UNIQUE; canonical shape |
| `org_margin_configs` | 0024_llm_router.sql | no | register-with-new-policy | `organisation_id` nullable (NULL = platform default); mixed-mode — §3.3.1 pt.3 mandates tenant-private; canonical shape, custom SELECT policy needed |
| `org_memories` | 0045_cross_subaccount_intelligence.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `org_memory_entries` | 0045_cross_subaccount_intelligence.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape (defined in orgMemories.ts) |
| `org_user_roles` | 0004_subaccounts_feature_new_tables.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `organisation_secrets` | 0035_phase1a_policy_engine_and_resume.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape; sensitive — API keys / credentials |
| `page_projects` | 0042_page_infrastructure.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `permission_groups` | 0000_wandering_firedrake.sql | no | register-with-new-policy | `organisation_id` NOT NULL (confirmed in migration body); canonical shape |
| `permission_sets` | 0004_subaccounts_feature_new_tables.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `playbook_runs` | 0076_playbooks.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `playbook_templates` | 0076_playbooks.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `policy_rules` | 0035_phase1a_policy_engine_and_resume.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `portal_briefs` | 0123_portal_briefs.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `process_connection_mappings` | 0018_three_level_process_framework.sql | no | register-with-new-policy | `organisation_id` NOT NULL (confirmed in migration body); canonical shape |
| `processed_resources` | 0016_hitl_action_system.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `projects` | 0022_add_projects.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `scheduled_tasks` | 0013_phase_two_scheduled_workforce.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `skill_analyzer_jobs` | 0092_skill_analyzer.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `skill_idempotency_keys` | 0238_system_agents_v7_1.sql | yes | register | Has `CREATE POLICY skill_idempotency_keys_org_isolation` with USING + WITH CHECK in 0238; registry-only edit needed |
| `skills` | 0009_autonomous_agent_teams.sql | no | register-with-new-policy | `organisation_id` nullable (NULL = system/built-in); mixed-mode — §3.3.1 pt.3 mandates tenant-private (custom skills cited explicitly in §3.3.1); canonical shape, custom SELECT policy needed |
| `slack_conversations` | 0102_slack_conversations.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `subaccount_agents` | 0008_workspace_board.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `subaccount_onboarding_state` | 0124_subaccount_onboarding_state.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `subaccount_tags` | 0045_cross_subaccount_intelligence.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `subaccounts` | 0004_subaccounts_feature_new_tables.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `system_incident_suppressions` | 0224_system_incidents.sql | no | allowlist | Schema comment: "BYPASSES RLS — every reader MUST be sysadmin-gated." `organisation_id` nullable (NULL = suppress everywhere). Sysadmin-only surface; access gated by `requireSystemAdmin`. All three §3.3.1 criteria hold: not per-org ownership data, cross-tenant mute rule, all callers sysadmin-gated. [ref: spec §3.3.1] |
| `system_incidents` | 0224_system_incidents.sql | no | allowlist | Schema comment: "BYPASSES RLS — every reader MUST be sysadmin-gated." `organisation_id` nullable (NULL = system-level incident). Explicit bypass in `rlsProtectedTables.ts` comment block. All three §3.3.1 criteria hold: cross-tenant incident sink, sysadmin-only, all callers service-layer-gated. [ref: spec §3.3.1] |
| `task_attachments` | 0060_inbox_feedback_attachments.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape (also has `task_id` NOT NULL FK to `tasks`) |
| `task_categories` | 0000_wandering_firedrake.sql | no | register-with-new-policy | `organisation_id` NOT NULL (confirmed in migration body); canonical shape |
| `users` | 0000_wandering_firedrake.sql | no | register-with-new-policy | `organisation_id` NOT NULL; one user belongs to one org; leak exposes another org's user list; canonical shape |
| `webhook_adapter_configs` | 0061_webhook_adapter_branding_governance.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `workflow_engines` | 0000_wandering_firedrake.sql | no | register-with-new-policy | `organisation_id` NOT NULL (confirmed in migration body); sister-branch owned (§0.4) — registry-edit-only, no new policy migration |
| `workflow_runs` | 0037_phase1c_memory_and_workflows.sql | no | register-with-new-policy | `organisation_id` NOT NULL; sister-branch owned (§0.4) — registry-edit-only, no new policy migration |
| `workspace_entities` | 0029_phase_1_2_memory_entities_triggers.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `workspace_health_findings` | 0096_workspace_health_findings.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape |
| `workspace_items` | 0008_workspace_board.sql | no | register-with-new-policy | `organisation_id` NOT NULL (confirmed in migration body); canonical shape |
| `workspace_memory_entries` | 0012_phase_one_autonomous_foundations.sql | no | register-with-new-policy | `organisation_id` NOT NULL; canonical shape (defined in workspaceMemories.ts) |

### Phase 1 migration-number pre-flight count
- register-with-new-policy verdicts: 57 tables (55 net, excluding 2 sister-branch owned)
- Canonical-shape tables (all in one combined file): 55 tables → 1 file (user decision: batch all same-shape into single migration)
- Parent-EXISTS tables (1 file each):                0 tables → 0 files
- Total 0245+ migration files needed:                1
- Available migration slots (0245–0255):             11
- Outcome: T=1 ≤ 11 → no overflow, proceed

---

### §3.4.2 — Stale registry entries (4)
- `document_bundle_members` → drop (parent `document_bundles` policied via 0213 + 0228)
- `reference_document_versions` → drop (policied via 0229)
- `task_activities` → drop pending USING+WITH CHECK confirmation on `tasks` parent (Task 1.4)
- `task_deliverables` → drop pending USING+WITH CHECK confirmation on `tasks` parent (Task 1.4)

### Task 1.4 — `tasks` parent USING + WITH CHECK verification ([spec round 7 — commit a9135930])

- Policy migration: `migrations/0079_rls_tasks_actions_runs.sql`
- USING clause present: yes
- WITH CHECK clause present: yes
- Verdict: drop-children-from-registry

### §3.4.3 — Caller-level violations (2)
- `server/services/systemMonitor/baselines/refreshJob.ts:39` — move existing comment from line ~37 onto line 38
- `server/services/systemMonitor/triage/loadCandidates.ts:45` — add inline justification within ±1 line

### Mutual-exclusion check ([spec round 7 — commit a9135930])
Command: comm -12 <(awk '/^[^#]/{print $1}' scripts/rls-not-applicable-allowlist.txt | sort -u) <(grep -oE "tableName: '[^']+" server/config/rlsProtectedTables.ts | sed "s/tableName: '//" | sort -u)
Output: <empty>
Verdict: pass

### Allowlist growth ([spec round 7 — commit a9135930])
- Entries before this PR: 0
- Entries added this PR: 3 (llm_inflight_history, system_incidents, system_incident_suppressions)
- Justification for growth: all three carry explicit sysadmin-gated bypass annotations in their schema files; confirmed allowlist per §3.3.1 criteria
