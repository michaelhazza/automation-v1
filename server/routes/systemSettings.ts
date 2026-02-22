import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { systemSettingsService, SETTING_KEYS } from '../services/systemSettingsService.js';

const router = Router();

// Full settings — system_admin only
router.get('/api/system/settings', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const settings = await systemSettingsService.getAll();
    res.json(settings);
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/system/settings', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const updates = req.body as Record<string, string>;
    const allowed = new Set(Object.values(SETTING_KEYS));
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.has(key as (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS])) continue;
      await systemSettingsService.set(key, String(value));
    }
    const settings = await systemSettingsService.getAll();
    res.json(settings);
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ error: e.message ?? 'Internal server error' });
  }
});

// Public subset — any authenticated user (used by upload UI to show the limit)
router.get('/api/settings/upload', authenticate, async (req, res) => {
  try {
    const maxUploadSizeMb = parseInt(
      await systemSettingsService.get(SETTING_KEYS.MAX_UPLOAD_SIZE_MB),
      10
    ) || 200;
    res.json({ maxUploadSizeMb });
  } catch {
    res.json({ maxUploadSizeMb: 200 });
  }
});

export default router;
