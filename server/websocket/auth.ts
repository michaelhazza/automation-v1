/**
 * WebSocket authentication middleware.
 *
 * Validates the JWT token passed via the `auth.token` handshake option.
 * On success, attaches the decoded payload to `socket.data` so downstream
 * handlers can read the user's identity and org context.
 */

import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import { env } from '../lib/env.js';

export interface SocketUser {
  id: string;
  organisationId: string;
  role: string;
  email: string;
}

/**
 * Socket.IO middleware that verifies the JWT before allowing the connection.
 */
export function authenticateSocket(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const token = socket.handshake.auth?.token as string | undefined;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as SocketUser;
    socket.data.user = payload;

    // Support system_admin scoping into a specific org via handshake auth
    if (payload.role === 'system_admin' && socket.handshake.auth?.organisationId) {
      socket.data.orgId = socket.handshake.auth.organisationId;
    } else {
      socket.data.orgId = payload.organisationId;
    }

    next();
  } catch {
    next(new Error('Authentication required'));
  }
}
