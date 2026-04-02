import jwt from 'jsonwebtoken';

interface PreviewTokenPayload {
  pageId: string;
  projectId: string;
}

function getSecret(): string {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || 'preview-secret-change-me';
}

/**
 * JWT-based preview token service for draft page previews.
 *
 * Tokens carry `{ pageId, projectId }` and expire after 24 hours.
 */
export const previewTokenService = {
  /** Generate a signed preview token valid for 24 hours. */
  generate(pageId: string, projectId: string): string {
    return jwt.sign({ pageId, projectId }, getSecret(), { expiresIn: '24h' });
  },

  /** Verify and decode a preview token. Throws `{ statusCode: 401 }` on failure. */
  verify(token: string): PreviewTokenPayload {
    try {
      const decoded = jwt.verify(token, getSecret()) as PreviewTokenPayload;
      return { pageId: decoded.pageId, projectId: decoded.projectId };
    } catch {
      throw { statusCode: 401, message: 'Invalid or expired preview token' };
    }
  },
};
