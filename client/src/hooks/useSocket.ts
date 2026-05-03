/**
 * React hooks for Socket.IO event subscriptions.
 *
 * Features:
 *   - useSocket(event, callback)        — subscribe to a global event
 *   - useSocketRoom(roomType, id, events) — join a room, subscribe, leave on cleanup
 *   - useSocketConnected()              — returns true/false for connection state
 *
 * Idempotency:
 *   Events use an envelope with eventId. The hooks deduplicate events
 *   using a bounded LRU set so the same event is never processed twice.
 *
 * Reconnect resync:
 *   useSocketRoom accepts an optional onReconnect callback that fires
 *   when the socket reconnects, so components can re-fetch baseline state via REST.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, onConnectionChange, onReconnect } from '../lib/socket';

// ─── Event dedup (bounded set of recent eventIds) ─────────────────────────────

const DEDUP_MAX_SIZE = 500;
const recentEventIds = new Set<string>();
const eventIdOrder: string[] = [];

function isDuplicate(eventId: string | undefined): boolean {
  if (!eventId) return false; // no eventId = legacy event, always process
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.add(eventId);
  eventIdOrder.push(eventId);
  // Evict oldest entries when set grows too large
  while (eventIdOrder.length > DEDUP_MAX_SIZE) {
    const oldest = eventIdOrder.shift()!;
    recentEventIds.delete(oldest);
  }
  return false;
}

// ─── Envelope type ────────────────────────────────────────────────────────────

interface EventEnvelope {
  eventId?: string;
  type?: string;
  entityId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

function unwrapEnvelope(data: unknown): { envelope: EventEnvelope; payload: unknown } {
  if (data && typeof data === 'object' && 'eventId' in (data as Record<string, unknown>)) {
    const envelope = data as EventEnvelope;
    return { envelope, payload: envelope.payload ?? data };
  }
  // Legacy event without envelope
  return { envelope: {}, payload: data };
}

// ─── useSocketConnected ───────────────────────────────────────────────────────

/**
 * Returns whether the WebSocket is currently connected.
 * Components can use this to decide whether to enable polling fallback.
 */
export function useSocketConnected(): boolean {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const unsub = onConnectionChange(setIsConnected);
    return unsub;
  }, []);

  return isConnected;
}

// ─── useSocket ────────────────────────────────────────────────────────────────

/**
 * Subscribe to a Socket.IO event with automatic dedup.
 */
export function useSocket(
  event: string,
  callback: (data: unknown) => void,
  deps: unknown[] = []
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data: unknown) => {
      const { envelope, payload } = unwrapEnvelope(data);
      if (isDuplicate(envelope.eventId)) return;
      callbackRef.current(payload);
    };
    socket.on(event, handler);
    return () => { socket.off(event, handler); };
    // reason: `callback` is intentionally omitted — it is kept current via callbackRef so stale-closure re-subscriptions are avoided.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}

// ─── useSocketRoom ────────────────────────────────────────────────────────────

/**
 * Join a Socket.IO room, subscribe to events, and automatically leave on cleanup.
 *
 * @param roomType        Room type prefix, e.g. 'execution', 'agent-run', 'subaccount'
 * @param roomId          The specific resource ID to join. Pass null/undefined to skip.
 * @param events          Map of event name → handler
 * @param onReconnectSync Optional callback fired on reconnect — use to re-fetch baseline state via REST
 */
export function useSocketRoom(
  roomType: string,
  roomId: string | null | undefined,
  events: Record<string, (data: unknown) => void>,
  onReconnectSync?: () => void
): void {
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const reconnectRef = useRef(onReconnectSync);
  reconnectRef.current = onReconnectSync;

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();
    if (!socket) return;

    // Join the room
    socket.emit(`join:${roomType}`, roomId);

    // Subscribe to all events with dedup
    const handlers: Array<[string, (data: unknown) => void]> = [];
    for (const [event] of Object.entries(eventsRef.current)) {
      const handler = (data: unknown) => {
        const { envelope, payload } = unwrapEnvelope(data);
        if (isDuplicate(envelope.eventId)) return;
        eventsRef.current[event]?.(payload);
      };
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    // On reconnect, rejoin the room and trigger REST resync
    const unsubReconnect = onReconnect(() => {
      socket.emit(`join:${roomType}`, roomId);
      reconnectRef.current?.();
    });

    return () => {
      socket.emit(`leave:${roomType}`, roomId);
      for (const [event, handler] of handlers) {
        socket.off(event, handler);
      }
      unsubReconnect();
    };
  }, [roomType, roomId]);
}
