// ---------------------------------------------------------------------------
// n8nImportServicePure.ts — pure functions for Feature 3 (n8n Workflow Import)
//
// No DB, no HTTP, no side effects. All state is passed in / returned.
// Tested in __tests__/n8nImportServicePure.test.ts.
//
// Export surface:
//   importN8nWorkflow(workflowJson) → ImportResult   (main entry point)
//   N8N_NODE_MAP                                     (mapping table constant)
//   Types: N8nNode, N8nConnection, N8nIR, MappedStep, MappingReportRow, ImportResult
// ---------------------------------------------------------------------------

// ─── Types (IR) ─────────────────────────────────────────────────────────────

export type N8nNode = {
  id: string;
  name: string;
  type: string; // e.g. 'n8n-nodes-base.httpRequest'
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  position: [number, number];
};

export type N8nConnection = {
  source: string;   // source node id
  sourceOutput: number;
  target: string;   // target node id
  targetInput: number;
};

export type N8nIR = {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnection[];
  triggers: N8nNode[]; // subset of nodes that are trigger types
};

// ─── Mapped step and report types ───────────────────────────────────────────

export type StepType =
  | 'action_call'
  | 'conditional'
  | 'prompt'
  | 'user_input'
  | 'schedule'
  | 'trigger';

export type SideEffectClass = 'auto' | 'review';

export type Confidence = 'high' | 'medium' | 'low';
export type ActionRequired = 'none' | 'review' | 'rewrite';
export type WarningSeverity = 'high' | 'medium' | 'low';

export type MappedStep = {
  id: string;          // derived from node id, URL-safe
  name: string;        // human label
  stepType: StepType;
  sideEffectClass: SideEffectClass;
  confidence: Confidence;
  /** Present on action_call steps */
  skill?: string;
  /** Present on prompt steps */
  model?: string;
  /** Step parameters (merged from node.parameters) */
  parameters?: Record<string, unknown>;
  /** Credential references identified (never imported) */
  credentialRefs?: Array<{ provider: string; id: string; name: string }>;
  /** TODO annotation for low-confidence / unmapped steps */
  todo?: string;
};

export type MappingReportRow = {
  n8nNodeId: string;
  n8nNodeName: string;
  n8nNodeType: string;        // normalised short key
  mappedStepId: string | null;
  mappedStepType: StepType | null;
  confidence: Confidence;
  actionRequired: ActionRequired;
  /** High-severity disconnected-node warning */
  warning?: { severity: WarningSeverity; message: string };
  notes?: string;
};

export type ImportResult =
  | {
      ok: true;
      workflowName: string;
      steps: MappedStep[];
      report: MappingReportRow[];
      credentialChecklist: Array<{ provider: string; id: string; name: string }>;
    }
  | {
      ok: false;
      error: string;
    };

// ─── Node-type mapping table ─────────────────────────────────────────────────
//
// Keys are SHORT keys: the n8n type string after stripping the
// 'n8n-nodes-base.' or 'n8n-nodes-langchain.' prefix.
//
// The mapping table is a constant so tests can snapshot it.

type NodeMapping = {
  stepType: StepType;
  skill?: string;          // for action_call nodes
  confidence: Confidence;
  isTrigger?: boolean;
  // Used to infer side effects at the mapping stage (before inferSideEffectClass)
  defaultSideEffect: SideEffectClass;
  notes?: string;
};

