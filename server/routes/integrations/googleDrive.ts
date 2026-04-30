import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { integrationConnectionService } from '../../services/integrationConnectionService.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

// GET /api/integrations/google-drive/picker-token?connectionId=<id>
// Returns a short-lived access token for the Google Picker API.
router.get(
  '/api/integrations/google-drive/picker-token',
  authenticate,
  asyncHandler(async (req, res) => {
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

export default router;
