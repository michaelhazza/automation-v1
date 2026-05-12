/**
 * ieeDevBackendPure — pure classification helper for the iee_dev adapter.
 *
 * Spec B §18.2, §7.2. This is the ONLY producer of dispatch-class verdicts
 * for the iee_dev adapter. No I/O, no DB, no side effects.
 *
 * Runnable tests:
 *   npx vitest run server/services/executionBackends/__tests__/ieeDevBackendPure.test.ts
 */

import type { DevTaskPayload } from '../../../shared/iee/jobPayload.js';

/**
 * Execution class returned by classifyExecutionClass.
 *
 *  - 'sandbox'              → SandboxExecutionService.runTask (Tier 4).
 *  - 'worker_orchestration' → deterministic internal orchestration in the worker.
 *  - 'worker_trusted'       → Tier 5 trusted repo / dev operations in the worker.
 */
export type ExecutionClass = 'sandbox' | 'worker_orchestration' | 'worker_trusted';

/**
 * Classify a DevTaskPayload into its dispatch class.
 *
 * Decision table (spec §7.2, hard-cut — no "small script" exception):
 *
 *   Customer-uploaded data parsing         → sandbox
 *   LLM-emitted scripts over customer data → sandbox
 *   Customer-derived transformation logic  → sandbox
 *   Deterministic internal orchestration   → worker_orchestration
 *   Trusted repo / dev operations          → worker_trusted
 *
 * V1 implementation: all DevTaskPayload tasks are Tier 5 trusted repo/dev
 * operations (git checkout, build commands, test runs against a controlled
 * repo). No DevTaskPayload variant today carries customer-derived code or
 * LLM-emitted scripts that act on customer data — those future task variants
 * will extend the payload schema with an explicit discriminator and update
 * this function accordingly.
 *
 * The function is the single source of dispatch-class truth. The
 * verify-sandbox-classification CI gate (C14) enforces that any code path
 * reaching a runtime call for customer-derived input passes through here.
 */
export function classifyExecutionClass(_task: DevTaskPayload): ExecutionClass {
  // V1: all DevTaskPayload variants are trusted repo/dev operations (Tier 5).
  // Customer-data processing tasks (Revenue Ops CSV parsing, Research PDF,
  // LLM-emitted transforms) will carry an explicit payload discriminator
  // (e.g. task.kind === 'data_transform') and update this function to
  // return 'sandbox' for those variants.
  return 'worker_trusted';
}
