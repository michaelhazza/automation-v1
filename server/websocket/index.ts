/**
 * WebSocket server — Socket.IO initialisation and export.
 *
 * Attaches to the Node HTTP server created by Express.
 * Authenticates connections via JWT (same token the REST API uses).
 * Manages room membership based on org/subaccount context.
 */

import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { authenticateSocket } from './auth.js';
import { handleConnection } from './rooms.js';
import { env } from '../lib/env.js';

let io: SocketIOServer | null = null;

/**
 * Initialise Socket.IO and attach it to the given HTTP server.
 * Call this once during server startup, after Express routes are mounted.
 */
export function initWebSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map(o => o.trim()),
      credentials: true,
    },
    // Allow long-polling fallback for environments where WS is blocked
    transports: ['websocket', 'polling'],
  });

  // Authenticate every incoming connection using the JWT middleware
  io.use(authenticateSocket);

  // Set up room management on successful connection
  io.on('connection', handleConnection);

  console.log('[WebSocket] Socket.IO initialised');
  return io;
}

/**
 * Get the initialised Socket.IO server instance.
 * Returns null if initWebSocket has not been called yet.
 */
export function getIO(): SocketIOServer | null {
  return io;
}
