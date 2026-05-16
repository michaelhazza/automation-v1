import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { AgentExecutionLogEdit } from '../../../../shared/types/agentExecutionLogEdits';

interface Props {
  runId: string;
  isTerminal: boolean;
}

function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function editLabel(edit: AgentExecutionLogEdit): string {
  const localTime = formatLocalTime(edit.editedAt);
  if (edit.entityType === 'memory_block') {
    return `Memory block edited by ${edit.editedByUserId} at ${localTime}: ${edit.editSummary}`;
  }
  if (edit.entityType === 'workspace_memory_summary') {
    return `Memory summary edited by ${edit.editedByUserId} at ${localTime}: ${edit.editSummary}`;
  }
  return `${edit.entityType} edited by ${edit.editedByUserId} at ${localTime}: ${edit.editSummary}`;
}

export function EditedAfterBanner({ runId, isTerminal }: Props) {
  const [edits, setEdits] = useState<AgentExecutionLogEdit[]>([]);

  useEffect(() => {
    // Clear at the start of every effect run so navigating from run A to run B
    // (or a non-terminal run) cannot briefly show stale edits from the prior
    // run before the new fetch resolves, and a failed fetch on run B does not
    // leave run A's edits on screen indefinitely.
    setEdits([]);
    if (!isTerminal) return;

    let cancelled = false;

    api
      .get<{ edits: AgentExecutionLogEdit[] }>(`/api/agent-runs/${runId}/edits`)
      .then(({ data }) => {
        if (cancelled) return;
        setEdits(data.edits ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('EditedAfterBanner: failed to fetch edits', err);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, isTerminal]);

  if (!isTerminal || edits.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
    >
      <strong>Edited after completion.</strong>
      <ul className="mt-1 space-y-0.5 list-none">
        {edits.map((edit) => (
          <li key={edit.id}>{editLabel(edit)}</li>
        ))}
      </ul>
    </div>
  );
}
