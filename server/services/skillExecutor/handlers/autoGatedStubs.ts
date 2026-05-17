import type { SkillHandler } from '../context.js';
import { executeWithActionAudit } from '../gating.js';

export const autoGatedStubHandlers: Record<string, SkillHandler> = {
  search_knowledge_base: async (input, context) => {
    // Auto-gated stub — integration not yet wired
    const searchQuery = typeof input.query === 'string' ? input.query : '';
    const searchCategory = typeof input.intent_category === 'string' ? input.intent_category : undefined;
    return executeWithActionAudit('search_knowledge_base', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      query: searchQuery,
      intent_category: searchCategory ?? null,
      results: [],
      message: 'Knowledge base integration not yet configured. Downstream draft_reply will flag replies as confidence: low.',
    }));
  },

  read_analytics: async (input, context) => {
    // Auto-gated stub — platform integrations not yet wired
    const analyticsplatforms = Array.isArray(input.platforms) ? input.platforms : [];
    const dateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const dateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_analytics', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      platforms: analyticsplatforms,
      date_from: dateFrom,
      date_to: dateTo,
      results: [],
      message: 'Social media analytics integration not yet configured. Downstream skills should handle stub status by noting data unavailability.',
    }));
  },

  read_campaigns: async (input, context) => {
    // Auto-gated stub — ads platform integrations not yet wired
    const adsPlatform = typeof input.platform === 'string' ? input.platform : '';
    const adsDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const adsDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (adsDateFrom && adsDateTo && new Date(adsDateFrom) > new Date(adsDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_campaigns', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      platform: adsPlatform,
      date_from: adsDateFrom,
      date_to: adsDateTo,
      campaigns: [],
      message: `The ${adsPlatform} integration has not been configured. Downstream skills should handle stub status by noting data unavailability.`,
    }));
  },

  enrich_contact: async (input, context) => {
    // Auto-gated stub — enrichment integration not yet wired
    const enrichEmail = typeof input.contact_email === 'string' ? input.contact_email : '';
    return executeWithActionAudit('enrich_contact', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      contact: enrichEmail,
      matched: false,
      fields: {},
      message: 'Data enrichment integration not configured. Downstream draft_sequence should apply generic personalisation.',
    }));
  },
};
