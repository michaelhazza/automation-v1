/**
 * BM25 lazy tool loading — Mastra pattern.
 *
 * Exposes two meta-tools the agent can use to discover and activate tools
 * on-demand rather than loading the full catalogue into every system prompt.
 *
 * search_tools: BM25-ranked search over all registered action types
 * load_tool:    Returns the schema for a specific action so the agent can use it
 *
 * The BM25 index is built lazily on first use and cached in-process.
 */

// Minimal context type — avoids circular dependency with skillExecutor
interface MetaToolContext {
  runId: string;
  subaccountId: string;
  organisationId: string;
}

// We use dynamic import for the ESM-only wink-bm25-text-search package
// so we can lazy-initialise it without affecting startup time.
let bm25Instance: unknown = null;
let indexedSlugs: string[] = [];

interface BM25Result { ref: string; score: number }

async function getBM25(slugs: string[], descriptions: Record<string, string>): Promise<{ search: (query: string, limit: number) => BM25Result[] }> {
  if (bm25Instance && indexedSlugs.join(',') === slugs.join(',')) {
    return bm25Instance as { search: (query: string, limit: number) => BM25Result[] };
  }

  // Dynamic import to avoid ESM/CJS issues
  const BM25 = (await import('wink-bm25-text-search')).default;
  const engine = BM25();
  engine.defineConfig({ fldWeights: { name: 0.3, description: 0.7 } });
  engine.definePrepTasks([
    (t: string) => t.toLowerCase(),
    (t: string) => t.replace(/[^a-z0-9\s_]/g, ' '),
    (t: string) => t.trim(),
  ]);

  for (const slug of slugs) {
    engine.addDoc(
      { name: slug.replace(/_/g, ' '), description: descriptions[slug] ?? slug },
      slug,
    );
  }
  engine.consolidate();

  bm25Instance = engine;
  indexedSlugs = slugs;
  return engine as { search: (query: string, limit: number) => BM25Result[] };
}

/** All registered action slugs with their descriptions (sourced from actionRegistry) */
function getRegisteredTools(): { slug: string; description: string; gateLevel: string }[] {
  // Import inline to avoid circular dependency at module load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ACTION_REGISTRY } = require('../../config/actionRegistry.js') as {
    ACTION_REGISTRY: Record<string, { actionType: string; defaultGateLevel: string }>;
  };

  return Object.values(ACTION_REGISTRY).map((def) => ({
    slug: def.actionType,
    description: `${def.actionType.replace(/_/g, ' ')} (${def.defaultGateLevel})`,
    gateLevel: def.defaultGateLevel,
  }));
}

// ---------------------------------------------------------------------------
// search_tools — BM25 keyword search over all registered action types
// ---------------------------------------------------------------------------

export async function executeSearchTools(
  input: Record<string, unknown>,
  _context: MetaToolContext,
): Promise<unknown> {
  const query = String(input.query ?? '');
  if (!query.trim()) {
    return { success: false, error: 'query is required' };
  }

  const tools = getRegisteredTools();
  const descriptions: Record<string, string> = {};
  for (const t of tools) descriptions[t.slug] = t.description;

  const engine = await getBM25(tools.map(t => t.slug), descriptions);
  const results = engine.search(query, 5);

  const slugSet = new Set(results.map((r: BM25Result) => r.ref));
  const matched = tools.filter(t => slugSet.has(t.slug));

  return {
    success: true,
    tools: matched.map(t => ({
      slug: t.slug,
      description: t.description,
      gate_level: t.gateLevel,
    })),
  };
}

// ---------------------------------------------------------------------------
// load_tool — returns the full schema for a named action type
// ---------------------------------------------------------------------------

export async function executeLoadTool(
  input: Record<string, unknown>,
  _context: MetaToolContext,
): Promise<unknown> {
  const toolSlug = String(input.tool_slug ?? '');
  if (!toolSlug) {
    return { success: false, error: 'tool_slug is required' };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActionDefinition } = require('../../config/actionRegistry.js') as {
    getActionDefinition: (s: string) => unknown | undefined;
  };

  const def = getActionDefinition(toolSlug);
  if (!def) {
    return { success: false, error: `Unknown tool: ${toolSlug}` };
  }

  return { success: true, tool: def };
}
