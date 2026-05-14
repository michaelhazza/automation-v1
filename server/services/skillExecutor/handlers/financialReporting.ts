import type { SkillHandler } from '../context.js';
import { executeWithActionAudit } from '../gating.js';

export const financialReportingHandlers: Record<string, SkillHandler> = {
  read_revenue: async (input, context) => {
    const revDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const revDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (revDateFrom && revDateTo && new Date(revDateFrom) > new Date(revDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_revenue', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      date_from: revDateFrom,
      date_to: revDateTo,
      total_revenue: null,
      message: 'Accounting/billing integration not configured. Downstream analyse_financials will note data unavailability.',
    }));
  },
  read_expenses: async (input, context) => {
    const expDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const expDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (expDateFrom && expDateTo && new Date(expDateFrom) > new Date(expDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_expenses', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      date_from: expDateFrom,
      date_to: expDateTo,
      total_expenses: null,
      message: 'Accounting integration not configured. Downstream analyse_financials will note data unavailability.',
    }));
  },
};
