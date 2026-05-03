/**
 * filesTabPure.ts — pure logic for the Files tab.
 *
 * No React, no side effects, no I/O.
 * Tests: client/src/components/openTask/__tests__/filesTabPure.test.ts
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

// ─── File shape ───────────────────────────────────────────────────────────────

/**
 * Normalised file record used throughout the Files tab.
 * Sourced from task deliverables (taskDeliverables) with extra fields
 * injected by the server listing endpoint.
 */
export interface TabFile {
  id: string;
  name: string;
  /** MIME type, e.g. "text/plain", "text/csv", "application/pdf". */
  mimeType: string | null;
  fileSizeBytes: number | null;
  /** ISO 8601 timestamp. */
  updatedAt: string;
  /**
   * Indicates who / what produced the file.
   * - 'agent'     : produced as a task step output
   * - 'user'      : uploaded by a user as an attachment / reference
   * - 'reference' : injected reference document
   */
  producerKind: 'agent' | 'user' | 'reference';
  /** Monotonic version counter. 1 = first version. */
  currentVersion: number;
  /** Agent slug or display name, if the file was produced by an agent. */
  agentName?: string;
  /** Free-form tags for search. */
  tags?: string[];
}

// ─── Group classification ─────────────────────────────────────────────────────

export type FileGroup = 'output' | 'reference' | 'version';

/**
 * Classify a file into one of the three UI groups.
 *
 * - output    : agent-produced files (deliverables)
 * - reference : user-uploaded references or reference-document injections
 * - version   : older versions of any file (currentVersion > 1 signals
 *               that earlier versions exist, but the tab only lists latest
 *               by default; this group is populated when version history
 *               is explicitly shown)
 */
export function classifyFileGroup(file: TabFile): FileGroup {
  if (file.producerKind === 'reference') return 'reference';
  if (file.producerKind === 'user') return 'reference';
  return 'output';
}

// ─── Latest-only filter ───────────────────────────────────────────────────────

/**
 * For a mixed list that may include multiple versions of the same logical file
 * (identified by name), keep only the record with the highest currentVersion.
 *
 * When two records share the same name but differ by ID (e.g. the same
 * logical document at different versions), keep the latest. Order of the
 * returned array follows the first occurrence of each name.
 */
export function filterLatestOnly(files: TabFile[]): TabFile[] {
  const seen = new Map<string, TabFile>();
  for (const f of files) {
    const existing = seen.get(f.name);
    if (!existing || f.currentVersion > existing.currentVersion) {
      seen.set(f.name, f);
    }
  }
  // Preserve original insertion order of first-seen names.
  const result: TabFile[] = [];
  const added = new Set<string>();
  for (const f of files) {
    const latest = seen.get(f.name)!;
    if (!added.has(latest.id)) {
      result.push(latest);
      added.add(latest.id);
    }
  }
  return result;
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

export type FileSortKey = 'name' | 'updated' | 'size';

/**
 * Return a sorted copy of `files`.
 *
 * - 'name'    : case-insensitive lexicographic
 * - 'updated' : newest-first (descending)
 * - 'size'    : largest-first (descending); nulls sort last
 */
export function sortFiles(files: TabFile[], by: FileSortKey): TabFile[] {
  return [...files].sort((a, b) => {
    switch (by) {
      case 'name':
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt);
      case 'size': {
        const sa = a.fileSizeBytes ?? -1;
        const sb = b.fileSizeBytes ?? -1;
        return sb - sa;
      }
    }
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match against file name, agent name, and tags.
 *
 * An empty query returns the full list unchanged.
 */
export function searchFiles(files: TabFile[], query: string): TabFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => {
    if (f.name.toLowerCase().includes(q)) return true;
    if (f.agentName?.toLowerCase().includes(q)) return true;
    if (f.tags?.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}
