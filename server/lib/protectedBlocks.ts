/**
 * Protected memory block names — blocks that cannot be deleted, renamed,
 * or structurally mutated via the API. Content edits by authorised admins
 * are still permitted (that is the point of runtime-editable guidelines).
 *
 * Guards are enforced at the route layer in:
 *   - server/routes/memoryBlocks.ts  (create, patch, delete, detach)
 *   - server/routes/knowledge.ts     (demote handler)
 *
 * Adding a new protected block is a deliberate code change — do not add
 * a UI or config-driven mechanism for managing this set without a spec.
 *
 * Demotion routing invariant: any mechanism that soft-deletes a memory block
 * (present or future) must apply this check before soft-deletion. If a new
 * deletion path is added, either route through the existing handler or import
 * PROTECTED_BLOCK_NAMES here and apply the check inline.
 */
export const PROTECTED_BLOCK_NAMES = new Set<string>([
  'config-agent-guidelines',
]);
