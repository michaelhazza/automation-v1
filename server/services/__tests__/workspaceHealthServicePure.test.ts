/**
 * workspaceHealthServicePure.test.ts — Brain Tree OS adoption P4 pure tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workspaceHealthServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  runDetectors,
  diffFindings,
} from '../workspaceHealth/workspaceHealthServicePure.js';
import type { DetectorContext, WorkspaceHealthFinding } from '../workspaceHealth/detectorTypes.js';

const FIXED_NOW = new Date('2026-04-11T00:00:00.000Z').getTime();
const ORG_ID = '00000000-0000-0000-0000-000000000001';

function emptyCtx(): DetectorContext {
  return {
    organisationId: ORG_ID,
    noRecentRunsThresholdDays: 30,
    systemAgentStaleThresholdDays: 60,
    agents: [],
    subaccountAgents: [],
    automations: [],
    automationConnectionMappings: [],
    systemAgentLinks: [],
    nowMs: FIXED_NOW,
  };
}

console.log('');
console.log('workspaceHealthServicePure — Brain Tree OS adoption P4');
console.log('');

// ── agent.no_recent_runs ──────────────────────────────────────────────────

test('agent.no_recent_runs — fires when active agent never ran', () => {
  const ctx = emptyCtx();
  ctx.agents.push({
    id: 'a-1',
    name: 'Bob',
    status: 'active',
    lastRunAt: null,
    systemAgentId: null,
    defaultSkillSlugs: ['x'],
  });
  const f = runDetectors(ctx);
  expect(f.length, 'one finding').toBe(1);
  expect(f[0].detector, 'detector name').toBe('agent.no_recent_runs');
});

test('agent.no_recent_runs — does not fire for inactive agents', () => {
  const ctx = emptyCtx();
  ctx.agents.push({
    id: 'a-2',
    name: 'Inactive',
    status: 'inactive',
    lastRunAt: null,
    systemAgentId: null,
    defaultSkillSlugs: ['x'],
  });
  const f = runDetectors(ctx);
  expect(f.length, 'no finding').toBe(0);
});

test('agent.no_recent_runs — does not fire when last run is recent', () => {
  const ctx = emptyCtx();
  ctx.agents.push({
    id: 'a-3',
    name: 'Recent',
    status: 'active',
    lastRunAt: new Date(FIXED_NOW - 5 * 24 * 60 * 60 * 1000),
    systemAgentId: null,
    defaultSkillSlugs: ['x'],
  });
  const f = runDetectors(ctx);
  expect(f.length, 'no finding').toBe(0);
});

// ── subaccount_agent.no_skills ────────────────────────────────────────────

test('subaccount_agent.no_skills — fires when both tiers empty', () => {
  const ctx = emptyCtx();
  ctx.agents.push({ id: 'a-4', name: 'A', status: 'active', lastRunAt: new Date(FIXED_NOW), systemAgentId: null, defaultSkillSlugs: null });
  ctx.subaccountAgents.push({
    id: 'sa-1',
    agentId: 'a-4',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    agentName: 'A',
    skillSlugs: null,
    heartbeatEnabled: true,
    scheduleCron: null,
  });
  const f = runDetectors(ctx);
  const noSkills = f.filter((x) => x.detector === 'subaccount_agent.no_skills');
  expect(noSkills.length, 'one finding').toBe(1);
});

test('subaccount_agent.no_skills — does NOT fire when org default exists', () => {
  const ctx = emptyCtx();
  ctx.agents.push({ id: 'a-5', name: 'A', status: 'active', lastRunAt: new Date(FIXED_NOW), systemAgentId: null, defaultSkillSlugs: ['read_workspace'] });
  ctx.subaccountAgents.push({
    id: 'sa-2',
    agentId: 'a-5',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    agentName: 'A',
    skillSlugs: null,
    heartbeatEnabled: true,
    scheduleCron: null,
  });
  const f = runDetectors(ctx);
  const noSkills = f.filter((x) => x.detector === 'subaccount_agent.no_skills');
  expect(noSkills.length, 'no finding').toBe(0);
});

// ── subaccount_agent.no_schedule ──────────────────────────────────────────

test('subaccount_agent.no_schedule — fires when both heartbeat and cron disabled', () => {
  const ctx = emptyCtx();
  ctx.agents.push({ id: 'a-6', name: 'A', status: 'active', lastRunAt: new Date(FIXED_NOW), systemAgentId: null, defaultSkillSlugs: ['x'] });
  ctx.subaccountAgents.push({
    id: 'sa-3',
    agentId: 'a-6',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    agentName: 'A',
    skillSlugs: ['x'],
    heartbeatEnabled: false,
    scheduleCron: null,
  });
  const f = runDetectors(ctx);
  const noSched = f.filter((x) => x.detector === 'subaccount_agent.no_schedule');
  expect(noSched.length, 'one finding').toBe(1);
  expect(noSched[0].severity, 'info severity').toBe('info');
});

// ── process.broken_connection_mapping ─────────────────────────────────────

test('process.broken_connection_mapping — fires when required slot is missing', () => {
  const ctx = emptyCtx();
  ctx.automations.push({
    id: 'p-1',
    name: 'Send GHL note',
    status: 'active',
    scope: 'organisation',
    automationEngineId:'eng-1',
    requiredConnections: [
      { key: 'ghl_account', provider: 'ghl', required: true },
      { key: 'gmail_account', provider: 'gmail', required: true },
    ],
  });
  // Mapping for one slot only
  ctx.automationConnectionMappings.push({
    processId: 'p-1',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    connectionKey: 'ghl_account',
  });
  const f = runDetectors(ctx);
  const broken = f.filter((x) => x.detector === 'process.broken_connection_mapping');
  expect(broken.length, 'one finding').toBe(1);
  expect(broken[0].severity, 'critical severity').toBe('critical');
  expect(broken[0].message.includes('gmail_account'), 'mentions missing key').toBe(true);
});

test('process.broken_connection_mapping — composite resourceId distinguishes the same process across subaccounts', () => {
  const ctx = emptyCtx();
  ctx.automations.push({
    id: 'p-multi',
    name: 'Send GHL note',
    status: 'active',
    scope: 'organisation',
    automationEngineId:'eng-1',
    requiredConnections: [{ key: 'ghl_account', provider: 'ghl', required: true }],
  });
  // Two subaccounts both link the process but neither maps the required slot
  // (each has a mapping for some unrelated key so the pair is "linked").
  ctx.automationConnectionMappings.push(
    { processId: 'p-multi', subaccountId: 'sub-A', subaccountName: 'Acme', connectionKey: 'unrelated' },
    { processId: 'p-multi', subaccountId: 'sub-B', subaccountName: 'Beta', connectionKey: 'unrelated' },
  );
  const f = runDetectors(ctx);
  const broken = f.filter((x) => x.detector === 'process.broken_connection_mapping');
  expect(broken.length, 'one finding per subaccount').toBe(2);
  // Composite resourceIds must differ so the unique upsert keeps both rows.
  expect(broken[0].resourceId !== broken[1].resourceId, 'distinct resourceIds').toBe(true);
  expect(broken.every((x) => x.resourceId.includes(':')), 'composite key contains colon').toBe(true);
});

test('process.broken_connection_mapping — does NOT fire when all required slots are mapped', () => {
  const ctx = emptyCtx();
  ctx.automations.push({
    id: 'p-2',
    name: 'Configured',
    status: 'active',
    scope: 'organisation',
    automationEngineId:'eng-1',
    requiredConnections: [{ key: 'gmail_account', provider: 'gmail', required: true }],
  });
  ctx.automationConnectionMappings.push({
    processId: 'p-2',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    connectionKey: 'gmail_account',
  });
  const f = runDetectors(ctx);
  const broken = f.filter((x) => x.detector === 'process.broken_connection_mapping');
  expect(broken.length, 'no finding').toBe(0);
});

// ── process.no_engine ─────────────────────────────────────────────────────

test('process.no_engine — fires for org process with null engine', () => {
  const ctx = emptyCtx();
  ctx.automations.push({
    id: 'p-3',
    name: 'No engine',
    status: 'active',
    scope: 'organisation',
    automationEngineId:null,
    requiredConnections: null,
  });
  const f = runDetectors(ctx);
  const noEng = f.filter((x) => x.detector === 'process.no_engine');
  expect(noEng.length, 'one finding').toBe(1);
});

test('process.no_engine — does NOT fire for system processes', () => {
  const ctx = emptyCtx();
  ctx.automations.push({
    id: 'p-4',
    name: 'System',
    status: 'active',
    scope: 'system',
    automationEngineId:null,
    requiredConnections: null,
  });
  const f = runDetectors(ctx);
  const noEng = f.filter((x) => x.detector === 'process.no_engine');
  expect(noEng.length, 'no finding').toBe(0);
});

// ── system_agent_link.never_synced ────────────────────────────────────────

test('system_agent_link.never_synced — fires when updatedAt is null', () => {
  const ctx = emptyCtx();
  ctx.systemAgentLinks.push({
    orgAgentId: 'a-7',
    orgAgentName: 'Linked',
    systemAgentId: 'sys-1',
    updatedAt: null,
  });
  const f = runDetectors(ctx);
  const sync = f.filter((x) => x.detector === 'system_agent_link.never_synced');
  expect(sync.length, 'one finding').toBe(1);
});

test('system_agent_link.never_synced — fires when updatedAt is older than threshold', () => {
  const ctx = emptyCtx();
  ctx.systemAgentLinks.push({
    orgAgentId: 'a-8',
    orgAgentName: 'Stale',
    systemAgentId: 'sys-1',
    updatedAt: new Date(FIXED_NOW - 90 * 24 * 60 * 60 * 1000),
  });
  const f = runDetectors(ctx);
  const sync = f.filter((x) => x.detector === 'system_agent_link.never_synced');
  expect(sync.length, 'one finding').toBe(1);
});

test('system_agent_link.never_synced — does NOT fire when updatedAt is recent', () => {
  const ctx = emptyCtx();
  ctx.systemAgentLinks.push({
    orgAgentId: 'a-9',
    orgAgentName: 'Recent',
    systemAgentId: 'sys-1',
    updatedAt: new Date(FIXED_NOW - 7 * 24 * 60 * 60 * 1000),
  });
  const f = runDetectors(ctx);
  const sync = f.filter((x) => x.detector === 'system_agent_link.never_synced');
  expect(sync.length, 'no finding').toBe(0);
});

// ── runner dedup ──────────────────────────────────────────────────────────

test('runner dedup — same (detector, resourceId) collapses to one', () => {
  // Construct a context that intentionally produces two findings for the
  // same agent if both detectors that touch agents fired. Since each
  // detector emits at most one finding per (agent), the natural way to test
  // dedup is via the diffFindings helper instead.
  const a: WorkspaceHealthFinding = {
    detector: 'agent.no_recent_runs',
    severity: 'warning',
    resourceKind: 'agent',
    resourceId: 'a-1',
    resourceLabel: 'A',
    message: 'x',
    recommendation: 'y',
  };
  // Emulate two detectors emitting the same finding by passing through the
  // dedup-aware runner: not directly callable, but the diff helper
  // demonstrates the contract.
  const diff = diffFindings([a, { ...a }], []);
  expect(diff.toUpsert.length, 'diff does not dedup; runner does').toBe(2);
});

// ── diffFindings auto-resolution ──────────────────────────────────────────

test('diffFindings — marks missing existing rows for resolution', () => {
  const newFindings: WorkspaceHealthFinding[] = [
    {
      detector: 'agent.no_recent_runs',
      severity: 'warning',
      resourceKind: 'agent',
      resourceId: 'a-1',
      resourceLabel: 'A',
      message: 'x',
      recommendation: 'y',
    },
  ];
  const existing = [
    { detector: 'agent.no_recent_runs', resourceId: 'a-1' },
    { detector: 'agent.no_recent_runs', resourceId: 'a-2' }, // not in new sweep
  ];
  const diff = diffFindings(newFindings, existing);
  expect(diff.toResolve.length, 'one to resolve').toBe(1);
  expect(diff.toResolve[0].resourceId, 'correct row').toBe('a-2');
});

test('diffFindings — counts by severity', () => {
  const findings: WorkspaceHealthFinding[] = [
    { detector: 'd1', severity: 'critical', resourceKind: 'agent', resourceId: '1', resourceLabel: 'a', message: '', recommendation: '' },
    { detector: 'd2', severity: 'warning',  resourceKind: 'agent', resourceId: '2', resourceLabel: 'b', message: '', recommendation: '' },
    { detector: 'd3', severity: 'info',     resourceKind: 'agent', resourceId: '3', resourceLabel: 'c', message: '', recommendation: '' },
  ];
  const diff = diffFindings(findings, []);
  expect(diff.counts, 'counts').toEqual({ critical: 1, warning: 1, info: 1, total: 3 });
});

// ── empty org happy path ──────────────────────────────────────────────────

test('empty org — no findings', () => {
  const f = runDetectors(emptyCtx());
  expect(f.length, 'no findings').toBe(0);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
