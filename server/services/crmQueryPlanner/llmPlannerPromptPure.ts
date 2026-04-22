// LLM Planner — pure prompt builder (spec §10.2)
// Assembles the system + user message pair for Stage 3.

import type { NormalisedIntent } from '../../../shared/types/crmQueryPlanner.js';
import type { ProviderMessage } from '../providers/types.js';
import type { CanonicalQueryRegistry } from '../../../shared/types/crmQueryPlanner.js';

// ── Draft plan schema description (inline — the LLM follows this shape) ─────

const DRAFT_PLAN_SCHEMA = `
{
  "source": "canonical" | "live" | "hybrid",
  "intentClass": "list_entities" | "count_entities" | "aggregate" | "lookup" | "trend_request" | "segment_request" | "unsupported",
  "primaryEntity": "contacts" | "opportunities" | "appointments" | "conversations" | "revenue" | "tasks",
  "relatedEntities": ["contacts" | "opportunities" | ...],  // optional
  "filters": [
    { "field": "<fieldName>", "operator": "eq"|"ne"|"in"|"nin"|"gt"|"gte"|"lt"|"lte"|"contains"|"starts_with"|"is_null"|"is_not_null"|"between", "value": <any>, "humanLabel": "<readable filter description>" }
  ],
  "sort": [{ "field": "<fieldName>", "direction": "asc"|"desc" }],  // optional
  "limit": <number 1-500>,
  "projection": ["<fieldName>", ...],  // optional
  "aggregation": {  // optional
    "type": "count"|"sum"|"avg"|"group_by",
    "field": "<fieldName>",  // for sum/avg
    "groupBy": ["<fieldName>", ...]  // for group_by
  },
  "dateContext": {  // optional
    "kind": "relative"|"absolute",
    "from": "<ISO 8601>",  // optional
    "to": "<ISO 8601>",    // optional
    "description": "<human-readable>"  // optional
  },
  "canonicalCandidateKey": "<registryKey>" | null,  // set if the intent could be served by a canonical entry
  "confidence": <number 0..1>,  // your confidence the plan correctly interprets the intent
  "hybridPattern": "canonical_base_with_live_filter",  // only if source=hybrid
  "clarificationNeeded": true | false,  // optional — true if intent is ambiguous
  "clarificationPrompt": "<what to ask the user>"  // optional — if clarificationNeeded
}
`.trim();

// ── System prompt body ────────────────────────────────────────────────────────

function buildRegistrySection(registry: CanonicalQueryRegistry): string {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(registry)) {
    lines.push(`  - ${key}: ${entry.description} (entity: ${entry.primaryEntity})`);
  }
  return lines.join('\n');
}

function buildSystemPrompt(
  registry: CanonicalQueryRegistry,
  schemaContextText: string,
): string {
  return `You are a CRM Query Planner. Convert the user's intent into a structured QueryPlan JSON object.

RULES:
- Prefer canonical sources when the question matches one of the canonical registry keys below.
  Set source="canonical" and canonicalCandidateKey to the matching key.
- For hybrid questions (one canonical base + one live-only field filter), set source="hybrid"
  with hybridPattern="canonical_base_with_live_filter" and canonicalCandidateKey.
- For questions requiring live data not in the registry, set source="live".
- For questions that cannot be expressed with available entities/fields, set intentClass="unsupported"
  and include a clarificationPrompt. Leave source set to the closest plausible value.
- Always include a confidence score (0..1). Low confidence (<0.6) indicates the plan may not
  exactly match the user's intent.
- Default limit is 50. Maximum is 500.
- Respond ONLY with valid JSON matching the schema below. No markdown fences, no explanation.

CANONICAL REGISTRY:
${buildRegistrySection(registry)}

AVAILABLE SCHEMA:
${schemaContextText || '(no schema available — use common CRM field names)'}

RESPONSE FORMAT (JSON):
${DRAFT_PLAN_SCHEMA}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PromptInput {
  intent: NormalisedIntent;
  registry: CanonicalQueryRegistry;
  schemaContextText: string;
}

export function buildPrompt(input: PromptInput): ProviderMessage[] {
  const { intent, registry, schemaContextText } = input;
  const system = buildSystemPrompt(registry, schemaContextText);
  // Truncate rawIntent at 2 000 chars (safety — spec §10.5)
  const rawIntent = intent.rawIntent.slice(0, 2000);
  return [
    // The system prompt is passed via routeCall's `system` param; here we
    // embed it as the first message so tests can inspect it without
    // needing to wire a full routeCall mock. The production llmPlanner.ts
    // extracts the system message and passes it as `system:` to the router.
    {
      role: 'user' as const,
      content: `__SYSTEM__:${system}\n__USER__:${rawIntent}`,
    },
  ];
}

// Helper for tests: extract just the system portion from the packed message.
export function extractSystemAndUser(messages: ProviderMessage[]): {
  system: string;
  user: string;
} {
  const raw = typeof messages[0]?.content === 'string' ? messages[0].content : '';
  const sysIdx = raw.indexOf('__SYSTEM__:');
  const usrIdx = raw.indexOf('\n__USER__:');
  if (sysIdx === -1 || usrIdx === -1) return { system: '', user: raw };
  return {
    system: raw.slice(sysIdx + '__SYSTEM__:'.length, usrIdx),
    user: raw.slice(usrIdx + '\n__USER__:'.length),
  };
}

export { buildSystemPrompt, buildRegistrySection };
