/**
 * Socket.IO client singleton.
 *
 * Provides a single persistent WebSocket connection per authenticated session.
 * The connection is established when the user is authenticated and torn down
 * on logout or token expiry.
 *
 * Components subscribe to events via the useSocket hook (see hooks/useSocket.ts).
 */

import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';

let socket: Socket | null = null;

/**
 * Get or create the Socket.IO client connection.
 * Returns null if the user is not authenticated.
 */
export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;

  if (socket?.connected) return socket;

  // If a stale socket exists, disconnect it before creating a new one
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // Build auth payload — includes JWT and optional org context for system admins
  const auth: Record<string, string> = { token };
  const activeOrgId = localStorage.getItem('activeOrgId');
  const userRole = localStorage.getItem('userRole');
  if (userRole === 'system_admin' && activeOrgId) {
    auth.organisationId = activeOrgId;
  }

  socket = io({
    auth,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
    // If auth fails, don't keep retrying — the token is likely invalid
    if (err.message === 'Authentication required') {
      socket?.disconnect();
    }
  });

  return socket;
}

/**
 * Disconnect and destroy the socket connection (e.g. on logout).
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Reconnect with fresh auth (e.g. after org switch for system_admin).
 */
export function reconnectSocket(): void {
  disconnectSocket();
  getSocket();
}
