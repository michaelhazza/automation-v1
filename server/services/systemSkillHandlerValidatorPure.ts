// ---------------------------------------------------------------------------
// System Skill Handler Validator — pure helpers
// ---------------------------------------------------------------------------
// The DB-touching `validateSystemSkillHandlers` lives in the sibling
// systemSkillHandlerValidator.ts. This file contains the pure kernel that
// can be unit-tested without a database connection.
// ---------------------------------------------------------------------------

export class SystemSkillHandlerError extends Error {
  readonly missingHandlers: string[];

  constructor(missingHandlers: string[]) {
    const lines = [
      'Active system_skills rows reference unregistered handlers:',
      ...missingHandlers.map((k) => `  - ${k}`),
      '',
      'Either register handlers in server/services/skillExecutor.ts SKILL_HANDLERS',
      'or deactivate these skills via UPDATE system_skills SET is_active = false',
      `WHERE handler_key IN (${missingHandlers.map((k) => `'${k}'`).join(', ')}).`,
    ];
    super(lines.join('\n'));
    this.name = 'SystemSkillHandlerError';
    this.missingHandlers = missingHandlers;
  }
}

/** Pure diff helper. Returns the list of handler keys present in `active`
 *  that are NOT present in `registered`. Order is preserved from `active`
 *  for stable error messages. */
export function findMissingHandlers(active: string[], registered: string[]): string[] {
  const registeredSet = new Set(registered);
  return active.filter((key) => !registeredSet.has(key));
}
