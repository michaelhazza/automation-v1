import type { FastPathDecision } from '../../shared/types/briefFastPath.js';
import type {
  BriefChatArtefact,
  BriefStructuredResult,
  BriefErrorResult,
} from '../../shared/types/briefResultContract.js';
import type { ChatTriageInput } from './chatTriageClassifierPure.js';

interface CannedTemplate {
  patterns: RegExp[];
  generate: (text: string) => BriefStructuredResult;
}

function makeCannedResult(
  summary: string,
  entityType: BriefStructuredResult['entityType'],
  rows: Array<Record<string, unknown>>,
): BriefStructuredResult {
  return {
    artefactId: crypto.randomUUID(),
    kind: 'structured',
    summary,
    entityType,
    source: 'stub',
    filtersApplied: [],
    columns: [
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'value', label: 'Value', type: 'string' },
    ],
    rows,
    rowCount: rows.length,
    truncated: false,
    suggestions: [],
    costCents: 0,
    confidence: 0.9,
    confidenceSource: 'deterministic',
    status: 'final',
  };
}

const CANNED_TEMPLATES: CannedTemplate[] = [
  {
    patterns: [/\bpipeline velocity\b/i],
    generate: () => makeCannedResult(
      'Pipeline velocity summary',
      'opportunities',
      [
        { metric: 'Average deal cycle', value: 'See CRM data' },
        { metric: 'Deals closed (MTD)', value: 'See CRM data' },
      ],
    ),
  },
  {
    patterns: [/\bchurn rate\b/i],
    generate: () => makeCannedResult(
      'Churn rate summary',
      'other',
      [{ metric: 'Monthly churn rate', value: 'See CRM data' }],
    ),
  },
  {
    patterns: [/\bmonthly recurring revenue\b/i, /\bMRR\b/],
    generate: () => makeCannedResult(
      'Monthly recurring revenue',
      'revenue',
      [{ metric: 'Current MRR', value: 'See revenue data' }],
    ),
  },
  {
    patterns: [/\bactive contacts\b/i],
    generate: () => ({
      ...makeCannedResult('Active contacts', 'contacts', [
        { metric: 'Active contacts', value: 'See CRM data' },
      ]),
      filtersApplied: [{ field: 'status', operator: 'eq', value: 'active', humanLabel: 'Status is active' }],
    }),
  },
  {
    patterns: [/\bopen opportunities\b/i],
    generate: () => ({
      ...makeCannedResult('Open opportunities', 'opportunities', [
        { metric: 'Open opportunities', value: 'See CRM data' },
      ]),
      filtersApplied: [{ field: 'status', operator: 'eq', value: 'open', humanLabel: 'Status is open' }],
    }),
  },
];

/**
 * Pure generator for simple_reply / cheap_answer fast-path routes.
 * No LLM involvement — deterministic output only.
 */
export function generateSimpleReply(
  decision: FastPathDecision,
  input: ChatTriageInput,
): BriefChatArtefact {
  if (decision.route === 'cheap_answer') {
    for (const tpl of CANNED_TEMPLATES) {
      if (tpl.patterns.some((re) => re.test(input.text))) {
        return tpl.generate(input.text);
      }
    }
    const err: BriefErrorResult = {
      artefactId: crypto.randomUUID(),
      kind: 'error',
      errorCode: 'unsupported_query',
      message: 'This query type is not yet supported in quick-answer mode. Try asking the full Orchestrator.',
      retryable: false,
      suggestions: [
        { kind: 'broaden', label: 'Ask with more context', intent: input.text },
      ],
      status: 'final',
    };
    return err;
  }

  // simple_reply: acknowledge without routing to Orchestrator
  const reply: BriefStructuredResult = {
    artefactId: crypto.randomUUID(),
    kind: 'structured',
    summary: 'Got it',
    entityType: 'other',
    source: 'canonical',
    filtersApplied: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    suggestions: [],
    costCents: 0,
    confidence: decision.confidence,
    confidenceSource: 'deterministic',
    status: 'final',
  };
  return reply;
}
