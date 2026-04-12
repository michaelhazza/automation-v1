/**
 * Playbook library — barrel export.
 *
 * Spec: tasks/playbooks-spec.md.
 *
 * The Playbook engine, templating, and validator live under
 * server/lib/playbook/. Higher-level orchestration (template service,
 * run service, engine service) lives under server/services/playbook*.
 */

export * from './types.js';
export { definePlaybook } from './definePlaybook.js';
export { canonicalJsonStringify } from './canonicalJson.js';
export { hashValue } from './hash.js';
export {
  resolve,
  renderString,
  resolveInputs,
  extractReferences,
  TemplatingError,
} from './templating.js';
export { validateDefinition, MAX_DAG_DEPTH } from './validator.js';
export {
  agentDecisionOutputBaseSchema,
  agentDecisionBranchSchema,
  composeDecisionOutputSchema,
  decisionStepRunOutputSchema,
} from './agentDecisionSchemas.js';
export type {
  AgentDecisionOutput,
  AgentDecisionBranchValidated,
  DecisionStepRunOutput,
} from './agentDecisionSchemas.js';
export {
  computeSkipSet,
  computeStepReadiness,
  parseDecisionOutput,
  validateDecisionStep,
  renderBranchesTable,
} from './agentDecisionPure.js';
export type {
  StepReadiness,
  StepRunStatus,
  DecisionParseResult,
  DecisionParseError,
  DecisionParseErrorCode,
} from './agentDecisionPure.js';
export {
  renderAgentDecisionEnvelope,
} from './agentDecisionEnvelope.js';
export type { EnvelopeRenderContext } from './agentDecisionEnvelope.js';
