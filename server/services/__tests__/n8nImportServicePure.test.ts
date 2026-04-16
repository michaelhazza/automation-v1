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

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}
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

await test('normaliseNodeType strips n8n-nodes-base prefix', () => {
  assertEqual(normaliseNodeType('n8n-nodes-base.httpRequest'), 'httpRequest', 'base prefix');
});

await test('normaliseNodeType strips n8n-nodes-langchain prefix', () => {
  assertEqual(normaliseNodeType('n8n-nodes-langchain.openAi'), 'openAi', 'langchain prefix');
});

await test('normaliseNodeType strips @n8n/n8n-nodes-base prefix', () => {
  assertEqual(normaliseNodeType('@n8n/n8n-nodes-base.scheduleTrigger'), 'scheduleTrigger', 'scoped package');
});

await test('normaliseNodeType leaves unknown prefixes intact', () => {
  assertEqual(normaliseNodeType('custom.MyNode'), 'custom.MyNode', 'unknown prefix unchanged');
});

// ─── inferSideEffectClass ─────────────────────────────────────────────────────

await test('HTTP GET → sideEffectClass auto', () => {
  const n = node('1', 'GET node', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  assertEqual(inferSideEffectClass(n, 'httpRequest'), 'auto', 'GET should be auto');
});

await test('HTTP POST → sideEffectClass review', () => {
  const n = node('1', 'POST node', 'n8n-nodes-base.httpRequest', { method: 'POST' });
  assertEqual(inferSideEffectClass(n, 'httpRequest'), 'review', 'POST should be review');
});

await test('HTTP PATCH → sideEffectClass review', () => {
  const n = node('1', 'PATCH node', 'n8n-nodes-base.httpRequest', { method: 'PATCH' });
  assertEqual(inferSideEffectClass(n, 'httpRequest'), 'review', 'PATCH should be review');
});

await test('HTTP method is JS variable expression → sideEffectClass review', () => {
  const n = node('1', 'Dynamic node', 'n8n-nodes-base.httpRequest', { method: '={{$json.method}}' });
  assertEqual(inferSideEffectClass(n, 'httpRequest'), 'review', 'variable method should be review');
});

await test('HTTP method missing → sideEffectClass review (unknown scope)', () => {
  const n = node('1', 'No method', 'n8n-nodes-base.httpRequest', {});
  assertEqual(inferSideEffectClass(n, 'httpRequest'), 'review', 'missing method should be review');
});

await test('scheduleTrigger → sideEffectClass auto', () => {
  const n = node('1', 'Scheduler', 'n8n-nodes-base.scheduleTrigger');
  assertEqual(inferSideEffectClass(n, 'scheduleTrigger'), 'auto', 'trigger should be auto');
});

await test('gmail → sideEffectClass review', () => {
  const n = node('1', 'Gmail', 'n8n-nodes-base.gmail');
  assertEqual(inferSideEffectClass(n, 'gmail'), 'review', 'gmail should be review');
});

// ─── extractCredentialRefs ────────────────────────────────────────────────────

await test('extractCredentialRefs returns empty array when no credentials', () => {
  const n = node('1', 'No creds', 'n8n-nodes-base.httpRequest');
  assertEqual(extractCredentialRefs(n), [], 'should be empty');
});

await test('extractCredentialRefs returns provider/id/name for each credential', () => {
  const n = node('1', 'Gmail node', 'n8n-nodes-base.gmail', {}, {
    gmailOAuth2: { id: 'cred-123', name: 'My Gmail' },
  });
  const refs = extractCredentialRefs(n);
  assert(refs.length === 1, 'should have 1 ref');
  assertEqual(refs[0], { provider: 'gmailOAuth2', id: 'cred-123', name: 'My Gmail' }, 'ref fields');
});

// ─── detectCycles ─────────────────────────────────────────────────────────────

await test('detectCycles returns empty array for a DAG', () => {
  const nodes = [node('a', 'A', 'x'), node('b', 'B', 'x'), node('c', 'C', 'x')];
  const conns = [conn('a', 'b'), conn('b', 'c')];
  const cycles = detectCycles(nodes, conns);
  assertEqual(cycles, [], 'linear chain has no cycles');
});

await test('detectCycles detects a simple A→B→C→A cycle', () => {
  const nodes = [node('a', 'A', 'x'), node('b', 'B', 'x'), node('c', 'C', 'x')];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const cycles = detectCycles(nodes, conns);
  assert(cycles.length > 0, 'should detect cycle');
  assert(cycles.includes('a') || cycles.includes('b') || cycles.includes('c'), 'cycle nodes included');
});

// ─── topologicalSort ──────────────────────────────────────────────────────────

await test('topologicalSort returns an error message for a cyclic workflow', () => {
  const nodes = [
    node('a', 'Node A', 'n8n-nodes-base.set'),
    node('b', 'Node B', 'n8n-nodes-base.set'),
    node('c', 'Node C', 'n8n-nodes-base.set'),
  ];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const result = topologicalSort(nodes, conns);
  assert('error' in result, 'should return error');
  assert(typeof (result as { error: string }).error === 'string', 'error should be string');
  assert((result as { error: string }).error.includes('directed cycle'), 'error mentions directed cycle');
});

await test('topologicalSort produces deterministic output (same on repeated calls)', () => {
  const nodes = [
    node('c', 'Zeta', 'n8n-nodes-base.set'),
    node('b', 'Alpha', 'n8n-nodes-base.set'),
    node('a', 'Beta', 'n8n-nodes-base.set'),
  ];
  const result1 = topologicalSort(nodes, []);
  const result2 = topologicalSort(nodes, []);
  assert('order' in result1 && 'order' in result2, 'both should return order');
  const ids1 = (result1 as { order: N8nNode[] }).order.map((n) => n.id);
  const ids2 = (result2 as { order: N8nNode[] }).order.map((n) => n.id);
  assertEqual(ids1, ids2, 'both runs should produce same order');
});

await test('topologicalSort puts sources before sinks', () => {
  const nodes = [
    node('trigger', 'Trigger', 'n8n-nodes-base.scheduleTrigger'),
    node('http', 'HTTP', 'n8n-nodes-base.httpRequest'),
    node('slack', 'Slack', 'n8n-nodes-base.slack'),
  ];
  const conns = [conn('trigger', 'http'), conn('http', 'slack')];
  const result = topologicalSort(nodes, conns);
  assert('order' in result, 'should return order');
  const order = (result as { order: N8nNode[] }).order;
  const idxTrigger = order.findIndex((n) => n.id === 'trigger');
  const idxHttp = order.findIndex((n) => n.id === 'http');
  const idxSlack = order.findIndex((n) => n.id === 'slack');
  assert(idxTrigger < idxHttp, 'trigger before http');
  assert(idxHttp < idxSlack, 'http before slack');
});

// ─── importN8nWorkflow ────────────────────────────────────────────────────────

await test('rejects non-object workflow JSON', () => {
  const result = importN8nWorkflow('not an object');
  assert(!result.ok, 'should fail');
});

await test('rejects workflow missing nodes array', () => {
  const result = importN8nWorkflow({ name: 'Test' });
  assert(!result.ok, 'should fail for missing nodes');
});

await test('rejects workflow exceeding 100-node cap', () => {
  const nodes = Array.from({ length: MAX_N8N_NODES + 1 }, (_, i) =>
    node(`n${i}`, `Node ${i}`, 'n8n-nodes-base.set')
  );
  const result = importN8nWorkflow(makeWorkflow(nodes));
  assert(!result.ok, 'should fail for too many nodes');
  assert(result.ok === false && result.error.includes(String(MAX_N8N_NODES + 1)), 'error should mention node count');
});

await test('rejects workflow with a directed cycle', () => {
  const nodes = [
    node('a', 'Node A', 'n8n-nodes-base.set'),
    node('b', 'Node B', 'n8n-nodes-base.set'),
    node('c', 'Node C', 'n8n-nodes-base.set'),
  ];
  const conns = [conn('a', 'b'), conn('b', 'c'), conn('c', 'a')];
  const result = importN8nWorkflow(makeWorkflow(nodes, conns));
  assert(!result.ok, 'cyclic workflow should fail');
  assert(result.ok === false && result.error.includes('directed cycle'), 'error mentions cycle');
  // Must cite the cycling node names
  assert(result.ok === false && (result.error.includes('Node A') || result.error.includes('Node B')), 'error cites node names');
});

await test('schedule trigger node maps to schedule step', () => {
  const nodes = [node('t', 'Cron', 'n8n-nodes-base.scheduleTrigger')];
  const result = importN8nWorkflow(makeWorkflow(nodes));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Cron');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.stepType, 'schedule', 'should be schedule step');
  assertEqual(step!.confidence, 'high', 'schedule trigger is high confidence');
});

await test('webhook trigger node maps to trigger step', () => {
  const nodes = [node('w', 'Webhook', 'n8n-nodes-base.webhook')];
  const result = importN8nWorkflow(makeWorkflow(nodes));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Webhook');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.stepType, 'trigger', 'should be trigger step');
});

await test('if node maps to conditional step', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const ifNode = node('i', 'Check Condition', 'n8n-nodes-base.if');
  const result = importN8nWorkflow(makeWorkflow([trigger, ifNode], [conn('t', 'i')]));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Check Condition');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.stepType, 'conditional', 'if node maps to conditional');
});

