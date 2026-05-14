import type { SkillHandler } from '../context.js';
import { proposeReviewGatedAction } from '../gating.js';

export const reviewGatedProposerHandlers: Record<string, SkillHandler> = {
  send_email: async (input, context) => {
    return proposeReviewGatedAction('send_email', input, context);
  },

  update_record: async (input, context) => {
    return proposeReviewGatedAction('update_record', input, context);
  },

  request_approval: async (input, context) => {
    return proposeReviewGatedAction('request_approval', input, context);
  },

  write_spec: async (input, context) => {
    return proposeReviewGatedAction('write_spec', input, context);
  },

  publish_post: async (input, context) => {
    return proposeReviewGatedAction('publish_post', input, context);
  },

  update_bid: async (input, context) => {
    return proposeReviewGatedAction('update_bid', input, context);
  },

  update_copy: async (input, context) => {
    return proposeReviewGatedAction('update_copy', input, context);
  },

  pause_campaign: async (input, context) => {
    return proposeReviewGatedAction('pause_campaign', input, context);
  },

  increase_budget: async (input, context) => {
    return proposeReviewGatedAction('increase_budget', input, context);
  },

  update_financial_record: async (input, context) => {
    return proposeReviewGatedAction('update_financial_record', input, context);
  },

  create_lead_magnet: async (input, context) => {
    return proposeReviewGatedAction('create_lead_magnet', input, context);
  },

  deliver_report: async (input, context) => {
    return proposeReviewGatedAction('deliver_report', input, context);
  },

  configure_integration: async (input, context) => {
    return proposeReviewGatedAction('configure_integration', input, context);
  },

  propose_doc_update: async (input, context) => {
    return proposeReviewGatedAction('propose_doc_update', input, context);
  },

  write_docs: async (input, context) => {
    return proposeReviewGatedAction('write_docs', input, context);
  },
};
