// ---------------------------------------------------------------------------
// Per-block deep-link prompt builder (spec §9.3). Consistent prompt shape
// across all 10 block cards so the agent learns the pattern.
// ---------------------------------------------------------------------------

export function buildBlockContextPrompt(params: {
  block: { path: string; title: string };
  effectiveValue: unknown;
}): string {
  const json = JSON.stringify(params.effectiveValue ?? null, null, 2);
  return `I want to change the ${params.block.title.toLowerCase()} settings. The current values are:\n\n\`\`\`json\n${json}\n\`\`\`\n\nWhat should I consider?`;
}
