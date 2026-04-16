/**
 * Pure (no-DB) helpers for memoryBlockService.
 * Safe to import in tests without a database connection.
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.5
 */

export interface MemoryBlockForPrompt {
  name: string;
  content: string;
  permission: 'read' | 'read_write';
}

/**
 * Format memory blocks for system prompt injection.
 * Returns null if no blocks are attached.
 */
export function formatBlocksForPrompt(blocks: MemoryBlockForPrompt[]): string | null {
  if (blocks.length === 0) return null;

  const sections = blocks.map(
    (b) => `### ${b.name}\n${b.content}`,
  );

  return `## Shared Context\n\n${sections.join('\n\n')}`;
}
