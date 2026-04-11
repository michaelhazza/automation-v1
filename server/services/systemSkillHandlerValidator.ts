import { db } from '../db/index.js';
import { systemSkills } from '../db/schema/systemSkills.js';
import { eq } from 'drizzle-orm';
import { SKILL_HANDLERS } from './skillExecutor.js';
import { findMissingHandlers, SystemSkillHandlerError } from './systemSkillHandlerValidatorPure.js';

export { findMissingHandlers, SystemSkillHandlerError };

// ---------------------------------------------------------------------------
// System Skill Handler Validator
// ---------------------------------------------------------------------------
// Boot-time gate against the "data refers to code" drift that opens the
// moment system_skills rows become editable via the analyzer UI. Every
// active row must reference a handler function that exists in the running
// server process's SKILL_HANDLERS registry (server/services/skillExecutor.ts).
//
// This is called from server/index.ts after the DB connection is established
// but before httpServer.listen() binds the port. A missing-handler condition
// is fail-fast — the server refuses to boot with a clear error listing every
// unregistered handler, so the operator can either add the handler code or
// deactivate the stray skill row before continuing.
//
// Inactive rows (`isActive = false`) are ignored so they can sit in the DB
// as staging entries without blocking startup. An inactive row with an
// unregistered handler is a known edge case handled by the analyzer's §8
// PARTIAL_OVERLAP branch at execute time.
//
// See docs/skill-analyzer-v2-spec.md §10 Phase 0 for the full contract.
// ---------------------------------------------------------------------------

/** Read every active system_skills row, collect its handler_key, and assert
 *  each one resolves to a key in SKILL_HANDLERS. Throws
 *  SystemSkillHandlerError listing every missing key on failure. Resolves
 *  to void on success. Inactive rows are skipped. */
export async function validateSystemSkillHandlers(): Promise<void> {
  const rows = await db
    .select({ handlerKey: systemSkills.handlerKey })
    .from(systemSkills)
    .where(eq(systemSkills.isActive, true));

  const activeKeys = rows.map((r) => r.handlerKey);
  const registeredKeys = Object.keys(SKILL_HANDLERS);
  const missing = findMissingHandlers(activeKeys, registeredKeys);

  if (missing.length > 0) {
    throw new SystemSkillHandlerError(missing);
  }
}
