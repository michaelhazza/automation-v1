/**
 * n8nImportServicePure.test.ts — Pure tests for Feature 3 (n8n Workflow Import).
 *
 * Covers (per spec §5.7):
 *   - Schedule trigger mapping
 *   - Webhook trigger mapping
 *   - if/switch conditional mapping
 *   - Unknown node type flagging as user_input + TODO
 *   - function/code node rejection as user_input + TODO
 *   - Credential reference extraction (no tokens)
 *   - 100-node cap
 *   - Directed cycle detection and rejection
 *   - Disconnected non-trigger node → high-severity warning, omitted from steps
 *   - Side-effect inference: HTTP POST → review; GET → auto; variable → review
 *   - Topological sort determinism (same output on repeated runs)
 *   - normaliseNodeType strips known prefixes
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/n8nImportServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  importN8nWorkflow,
  detectCycles,
  topologicalSort,
  normaliseNodeType,
  inferSideEffectClass,
  extractCredentialRefs,
  MAX_N8N_NODES,
  type N8nNode,
  type N8nConnection,
} from '../n8nImportServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

// ─── Helpers to build minimal n8n workflow JSON ──────────────────────────────

function makeWorkflow(nodes: N8nNode[], connections: N8nConnection[] = []) {
  // Convert connections to n8n's name-indexed format
  const connMap: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }> = {};
  const nodeById = new Map<string, N8nNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  for (const c of connections) {
    const sourceNode = nodeById.get(c.source);
    const targetNode = nodeById.get(c.target);
    if (!sourceNode || !targetNode) continue;
    if (!connMap[sourceNode.name]) connMap[sourceNode.name] = { main: [] };
    const group = connMap[sourceNode.name].main;
    while (group.length <= c.sourceOutput) group.push([]);
    group[c.sourceOutput].push({ node: targetNode.name, type: 'main', index: c.targetInput });
  }

  return {
    name: 'Test Workflow',
    nodes,
    connections: connMap,
  };
}

function node(id: string, name: string, type: string, params: Record<string, unknown> = {}, creds?: Record<string, { id: string; name: string }>): N8nNode {
  return { id, name, type, parameters: params, credentials: creds, position: [0, 0] };
}

function conn(source: string, target: string): N8nConnection {
  return { source, target, sourceOutput: 0, targetInput: 0 };
}

// ─── normaliseNodeType ────────────────────────────────────────────────────────

test('normaliseNodeType strips n8n-nodes-base prefix', () => {
  expect(normaliseNodeType('n8n-nodes-base.httpRequest'), 'base prefix').toBe('httpRequest');
});

test('normaliseNodeType strips n8n-nodes-langchain prefix', () => {
  expect(normaliseNodeType('n8n-nodes-langchain.openAi'), 'langchain prefix').toBe('openAi');
});

test('normaliseNodeType strips @n8n/n8n-nodes-base prefix', () => {
  expect(normaliseNodeType('@n8n/n8n-nodes-base.scheduleTrigger'), 'scoped package').toBe('scheduleTrigger');
});

test('normaliseNodeType leaves unknown prefixes intact', () => {
  expect(normaliseNodeType('custom.MyNode'), 'unknown prefix unchanged').toBe('custom.MyNode');
});

// ─── inferSideEffectClass ─────────────────────────────────────────────────────

test('HTTP GET → sideEffectClass auto', () => {
  const n = node('1', 'GET node', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  expect(inferSideEffectClass(n, 'httpRequest'), 'GET should be auto').toBe('auto');
});

test('HTTP POST → sideEffectClass review', () => {
  const n = node('1', 'POST node', 'n8n-nodes-base.httpRequest', { method: 'POST' });
  expect(inferSideEffectClass(n, 'httpRequest'), 'POST should be review').toBe('review');
});

test('HTTP PATCH → sideEffectClass review', () => {
  const n = node('1', 'PATCH node', 'n8n-nodes-base.httpRequest', { method: 'PATCH' });
  expect(inferSideEffectClass(n, 'httpRequest'), 'PATCH should be review').toBe('review');
});

test('HTTP method is JS variable expression → sideEffectClass review', () => {
  const n = node('1', 'Dynamic node', 'n8n-nodes-base.httpRequest', { method: '={{$json.method}}' });
  expect(inferSideEffectClass(n, 'httpRequest'), 'variable method should be review').toBe('review');
});

test('HTTP method missing → sideEffectClass review (unknown scope)', () => {
  const n = node('1', 'No method', 'n8n-nodes-base.httpRequest', {});
  expect(inferSideEffectClass(n, 'httpRequest'), 'missing method should be review').toBe('review');
});

test('scheduleTrigger → sideEffectClass auto', () => {
  const n = node('1', 'Scheduler', 'n8n-nodes-base.scheduleTrigger');
  expect(inferSideEffectClass(n, 'scheduleTrigger'), 'trigger should be auto').toBe('auto');
});

test('gmail → sideEffectClass review', () => {
  const n = node('1', 'Gmail', 'n8n-nodes-base.gmail');
  expect(inferSideEffectClass(n, 'gmail'), 'gmail should be review').toBe('review');
});

// ─── extractCredentialRefs ────────────────────────────────────────────────────

test('extractCredentialRefs returns empty array when no credentials', () => {
  const n = node('1', 'No creds', 'n8n-nodes-base.httpRequest');
  expect(extractCredentialRefs(n), 'should be empty').toEqual([]);
});

test('extractCredentialRefs returns provider/id/name for each credential', () => {
  const n = node('1', 'Gmail node', 'n8n-nodes-base.gmail', {}, {
    gmailOAuth2: { id: 'cred-123', name: 'My Gmail' },
  });
  const refs = extractCredentialRefs(n);
  expect(refs.length === 1, 'should have 1 ref').toBeTruthy();
  expect(refs[0], 'ref fields').toEqual({ provider: 'gmailOAuth2', id: 'cred-123', name: 'My Gmail' });
});

// ─── detectCycles ─────────────────────────────────────────────────────────────

test('detectCycles returns empty array for a DAG', () => {
  const nodes = [node('a', 'A', 'x'), node('b', 'B', 'x'), node('c', 'C', 'x')];
  const conns = [conn('a', 'b'), conn('b', 'c')];
  const cycles = detectCycles(nodes, conns);
  expect(cycles, 'linear chain has no cycles').toEqual([]);
});

test('detectCycles detects a simple A→B→C→A cycle', () => {
  const nodes = [node('a', 'A', 'x'), node('b', 'B', 'x'), node('c', 'C', 'x')];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const cycles = detectCycles(nodes, conns);
  expect(cycles.length > 0, 'should detect cycle').toBeTruthy();
  expect(cycles.includes('a') || cycles.includes('b') || cycles.includes('c'), 'cycle nodes included').toBeTruthy();
});

// ─── topologicalSort ──────────────────────────────────────────────────────────

test('topologicalSort returns an error message for a cyclic workflow', () => {
  const nodes = [
    node('a', 'Node A', 'n8n-nodes-base.set'),
    node('b', 'Node B', 'n8n-nodes-base.set'),
    node('c', 'Node C', 'n8n-nodes-base.set'),
  ];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const result = topologicalSort(nodes, conns);
  expect('error' in result, 'should return error').toBeTruthy();
  expect(typeof (result as { error: string }).error === 'string', 'error should be string').toBeTruthy();
  expect((result as { error: string }).error.includes('directed cycle'), 'error mentions directed cycle').toBeTruthy();
});

test('topologicalSort produces deterministic output (same on repeated calls)', () => {
  const nodes = [
    node('c', 'Zeta', 'n8n-nodes-base.set'),
    node('b', 'Alpha', 'n8n-nodes-base.set'),
    node('a', 'Beta', 'n8n-nodes-base.set'),
  ];
  const result1 = topologicalSort(nodes, []);
  const result2 = topologicalSort(nodes, []);
  expect('order' in result1 && 'order' in result2, 'both should return order').toBeTruthy();
  const ids1 = (result1 as { order: N8nNode[] }).order.map((n) => n.id);
  const ids2 = (result2 as { order: N8nNode[] }).order.map((n) => n.id);
  expect(ids1, 'both runs should produce same order').toEqual(ids2);
});

test('topologicalSort puts sources before sinks', () => {
  const nodes = [
    node('trigger', 'Trigger', 'n8n-nodes-base.scheduleTrigger'),
    node('http', 'HTTP', 'n8n-nodes-base.httpRequest'),
    node('slack', 'Slack', 'n8n-nodes-base.slack'),
  ];
  const conns = [conn('trigger', 'http'), conn('http', 'slack')];
  const result = topologicalSort(nodes, conns);
  expect('order' in result, 'should return order').toBeTruthy();
  const order = (result as { order: N8nNode[] }).order;
  const idxTrigger = order.findIndex((n) => n.id === 'trigger');
  const idxHttp = order.findIndex((n) => n.id === 'http');
  const idxSlack = order.findIndex((n) => n.id === 'slack');
  expect(idxTrigger < idxHttp, 'trigger before http').toBeTruthy();
  expect(idxHttp < idxSlack, 'http before slack').toBeTruthy();
});

// ─── importN8nWorkflow ────────────────────────────────────────────────────────

test('rejects non-object workflow JSON', () => {
  const result = importN8nWorkflow('not an object');
  expect(!result.ok, 'should fail').toBeTruthy();
});

test('rejects workflow missing nodes array', () => {
  const result = importN8nWorkflow({ name: 'Test' });
  expect(!result.ok, 'should fail for missing nodes').toBeTruthy();
});

test('rejects workflow exceeding 100-node cap', () => {
  const nodes = Array.from({ length: MAX_N8N_NODES + 1 }, (_, i) =>
    node(`n${i}`, `Node ${i}`, 'n8n-nodes-base.set')
  );
  const result = importN8nWorkflow(makeWorkflow(nodes));
  expect(!result.ok, 'should fail for too many nodes').toBeTruthy();
  expect(result.ok === false && result.error.includes(String(MAX_N8N_NODES + 1)), 'error should mention node count').toBeTruthy();
});

test('rejects workflow with a directed cycle', () => {
  const nodes = [
    node('a', 'Node A', 'n8n-nodes-base.set'),
    node('b', 'Node B', 'n8n-nodes-base.set'),
    node('c', 'Node C', 'n8n-nodes-base.set'),
  ];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const result = importN8nWorkflow(makeWorkflow(nodes, conns));
  expect(!result.ok, 'cyclic workflow should fail').toBeTruthy();
  expect(result.ok === false && result.error.includes('directed cycle'), 'error mentions cycle').toBeTruthy();
  // Must cite the cycling node names
  expect(result.ok === false && (result.error.includes('Node A') || result.error.includes('Node B')), 'error cites node names').toBeTruthy();
});

test('schedule trigger node maps to schedule step', () => {
  const nodes = [node('t', 'Cron', 'n8n-nodes-base.scheduleTrigger')];
  const result = importN8nWorkflow(makeWorkflow(nodes));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Cron');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.stepType, 'should be schedule step').toBe('schedule');
  expect(step!.confidence, 'schedule trigger is high confidence').toBe('high');
});

test('webhook trigger node maps to trigger step', () => {
  const nodes = [node('w', 'Webhook', 'n8n-nodes-base.webhook')];
  const result = importN8nWorkflow(makeWorkflow(nodes));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Webhook');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.stepType, 'should be trigger step').toBe('trigger');
});

test('if node maps to conditional step', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const ifNode = node('i', 'Check Condition', 'n8n-nodes-base.if');
  const result = importN8nWorkflow(makeWorkflow([trigger, ifNode], [conn('t', 'i')]));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Check Condition');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.stepType, 'if node maps to conditional').toBe('conditional');
});

test('unknown node type emits user_input step with TODO and low confidence', () => {
  // Connect from a trigger so the unknown node is not disconnected
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const nodes = [trigger, node('u', 'Mystery Node', 'n8n-nodes-base.unknownType42')];
  const result = importN8nWorkflow(makeWorkflow(nodes, [conn('t', 'u')]));
  expect(result.ok, 'should succeed overall').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Mystery Node');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.stepType, 'unknown → user_input').toBe('user_input');
  expect(step!.confidence, 'unknown → low confidence').toBe('low');
  expect(typeof step!.todo === 'string' && step!.todo.includes('TODO'), 'should have TODO annotation').toBeTruthy();
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Mystery Node');
  expect(reportRow !== undefined, 'report row should exist').toBeTruthy();
  expect(reportRow!.actionRequired, 'unknown → rewrite action').toBe('rewrite');
});

test('function node is emitted as user_input step with TODO (unconvertible)', () => {
  // Connect from a trigger so it is not treated as disconnected
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const nodes = [trigger, node('f', 'Transform Data', 'n8n-nodes-base.function')];
  const result = importN8nWorkflow(makeWorkflow(nodes, [conn('t', 'f')]));
  expect(result.ok, 'should succeed overall').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Transform Data');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.stepType, 'function → user_input').toBe('user_input');
  expect(step!.confidence, 'function → low confidence').toBe('low');
  expect(typeof step!.todo === 'string' && step!.todo.toLowerCase().includes('code'), 'should mention code').toBeTruthy();
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Transform Data');
  expect(reportRow!.actionRequired, 'function → rewrite').toBe('rewrite');
});

test('disconnected non-trigger node is absent from steps and has high-severity warning in report', () => {
  // trigger connects to http; slack has NO connections
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'HTTP Call', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  const orphan = node('s', 'Orphan Slack', 'n8n-nodes-base.slack');
  const result = importN8nWorkflow(makeWorkflow([trigger, http, orphan], [conn('t', 'h')]));
  expect(result.ok, 'should succeed overall').toBeTruthy();
  if (!result.ok) return;

  // orphan should NOT appear in steps
  const orphanStep = result.steps.find((s) => s.name === 'Orphan Slack');
  expect(orphanStep === undefined, 'disconnected node should be absent from steps').toBeTruthy();

  // should appear in report with high-severity warning
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Orphan Slack');
  expect(reportRow !== undefined, 'should appear in report').toBeTruthy();
  expect(reportRow!.warning !== undefined, 'should have warning').toBeTruthy();
  expect(reportRow!.warning!.severity, 'should be high severity').toBe('high');
});

test('credential references extracted into checklist (no tokens)', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const gmail = node('g', 'Send Email', 'n8n-nodes-base.gmail', {}, {
    gmailOAuth2: { id: 'cred-abc', name: 'Client Gmail' },
  });
  const result = importN8nWorkflow(makeWorkflow([trigger, gmail], [conn('t', 'g')]));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  expect(result.credentialChecklist.length === 1, 'should have 1 credential').toBeTruthy();
  expect(result.credentialChecklist[0].provider, 'provider correct').toBe('gmailOAuth2');
  expect(result.credentialChecklist[0].id, 'id correct').toBe('cred-abc');
  expect(result.credentialChecklist[0].name, 'name correct').toBe('Client Gmail');
});

test('HTTP POST step has sideEffectClass review', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'POST to API', 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://api.example.com/endpoint' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'POST to API');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.sideEffectClass, 'POST → review').toBe('review');
});

test('HTTP GET step has sideEffectClass auto', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'GET Data', 'n8n-nodes-base.httpRequest', { method: 'GET', url: 'https://api.example.com/data' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'GET Data');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.sideEffectClass, 'GET → auto').toBe('auto');
});

test('HTTP node with variable method expression has sideEffectClass review', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'Dynamic HTTP', 'n8n-nodes-base.httpRequest', { method: '={{$json.httpMethod}}' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Dynamic HTTP');
  expect(step !== undefined, 'step should exist').toBeTruthy();
  expect(step!.sideEffectClass, 'variable method → review (unknown scope)').toBe('review');
});

test('typical workflow: trigger → http → slack produces 3 steps in order', () => {
  const trigger = node('t', 'Cron Trigger', 'n8n-nodes-base.scheduleTrigger');
  const http = node('h', 'Fetch Data', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  const slack = node('s', 'Post to Slack', 'n8n-nodes-base.slack');
  const result = importN8nWorkflow(makeWorkflow(
    [trigger, http, slack],
    [conn('t', 'h'), conn('h', 's')]
  ));
  expect(result.ok, 'should succeed').toBeTruthy();
  if (!result.ok) return;
  expect(result.steps.length === 3, `should have 3 steps, got ${result.steps.length}`).toBeTruthy();
  expect(result.steps[0].stepType, 'first step is schedule').toBe('schedule');
  expect(result.steps[2].sideEffectClass, 'slack is review').toBe('review');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
