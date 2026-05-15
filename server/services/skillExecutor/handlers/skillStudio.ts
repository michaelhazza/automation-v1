import type { SkillHandler } from '../context.js';
import * as skillStudioService from '../../skillStudioService.js';

// ── Skill Studio skills (Feature 3) ──────────────────────────────────

export const skillStudioHandlers: Record<string, SkillHandler> = {
  skill_read_existing: async (input, context) => {
    const ctx = await skillStudioService.getSkillStudioContext(
      input.skillId as string, input.scope as 'system' | 'org', context.organisationId,
    );
    if (!ctx) return { success: false, error: 'Skill not found' };
    return { success: true, skill: { id: ctx.id, slug: ctx.slug, name: ctx.name, definition: ctx.definition, instructions: ctx.instructions } };
  },
  skill_read_regressions: async (input, context) => {
    const ctx = await skillStudioService.getSkillStudioContext(
      input.skillId as string ?? '', 'system', context.organisationId,
    );
    return { success: true, regressions: ctx?.regressions ?? [] };
  },
  skill_validate: async (input) => {
    const result = await skillStudioService.validateSkillDefinition(input.definition, input.handlerKey as string);
    return { success: result.valid, ...result };
  },
  skill_simulate: async (input, context) => {
    const results = await skillStudioService.simulateSkillVersion(
      input.definition as object, (input.instructions as string) ?? null,
      (input.regressionCaseIds as string[]) ?? [], context.organisationId,
    );
    return { success: true, results };
  },
  skill_propose_save: async (input, context) => {
    const version = await skillStudioService.saveSkillVersion(
      input.skillId as string, input.scope as 'system' | 'org',
      context.organisationId, {
        name: input.name as string,
        definition: input.definition as object,
        instructions: (input.instructions as string) ?? null,
        changeSummary: (input.changeSummary as string) ?? undefined,
        regressionIds: (input.regressionIds as string[]) ?? undefined,
        simulationPassCount: (input.simulationPassCount as number) ?? 0,
        simulationTotalCount: (input.simulationTotalCount as number) ?? 0,
      }, context.userId ?? '',
    );
    return { success: true, version };
  },
};
