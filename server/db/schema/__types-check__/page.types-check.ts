/**
 * Compile-time drift check: shared/types/page.ts MUST stay structurally compatible
 * with the drizzle row shapes inferred from server/db/schema/pages.ts and
 * server/db/schema/pageProjects.ts.
 *
 * Why this file exists: pagePreview.ts and pageServing.ts moved to importing
 * `Page` / `PageProject` from `shared/types/page.ts` (gate-friendly — routes
 * don't import from server/db/schema). That move is only safe as long as the
 * two shapes stay aligned. TypeScript will not flag drift unless a consumer
 * happens to use the divergent field, so we pin both directions explicitly.
 *
 * If this file fails to compile, either:
 *   - The drizzle schema changed and `shared/types/page.ts` needs to follow.
 *   - The shared type changed and the schema needs to follow.
 * Update them in the same commit; this file is the contract.
 */

import type { Page as SharedPage, PageProject as SharedPageProject } from '../../../../shared/types/page.js';
import type { Page as DbPage } from '../pages.js';
import type { PageProject as DbPageProject } from '../pageProjects.js';

// Both directions of the structural compatibility check. If the shared type
// adds a field the schema doesn't have, the first assertion fails. If the
// schema adds a notNull field the shared type doesn't model, the second fails.
// (Nullable-vs-notNull mismatches break in whichever direction is narrowing.)
type _PageCompatA = SharedPage extends DbPage ? true : never;
type _PageCompatB = DbPage extends SharedPage ? true : never;
type _PageProjectCompatA = SharedPageProject extends DbPageProject ? true : never;
type _PageProjectCompatB = DbPageProject extends SharedPageProject ? true : never;

// Reference the marker types so unused-symbol lint doesn't drop them.
const _markers: [_PageCompatA, _PageCompatB, _PageProjectCompatA, _PageProjectCompatB] = [
  true, true, true, true,
];
void _markers;