export const N8N_NODE_MAP: Record<string, NodeMapping> = {
  // ── Triggers ──────────────────────────────────────────────────────────────
  scheduleTrigger: {
    stepType: 'schedule',
    isTrigger: true,
    confidence: 'high',
    defaultSideEffect: 'auto',
    notes: 'Converts cron to Synthetos cron format; timezone preserved',
  },
  webhook: {
    stepType: 'trigger',
    isTrigger: true,
    confidence: 'high',
    defaultSideEffect: 'auto',
    notes: 'Webhook path is a placeholder in draft; allocated on save',
  },
  manualTrigger: {
    stepType: 'trigger',
    isTrigger: true,
    confidence: 'high',
    defaultSideEffect: 'auto',
  },

  // ── HTTP / connectors ─────────────────────────────────────────────────────
  httpRequest: {
    stepType: 'action_call',
    skill: 'fetch_url',
    confidence: 'medium',
    defaultSideEffect: 'review', // overridden by inferSideEffectClass
    notes: 'URL + method preserved; auth mapped to connection scoping',
  },
  gmail: {
    stepType: 'action_call',
    skill: 'gmail',
    confidence: 'medium',
    defaultSideEffect: 'review',
    notes: 'Credentials mapped to Synthetos connection',
  },
  slack: {
    stepType: 'action_call',
    skill: 'slack',
    confidence: 'medium',
    defaultSideEffect: 'review',
  },
  hubspot: {
    stepType: 'action_call',
    skill: 'hubspot',
    confidence: 'medium',
    defaultSideEffect: 'review',
  },
  github: {
    stepType: 'action_call',
    skill: 'github',
    confidence: 'medium',
    defaultSideEffect: 'review',
  },
  ghl: {
    stepType: 'action_call',
    skill: 'ghl',
    confidence: 'medium',
    defaultSideEffect: 'review',
  },

  // ── Control flow ─────────────────────────────────────────────────────────
  if: {
    stepType: 'conditional',
    confidence: 'medium',
    defaultSideEffect: 'auto',
    notes: 'Expression converted from n8n JS syntax; complex cases flagged',
  },
  switch: {
    stepType: 'conditional',
    confidence: 'medium',
    defaultSideEffect: 'auto',
    notes: 'Switch mapped to conditional; multi-branch may require review',
  },

  // ── Data transforms (inlined into downstream step) ─────────────────────
  set: {
    stepType: 'user_input',
    confidence: 'low',
    defaultSideEffect: 'auto',
    notes: 'Set node — inlined into downstream step templating; review required',
  },
  splitOut: {
    stepType: 'user_input',
    confidence: 'low',
    defaultSideEffect: 'auto',
    notes: 'SplitOut node — inlined into downstream step templating; review required',
  },

  // ── LLM nodes ─────────────────────────────────────────────────────────────
  openAi: {
    stepType: 'prompt',
    confidence: 'medium',
    defaultSideEffect: 'auto',
    notes: 'Model-agnostic routing; model selection preserved in comment',
  },
  lmAnthropicClaude: {
    stepType: 'prompt',
    confidence: 'medium',
    defaultSideEffect: 'auto',
    notes: 'Model-agnostic routing; model selection preserved in comment',
  },
};

// Node types that are unconvertible (flagged in report, not emitted as steps)
const UNCONVERTIBLE_TYPES = new Set(['function', 'code', 'executeWorkflow', 'executeCode']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise an n8n type string to its short key by stripping known prefixes.
 * 'n8n-nodes-base.httpRequest' → 'httpRequest'
 * 'n8n-nodes-langchain.openAi' → 'openAi'
 * '@n8n/n8n-nodes-base.httpRequest' → 'httpRequest' (scoped package variant)
 */
export function normaliseNodeType(rawType: string): string {
  return rawType
    .replace(/^@n8n\/n8n-nodes-[a-z]+\./, '')
    .replace(/^n8n-nodes-[a-z]+\./, '');
}

/**
 * Derive a step id from a node — URL-safe, lowercase, hyphenated.
 */
function stepIdFromNode(node: N8nNode): string {
  return `step_${node.id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`;
}

// ─── 3A2: Cycle detection + topological sort ─────────────────────────────────

/**
 * detectCycles — returns the IDs of nodes involved in directed cycles.
 * Uses Kahn's algorithm: any node that cannot be processed (never reaches
 * in-degree 0) is part of a cycle. O(V+E).
 * Returns an empty array if the graph is a DAG.
 */
export function detectCycles(nodes: N8nNode[], connections: N8nConnection[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const c of connections) {
    const out = adj.get(c.source);
    if (out) out.push(c.target);
    inDegree.set(c.target, (inDegree.get(c.target) ?? 0) + 1);
  }

  // Seed with zero-in-degree nodes
  const queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  const processed = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    processed.add(id);
    for (const nid of (adj.get(id) ?? [])) {
      const deg = (inDegree.get(nid) ?? 0) - 1;
      inDegree.set(nid, deg);
      if (deg === 0) queue.push(nid);
    }
  }

  // Nodes not reachable by Kahn's = members of a cycle
  return nodes.filter((n) => !processed.has(n.id)).map((n) => n.id);
}

/**
 * topologicalSort — Kahn's algorithm (BFS, O(V+E)).
 * Tie-break: (node.name, node.id) ascending (deterministic).
 * Returns { order: N8nNode[] } or { error: string } if cycles found.
 */
