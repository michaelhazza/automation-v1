import type { SkillHandler } from '../context.js';

export const digestHandlers: Record<string, SkillHandler> = {
  weekly_digest_gather: async (input) => {
    const { executeWeeklyDigestGather } = await import('../../../tools/internal/weeklyDigestGather.js');
    return executeWeeklyDigestGather(input);
  },
  smart_skip_from_website: async (_input, _context) => {
    return { success: false, error: 'smart_skip_from_website is not yet implemented' };
  },
  canonical_dictionary: async (input, _context) => {
    const { CANONICAL_DICTIONARY_REGISTRY } = await import('../../canonicalDictionary/canonicalDictionaryRegistry.js');
    const { renderDictionary } = await import('../../canonicalDictionary/canonicalDictionaryRendererPure.js');
    const tableFilter = input.tableFilter as string[] | undefined;
    const includeExamples = (input.includeExamples as boolean) ?? false;
    return {
      success: true,
      result: renderDictionary(CANONICAL_DICTIONARY_REGISTRY, { tableFilter, includeExamples }),
    };
  },
};
