/**
 * toolCallsLogProjectionService — Sprint 3 P2.1 Sprint 3A impure wrapper.
 *
 * Thin service layer around the pure projection helper. Reads every
 * `agent_run_messages` row for a run (in ascending `sequence_number`
 * order), passes them through `projectToolCallsLog`, and returns the
 * legacy-shaped log entries the dashboard still reads.
 *
 * Sprint 3A wires this in at run completion, alongside the inline
 * writer the existing loop uses. Sprint 3B removes the inline writer
 * and relies on the projection as the sole source of truth for the
 * legacy blob.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.1.
 */

import { streamMessages } from './agentRunMessageService.js';
import {
  projectToolCallsLog,
  type ProjectedToolCallLogEntry,
} from './toolCallsLogProjectionServicePure.js';

/**
 * Load every message for a run and project it to the legacy
 * `toolCallsLog` array. Must be called inside an active `withOrgTx`
 * block (it reuses `streamMessages` which uses `getOrgScopedDb`).
 *
 * `organisationId` is a required argument and layered into the read
 * predicate by `streamMessages` for defence-in-depth against ALS
 * misconfiguration — the same convention every other service in the
 * codebase uses on top of RLS.
 */
export async function project(
  runId: string,
  organisationId: string,
): Promise<ProjectedToolCallLogEntry[]> {
  const rows = await streamMessages(runId, organisationId, {});
  return projectToolCallsLog(
    rows.map((row) => ({
      sequenceNumber: row.sequenceNumber,
      role: row.role,
      content: row.content,
    })),
  );
}
