import { z } from 'zod';

// ── Reusable field types ──────────────────────────────────────────
export const uuidParam = z.string().uuid();

// ── Pagination ────────────────────────────────────────────────────
export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().max(200).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;
