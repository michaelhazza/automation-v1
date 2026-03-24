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

      if (skill.instructions) {
        instructions.push(skill.instructions);
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

      if (existing.length > 0) continue;

      await db.insert(skills).values({
        organisationId: null,
        name: def.name,
        slug: def.slug,
        description: def.description,
        skillType: 'built_in',
        definition: def.definition,
        instructions: def.instructions,
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
    },
  ];
}
