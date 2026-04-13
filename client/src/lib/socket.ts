/**
 * Socket.IO client singleton with reconnect resync and hybrid fallback.
 *
 * Provides a single persistent WebSocket connection per authenticated session.
 *
 * On reconnect:
 *   - Fires a 'socket:reconnected' custom event so components can re-fetch baseline state
 *   - Re-joins rooms automatically (Socket.IO handles this)
 *
 * Hybrid fallback:
 *   - Exposes connection state so components can fall back to polling when disconnected
 *   - Fires 'socket:disconnected' / 'socket:connected' for state tracking
 */

import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';

let socket: Socket | null = null;
let connected = false;

// ─── Connection state listeners ──────────────────────────────────────────────

type ConnectionListener = (isConnected: boolean) => void;
const connectionListeners = new Set<ConnectionListener>();

export function onConnectionChange(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  // Immediately notify of current state
  listener(connected);
  return () => { connectionListeners.delete(listener); };
}

function notifyConnectionChange(isConnected: boolean): void {
  connected = isConnected;
  for (const listener of connectionListeners) {
    try { listener(isConnected); } catch { /* ignore listener errors */ }
  }
}

// ─── Reconnect listeners (for REST resync) ────────────────────────────────────

type ReconnectListener = () => void;
const reconnectListeners = new Set<ReconnectListener>();

export function onReconnect(listener: ReconnectListener): () => void {
  reconnectListeners.add(listener);
  return () => { reconnectListeners.delete(listener); };
}

function notifyReconnect(): void {
  for (const listener of reconnectListeners) {
    try { listener(); } catch { /* ignore listener errors */ }
  }
}

// ─── Socket management ──────────────────────────────────────────────────────

export function isSocketConnected(): boolean {
  return connected;
}

/**
 * Get or create the Socket.IO client connection.
 * Returns null if the user is not authenticated.
 */
export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;

  if (socket?.connected) return socket;

  // If a stale socket exists, remove all listeners and disconnect before
  // creating a new one to prevent memory leaks from duplicate handlers.
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
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

  socket.on('connect', () => {
    notifyConnectionChange(true);
  });

  socket.on('disconnect', () => {
    notifyConnectionChange(false);
  });

  // On reconnect, notify listeners to re-fetch baseline state via REST
  socket.io.on('reconnect', () => {
    notifyConnectionChange(true);
    notifyReconnect();
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
    notifyConnectionChange(false);
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
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  notifyConnectionChange(false);
}

/**
 * Reconnect with fresh auth (e.g. after org switch for system_admin).
 */
export function reconnectSocket(): void {
  disconnectSocket();
  getSocket();
}
