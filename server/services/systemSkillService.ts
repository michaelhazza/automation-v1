import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemSkills } from '../db/schema/index.js';
import type { AnthropicTool } from './llmService.js';

// ---------------------------------------------------------------------------
// System Skill Service — manages platform-level skills (our IP)
// These skills handle task board interactions and core agent capabilities.
// Never exposed in the org-level skills UI.
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export const systemSkillService = {
  async listSkills() {
    return db
      .select()
      .from(systemSkills)
      .orderBy(systemSkills.name);
  },

  async listActiveSkills() {
    return db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.isActive, true))
      .orderBy(systemSkills.name);
  },

  async getSkill(id: string) {
    const [skill] = await db.select().from(systemSkills).where(eq(systemSkills.id, id));
    if (!skill) throw { statusCode: 404, message: 'System skill not found' };
    return skill;
  },

  async getSkillBySlug(slug: string) {
    const [skill] = await db
      .select()
      .from(systemSkills)
      .where(and(eq(systemSkills.slug, slug), eq(systemSkills.isActive, true)));
    return skill ?? null;
  },

  /**
   * Resolve an array of system skill slugs into Anthropic tool definitions + prompt instructions.
   */
  async resolveSystemSkills(
    skillSlugs: string[]
  ): Promise<{ tools: AnthropicTool[]; instructions: string[] }> {
    if (!skillSlugs || skillSlugs.length === 0) return { tools: [], instructions: [] };

    const tools: AnthropicTool[] = [];
    const instructions: string[] = [];

    for (const slug of skillSlugs) {
      const skill = await this.getSkillBySlug(slug);
      if (!skill) continue;

      const def = skill.definition as { name: string; description: string; input_schema: AnthropicTool['input_schema'] };
      if (def && def.name) {
        tools.push({
          name: def.name,
          description: def.description,
          input_schema: def.input_schema,
        });
      }

      const parts: string[] = [];
      if (skill.instructions) parts.push(skill.instructions);
      if (skill.methodology) parts.push(skill.methodology);
      if (parts.length > 0) {
        instructions.push(parts.join('\n\n'));
      }
    }

    return { tools, instructions };
  },

  async createSkill(data: {
    name: string;
    slug?: string;
    description?: string;
    definition: object;
    instructions?: string;
    methodology?: string;
  }) {
    const slug = data.slug || slugify(data.name);

    const [skill] = await db
      .insert(systemSkills)
      .values({
        name: data.name,
        slug,
        description: data.description ?? null,
        definition: data.definition,
        instructions: data.instructions ?? null,
        methodology: data.methodology ?? null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return skill;
  },

  async updateSkill(id: string, data: Partial<{
    name: string;
    description: string;
    definition: object;
    instructions: string;
    methodology: string;
    isActive: boolean;
  }>) {
    const [existing] = await db.select().from(systemSkills).where(eq(systemSkills.id, id));
    if (!existing) throw { statusCode: 404, message: 'System skill not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.definition !== undefined) update.definition = data.definition;
    if (data.instructions !== undefined) update.instructions = data.instructions;
    if (data.methodology !== undefined) update.methodology = data.methodology;
    if (data.isActive !== undefined) update.isActive = data.isActive;

    const [updated] = await db.update(systemSkills).set(update).where(eq(systemSkills.id, id)).returning();
    return updated;
  },

  async deleteSkill(id: string) {
    const [existing] = await db.select().from(systemSkills).where(eq(systemSkills.id, id));
    if (!existing) throw { statusCode: 404, message: 'System skill not found' };

    await db.delete(systemSkills).where(eq(systemSkills.id, id));
    return { message: 'System skill deleted' };
  },

  /**
   * Seed system skills from built-in definitions (idempotent).
   * Migrates existing built-in skills from the skills table to system_skills.
   */
  async seedSystemSkills() {
    const definitions = getSystemSkillDefinitions();

    for (const def of definitions) {
      const existing = await db
        .select()
        .from(systemSkills)
        .where(eq(systemSkills.slug, def.slug));

      if (existing.length > 0) {
        // Update methodology if changed
        const current = existing[0];
        if (current.methodology !== (def.methodology ?? null) || current.instructions !== (def.instructions ?? null)) {
          await db.update(systemSkills).set({
            instructions: def.instructions ?? null,
            methodology: def.methodology ?? null,
            updatedAt: new Date(),
          }).where(eq(systemSkills.id, current.id));
        }
        continue;
      }

      await db.insert(systemSkills).values({
        name: def.name,
        slug: def.slug,
        description: def.description,
        definition: def.definition,
        instructions: def.instructions ?? null,
        methodology: def.methodology ?? null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// System skill definitions — task board interaction skills
// These are the core skills every system agent gets by default.
// ---------------------------------------------------------------------------

function getSystemSkillDefinitions() {
  return [
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
- **Progress**: Log meaningful progress updates as you work, not just at the end.
- **Findings**: When you discover something relevant to a task, log it immediately.
- **Blockers**: If you cannot complete something, log a "blocked" activity explaining why.
- **Completion**: Always log a "completed" activity with a summary before moving a task to review/done.

### Quality Standards
- Be specific and actionable. Include data and evidence, not just conclusions.
- Write for your team — assume the reader has context on the task but not on what you just did.

### Decision Rules
- **One activity per logical step**: Do not batch everything into a single activity at the end.
- **Do not duplicate**: Check existing activities before writing.
- **Link to deliverables**: If your work produced an output, add a deliverable instead of pasting content into an activity message.`,
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
1. **Clear title**: Short, specific, action-oriented.
2. **Actionable description**: What needs to be done, expected output, and constraints.
3. **Correct priority**: Use "urgent" only for time-sensitive items with real deadlines.
4. **Appropriate status**: Use "inbox" for unassigned, "assigned" if assigning to an agent, "todo" if planned but unassigned.

### Decision Rules
- **Check for duplicates first**: Always read the workspace before creating a task.
- **One task per deliverable**: Each task should have a single clear outcome.
- **Assign when possible**: If you know which agent should handle a task, assign it.
- **Include a brief for assigned tasks**: The brief gives the assigned agent its instructions.`,
    },
    {
      name: 'Move Task',
      slug: 'move_task',
      description: 'Move a task to a different board column.',
      definition: {
        name: 'move_task',
        description: 'Move a task to a different board column. Use this to update the status of work.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to move' },
            status: { type: 'string', description: 'The target column: "todo", "assigned", "in_progress", "review", "acceptance", "done"' },
          },
          required: ['task_id', 'status'],
        },
      },
      instructions: 'Move tasks through the board as you work on them. Move to "in_progress" when starting, "review" when done.',
      methodology: `## Move Task Methodology

### Status Transitions
- **inbox -> todo**: Task triaged and ready to plan.
- **todo -> assigned**: Task assigned to an agent.
- **assigned -> in_progress**: Agent started working.
- **in_progress -> review**: Work complete, ready for human review.
- **review -> acceptance**: Human approved, pending final sign-off.
- **acceptance -> done**: Task fully completed.

### Decision Rules
- **Always log before moving**: Write a progress activity before moving to the next status.
- **Do not skip statuses**: Follow the workflow order.
- **Move to "review" only when there is a deliverable**.`,
    },
    {
      name: 'Add Deliverable',
      slug: 'add_deliverable',
      description: 'Attach a deliverable (output/artifact) to a task.',
      definition: {
        name: 'add_deliverable',
        description: 'Attach a deliverable to a task. Use this to submit your work output — reports, drafts, analysis, recommendations.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to attach the deliverable to' },
            title: { type: 'string', description: 'Title of the deliverable' },
            deliverable_type: { type: 'string', description: 'Type: "artifact" (text content), "url" (link), "file" (file reference)' },
            description: { type: 'string', description: 'The deliverable content.' },
          },
          required: ['task_id', 'title', 'deliverable_type', 'description'],
        },
      },
      instructions: 'When you complete work, always attach the output as a deliverable so it can be reviewed.',
      methodology: `## Add Deliverable Methodology

### Deliverable Types
- **artifact**: Full text content (reports, analysis, drafts). Content goes in the description field.
- **url**: A link to external content. URL goes in the path field.
- **file**: A reference to a generated file.

### Quality Standards
- Title must be descriptive. Content must be complete and stand alone.
- Structure long content with headings, bullet points, and sections.

### Decision Rules
- **One deliverable per output**.
- **Always attach to the right task**.
- **Add deliverable before moving to review**.`,
    },
    {
      name: 'Reassign Task',
      slug: 'reassign_task',
      description: 'Reassign an existing task to another agent.',
      definition: {
        name: 'reassign_task',
        description: 'Reassign an existing task to another agent to continue working on it. This wakes the target agent to start working immediately.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'ID of the task to reassign' },
            assigned_agent_id: { type: 'string', description: 'ID of the agent to assign the task to' },
            handoff_context: { type: 'string', description: 'Context for the next agent — what you did, what they should do next' },
          },
          required: ['task_id', 'assigned_agent_id'],
        },
      },
      instructions: 'You can reassign tasks to other agents on your team. Always provide handoff context.',
      methodology: `## Task Reassignment Methodology

### When to Reassign
- You completed work within your expertise and a different specialist should continue.
- The task explicitly calls for a multi-agent workflow.

### When NOT to Reassign
- You can complete the entire task yourself.
- You're stuck — log the blocker instead.

### Handoff Context Quality
Always include: what you did, key findings, what to do next, where you left off.`,
    },
    {
      name: 'Spawn Sub-Agents',
      slug: 'spawn_sub_agents',
      description: 'Split work into 2-3 parallel sub-tasks executed by agents simultaneously.',
      definition: {
        name: 'spawn_sub_agents',
        description: 'Split work into 2-3 parallel sub-tasks executed by agents simultaneously. Each sub-task gets its own task card and runs in parallel.',
        input_schema: {
          type: 'object',
          properties: {
            sub_tasks: {
              type: 'array',
              description: 'Array of 2-3 sub-tasks to execute in parallel',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Sub-task title' },
                  brief: { type: 'string', description: 'Detailed instructions for the sub-agent' },
                  assigned_agent_id: { type: 'string', description: 'Agent ID from your team roster' },
                },
                required: ['title', 'brief', 'assigned_agent_id'],
              },
            },
          },
          required: ['sub_tasks'],
        },
      },
      instructions: 'You can spawn 2-3 sub-agents to work on tasks in parallel. Results will be returned to you for synthesis.',
      methodology: `## Sub-Agent Spawning Methodology

### When to Spawn
- Task involves researching multiple independent topics.
- Parallel execution would save significant time.
- Each sub-task is self-contained.

### When NOT to Spawn
- Sub-tasks depend on each other — use sequential reassignment.
- Fewer than 2 distinct parallel tracks — just do the work yourself.

### Writing Good Sub-Task Briefs
Make each brief self-contained with all necessary background, expected output format, and clear scope boundaries.`,
    },
    {
      name: 'Trigger Process',
      slug: 'trigger_process',
      description: 'Trigger an automation process/workflow.',
      definition: {
        name: 'trigger_process',
        description: 'Trigger an automation process/workflow. Use this when you need to execute a specific automation.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the process to trigger' },
            process_name: { type: 'string', description: 'The human-readable name of the process' },
            input_data: { type: 'string', description: 'JSON string of input data to pass to the task.' },
            reason: { type: 'string', description: 'Brief explanation of why you are triggering this task' },
          },
          required: ['task_id', 'process_name', 'input_data', 'reason'],
        },
      },
      instructions: null,
      methodology: `## Trigger Process Methodology

### Before Triggering
1. Confirm the process is the right one. Read the name and description carefully.
2. Validate your input data matches what the process expects.
3. Document your reasoning in the reason field.

### Decision Rules
- **Trigger only when justified**: Each process has real-world effects.
- **One trigger per intent**: Do not trigger the same process multiple times for the same reason.
- **Check workspace first**: Before triggering, check if another agent has already triggered this recently.`,
    },
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
Start with a broad query to understand the landscape. Request 5-10 results for a representative spread.

### Phase 2: Targeted Deep-Dive
Based on broad scan results, formulate 2-3 specific follow-up queries. Reduce max_results to 3-5 for focused results.

### Phase 3: Verification & Synthesis
Cross-reference key claims across multiple results. If a critical fact appears in only one source, run a verification query.

### Decision Rules
- **Always search** when: dates, prices, current events, competitor activity, or anything time-sensitive.
- **Search before asserting** when: not fully confident in a specific fact or statistic.
- **Multiple queries** when: topic has multiple dimensions.
- **Skip search** when: information is clearly within training data and does not change.`,
    },
  ];
}
