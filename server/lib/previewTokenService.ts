import jwt from 'jsonwebtoken';

interface PreviewTokenPayload {
  pageId: string;
  projectId: string;
  slug: string;
  updatedAt: string; // ISO timestamp — lets consumers detect stale previews
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET or SESSION_SECRET must be set for preview token signing');
  }
  return secret;
}

/**
 * JWT-based preview token service for draft page previews.
 *
 * Tokens carry `{ pageId, projectId, slug, updatedAt }` and expire after 24 hours.
 */
export const previewTokenService = {
  /** Generate a signed preview token valid for 24 hours. */
  generate(pageId: string, projectId: string, slug: string, updatedAt: Date): string {
    return jwt.sign({ pageId, projectId, slug, updatedAt: updatedAt.toISOString() }, getSecret(), { expiresIn: '24h' });
  },

  /** Verify and decode a preview token. Throws `{ statusCode: 401 }` on failure. */
  verify(token: string): PreviewTokenPayload {
    try {
      const decoded = jwt.verify(token, getSecret()) as PreviewTokenPayload;
      return { pageId: decoded.pageId, projectId: decoded.projectId, slug: decoded.slug, updatedAt: decoded.updatedAt };
    } catch {
      throw { statusCode: 401, message: 'Invalid or expired preview token' };
    }
  },
};
