/**
 * sensitiveConfigPathsRegistry — module-declared set of operational_config
 * dot-paths whose writes must route through the action→review queue.
 *
 * Per spec §3.6 (tasks/builds/clientpulse/session-1-foundation-spec.md):
 * each module contributes its sensitive paths via `registerSensitiveConfigPaths`
 * at module-init time (imported once at server startup). The core config-agent
 * service reads the merged set via `getAllSensitiveConfigPaths()`.
 *
 * The registry is append-only within a process lifetime: paths can be added,
 * never silently removed. Removal requires a deliberate code change +
 * deployment.
 *
 * Closes contract (n) / locked-registry pattern from spec §1.3.
 */

const registeredPaths = new Set<string>();

export function registerSensitiveConfigPaths(_moduleSlug: string, paths: readonly string[]): void {
  for (const p of paths) registeredPaths.add(p);
}

export function getAllSensitiveConfigPaths(): readonly string[] {
  return Array.from(registeredPaths);
}

export function isSensitiveConfigPath(path: string): boolean {
  for (const sensitive of registeredPaths) {
    if (path === sensitive || path.startsWith(sensitive + '.')) return true;
  }
  return false;
}

/**
 * Test-only — reset the registered set. Never call from production code.
 */
export function __resetSensitiveConfigPathsRegistryForTests(): void {
  registeredPaths.clear();
}
