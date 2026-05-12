import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import * as voiceProfileService from '../services/voiceProfile/voiceProfileService.js';

const router = Router();

// ─── List voice profiles for the authenticated user ───────────────────────────

router.get(
  '/api/voice-profiles',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_READ),
  asyncHandler(async (req, res) => {
    const profiles = await voiceProfileService.listProfiles(
      { ownerUserId: req.user!.id },
      { organisationId: req.orgId! },
    );
    res.json(profiles);
  }),
);

// ─── Get single voice profile ─────────────────────────────────────────────────

router.get(
  '/api/voice-profiles/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_READ),
  asyncHandler(async (req, res) => {
    const profile = await voiceProfileService.getProfile(
      { profileId: req.params.id },
      { organisationId: req.orgId! },
    );
    if (!profile) {
      res.status(404).json({ error: 'Voice profile not found' });
      return;
    }
    res.json(profile);
  }),
);

// ─── Trigger profile refresh ──────────────────────────────────────────────────

router.post(
  '/api/voice-profiles/:id/refresh',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_WRITE),
  asyncHandler(async (req, res) => {
    const result = await voiceProfileService.refreshProfile(
      { profileId: req.params.id, force: true },
      { organisationId: req.orgId! },
    );
    res.json(result);
  }),
);

// ─── Opt out of voice profiling ───────────────────────────────────────────────

router.post(
  '/api/voice-profiles/:id/opt-out',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_WRITE),
  asyncHandler(async (req, res) => {
    const profile = await voiceProfileService.getProfile(
      { profileId: req.params.id },
      { organisationId: req.orgId! },
    );
    if (!profile) {
      res.status(404).json({ error: 'Voice profile not found' });
      return;
    }
    await voiceProfileService.optOut(
      { profileId: req.params.id },
      { organisationId: req.orgId! },
    );
    res.json({ ok: true });
  }),
);

// ─── Reactivate after opt-out ─────────────────────────────────────────────────

router.post(
  '/api/voice-profiles/:id/reactivate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_WRITE),
  asyncHandler(async (req, res) => {
    const profile = await voiceProfileService.getProfile(
      { profileId: req.params.id },
      { organisationId: req.orgId! },
    );
    if (!profile) {
      res.status(404).json({ error: 'Voice profile not found' });
      return;
    }
    await voiceProfileService.reactivate(
      { profileId: req.params.id },
      { organisationId: req.orgId! },
    );
    res.json({ ok: true });
  }),
);

export default router;
