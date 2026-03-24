import { eq, and, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skills } from '../db/schema/index.js';
import type { AnthropicTool } from './llmService.js';

// ---------------------------------------------------------------------------
// Skill Service — manages the skill library and resolves skills for agents
// ---------------------------------------------------------------------------

export const skillService = {
  /**
   * List skills available to an org (built-in + org-specific)
   */
  async listSkills(organisationId?: string) {
    const conditions = organisationId
      ? or(isNull(skills.organisationId), eq(skills.organisationId, organisationId))
      : isNull(skills.organisationId);

    return db
      .select()
      .from(skills)
      .where(and(conditions, eq(skills.isActive, true)))
      .orderBy(skills.skillType, skills.name);
  },

  async getSkill(id: string) {
    const [skill] = await db.select().from(skills).where(eq(skills.id, id));
    if (!skill) throw { statusCode: 404, message: 'Skill not found' };
    return skill;
  },

  async getSkillBySlug(slug: string, organisationId?: string) {
    // Prefer org-specific skill, fall back to built-in
    const rows = await db
      .select()
      .from(skills)
      .where(and(eq(skills.slug, slug), eq(skills.isActive, true)));

    if (organisationId) {
      const orgSkill = rows.find(s => s.organisationId === organisationId);
      if (orgSkill) return orgSkill;
    }
    const builtIn = rows.find(s => s.organisationId === null);
    return builtIn ?? null;
  },

  /**
   * Resolve an array of skill slugs into Anthropic tool definitions + prompt instructions.
   */
  async resolveSkillsForAgent(
    skillSlugs: string[],
    organisationId: string
  ): Promise<{ tools: AnthropicTool[]; instructions: string[] }> {
    if (!skillSlugs || skillSlugs.length === 0) return { tools: [], instructions: [] };

    const tools: AnthropicTool[] = [];
    const instructions: string[] = [];

    for (const slug of skillSlugs) {
      const skill = await this.getSkillBySlug(slug, organisationId);
      if (!skill) continue;

      const def = skill.definition as { name: string; description: string; input_schema: AnthropicTool['input_schema'] };
      if (def && def.name) {
        tools.push({
          name: def.name,
          description: def.description,
          input_schema: def.input_schema,
        });
      }

      // Combine instructions and methodology into a single guidance block
      const parts: string[] = [];
      if (skill.instructions) parts.push(skill.instructions);
      if (skill.methodology) parts.push(skill.methodology);
      if (parts.length > 0) {
        instructions.push(parts.join('\n\n'));
      }
    }

    return { tools, instructions };
  },

  /**
   * Create a custom skill for an org.
   */
  async createSkill(organisationId: string, data: {
    name: string;
    slug: string;
    description?: string;
    definition: object;
    instructions?: string;
    methodology?: string;
  }) {
    const [skill] = await db
      .insert(skills)
      .values({
        organisationId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        skillType: 'custom',
        definition: data.definition,
        instructions: data.instructions ?? null,
        methodology: data.methodology ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return skill;
  },

  async updateSkill(id: string, organisationId: string, data: Partial<{
    name: string;
    description: string;
    definition: object;
    instructions: string;
    methodology: string;
    isActive: boolean;
  }>) {
    const [existing] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.organisationId, organisationId)));

    if (!existing) throw { statusCode: 404, message: 'Skill not found' };
    if (existing.skillType === 'built_in') throw { statusCode: 400, message: 'Cannot modify built-in skills' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.definition !== undefined) update.definition = data.definition;
    if (data.instructions !== undefined) update.instructions = data.instructions;
    if (data.methodology !== undefined) update.methodology = data.methodology;
    if (data.isActive !== undefined) update.isActive = data.isActive;

    const [updated] = await db.update(skills).set(update).where(eq(skills.id, id)).returning();
    return updated;
  },

  async deleteSkill(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.organisationId, organisationId)));

    if (!existing) throw { statusCode: 404, message: 'Skill not found' };
    if (existing.skillType === 'built_in') throw { statusCode: 400, message: 'Cannot delete built-in skills' };

    await db.delete(skills).where(eq(skills.id, id));
    return { message: 'Skill deleted' };
  },

  /**
   * Seed built-in skills (idempotent — skips if slug already exists)
   */
  async seedBuiltInSkills() {
    const builtInSkills = getBuiltInSkillDefinitions();

    for (const def of builtInSkills) {
      const existing = await db
        .select()
        .from(skills)
        .where(and(isNull(skills.organisationId), eq(skills.slug, def.slug)));

      if (existing.length > 0) {
        // Update existing built-in skill with latest methodology (if changed)
        const current = existing[0];
        if (current.methodology !== (def.methodology ?? null)) {
          await db.update(skills).set({
            methodology: def.methodology ?? null,
            updatedAt: new Date(),
          }).where(eq(skills.id, current.id));
        }
        continue;
      }

      await db.insert(skills).values({
        organisationId: null,
        name: def.name,
        slug: def.slug,
        description: def.description,
        skillType: 'built_in',
        definition: def.definition,
        instructions: def.instructions,
        methodology: def.methodology ?? null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in skill definitions
// ---------------------------------------------------------------------------

function getBuiltInSkillDefinitions() {
  return [
    {
      name: 'Web Search',
      slug: 'web_search',
      description: 'Search the web for current information using Tavily AI search.',
      definition: {
        name: 'web_search',
        description: 'Search the web for current information. Use this when you need to find up-to-date facts, news, competitor information, or any real-time data.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            max_results: { type: 'number', description: 'Maximum number of results to return (default 5, max 10)' },
          },
          required: ['query'],
        },
      },
      instructions: 'You have access to web search. Use it to find current information, verify facts, research competitors, or gather data that may not be in your training data.',
      methodology: `## Web Search Methodology

### Phase 1: Broad Scan
Start with a broad query to understand the landscape. Use general terms first to identify what information is available and what angles exist. Request 5-10 results to get a representative spread.

### Phase 2: Targeted Deep-Dive
Based on broad scan results, formulate 2-3 specific follow-up queries targeting the most relevant angles. Use precise terms, names, or phrases discovered in Phase 1. Reduce max_results to 3-5 for focused results.

### Phase 3: Verification & Synthesis
Cross-reference key claims across multiple search results. If a critical fact appears in only one source, run a verification query. Prefer recent results over older ones for time-sensitive information.

### Decision Rules
- **Always search** when: the question involves dates, prices, current events, competitor activity, or anything that changes over time.
- **Search before asserting** when: you are not fully confident in a specific fact, statistic, or claim.
- **Multiple queries** when: the topic has multiple dimensions (e.g. competitor research = products + pricing + reviews + news).
- **Skip search** when: the information is clearly within your training data and does not change (e.g. general concepts, historical facts).

### Quality Bar
- Never present a single search result as authoritative. Always synthesise across results.
- Clearly distinguish between facts found via search and your own analysis/interpretation.
- Note when information may be outdated or when sources conflict.`,
    },
    {
      name: 'Read Workspace',
      slug: 'read_workspace',
      description: 'Read tasks and activities from the shared board.',
      definition: {
        name: 'read_workspace',
        description: 'Read tasks (board cards) and their activities from the shared board. Use this to see what work exists, what other agents have done, and what needs attention.',
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by board column status (e.g. "inbox", "todo", "assigned", "in_progress", "review", "done")' },
            assigned_to_me: { type: 'boolean', description: 'If true, only return tasks assigned to you' },
            limit: { type: 'number', description: 'Maximum tasks to return (default 20)' },
            include_activities: { type: 'boolean', description: 'If true, include recent activity log for each task (default false)' },
          },
          required: [],
        },
      },
      instructions: 'You can read the shared board to see what tasks exist, their status, and what other agents have been working on. Check the board regularly to stay coordinated with the team.',
      methodology: `## Read Workspace Methodology

### Phase 1: Orientation
At the start of every run, read the board without filters to understand the current state. Look at task distribution across columns, identify what has changed since your last run, and note any urgent or blocked items.

### Phase 2: Focused Queries
After orientation, use targeted filters:
- Filter by \`assigned_to_me: true\` to see your current workload.
- Filter by specific statuses to find tasks that need your attention (e.g. "inbox" for new items, "review" for items awaiting feedback).
- Include activities for tasks you plan to work on, to understand their full history.

### Phase 3: Pattern Recognition
Look for patterns across the board:
- Tasks stuck in the same status for a long time may need escalation.
- Clusters of related tasks may indicate a larger initiative.
- Recent activity from other agents may inform your own work.

### Decision Rules
- **Read before writing**: Always check the board state before creating new tasks or updating existing ones, to avoid duplicates.
- **Limit scope**: Use the \`limit\` parameter to avoid pulling excessive data. Start with 20 tasks; only increase if needed.
- **Include activities sparingly**: Only request activities for tasks you intend to act on. Activity logs add significant context volume.`,
    },
    {
      name: 'Write Workspace',
      slug: 'write_workspace',
      description: 'Add an activity entry to a task.',
      definition: {
        name: 'write_workspace',
        description: 'Add a progress note or activity entry to an existing task. Use this to log what you have done, share findings, or update the team.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to add an activity to' },
            activity_type: { type: 'string', description: 'Type of activity: "progress", "note", "completed", "blocked"' },
            message: { type: 'string', description: 'The activity message content' },
          },
          required: ['task_id', 'activity_type', 'message'],
        },
      },
      instructions: 'Always log your progress and findings to tasks so other agents and the team can see what you have done.',
      methodology: `## Write Workspace Methodology

### When to Write
- **Progress**: Log meaningful progress updates as you work, not just at the end. Other agents and team members monitor the activity feed.
- **Findings**: When you discover something relevant to a task (research results, data points, insights), log it immediately so it is not lost.
- **Blockers**: If you cannot complete something, log a "blocked" activity explaining why and what is needed to unblock.
- **Completion**: Always log a "completed" activity with a summary of what was done before moving a task to review/done.

### Quality Standards
- Be specific and actionable. "Researched competitors" is too vague. "Identified 3 key competitors: X, Y, Z. X leads on pricing, Y on features, Z on brand recognition" is useful.
- Include data and evidence, not just conclusions.
- Write for your team — assume the reader has context on the task but not on what you just did.

### Decision Rules
- **One activity per logical step**: Do not batch everything into a single activity at the end. Multiple focused updates are more useful than one long dump.
- **Do not duplicate**: Check existing activities before writing. If the information is already logged, do not re-log it.
- **Link to deliverables**: If your work produced an output, add a deliverable (using add_deliverable) instead of pasting content into an activity message.`,
    },
    {
      name: 'Trigger Process',
      slug: 'trigger_process',
      description: 'Trigger an automation process/workflow via the task execution system.',
      definition: {
        name: 'trigger_process',
        description: 'Trigger an automation process/workflow. Use this when you need to execute a specific automation like sending an email, posting to social media, or updating a CRM.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the process to trigger' },
            process_name: { type: 'string', description: 'The human-readable name of the process' },
            input_data: { type: 'string', description: 'JSON string of input data to pass to the task. Use {} if no input needed.' },
            reason: { type: 'string', description: 'Brief explanation of why you are triggering this task' },
          },
          required: ['task_id', 'process_name', 'input_data', 'reason'],
        },
      },
      instructions: null,
      methodology: `## Trigger Process Methodology

### Before Triggering
1. Confirm the process is the right one for this situation. Read the process name and description carefully.
2. Validate your input data matches what the process expects. Use valid JSON in the input_data field.
3. Document your reasoning — the \`reason\` field exists for audit trail. Be specific about why this process is being triggered now.

### Decision Rules
- **Trigger only when justified**: Each process execution has real-world effects (sending emails, updating CRMs, posting content). Never trigger a process "to test" or "just in case."
- **One trigger per intent**: Do not trigger the same process multiple times for the same reason in a single run.
- **Check workspace first**: Before triggering, check if another agent has already triggered this process recently for the same reason.
- **Handle failures gracefully**: If a trigger returns an error, log the failure to the task board and move on. Do not retry automatically.`,
    },
    {
      name: 'Create Task',
      slug: 'create_task',
      description: 'Create a new task (card) on the workspace board.',
      definition: {
        name: 'create_task',
        description: 'Create a new task (board card). Use this when you identify new work that needs to be done, or when you want to assign a task to another agent.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the work item' },
            description: { type: 'string', description: 'Detailed description of what needs to be done' },
            brief: { type: 'string', description: 'Brief/instructions for the assigned agent' },
            priority: { type: 'string', description: 'Priority level: "low", "normal", "high", "urgent" (default: "normal")' },
            status: { type: 'string', description: 'Initial board column: "inbox", "todo", "assigned" (default: "inbox")' },
            assigned_agent_id: { type: 'string', description: 'ID of the agent to assign this work to (optional)' },
          },
          required: ['title'],
        },
      },
      instructions: 'You can create new tasks to assign work, track new tasks, or flag issues for the team.',
      methodology: `## Create Task Methodology

### Task Quality Checklist
Before creating a task, verify it meets these criteria:
1. **Clear title**: Short, specific, action-oriented. "Draft Q1 competitor analysis report" not "Competitor stuff."
2. **Actionable description**: What needs to be done, what the expected output is, and any relevant context or constraints.
3. **Correct priority**: Use "urgent" only for time-sensitive items with real deadlines. Default to "normal."
4. **Appropriate status**: Use "inbox" for unassigned new work, "assigned" if you are assigning to a specific agent, "todo" if it is planned but unassigned.

### Decision Rules
- **Check for duplicates first**: Always read the workspace before creating a task. If a similar task already exists, update it instead of creating a new one.
- **One task per deliverable**: Each task should have a single clear outcome. If you are identifying multiple pieces of work, create separate tasks.
- **Assign when possible**: If you know which agent should handle a task, assign it. Unassigned tasks may sit in inbox indefinitely.
- **Include a brief for assigned tasks**: The brief field gives the assigned agent its instructions. Without a brief, the agent has to guess what to do.`,
    },
    {
      name: 'Move Task',
      slug: 'move_task',
      description: 'Move a task to a different board column.',
      definition: {
        name: 'move_task',
        description: 'Move a task to a different board column. Use this to update the status of work — for example, moving a task to "in_progress" when you start, or to "review" when you are done.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to move' },
            status: { type: 'string', description: 'The target column: "todo", "assigned", "in_progress", "review", "acceptance", "done"' },
          },
          required: ['task_id', 'status'],
        },
      },
      instructions: 'Move tasks through the board as you work on them. Move to "in_progress" when starting, "review" when done and ready for human review.',
      methodology: `## Move Task Methodology

### Status Transitions
Follow these standard workflow transitions:
- **inbox → todo**: Task has been triaged and is ready to be planned.
- **todo → assigned**: Task has been assigned to a specific agent.
- **assigned → in_progress**: Agent has started working on the task.
- **in_progress → review**: Work is complete and ready for human review.
- **review → acceptance**: Human has reviewed and approved, pending final sign-off.
- **acceptance → done**: Task is fully completed and closed.

### Decision Rules
- **Always log before moving**: Write a progress activity explaining what was accomplished before moving a task to the next status.
- **Do not skip statuses**: Follow the workflow order. Do not jump from "inbox" to "done."
- **Move to "in_progress" at the start of work**: This signals to other agents and the team that someone is actively working on it.
- **Move to "review" only when there is a deliverable**: Do not move to review unless the task has an attached deliverable or a clear completion summary.`,
    },
    {
      name: 'Add Deliverable',
      slug: 'add_deliverable',
      description: 'Attach a deliverable (output/artifact) to a task.',
      definition: {
        name: 'add_deliverable',
        description: 'Attach a deliverable to a task. Use this to submit your work output — reports, drafts, analysis, recommendations, or any structured content that needs human review.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to attach the deliverable to' },
            title: { type: 'string', description: 'Title of the deliverable' },
            deliverable_type: { type: 'string', description: 'Type: "artifact" (text content), "url" (link), "file" (file reference)' },
            description: { type: 'string', description: 'The deliverable content. For artifacts, this is the full content (report, draft, analysis, etc.)' },
          },
          required: ['task_id', 'title', 'deliverable_type', 'description'],
        },
      },
      instructions: 'When you complete work, always attach the output as a deliverable so it can be reviewed. Put the full content in the description field.',
      methodology: `## Add Deliverable Methodology

### Deliverable Types
Choose the correct type for your output:
- **artifact**: Full text content (reports, analysis, drafts, recommendations). The content goes in the description field. Use this for anything the agent produces as text.
- **url**: A link to external content (Google Doc, published post, dashboard). The URL goes in the path field, with a description of what it links to.
- **file**: A reference to a generated file. The file path goes in the path field.

### Quality Standards
- **Title must be descriptive**: "Q1 Competitor Analysis — March 2025" not "Report."
- **Content must be complete**: Do not add a deliverable that says "see above" or references conversation context. The deliverable should stand alone.
- **Structure long content**: Use headings, bullet points, and sections for artifacts longer than a few paragraphs. The deliverable will be read by humans who may not have context on the agent run.

### Decision Rules
- **One deliverable per output**: If your work produced a report and a data summary, create two separate deliverables.
- **Always attach to the right task**: The deliverable must belong to the task it fulfills. Do not attach work to unrelated tasks.
- **Add deliverable before moving to review**: A task in "review" status should always have at least one deliverable attached.`,
    },
  ];
}
