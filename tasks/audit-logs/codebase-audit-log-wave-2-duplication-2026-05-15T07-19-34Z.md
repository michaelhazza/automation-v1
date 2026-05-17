# Wave 2 — Hotspot duplication audit

**Verdict:** PASS_WITH_DEFERRED
**Scope:** `server/` and `client/src/` — `npx jscpd@4.2.0` with `--min-lines 10 --min-tokens 60`.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z

## Reconnaissance Map

- Server: 1,572 source files, **291 clones**, **4,298 duplicated lines** (1.75%). JSON: `tasks/audit-logs/jscpd-server/jscpd-report.json`.
- Client: 1,126 source files, **138 clones**, **3,495 duplicated lines**. JSON: `tasks/audit-logs/jscpd-client/jscpd-report.json`.

## Pass 1 Findings — Server top 20 (sorted by clone length)

| # | Lines | First location | Second location |
|---|---|---|---|
| 1 | 87 | `server/services/workflowEngine/queueLifecycle/agentStep.ts:397-483` | same file `:225-307` |
| 2 | 44 | `server/services/hierarchyTemplateService.ts:455-498` | `server/services/systemTemplateService.ts:413-456` |
| 3 | 34 | `server/services/skillAnalyzerService/results/merge.ts:242-275` | `server/services/skillAnalyzerService/results/updateProposal.ts:191-224` [^jscpd-typo] |
| 4 | 34 | `server/services/workspace/workspaceOnboardingService.ts:111-144` | same file `:73-105` |
| 5 | 33 | `server/services/supportDraftDispatchService.ts:812-844` | same file `:752-784` |
| 6 | 33 | `server/services/hierarchyTemplateService.ts:521-553` | `server/services/systemTemplateService.ts:475-507` |
| 7 | 33 | `server/jobs/sandboxEgressAuditPruneJob.ts:66-98` | `server/jobs/sandboxTelemetryPruneJob.ts:66-98` |
| 8 | 32 | `server/services/skillAnalyzerService/results/merge.ts:129-160` | `updateProposal.ts:191-222` |
| 9 | 32 | `server/services/calendar/calendarActionService.ts:143-174` | `server/services/slack/slackActionService.ts:155-186` |
| 10 | 32 | `server/services/calendar/calendarActionService.ts:426-457` | same file `:294-395` |
| 11 | 30 | `server/services/calendar/calendarActionService.ts:364-393` | same file `:294-323` |
| 12 | 30 | `server/routes/workspaceCalendar.ts:19-48` | `server/routes/workspaceMail.ts:25-54` |
| 13 | 30 | `server/mcp/mcpServer.ts:190-219` | same file `:134-163` |
| 14 | 29 | `server/services/scheduleCalendarServicePure.ts:267-295` | `server/services/scheduledTaskService.ts:34-97` |
| 15 | 29 | `server/jobs/sandboxEgressAuditPruneJob.ts:99-127` | `server/jobs/sandboxTelemetryPruneJob.ts:99-135` |
| 16 | 28 | `server/services/memoryReviewQueueService.ts:205-232` | same file `:125-152` |
| 17 | 28 | `server/jobs/sandboxLogsPruneJob.ts:107-134` | `server/jobs/sandboxTelemetryPruneJob.ts:100-135` |
| 18 | 28 | `server/jobs/fastPathDecisionsPruneJob.ts:93-120` | `server/jobs/sandboxTelemetryPruneJob.ts:100-135` |
| 19 | 27 | `server/services/supportInboxService.ts:178-204` | same file `:132-159` |
| 20 | 27 | `server/services/agentRecommendationsService.ts:386-412` | same file `:263-289` |

[^jscpd-typo]: The raw `jscpd-report.json` reports the second range as `191-162` (start > end) for this clone. The 34-line clone size on the first file implies the correct second range is `191-224`. The reversed range is an artefact of jscpd 4.2.0's reporter; the raw tool output is preserved in `tasks/audit-logs/jscpd-server/jscpd-report.json` unmodified.

## Pass 1 Findings — Client top 20

| # | Lines | First location | Second location |
|---|---|---|---|
| 1 | 213 | `client/src/pages/SubaccountSkillsPage.tsx:69-281` | `client/src/components/pulse/HistoryTab.tsx:107-151` |
| 2 | 209 | `client/src/pages/SystemSkillsPage.tsx:129-337` | `client/src/components/pulse/HistoryTab.tsx:74-115` |
| 3 | 143 | `client/src/pages/SubaccountBlueprintsPage.tsx:71-213` | `client/src/pages/SystemOrganisationTemplatesPage.tsx:62-229` |
| 4 | 111 | `client/src/pages/operate/ActivityPage.tsx:178-288` | `client/src/pages/operate/components/ActivityDetailModal.tsx:48-127` |
| 5 | 100 | `client/src/pages/ClientPulseSettingsPage.tsx:49-148` | same-file overlap `:48-56` (jscpd self-overlap; ignore) |
| 6 | 76 | `client/src/pages/OrgApprovalChannelsPage.tsx:128-203` | `client/src/pages/SubaccountApprovalChannelsPage.tsx:94-177` |
| 7 | 73 | `client/src/pages/AgentChatPage.tsx:359-431` | `client/src/pages/ConfigAssistantPage.tsx:347-427` |
| 8 | 69 | `client/src/pages/AdminPermissionSetsPage.tsx:89-157` | `client/src/components/org-settings/PermissionsTab.tsx:81-143` |
| 9 | 68 | `client/src/components/agent-chat/messageRender.tsx:1-68` | `client/src/components/config-assistant/messageRender.tsx:1-68` |
| 10 | 55 | `client/src/pages/LoginPage.tsx:93-147` | `client/src/pages/SignupPage.tsx:114-173` |
| 11 | 55 | `AdminPermissionSetsPage.tsx:87-141` | `org-settings/PermissionsTab.tsx:79-133` |
| 12 | 53 | `agent-chat/messageRender.tsx:15-67` | `config-assistant/messageRender.tsx:15-67` |
| 13 | 53 | `OrgApprovalChannelsPage:203-255` | `SubaccountApprovalChannelsPage:163-224` |
| 14 | 52 | `AgentChatPage:472-523` | `ConfigAssistantPage:391-449` |
| 15 | 52 | `AdminPermissionSetsPage:28-79` | `PermissionsTab:25-74` |
| 16 | 49 | `OrgApprovalChannelsPage:217-265` | `SubaccountApprovalChannelsPage:186-234` |
| 17 | 48 | `client/src/components/agent-run-chat/AgentRunChatPane.tsx:41-88` | `client/src/components/task-chat/TaskChatPane.tsx:39-86` |
| 18 | 46 | `SubaccountBlueprintsPage:59-104` | `SystemOrganisationTemplatesPage:50-97` |
| 19 | 44 | `admin-subaccount-detail/BeliefsTab.tsx:101-144` | `subaccount-agent-edit/BeliefsTab.tsx:97-139` |
| 20 | 37 | `SubaccountSkillsPage.tsx:183-219` | `SystemSkillsPage.tsx:223-259` |