export function topologicalSort(
  nodes: N8nNode[],
  connections: N8nConnection[],
): { order: N8nNode[] } | { error: string } {
  // First run cycle detection
  const cycleIds = detectCycles(nodes, connections);
  if (cycleIds.length > 0) {
    const cycleNames = nodes
      .filter((n) => cycleIds.includes(n.id))
      .map((n) => n.name)
      .join(', ');
    return {
      error: `Workflow contains a directed cycle at nodes: [${cycleNames}]. Cyclic graphs cannot be converted to a linear playbook.`,
    };
  }

  const nodeById = new Map<string, N8nNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  // Build adjacency list and in-degree map
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const c of connections) {
    const out = adj.get(c.source);
    if (out) out.push(c.target);
    inDegree.set(c.target, (inDegree.get(c.target) ?? 0) + 1);
  }

  // Seed queue with zero-in-degree nodes, sorted for determinism
  const queue: N8nNode[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1);

  const order: N8nNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    const neighbours = (adj.get(node.id) ?? [])
      .map((id) => nodeById.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1);
    for (const neighbour of neighbours) {
      const newDeg = (inDegree.get(neighbour.id) ?? 0) - 1;
      inDegree.set(neighbour.id, newDeg);
      if (newDeg === 0) {
        // Insert in sorted position to maintain determinism
        let inserted = false;
        for (let i = 0; i < queue.length; i++) {
          const q = queue[i];
          if (neighbour.name < q.name || (neighbour.name === q.name && neighbour.id < q.id)) {
            queue.splice(i, 0, neighbour);
            inserted = true;
            break;
          }
        }
        if (!inserted) queue.push(neighbour);
      }
    }
  }

  // Defensive assertion: if cycle detection passed, all nodes must be sorted.
  // If this fires, detectCycles has a bug.
  if (order.length !== nodes.length) {
    return {
      error: `Internal error: topological sort produced ${order.length} nodes from ${nodes.length} input nodes after cycle check passed. Please report this.`,
    };
  }

  return { order };
}

// ─── 3A3: Side-effect inference + credentials + 100-cap ──────────────────────

/**
 * inferSideEffectClass — conservative default side-effect class for a mapped step.
 *
 * Rules:
 * - HTTP GET → 'auto'
 * - HTTP POST/PATCH/PUT/DELETE → 'review'
 * - HTTP method is a JS variable expression → 'review' (unknown scope)
 * - Trigger nodes → 'auto'
 * - Prompt/LLM nodes → 'auto'
 * - Connector writes (gmail, slack, hubspot, etc.) → 'review'
 * - Unknown scope (credential unknown, method variable) → 'review'
 */
export function inferSideEffectClass(
  node: N8nNode,
  shortKey: string,
): SideEffectClass {
  if (shortKey === 'httpRequest') {
    const method = node.parameters.method;
    if (typeof method === 'string') {
      // Variable expression — unknown scope, default to review
      if (method.startsWith('={{') || method.startsWith('=')) return 'review';
      const upper = method.toUpperCase();
      if (upper === 'GET' || upper === 'HEAD') return 'auto';
      return 'review'; // POST, PATCH, PUT, DELETE, etc.
    }
    // Method is missing or non-string — unknown scope
    return 'review';
  }

  const mapping = N8N_NODE_MAP[shortKey];
  if (!mapping) return 'review'; // unknown type → conservative default

  return mapping.defaultSideEffect;
}

/**
 * extractCredentialRefs — pull credential references from a node.
 * Returns an array of { provider, id, name } (never the tokens themselves).
 */
export function extractCredentialRefs(
  node: N8nNode,
): Array<{ provider: string; id: string; name: string }> {
  if (!node.credentials) return [];
  return Object.entries(node.credentials).map(([provider, ref]) => ({
    provider,
    id: ref.id,
    name: ref.name,
  }));
}

// ─── Main entry point ────────────────────────────────────────────────────────

export const MAX_N8N_NODES = 100;

/**
 * importN8nWorkflow — parse an n8n workflow JSON export and produce a draft
 * Synthetos playbook step list + mapping report.
 *
 * @param workflowJson - the raw parsed JSON (unknown type)
 */
