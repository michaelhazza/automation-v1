// ---------------------------------------------------------------------------
// Provider cooldown map — skip recently-failed providers
// ---------------------------------------------------------------------------

const providerCooldowns: Map<string, number> = new Map();

export function isProviderCoolingDown(provider: string): boolean {
  const cooldownUntil = providerCooldowns.get(provider);
  if (!cooldownUntil) return false;
  if (Date.now() > cooldownUntil) {
    providerCooldowns.delete(provider);
    return false;
  }
  return true;
}

export function setProviderCooldown(provider: string, durationMs: number): void {
  providerCooldowns.set(provider, Date.now() + durationMs);
}