await test('unknown node type emits user_input step with TODO and low confidence', () => {
  // Connect from a trigger so the unknown node is not disconnected
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const nodes = [trigger, node('u', 'Mystery Node', 'n8n-nodes-base.unknownType42')];
  const result = importN8nWorkflow(makeWorkflow(nodes, [conn('t', 'u')]));
  assert(result.ok, 'should succeed overall');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Mystery Node');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.stepType, 'user_input', 'unknown → user_input');
  assertEqual(step!.confidence, 'low', 'unknown → low confidence');
  assert(typeof step!.todo === 'string' && step!.todo.includes('TODO'), 'should have TODO annotation');
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Mystery Node');
  assert(reportRow !== undefined, 'report row should exist');
  assertEqual(reportRow!.actionRequired, 'rewrite', 'unknown → rewrite action');
});

await test('function node is emitted as user_input step with TODO (unconvertible)', () => {
  // Connect from a trigger so it is not treated as disconnected
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const nodes = [trigger, node('f', 'Transform Data', 'n8n-nodes-base.function')];
  const result = importN8nWorkflow(makeWorkflow(nodes, [conn('t', 'f')]));
  assert(result.ok, 'should succeed overall');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Transform Data');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.stepType, 'user_input', 'function → user_input');
  assertEqual(step!.confidence, 'low', 'function → low confidence');
  assert(typeof step!.todo === 'string' && step!.todo.toLowerCase().includes('code'), 'should mention code');
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Transform Data');
  assertEqual(reportRow!.actionRequired, 'rewrite', 'function → rewrite');
});

