/**
 * Pure helper — deep-merge a partial patch into an existing SupportInboxAgentConfig.
 * NESTED_KEYS get shallow-merged; all other fields are replaced at the top level.
 */

const NESTED_KEYS = ['collisionWindow', 'draftExpiry', 'optIns'] as const;

export function mergeAgentConfigPatch(
  existingConfig: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existingConfig, ...patch };
  for (const key of NESTED_KEYS) {
    if (patch[key] != null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      merged[key] = { ...(existingConfig[key] as object), ...(patch[key] as object) };
    }
  }
  return merged;
}