export function importN8nWorkflow(workflowJson: unknown): ImportResult {
  // 1. Basic shape validation
  if (!workflowJson || typeof workflowJson !== 'object' || Array.isArray(workflowJson)) {
    return { ok: false, error: 'Invalid workflow JSON: expected an object' };
  }
  const wf = workflowJson as Record<string, unknown>;

  const workflowName = typeof wf.name === 'string' ? wf.name : 'Imported Workflow';

  // 2. Parse nodes
  if (!Array.isArray(wf.nodes)) {
    return { ok: false, error: 'Invalid workflow JSON: missing nodes array' };
  }
  const rawNodes = wf.nodes as unknown[];
  const nodes: N8nNode[] = rawNodes.map((n: unknown, i) => {
    const node = n as Record<string, unknown>;
    return {
      id: typeof node.id === 'string' ? node.id : `node_${i}`,
      name: typeof node.name === 'string' ? node.name : `Node ${i}`,
      type: typeof node.type === 'string' ? node.type : 'unknown',
      parameters: typeof node.parameters === 'object' && node.parameters !== null
        ? (node.parameters as Record<string, unknown>)
        : {},
      credentials: typeof node.credentials === 'object' && node.credentials !== null
        ? (node.credentials as Record<string, { id: string; name: string }>)
        : undefined,
      position: Array.isArray(node.position) ? node.position as [number, number] : [0, 0],
    };
  });

  // 3. Cap at 100 nodes
  if (nodes.length > MAX_N8N_NODES) {
    return {
      ok: false,
      error: `Workflow has ${nodes.length} nodes, which exceeds the ${MAX_N8N_NODES}-node import limit. Please split the workflow or use the manual conversion path.`,
    };
  }

  // 4. Parse connections
  // n8n connection format: { connections: { [sourceNodeName]: { main: [[{ node, type, index }]] } } }
  const connections: N8nConnection[] = [];
  const nodeByName = new Map<string, N8nNode>();
  for (const n of nodes) nodeByName.set(n.name, n);

  if (wf.connections && typeof wf.connections === 'object' && !Array.isArray(wf.connections)) {
    const conns = wf.connections as Record<string, {
      main?: Array<Array<{ node: string; type: string; index: number }>>;
    }>;
    for (const [sourceName, outputs] of Object.entries(conns)) {
      const sourceNode = nodeByName.get(sourceName);
      if (!sourceNode) continue;
      const mainOutputs = outputs.main ?? [];
      mainOutputs.forEach((outputGroup, outputIdx) => {
        for (const target of (outputGroup ?? [])) {
          const targetNode = nodeByName.get(target.node);
          if (!targetNode) continue;
          connections.push({
            source: sourceNode.id,
            sourceOutput: outputIdx,
            target: targetNode.id,
            targetInput: target.index ?? 0,
          });
        }
      });
    }
  }

  // 5. Cycle detection + topological sort
  const sortResult = topologicalSort(nodes, connections);
  if ('error' in sortResult) {
    return { ok: false, error: sortResult.error };
  }
  const sortedNodes = sortResult.order;

  // 6. Identify trigger nodes
  const triggers = sortedNodes.filter((n) => {
    const key = normaliseNodeType(n.type);
    return N8N_NODE_MAP[key]?.isTrigger === true;
  });

  // 7. Identify disconnected non-trigger nodes
  const connectedIds = new Set<string>();
  for (const c of connections) {
    connectedIds.add(c.source);
    connectedIds.add(c.target);
  }
  const disconnectedNonTriggerIds = new Set<string>(
    sortedNodes
      .filter((n) => {
        const key = normaliseNodeType(n.type);
        const isTrigger = N8N_NODE_MAP[key]?.isTrigger === true;
        return !isTrigger && !connectedIds.has(n.id);
      })
      .map((n) => n.id)
  );

  // 8. Map each node to a step
  const steps: MappedStep[] = [];
  const report: MappingReportRow[] = [];
  const allCredentialRefs: Array<{ provider: string; id: string; name: string }> = [];

  for (const node of sortedNodes) {
    const shortKey = normaliseNodeType(node.type);

    // Disconnected non-trigger → high-severity warning, omit from steps
    if (disconnectedNonTriggerIds.has(node.id)) {
      report.push({
        n8nNodeId: node.id,
        n8nNodeName: node.name,
        n8nNodeType: shortKey,
        mappedStepId: null,
        mappedStepType: null,
        confidence: 'low',
        actionRequired: 'rewrite',
        warning: {
          severity: 'high',
          message: `Node "${node.name}" has no inbound or outbound connections and has been omitted from the draft playbook. Wire it up, hand-convert it, or discard it before saving.`,
        },
      });
      continue;
    }

    // Unconvertible node types (function / code)
    if (UNCONVERTIBLE_TYPES.has(shortKey)) {
      const todoMsg = `TODO: node "${node.name}" (${shortKey}) contains arbitrary code and cannot be automatically converted. Rewrite the logic as a Synthetos skill or omit this branch.`;
      const step: MappedStep = {
        id: stepIdFromNode(node),
        name: node.name,
        stepType: 'user_input',
        sideEffectClass: 'review',
        confidence: 'low',
        todo: todoMsg,
      };
      steps.push(step);
      report.push({
        n8nNodeId: node.id,
        n8nNodeName: node.name,
        n8nNodeType: shortKey,
        mappedStepId: step.id,
        mappedStepType: 'user_input',
        confidence: 'low',
        actionRequired: 'rewrite',
        notes: todoMsg,
      });
      continue;
    }

    const mapping = N8N_NODE_MAP[shortKey];
    const credRefs = extractCredentialRefs(node);
    if (credRefs.length > 0) allCredentialRefs.push(...credRefs);

    if (!mapping) {
      // Unknown node type → user_input step with TODO
      const todoMsg = `TODO: unknown n8n node type "${node.type}". Map this step to an appropriate Synthetos skill before saving.`;
      const step: MappedStep = {
        id: stepIdFromNode(node),
        name: node.name,
        stepType: 'user_input',
        sideEffectClass: 'review',
        confidence: 'low',
        todo: todoMsg,
        credentialRefs: credRefs.length > 0 ? credRefs : undefined,
      };
      steps.push(step);
      report.push({
        n8nNodeId: node.id,
        n8nNodeName: node.name,
        n8nNodeType: shortKey,
        mappedStepId: step.id,
        mappedStepType: 'user_input',
        confidence: 'low',
        actionRequired: 'rewrite',
        notes: todoMsg,
      });
      continue;
    }

    const sideEffectClass = inferSideEffectClass(node, shortKey);
    const step: MappedStep = {
      id: stepIdFromNode(node),
      name: node.name,
      stepType: mapping.stepType,
      sideEffectClass,
      confidence: mapping.confidence,
      skill: mapping.skill,
      credentialRefs: credRefs.length > 0 ? credRefs : undefined,
    };

    // LLM nodes: preserve model selection as comment
    if (mapping.stepType === 'prompt') {
      const modelId = (node.parameters.model ?? node.parameters.modelId ?? null);
      if (modelId) {
        step.model = `/* n8n model: ${String(modelId)} — Synthetos routes to best available */`;
      }
    }

    steps.push(step);

    const actionRequired: ActionRequired =
      mapping.confidence === 'high' ? 'none' :
      mapping.confidence === 'medium' ? 'review' :
      'rewrite';

    report.push({
      n8nNodeId: node.id,
      n8nNodeName: node.name,
      n8nNodeType: shortKey,
      mappedStepId: step.id,
      mappedStepType: mapping.stepType,
      confidence: mapping.confidence,
      actionRequired,
      notes: mapping.notes,
    });
  }

  // Deduplicate credential refs by (provider, id)
  const seen = new Set<string>();
  const credentialChecklist = allCredentialRefs.filter((r) => {
    const key = `${r.provider}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ok: true,
    workflowName,
    steps,
    report,
    credentialChecklist,
  };
}

/**
 * renderMappingReport — converts a report row array to a Markdown table
 * for display in the Studio chat. Rows with high-severity warnings are
 * prefixed with ⚠.
 */
export function renderMappingReport(report: MappingReportRow[]): string {
  const header = '| Node | Type | Step | Confidence | Action Required | Notes |\n|---|---|---|---|---|---|';
  const rows = report.map((r) => {
    const warn = r.warning?.severity === 'high' ? '⚠ ' : '';
    const stepType = r.mappedStepType ?? '—';
    const notes = r.warning?.message ?? r.notes ?? '';
    return `| ${warn}${r.n8nNodeName} | ${r.n8nNodeType} | ${stepType} | ${r.confidence} | ${r.actionRequired} | ${notes} |`;
  });
  return [header, ...rows].join('\n');
}
