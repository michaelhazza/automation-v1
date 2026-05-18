// Pure state machine for file attachment lifecycle. No React, no DOM, no fetch.

export type AttachmentRowState =
  | { state: 'pending'; localId: string; file: File }
  | { state: 'uploading'; localId: string; file: File; idempotencyKey: string; controller: AbortController }
  | { state: 'succeeded'; localId: string; attachmentId: string; filename: string }
  | { state: 'failed_recoverable'; localId: string; file: File; idempotencyKey: string; error: string }
  | { state: 'failed_unrecoverable'; localId: string; filename: string; error: string }
  | { state: 'cancelled'; localId: string; filename: string };

let _counter = 0;

export function addFiles(rows: AttachmentRowState[], files: File[]): AttachmentRowState[] {
  const newRows: AttachmentRowState[] = files.map((file) => ({
    state: 'pending' as const,
    localId: `${Date.now()}-${++_counter}`,
    file,
  }));
  return [...rows, ...newRows];
}

const DISALLOWED: Record<string, Set<string>> = {
  succeeded: new Set(['pending', 'uploading', 'failed_recoverable', 'failed_unrecoverable']),
  cancelled: new Set(['pending', 'uploading', 'succeeded', 'failed_recoverable', 'failed_unrecoverable', 'cancelled']),
  failed_unrecoverable: new Set(['uploading']),
};

export function transitionRow(
  rows: AttachmentRowState[],
  localId: string,
  newState: AttachmentRowState,
): AttachmentRowState[] {
  const idx = rows.findIndex((r) => r.localId === localId);
  if (idx === -1) return rows;

  const current = rows[idx];
  const disallowedForCurrent = DISALLOWED[current.state];
  if (disallowedForCurrent?.has(newState.state)) {
    throw new Error(
      `Disallowed transition: ${current.state} → ${newState.state} (localId=${localId})`,
    );
  }

  const next = [...rows];
  next[idx] = newState;
  return next;
}

export function summariseRows(
  rows: AttachmentRowState[],
): { pending: number; uploading: number; succeeded: number; failed: number } {
  let pending = 0;
  let uploading = 0;
  let succeeded = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.state === 'pending') pending++;
    else if (r.state === 'uploading') uploading++;
    else if (r.state === 'succeeded') succeeded++;
    else if (r.state === 'failed_recoverable' || r.state === 'failed_unrecoverable') failed++;
    // 'cancelled' counts nowhere
  }
  return { pending, uploading, succeeded, failed };
}
