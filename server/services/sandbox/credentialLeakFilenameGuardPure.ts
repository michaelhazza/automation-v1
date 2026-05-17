/**
 * credentialLeakFilenameGuardPure.ts — Pure predicate for credential-leak filename detection.
 *
 * Spec §5.3 (SANDBOX-ADV-4.1).
 *
 * No imports — this is a pure predicate over a string.
 */

/**
 * Returns true if the given filename (after lowercasing, backslash→slash normalisation,
 * and double-slash collapse) contains `/workspace/secrets/`, begins with `secrets/`,
 * or contains `..`.
 *
 * Identical to the inline normalisation in sandboxHarvestService.ts:418-425.
 */
export function isCredentialLeakFilename(filename: string): boolean {
  const norm = filename.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/');
  return (
    norm.includes('/workspace/secrets/') ||
    norm.startsWith('secrets/') ||
    norm.includes('..')
  );
}
