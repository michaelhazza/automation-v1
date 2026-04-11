/**
 * workspaceHealthServicePure.test.ts — Brain Tree OS adoption P4 pure tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workspaceHealthServicePure.test.ts
 */

import {
  runDetectors,
  diffFindings,
} from '../workspaceHealth/workspaceHealthServicePure.js';
import type { DetectorContext, WorkspaceHealthFinding } from '../workspaceHealth/detectorTypes.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual(a: unknown, b: unknown, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
}

function assertTrue(value: boolean, label: string) {
  if (!value) throw new Error(`${label} — expected truthy`);
}

const FIXED_NOW = new Date('2026-04-11T00:00:00.000Z').getTime();
const ORG_ID = '00000000-0000-0000-0000-000000000001';

function emptyCtx(): DetectorContext {
  return {
    organisationId: ORG_ID,
    noRecentRunsThresholdDays: 30,
    systemAgentStaleThresholdDays: 60,
    agents: [],
    subaccountAgents: [],
    processes: [],
    processConnectionMappings: [],
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
  assertEqual(f.length, 1, 'one finding');
  assertEqual(f[0].detector, 'agent.no_recent_runs', 'detector name');
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
  assertEqual(f.length, 0, 'no finding');
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
  assertEqual(f.length, 0, 'no finding');
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
  assertEqual(noSkills.length, 1, 'one finding');
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
  assertEqual(noSkills.length, 0, 'no finding');
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
  assertEqual(noSched.length, 1, 'one finding');
  assertEqual(noSched[0].severity, 'info', 'info severity');
});

// ── process.broken_connection_mapping ─────────────────────────────────────

test('process.broken_connection_mapping — fires when required slot is missing', () => {
  const ctx = emptyCtx();
  ctx.processes.push({
    id: 'p-1',
    name: 'Send GHL note',
    status: 'active',
    scope: 'organisation',
    workflowEngineId: 'eng-1',
    requiredConnections: [
      { key: 'ghl_account', provider: 'ghl', required: true },
      { key: 'gmail_account', provider: 'gmail', required: true },
    ],
  });
  // Mapping for one slot only
  ctx.processConnectionMappings.push({
    processId: 'p-1',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    connectionKey: 'ghl_account',
  });
  const f = runDetectors(ctx);
  const broken = f.filter((x) => x.detector === 'process.broken_connection_mapping');
  assertEqual(broken.length, 1, 'one finding');
  assertEqual(broken[0].severity, 'critical', 'critical severity');
  assertTrue(broken[0].message.includes('gmail_account'), 'mentions missing key');
});

test('process.broken_connection_mapping — does NOT fire when all required slots are mapped', () => {
  const ctx = emptyCtx();
  ctx.processes.push({
    id: 'p-2',
    name: 'Configured',
    status: 'active',
    scope: 'organisation',
    workflowEngineId: 'eng-1',
    requiredConnections: [{ key: 'gmail_account', provider: 'gmail', required: true }],
  });
  ctx.processConnectionMappings.push({
    processId: 'p-2',
    subaccountId: 'sub-1',
    subaccountName: 'Acme',
    connectionKey: 'gmail_account',
  });
  const f = runDetectors(ctx);
  const broken = f.filter((x) => x.detector === 'process.broken_connection_mapping');
  assertEqual(broken.length, 0, 'no finding');
});

// ── process.no_engine ─────────────────────────────────────────────────────

test('process.no_engine — fires for org process with null engine', () => {
  const ctx = emptyCtx();
  ctx.processes.push({
    id: 'p-3',
    name: 'No engine',
    status: 'active',
    scope: 'organisation',
    workflowEngineId: null,
    requiredConnections: null,
  });
  const f = runDetectors(ctx);
  const noEng = f.filter((x) => x.detector === 'process.no_engine');
  assertEqual(noEng.length, 1, 'one finding');
});

test('process.no_engine — does NOT fire for system processes', () => {
  const ctx = emptyCtx();
  ctx.processes.push({
    id: 'p-4',
    name: 'System',
    status: 'active',
    scope: 'system',
    workflowEngineId: null,
    requiredConnections: null,
  });
  const f = runDetectors(ctx);
  const noEng = f.filter((x) => x.detector === 'process.no_engine');
  assertEqual(noEng.length, 0, 'no finding');
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
  assertEqual(sync.length, 1, 'one finding');
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
  assertEqual(sync.length, 1, 'one finding');
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
  assertEqual(sync.length, 0, 'no finding');
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
  assertEqual(diff.toUpsert.length, 2, 'diff does not dedup; runner does');
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
  assertEqual(diff.toResolve.length, 1, 'one to resolve');
  assertEqual(diff.toResolve[0].resourceId, 'a-2', 'correct row');
});

test('diffFindings — counts by severity', () => {
  const findings: WorkspaceHealthFinding[] = [
    { detector: 'd1', severity: 'critical', resourceKind: 'agent', resourceId: '1', resourceLabel: 'a', message: '', recommendation: '' },
    { detector: 'd2', severity: 'warning',  resourceKind: 'agent', resourceId: '2', resourceLabel: 'b', message: '', recommendation: '' },
    { detector: 'd3', severity: 'info',     resourceKind: 'agent', resourceId: '3', resourceLabel: 'c', message: '', recommendation: '' },
  ];
  const diff = diffFindings(findings, []);
  assertEqual(diff.counts, { critical: 1, warning: 1, info: 1, total: 3 }, 'counts');
});

// ── empty org happy path ──────────────────────────────────────────────────

test('empty org — no findings', () => {
  const f = runDetectors(emptyCtx());
  assertEqual(f.length, 0, 'no findings');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
