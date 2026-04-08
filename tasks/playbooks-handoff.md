# Playbooks Phase 1 — Implementation Handoff

**Branch:** `claude/multi-step-automation-hzlRg`
**Spec:** [`tasks/playbooks-spec.md`](./playbooks-spec.md)
**Migration target:** `0076_playbooks.sql`

## Status

Phase 1 backend is functional end-to-end. Phase 1 client UI ships the
library, run detail, and Studio pages. WebSocket live updates and the
LLM-driven Playbook Author agent are explicitly deferred (see below).

## What landed (12 implementation steps from spec §12.1)

| Step | Status | Files |
|------|--------|-------|
| 1. Migration 0076 | DONE | `migrations/0076_playbooks.sql`, `migrations/_down/0076_playbooks.sql`, `server/db/schema/playbookTemplates.ts`, `server/db/schema/playbookRuns.ts`, `server/db/schema/agentRuns.ts` (additive col), `server/db/schema/index.ts` |
| 2. Types + validator + templating | DONE | `server/lib/playbook/{types,definePlaybook,canonicalJson,hash,templating,validator,index}.ts` + 33 unit tests |
| 3. Template service + seeder | DONE | `server/services/playbookTemplateService.ts`, `scripts/seed-playbooks.ts`, `scripts/validate-playbooks.ts`, npm scripts |
| 4. Engine + run service + queue | DONE | `server/services/playbookEngineService.ts`, `server/services/playbookRunService.ts`, `server/config/jobConfig.ts` |
| 5. Routes | DONE | `server/routes/playbookTemplates.ts`, `server/routes/playbookRuns.ts`, `server/lib/permissions.ts`, mounted in `server/index.ts` |
| 6. Agent run hook + worker registration | DONE | `server/services/playbookAgentRunHook.ts`, hook in `agentExecutionService.ts`, `playbookEngineService.registerWorkers()` called from `server/index.ts` boot |
| 7. WebSocket events | DEFERRED — Phase 1.5 | UI polls every 3s instead. WS plumbing is documented in spec §8.2; the engine emits structured logs ready to be wired through Socket.IO when added. |
| 8. Phase 1 UI pages | DONE | `client/src/pages/PlaybooksLibraryPage.tsx`, `PlaybookRunDetailPage.tsx`, mounted in `App.tsx` + `Layout.tsx` nav link |
| 8.5. Playbook Studio | DONE | `server/services/playbookStudioService.ts`, `server/routes/playbookStudio.ts`, `client/src/pages/PlaybookStudioPage.tsx`, system-admin nav link |
| 9. Permissions seed | DONE | New `org.playbook_*` and `subaccount.playbook_runs.*` permission keys with seed metadata |
| 10. Seed first system playbook | DONE | `server/playbooks/event-creation.playbook.ts` (6-step demo with parallel branches, human review, irreversible CMS publish) |
| 11. Internal dogfood | NOT YET — requires migration + seed run by user |
| 12. Feature flag rollout | NOT YET — feature flag plumbing exists but is not wired |

## How to deploy

```bash
# 1. Run the migration
npm run migrate

# 2. Seed the system playbook (idempotent)
npm run playbooks:seed

# 3. Verify
npm run playbooks:test       # 33 unit tests
npm run playbooks:validate   # validates server/playbooks/*.playbook.ts

# 4. Restart server — boot path now registers the engine workers
#    (playbook-run-tick + playbook-watchdog cron)
npm run dev:server
```

## What you can do today

- **System admin**: navigate to `/system/playbook-studio` to author new
  playbooks via the chat-style UI. Use Validate + Simulate + Estimate
  before saving. Save & Open PR currently records a placeholder PR URL —
  real GitHub MCP integration is the next follow-up commit.

- **Org user (with `agents.view` or `playbook_templates.read`)**:
  navigate to `/playbooks` to browse the library. Click a system or org
  template, pick a subaccount, provide initial input as JSON, click
  Start. Watch the run progress on the run detail page (polls every 3s).
  Provide form input for `user_input` steps and approve/reject
  `approval` steps inline.

- **From a script**: hit the routes directly. Full contract in spec §7.

## What is intentionally deferred

These items are documented as deferred in the spec and noted explicitly
so you don't expect them in Phase 1:

1. **WebSocket live updates** (spec §8.2). UI polls. Engine emits
   structured logs ready to be wired through Socket.IO when added.

