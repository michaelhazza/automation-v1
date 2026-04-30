import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { ORG_PERMISSIONS } from '../../lib/permissions.js';
import { integrationConnectionService } from '../../services/integrationConnectionService.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { googleDriveResolver, ResolverError } from '../../services/resolvers/googleDriveResolver.js';
import { externalDocFlags } from '../../lib/featureFlags.js';

const router = Router();

// GET /api/integrations/google-drive/picker-token?connectionId=<id>
// Returns a short-lived access token for the Google Picker API.
router.get(
  '/api/integrations/google-drive/picker-token',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    if (externalDocFlags.systemDisabled) return res.status(503).json({ error: 'external_doc_system_disabled' });
    const { connectionId } = req.query as { connectionId?: string };
    if (!connectionId) return res.status(400).json({ error: 'connectionId_required' });

    const conn = await integrationConnectionService.getOrgConnectionWithToken(connectionId, req.orgId!);
    if (!conn || conn.providerType !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }

    const decrypted = await integrationConnectionService.getDecryptedConnection(
      null,
      'google_drive',
      req.orgId!,
      connectionId,
    );

    return res.json({
      accessToken: decrypted.accessToken,
      pickerApiKey: process.env.GOOGLE_PICKER_API_KEY ?? '',
      appId: process.env.GOOGLE_OAUTH_CLIENT_PROJECT_NUMBER ?? '',
    });
  })
);

// GET /api/integrations/google-drive/verify-access?connectionId=<id>&fileId=<id>
// Verify that a connection can access a given file and return its metadata.
router.get(
  '/api/integrations/google-drive/verify-access',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    if (externalDocFlags.systemDisabled) return res.status(503).json({ error: 'external_doc_system_disabled' });
    const { connectionId, fileId } = req.query as { connectionId?: string; fileId?: string };
    if (!connectionId || !fileId) {
      return res.status(400).json({ error: 'connectionId_and_fileId_required' });
    }

    const conn = await integrationConnectionService.getOrgConnectionWithToken(connectionId, req.orgId!);
    if (!conn || conn.providerType !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }

    const decrypted = await integrationConnectionService.getDecryptedConnection(
      null,
      'google_drive',
      req.orgId!,
      connectionId,
    );

    try {
      const meta = await googleDriveResolver.checkRevision(fileId, decrypted.accessToken);
      if (!meta) return res.status(404).json({ error: 'file_not_accessible' });
      return res.json({ ok: true, mimeType: meta.mimeType, name: meta.name });
    } catch (err) {
      const reason = err instanceof ResolverError ? err.reason : 'network_error';
      return res.status(reason === 'auth_revoked' ? 403 : 404).json({ error: reason });
    }
  }),
);

export default router;
