// supportAgentMasterPrompt.ts — runtime loader for the Support Agent master prompt.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.3.2, §5.3.5
//
// The system_agents.master_prompt column stores the literal string
// '{{MASTER_PROMPT_PLACEHOLDER}}' (set at install time by migration 0314).
// At agent run start, this loader reads server/prompts/support-agent-master.md
// from disk, strips the YAML frontmatter, and substitutes runtime placeholders
// against the resolved context so each call sees an inbox-specific prompt.
//
// File contents are read once per process and cached. To pick up a prompt edit
// without a restart, callers may invoke clearMasterPromptCache() (used in
// tests; not exposed via any HTTP surface).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MASTER_PROMPT_PATH = resolve(process.cwd(), 'server/prompts/support-agent-master.md');

let cachedTemplate: string | null = null;

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const closeIndex = raw.indexOf('\n---', 3);
  if (closeIndex === -1) return raw;
  return raw.slice(closeIndex + 4).replace(/^\s+/, '');
}

export function loadMasterPromptTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate;
  const raw = readFileSync(MASTER_PROMPT_PATH, 'utf8');
  cachedTemplate = stripFrontmatter(raw);
  return cachedTemplate;
}

export function clearMasterPromptCache(): void {
  cachedTemplate = null;
}

export interface MasterPromptContext {
  orgName: string;
  subaccountName: string;
  minConfidence: number;
  voiceProfile: string;
  escalationCategories: ReadonlyArray<string>;
}

/**
 * Strip `{{}}` template tokens from a placeholder value so a tenant whose name
 * contains adversarial template syntax cannot inject an additional placeholder
 * expansion or break the prompt's structure. Pure text values pass through.
 */
function safeForTemplate(value: string): string {
  return value.replaceAll('{{', '').replaceAll('}}', '');
}

export function resolveMasterPrompt(context: MasterPromptContext): string {
  const template = loadMasterPromptTemplate();
  const escalationList =
    context.escalationCategories.length > 0
      ? context.escalationCategories.map(safeForTemplate).join(', ')
      : 'none';
  return template
    .replaceAll('{{org_name}}', safeForTemplate(context.orgName))
    .replaceAll('{{subaccount_name}}', safeForTemplate(context.subaccountName))
    .replaceAll('{{min_confidence}}', context.minConfidence.toFixed(2))
    .replaceAll('{{voice_profile}}', safeForTemplate(context.voiceProfile))
    .replaceAll('{{escalation_categories}}', escalationList);
}
