/**
 * Client-side EventSource wrapper for the agent presence SSE stream.
 * Agent Workspace Chunk 9.
 */

export interface PresenceStreamEvent {
  agentId: string;
  eventTimestamp: string;
  serverNow: string;
  eventId: string;
  data: unknown;
  eventType: string;
  truncated?: boolean;
}

export type PresenceStreamScope =
  | { kind: 'agent'; agentId: string }
  | { kind: 'workspace'; subaccountId: string };

export interface PresenceStreamSubscription {
  unsubscribe: () => void;
}

export function openPresenceStream(
  scope: PresenceStreamScope,
  handlers: {
    onEvent: (event: PresenceStreamEvent) => void;
    onConnected: () => void;
    onReconnecting: () => void;
    onError: (err: Event) => void;
  },
  options?: { lastEventId?: string; token?: string },
): PresenceStreamSubscription {
  let url: string;
  if (scope.kind === 'agent') {
    url = `/api/agent-presence/stream/${scope.agentId}`;
  } else {
    url = `/api/agent-presence/stream/workspace/${scope.subaccountId}`;
  }

  const params = new URLSearchParams();
  if (options?.lastEventId) params.set('lastEventId', options.lastEventId);
  const token = options?.token ?? localStorage.getItem('token') ?? '';
  if (token) params.set('token', token);
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const eventSource = new EventSource(url);

  eventSource.addEventListener('message', (e: MessageEvent) => {
    try {
      const parsed = JSON.parse(e.data) as PresenceStreamEvent;
      handlers.onEvent(parsed);
    } catch {
      // malformed event — ignore
    }
  });

  eventSource.addEventListener('open', () => {
    handlers.onConnected();
  });

  eventSource.addEventListener('error', (e: Event) => {
    handlers.onReconnecting();
    handlers.onError(e);
  });

  return {
    unsubscribe: () => {
      eventSource.close();
    },
  };
}
