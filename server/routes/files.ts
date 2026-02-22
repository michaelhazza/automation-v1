import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { fileService } from '../services/fileService.js';
import { validateMultipart } from '../middleware/validate.js';
import { systemSettingsService } from '../services/systemSettingsService.js';

const router = Router();

router.post('/api/files/upload', authenticate, validateMultipart, async (req, res) => {
  try {
    const { executionId } = req.body;
    if (!executionId) {
      res.status(400).json({ error: 'Validation failed', details: 'executionId is required' });
      return;
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const file = files[0];

    // Enforce the configurable max upload size from system settings
    const maxBytes = await systemSettingsService.getMaxUploadSizeBytes();
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      res.status(413).json({ error: `File too large. Maximum allowed size is ${maxMb} MB.` });
      return;
    }

    const result = await fileService.uploadFile(executionId, req.user!.id, req.user!.organisationId, file);
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/files/:fileId/download', authenticate, async (req, res) => {
  try {
    const result = await fileService.downloadFile(req.params.fileId, req.user!.id, req.user!.organisationId, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