await test('disconnected non-trigger node is absent from steps and has high-severity warning in report', () => {
  // trigger connects to http; slack has NO connections
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'HTTP Call', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  const orphan = node('s', 'Orphan Slack', 'n8n-nodes-base.slack');
  const result = importN8nWorkflow(makeWorkflow([trigger, http, orphan], [conn('t', 'h')]));
  assert(result.ok, 'should succeed overall');
  if (!result.ok) return;

  // orphan should NOT appear in steps
  const orphanStep = result.steps.find((s) => s.name === 'Orphan Slack');
  assert(orphanStep === undefined, 'disconnected node should be absent from steps');

  // should appear in report with high-severity warning
  const reportRow = result.report.find((r) => r.n8nNodeName === 'Orphan Slack');
  assert(reportRow !== undefined, 'should appear in report');
  assert(reportRow!.warning !== undefined, 'should have warning');
  assertEqual(reportRow!.warning!.severity, 'high', 'should be high severity');
});

await test('credential references extracted into checklist (no tokens)', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const gmail = node('g', 'Send Email', 'n8n-nodes-base.gmail', {}, {
    gmailOAuth2: { id: 'cred-abc', name: 'Client Gmail' },
  });
  const result = importN8nWorkflow(makeWorkflow([trigger, gmail], [conn('t', 'g')]));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  assert(result.credentialChecklist.length === 1, 'should have 1 credential');
  assertEqual(result.credentialChecklist[0].provider, 'gmailOAuth2', 'provider correct');
  assertEqual(result.credentialChecklist[0].id, 'cred-abc', 'id correct');
  assertEqual(result.credentialChecklist[0].name, 'Client Gmail', 'name correct');
});

await test('HTTP POST step has sideEffectClass review', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'POST to API', 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://api.example.com/endpoint' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'POST to API');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.sideEffectClass, 'review', 'POST → review');
});

await test('HTTP GET step has sideEffectClass auto', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'GET Data', 'n8n-nodes-base.httpRequest', { method: 'GET', url: 'https://api.example.com/data' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'GET Data');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.sideEffectClass, 'auto', 'GET → auto');
});

await test('HTTP node with variable method expression has sideEffectClass review', () => {
  const trigger = node('t', 'Trigger', 'n8n-nodes-base.manualTrigger');
  const http = node('h', 'Dynamic HTTP', 'n8n-nodes-base.httpRequest', { method: '={{$json.httpMethod}}' });
  const result = importN8nWorkflow(makeWorkflow([trigger, http], [conn('t', 'h')]));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  const step = result.steps.find((s) => s.name === 'Dynamic HTTP');
  assert(step !== undefined, 'step should exist');
  assertEqual(step!.sideEffectClass, 'review', 'variable method → review (unknown scope)');
});

await test('typical workflow: trigger → http → slack produces 3 steps in order', () => {
  const trigger = node('t', 'Cron Trigger', 'n8n-nodes-base.scheduleTrigger');
  const http = node('h', 'Fetch Data', 'n8n-nodes-base.httpRequest', { method: 'GET' });
  const slack = node('s', 'Post to Slack', 'n8n-nodes-base.slack');
  const result = importN8nWorkflow(makeWorkflow(
    [trigger, http, slack],
    [conn('t', 'h'), conn('h', 's')]
  ));
  assert(result.ok, 'should succeed');
  if (!result.ok) return;
  assert(result.steps.length === 3, `should have 3 steps, got ${result.steps.length}`);
  assertEqual(result.steps[0].stepType, 'schedule', 'first step is schedule');
  assertEqual(result.steps[2].sideEffectClass, 'review', 'slack is review');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nn8nImportServicePure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