## Findings summary

| ID | Severity | Confidence | Finding |
|---|---|---|---|
| DUP1 | high | high | **Client: 213-line + 209-line duplication between Skills pages and ClientPulse HistoryTab.** Two top-tier pages (`SubaccountSkillsPage`, `SystemSkillsPage`) share large blocks with `components/pulse/HistoryTab.tsx`. Either the pages were copy-pasted from HistoryTab or vice versa. Extract shared rendering logic into a single component. |
| DUP2 | medium | high | **Client: `AdminPermissionSetsPage` ↔ `org-settings/PermissionsTab` triple-clone** (69L + 55L + 52L = 176 duplicated lines). Strong candidate for a single `<PermissionsEditor>` component used by both. |
| DUP3 | medium | high | **Client: `OrgApprovalChannelsPage` ↔ `SubaccountApprovalChannelsPage` triple-clone** (76L + 53L + 49L = 178 duplicated lines). Sibling pages for the org-tier vs subaccount-tier of the same feature. Lift to shared `<ApprovalChannelsEditor>`. |
| DUP4 | medium | high | **Client: `AgentChatPage` ↔ `ConfigAssistantPage` double-clone** (73L + 52L = 125 duplicated lines, plus 68L messageRender clone). Two chat surfaces sharing render/scroll/message-state logic that was clearly meant to be extracted (the 68L `messageRender.tsx` IS extracted in `components/agent-chat/` and `components/config-assistant/` — but the two extracted copies are 100% identical). Combine into `client/src/components/chat/messageRender.tsx`. |
| DUP5 | medium | high | **Client: 143L Blueprints ↔ OrganisationTemplates duplication** (`SubaccountBlueprintsPage` ↔ `SystemOrganisationTemplatesPage`). Template-rendering UI cloned. |
| DUP6 | medium | high | **Server: 87L cycle within `workflowEngine/queueLifecycle/agentStep.ts`** (`:397-483` ↔ `:225-307`). Two near-identical 87-line blocks in the same file — strong indicator of a refactor that should extract a helper. |
| DUP7 | medium | high | **Server: 44L + 33L clone between `hierarchyTemplateService.ts` and `systemTemplateService.ts`.** Two services walk the same template materialisation logic. Single source of truth needed. |
| DUP8 | medium | medium | **Server: prune-job family clones** (`sandboxEgressAuditPruneJob`, `sandboxTelemetryPruneJob`, `sandboxLogsPruneJob`, `fastPathDecisionsPruneJob`) all share 28–33L blocks. Extract a `definePruneJob({table, retentionConfig, ...})` factory. |
| DUP9 | medium | high | **Server: 32L clone `calendarActionService` ↔ `slackActionService`.** External-action services sharing dispatch logic. Lift to a shared `defineActionService` helper or a base class. |
| DUP10 | low | high | **Server: `mcpServer.ts:190-219` ↔ `:134-163`** (same file). Same-file 30L duplication suggests handler factory pattern needed. Same root cause as the CD7 finding in the circular-deps audit. |

## Prevention Proposals

| ID | Target | Proposal | Closes |
|---|---|---|---|
| PP-DUP1 | `gate` | New gate `npm run check:duplication` running jscpd with **baseline at 4,298 server + 3,495 client duplicated lines.** Net-new duplication above N lines fails the PR. Leverage tier 1. | DUP1–DUP10 |
| PP-DUP2 | `CLAUDE.md` § 6 Surgical Changes | Tighten the "Three-Similar-Lines rule" to be enforceable: a PR that creates a fourth near-duplicate block is the threshold for blocking. Pair with PP-DUP1 to enforce. Leverage tier 2. | DUP1–DUP10 |
| PP-DUP3 | `KNOWLEDGE.md` | Pattern entry: org-tier and subaccount-tier sibling pages drift apart. When adding a feature that needs both, default to extracting the shared editor component on the first commit, not after the drift. Leverage tier 3. | DUP2, DUP3 |

Findings count: 10 named findings (1 high, 8 medium, 1 low). Top 20 server + top 20 client raw clone tables above.
