/**
 * Middleware that verifies a short-lived stream token from ?token= query param.
 * Populates req.user, req.orgId, and req.streamTokenScope from the token claims.
 * Strips the token from the URL before any logger sees it.
 *
 * Used exclusively on agent presence SSE GET routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyStreamToken } from '../lib/agentPresenceStreamToken.js';
import type { JwtPayload } from './auth.js';
import type { StreamTokenScope } from '../lib/agentPresenceStreamToken.js';

declare global {
  // reason: Express module augmentation requires the `namespace` keyword.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Scope claims from a verified short-lived stream token. */
      streamTokenScope?: StreamTokenScope;
    }
  }
}

export const authenticateStreamToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const rawToken = req.query.token as string | undefined;

  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Strip token from query before any downstream logger reads req.url
  // so that the short-lived credential does not appear in access logs.
  const urlObj = new URL(req.url, 'http://localhost');
  urlObj.searchParams.delete('token');
  req.url = urlObj.pathname + (urlObj.search || '');

  let claims;
  try {
    claims = verifyStreamToken(rawToken);
  } catch {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Populate req.user shape expected by downstream guards
  req.user = {
    id: claims.userId,
    organisationId: claims.orgId,
    role: 'user',
    email: '',
  } satisfies JwtPayload;

  req.orgId = claims.orgId;
  req.streamTokenScope = claims.scope;

  next();
};
