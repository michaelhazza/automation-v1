/**
 * Workspace-scope presence hook.
 * Connects to the SSE stream for a subaccount and maintains a live PresenceRow[].
 *
 * Agent Workspace Chunk 9.
 */

import { useState, useEffect } from 'react';
import { openPresenceStream } from '../lib/agentPresenceStream';
import type { PresenceRow } from '../lib/orderHomePresenceSections';

export interface WorkspacePresenceState {
  rows: PresenceRow[];
  isConnected: boolean;
  isReconnecting: boolean;
}

interface PresenceStateChangedData {
  agentId?: string;
  presenceState?: string;
  degradedBaseState?: PresenceRow['degradedBaseState'];
  nextRunAt?: string | null;
  updatedAt?: string;
}

export function useWorkspacePresence(subaccountId: string): WorkspacePresenceState {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!subaccountId) return;

    const subscription = openPresenceStream(
      { kind: 'workspace', subaccountId },
      {
        onEvent: (event) => {
          if (event.eventType === 'presence_state_changed') {
            const d = event.data as PresenceStateChangedData;
            const agentId = d?.agentId ?? event.agentId;
            if (!agentId) return;

            const newRow: PresenceRow = {
              agentId,
              presenceState: (d?.presenceState ?? 'idle') as PresenceRow['presenceState'],
              degradedBaseState: d?.degradedBaseState ?? null,
              nextRunAt: d?.nextRunAt ?? null,
              updatedAt: d?.updatedAt ?? event.eventTimestamp,
            };

            setRows((prev) => {
              const idx = prev.findIndex((r) => r.agentId === agentId);
              if (idx === -1) return [...prev, newRow];
              const next = [...prev];
              next[idx] = newRow;
              return next;
            });
          }
        },
        onConnected: () => {
          setIsConnected(true);
          setIsReconnecting(false);
        },
        onReconnecting: () => {
          setIsConnected(false);
          setIsReconnecting(true);
        },
        onError: () => {
          // onReconnecting is called from the error handler; no additional state needed
        },
      },
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [subaccountId]);

  return { rows, isConnected, isReconnecting };
}
