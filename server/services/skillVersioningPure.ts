/** Returns the next skill version number given the current max version (null if no prior version). */
export function computeNextSkillVersion(currentMaxVersion: number | null): number {
  return (currentMaxVersion ?? 0) + 1;
}