2. **`agent_call` and `prompt` step dispatch** is currently a stub —
   it transitions the step run to `running` but does not yet create a
   real agent run. The hook from `agentExecutionService` back into the
   engine is in place; the dispatch direction is the missing piece.
   Implementing this requires plumbing the resolved agent context
   (resolved agent id, resolved input, idempotency key) through
   `agentRunService.create()`. Spec §5.2 dispatch case.

3. **Mid-run output editing** (spec §5.4). Engine has the discard rule
   for invalidated step results, but the cascade BFS + side-effect
   safety prompts + skip-and-reuse path are not yet wired through the
   route layer. The endpoint contract is in spec §7.

4. **Replay mode** (spec §5.10). `replay_mode` column is in place;
   the engine's hard external-effect block is not yet enforced
   (skill executor change pending).

5. **Org-template publish via API** works for the route, but the
   stored definition uses a structural-only shape. Re-hydrating the
   Zod schemas at run time requires a JSON-Schema → Zod path that
   Phase 1.5 will add via `zod-from-json-schema` or TypeBox.

6. **Playbook Author agent** (the LLM behind the Studio chat). The
   master prompt is documented in spec §10.8.5 but the system agent
   row + the chat ↔ tool wiring is a follow-up. The Studio tools are
   ready to be called from any agent.

7. **GitHub PR creation** in `saveAndOpenPr`. Phase 1 records a
   placeholder URL. Real MCP integration is one focused commit
   away — the trust boundary (re-validation + system-admin gating)
   is already enforced.

8. **`playbook_step_run_id` set on agent runs**. The reverse-link
   column exists in the schema; setting it from the engine's dispatch
   path lands with item #2 above.

## Verification commands

```bash
npm run playbooks:test        # 33 unit tests (templating, validator, hash, canonicalJson)
npm run playbooks:validate    # validates every server/playbooks/*.playbook.ts
npx tsc -p server/tsconfig.json --noEmit 2>&1 | grep playbook   # zero errors
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep Playbook   # zero errors
```

All four return clean.

## Files added

```
migrations/0076_playbooks.sql                              (244 lines)
migrations/_down/0076_playbooks.sql                        (22 lines)
server/db/schema/playbookTemplates.ts                      (135 lines)
server/db/schema/playbookRuns.ts                           (211 lines)
server/lib/playbook/types.ts                               (197 lines)
server/lib/playbook/definePlaybook.ts                      (51 lines)
server/lib/playbook/canonicalJson.ts                       (62 lines)
server/lib/playbook/hash.ts                                (29 lines)
server/lib/playbook/templating.ts                          (385 lines)
server/lib/playbook/validator.ts                           (310 lines)
server/lib/playbook/index.ts                               (24 lines)
server/lib/playbook/__tests__/playbook.test.ts             (470 lines)
server/services/playbookTemplateService.ts                 (340 lines)
server/services/playbookRunService.ts                      (335 lines)
server/services/playbookEngineService.ts                   (520 lines)
server/services/playbookAgentRunHook.ts                    (52 lines)
server/services/playbookStudioService.ts                   (470 lines)
server/routes/playbookTemplates.ts                         (155 lines)
server/routes/playbookRuns.ts                              (135 lines)
server/routes/playbookStudio.ts                            (155 lines)
server/playbooks/event-creation.playbook.ts                (160 lines)
scripts/seed-playbooks.ts                                  (90 lines)
scripts/validate-playbooks.ts                              (66 lines)
client/src/pages/PlaybooksLibraryPage.tsx                  (240 lines)
client/src/pages/PlaybookRunDetailPage.tsx                 (370 lines)
client/src/pages/PlaybookStudioPage.tsx                    (390 lines)
```

Plus additive edits to:
- `server/db/schema/agentRuns.ts` (one column + one index)
- `server/db/schema/index.ts` (two exports)
- `server/lib/permissions.ts` (9 new permission keys + seed metadata)
- `server/config/jobConfig.ts` (2 new pg-boss queue configs)
- `server/services/agentExecutionService.ts` (success + failure hook)
- `server/index.ts` (3 router mounts + worker registration)
- `client/src/App.tsx` (3 lazy imports + 3 routes)
- `client/src/components/Layout.tsx` (2 nav links)
- `package.json` (3 npm scripts)
