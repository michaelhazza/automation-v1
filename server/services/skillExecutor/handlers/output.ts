import type { SkillHandler } from '../context.js';

export const outputHandlers: Record<string, SkillHandler> = {
  'output.recommend': async (input, context) => {
    if (!context.agentId) {
      return {
        success: false,
        error: 'output.recommend requires an agent execution context (agentId missing)',
      };
    }

    const {
      scope_type,
      scope_id,
      category,
      severity,
      title,
      body,
      evidence,
      action_hint,
      dedupe_key,
    } = input as Record<string, unknown>;

    if (!scope_type || (scope_type !== 'org' && scope_type !== 'subaccount')) {
      return { success: false, error: 'scope_type must be "org" or "subaccount"' };
    }
    if (!scope_id || typeof scope_id !== 'string') {
      return { success: false, error: 'scope_id must be a valid UUID string' };
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(scope_id)) {
      return { success: false, error: 'scope_id must be a valid UUID' };
    }
    if (!severity || !['info', 'warn', 'critical'].includes(severity as string)) {
      return { success: false, error: 'severity must be "info", "warn", or "critical"' };
    }
    if (!category || typeof category !== 'string') {
      return { success: false, error: 'category is required' };
    }
    const categoryParts = (category as string).split('.');
    if (categoryParts.length < 3) {
      return {
        success: false,
        error: 'category must follow <agent_namespace>.<area>.<finding> format (three segments)',
      };
    }
    if (!title || typeof title !== 'string') {
      return { success: false, error: 'title is required' };
    }
    if (!body || typeof body !== 'string') {
      return { success: false, error: 'body is required' };
    }
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return { success: false, error: 'evidence must be a plain object' };
    }
    if (!dedupe_key || typeof dedupe_key !== 'string') {
      return { success: false, error: 'dedupe_key is required' };
    }
    if (action_hint !== undefined && action_hint !== null) {
      if (typeof action_hint !== 'string' || action_hint === '') {
        return { success: false, error: 'action_hint must be null/omitted or a non-empty URI string' };
      }
      const actionHintRegex = /^[a-z][a-z0-9-]*:\/\/[^\s]+$/;
      if (!actionHintRegex.test(action_hint as string)) {
        return {
          success: false,
          error: 'action_hint must match pattern ^[a-z][a-z0-9-]*://[^\\s]+$ (e.g. configuration-assistant://agent/id?focus=budget)',
        };
      }
    }

    const { upsertRecommendation } = await import('../../agentRecommendationsService.js');
    const result = await upsertRecommendation(
      {
        organisationId: context.organisationId,
        agentId: context.agentId,
      },
      {
        scope_type: scope_type as 'org' | 'subaccount',
        scope_id: scope_id as string,
        category: category as string,
        severity: severity as 'info' | 'warn' | 'critical',
        title: title as string,
        body: body as string,
        evidence: evidence as Record<string, unknown>,
        action_hint: (action_hint as string | null | undefined) ?? null,
        dedupe_key: dedupe_key as string,
      },
    );
    return { success: true, ...result };
  },
};
