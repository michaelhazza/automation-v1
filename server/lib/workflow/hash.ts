/**
 * SHA256 hash helper for playbook input/output fingerprinting.
 *
 * Spec: tasks/workflows-spec.md §5.4 (output_hash) and §5.5 (input_hash).
 *
 * Both `input_hash` and `output_hash` columns on `workflow_step_runs`
 * store the hex digest of the canonical JSON of the value. The hash is
 * what powers:
 *
 *   - The output-hash firewall pattern: re-execution that produces a
 *     byte-identical output stops invalidation from propagating further
 *     downstream.
 *   - The per-run input-hash reuse path: if the same step is dispatched
 *     with byte-identical inputs to a prior completed attempt, the
 *     engine reuses the previous output instead of dispatching again.
 *
 * Determinism is critical — both producers and consumers must use this
 * same helper so the hash agrees across the engine, the validator, and
 * the studio simulator.
 */

import { createHash } from 'crypto';
import { canonicalJsonStringify } from './canonicalJson.js';

export function hashValue(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex');
}
