/**
 * React hooks for Socket.IO event subscriptions.
 *
 * useSocket(event, callback)       — subscribe to a global event
 * useSocketRoom(joinEvent, id, events) — join a room, subscribe to events, leave on cleanup
 */

import { useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';

/**
 * Subscribe to a Socket.IO event. Re-subscribes when dependencies change.
 * The callback is kept stable via a ref so re-renders don't cause re-subscriptions.
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

    const handler = (data: unknown) => callbackRef.current(data);
    socket.on(event, handler);
    return () => { socket.off(event, handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}

/**
 * Join a Socket.IO room (by emitting a join event), subscribe to one or more
 * events, and automatically leave + unsubscribe on cleanup.
 *
 * @param roomType  The room type prefix, e.g. 'execution', 'agent-run', 'subaccount'
 * @param roomId    The specific resource ID to join. Pass null/undefined to skip.
 * @param events    Map of event name → handler
 */
export function useSocketRoom(
  roomType: string,
  roomId: string | null | undefined,
  events: Record<string, (data: unknown) => void>
): void {
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();
    if (!socket) return;

    // Join the room
    socket.emit(`join:${roomType}`, roomId);

    // Subscribe to all events
    const handlers: Array<[string, (data: unknown) => void]> = [];
    for (const [event, _handler] of Object.entries(eventsRef.current)) {
      const handler = (data: unknown) => eventsRef.current[event]?.(data);
      socket.on(event, handler);
      handlers.push([event, handler]);
    }

    return () => {
      // Leave the room and unsubscribe
      socket.emit(`leave:${roomType}`, roomId);
      for (const [event, handler] of handlers) {
        socket.off(event, handler);
      }
    };
  }, [roomType, roomId]);
}
