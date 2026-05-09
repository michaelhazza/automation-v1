/**
 * Client-side EventSource wrapper for the agent presence SSE stream.
 * Agent Workspace Chunk 9 + B3 signed-token auth.
 *
 * Auth: fetches a short-lived signed token from POST /api/agent-presence/stream-token
 * and passes it as ?token=... on the EventSource URL. The token is held in memory
 * only (not localStorage). On EventSource error, the token is refreshed and the
 * connection is re-established.
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

// ── Stream token helpers ──────────────────────────────────────────────────────

interface StreamTokenResponse {
  token: string;
  expiresAt: string;
}

async function fetchStreamToken(scope: PresenceStreamScope): Promise<string> {
  const jwt = localStorage.getItem('token') ?? '';
  const scopeBody =
    scope.kind === 'agent'
      ? { kind: 'agent', agentId: scope.agentId }
      : { kind: 'workspace', subaccountId: scope.subaccountId };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };

  const resp = await fetch('/api/agent-presence/stream-token', {
    method: 'POST',
    headers,
    body: JSON.stringify({ scope: scopeBody }),
  });

  if (!resp.ok) {
    throw new Error(`stream-token fetch failed: ${resp.status}`);
  }

  const data = (await resp.json()) as StreamTokenResponse;
  return data.token;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function openPresenceStream(
  scope: PresenceStreamScope,
  handlers: {
    onEvent: (event: PresenceStreamEvent) => void;
    onConnected: () => void;
    onReconnecting: () => void;
    onError: (err: Event) => void;
  },
  options?: { lastEventId?: string },
): PresenceStreamSubscription {
  let currentEventSource: EventSource | null = null;
  let cancelled = false;
  let currentLastEventId = options?.lastEventId;

  function buildUrl(token: string): string {
    let base: string;
    if (scope.kind === 'agent') {
      base = `/api/agent-presence/stream/${scope.agentId}`;
    } else {
      base = `/api/agent-presence/stream/workspace/${scope.subaccountId}`;
    }
    const params = new URLSearchParams({ token });
    if (currentLastEventId) params.set('lastEventId', currentLastEventId);
    return `${base}?${params.toString()}`;
  }

  async function connect(): Promise<void> {
    if (cancelled) return;

    let token: string;
    try {
      token = await fetchStreamToken(scope);
    } catch {
      handlers.onReconnecting();
      // Retry token fetch after 5s before giving up on this connect attempt
      if (!cancelled) {
        setTimeout(() => { void connect(); }, 5_000);
      }
      return;
    }

    if (cancelled) return;

    const es = new EventSource(buildUrl(token));
    currentEventSource = es;

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data as string) as PresenceStreamEvent;
        if (parsed.eventId) currentLastEventId = parsed.eventId;
        handlers.onEvent(parsed);
      } catch {
        // malformed event — ignore
      }
    });

    es.addEventListener('open', () => {
      handlers.onConnected();
    });

    es.addEventListener('error', (e: Event) => {
      handlers.onReconnecting();
      handlers.onError(e);
      es.close();
      currentEventSource = null;

      if (!cancelled) {
        // Re-fetch a fresh token and reconnect
        setTimeout(() => { void connect(); }, 2_000);
      }
    });
  }

  void connect();

  return {
    unsubscribe: () => {
      cancelled = true;
      currentEventSource?.close();
      currentEventSource = null;
    },
  };
}
