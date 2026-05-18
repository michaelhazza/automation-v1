// Feature flag helpers — reads environment variables at call time, not at module load.
// This file must not import from server/ internals (db, services, routes, lib).

export function parseBooleanEnv(name: string): boolean {
  const value = process.env[name];
  if (value === undefined) return false;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

export function getMemoryConsolidationTierEnabled(): boolean {
  return parseBooleanEnv('MEMORY_CONSOLIDATION_TIER_ENABLED');
}
