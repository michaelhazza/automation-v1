import type { SkillHandler } from '../context.js';

export const spendShellHandlers: Record<string, SkillHandler> = {
  pay_invoice: async (input, context) => {
    const { executePayInvoice } = await import('../../spendSkillHandlers.js');
    return executePayInvoice(input, context);
  },
  purchase_resource: async (input, context) => {
    const { executePurchaseResource } = await import('../../spendSkillHandlers.js');
    return executePurchaseResource(input, context);
  },
  subscribe_to_service: async (input, context) => {
    const { executeSubscribeToService } = await import('../../spendSkillHandlers.js');
    return executeSubscribeToService(input, context);
  },
  top_up_balance: async (input, context) => {
    const { executeTopUpBalance } = await import('../../spendSkillHandlers.js');
    return executeTopUpBalance(input, context);
  },
  issue_refund: async (input, context) => {
    const { executeIssueRefund } = await import('../../spendSkillHandlers.js');
    return executeIssueRefund(input, context);
  },
};
