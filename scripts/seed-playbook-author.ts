/**
 * Seed the Playbook Author system agent.
 *
 * Spec: tasks/playbooks-spec.md §10.8.5.
 *
 * Creates (or upserts) a system agent row with:
 *   - slug:                 'playbook-author'
 *   - name:                 'Playbook Author'
 *   - masterPrompt:         loaded from server/agents/playbook-author/master-prompt.md
 *   - defaultSystemSkillSlugs: the 5 Playbook Studio tools
 *
 * The agent is tagged isSystemManaged so org admins cannot edit the
 * masterPrompt — only the additionalPrompt field is editable per tier.
 *
 * Run after migrations + the regular seedPlaybooks pass:
 *   npm run migrate
 *   npm run playbooks:seed
 *   npm run playbooks:seed-author
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '../server/db/index.js';
import { systemAgents } from '../server/db/schema/index.js';

const SLUG = 'playbook-author';
const PROMPT_PATH = resolve(process.cwd(), 'server/agents/playbook-author/master-prompt.md');
const TOOL_SKILLS = [
  'playbook_read_existing',
  'playbook_validate',
  'playbook_simulate',
  'playbook_estimate_cost',
  'playbook_propose_save',
];

async function main(): Promise<void> {
  if (!existsSync(PROMPT_PATH)) {
    console.error(`[playbook-author] master prompt missing at ${PROMPT_PATH}`);
    process.exit(1);
  }
  const masterPrompt = readFileSync(PROMPT_PATH, 'utf8');

  const [existing] = await db
    .select()
    .from(systemAgents)
    .where(eq(systemAgents.slug, SLUG));

  if (!existing) {
    const [created] = await db
      .insert(systemAgents)
      .values({
        name: 'Playbook Author',
        slug: SLUG,
        description:
          'System agent that helps platform admins create new Playbook templates via chat. Uses the 5 Playbook Studio tools (read_existing, validate, simulate, estimate_cost, propose_save) and never writes files itself.',
        masterPrompt,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        temperature: 0.3,
        maxTokens: 8192,
        defaultSystemSkillSlugs: TOOL_SKILLS,
        defaultOrgSkillSlugs: [],
        allowModelOverride: false,
        defaultTokenBudget: 50000,
        defaultMaxToolCalls: 30,
        executionMode: 'api',
        isSystemManaged: true,
        isPublished: true,
      } as never)
      .returning();
    console.log(`[playbook-author] created system agent: ${created.id}`);
    return;
  }

  // Update the master prompt + tool list if they've drifted from the file.
  await db
    .update(systemAgents)
    .set({
      name: 'Playbook Author',
      masterPrompt,
      defaultSystemSkillSlugs: TOOL_SKILLS,
      updatedAt: new Date(),
    } as never)
    .where(eq(systemAgents.id, existing.id));
  console.log(`[playbook-author] updated existing system agent: ${existing.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[playbook-author] fatal:', err);
    process.exit(1);
  });
