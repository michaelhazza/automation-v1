import { Router } from 'express';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { auditService } from '../services/auditService.js';
import { recordSecurityEvent, SECURITY_AUDIT_SENTINEL_ORG_ID } from '../services/securityAuditService.js';
import { validateBody } from '../middleware/validate.js';
import { loginBody, acceptInviteBody, forgotPasswordBody, resetPasswordBody, signupBody } from '../schemas/auth.js';
import type { LoginInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput, SignupInput } from '../schemas/auth.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys, normaliseEmail, loginEmailOnlyKey, loginEmailOnlyKeyBurst } from '../lib/rateLimitKeys.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

const router = Router();

// Validates password strength: min 8 chars, uppercase, number, special character
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

router.post('/api/auth/signup', validateBody(signupBody), asyncHandler(async (req, res) => {
  const { agencyName, password } = req.body as SignupInput;
  const email = (req.body as SignupInput).email.trim().toLowerCase();
  const limitResult = await rateLimitCheck(rateLimitKeys.authSignup(req.ip ?? 'unknown', email), 10, 900);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
    return;
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    res.status(400).json({ error: 'Validation failed', details: { password: [passwordError] } });
    return;
  }
  const result = await authService.signup(agencyName, email, password);
  auditService.log({
    organisationId: result.user.organisationId,
    actorId: result.user.id,
    actorType: 'user',
    action: 'signup',
    entityType: 'user',
    entityId: result.user.id,
    ipAddress: req.ip,
  });
  void recordSecurityEvent({
    event:          auditEvent.auth.signup,
    organisationId: result.user.organisationId,
    actorUserId:    result.user.id,
    ip:             req.ip ?? null,
    userAgent:      req.get('user-agent') ?? null,
  });
  res.status(201).json(result);
}));

router.post('/api/auth/login', validateBody(loginBody), asyncHandler(async (req, res) => {
  const { password, organisationSlug } = req.body as LoginInput;
  const normEmail = normaliseEmail((req.body as LoginInput).email ?? '');
  const email = normEmail; // NormalisedEmail satisfies string
  const ip = req.ip ?? 'unknown';

  // Evaluate all four buckets independently (no short-circuit on success).
  // Backend errors on any bucket are fail-open (emit audit event, continue).

  // Bucket 1 — IP+email short: 10 attempts / 60s (burst protection)
  const rlShort = await rateLimitCheck(rateLimitKeys.authLogin(ip, email), 10, 60).catch(async (err) => {
    void recordSecurityEvent({
      event: auditEvent.security.rateLimitTrip,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { severity: 'configuration', reason: 'BACKEND_UNAVAILABLE', bucket: `rl:v1:auth:login:short`, error: String(err) },
    });
    return null;
  });

  // Bucket 2 — IP+email long: 50 attempts / 3600s (credential-stuffing prevention)
  const rlLong = await rateLimitCheck(rateLimitKeys.authLoginLong(ip, email), 50, 3600).catch(async (err) => {
    void recordSecurityEvent({
      event: auditEvent.security.rateLimitTrip,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { severity: 'configuration', reason: 'BACKEND_UNAVAILABLE', bucket: `rl:v1:auth:login:long`, error: String(err) },
    });
    return null;
  });

  // Bucket 3 — email-only hourly: 100 attempts / 3600s
  const rlEmailHourly = await rateLimitCheck(loginEmailOnlyKey(normEmail), 100, 3600).catch(async (err) => {
    void recordSecurityEvent({
      event: auditEvent.security.rateLimitTrip,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { severity: 'configuration', reason: 'BACKEND_UNAVAILABLE', bucket: `rl:v1:auth:login:email`, error: String(err) },
    });
    return null;
  });

  // Bucket 4 — email-only burst: 20 attempts / 300s
  const rlEmailBurst = await rateLimitCheck(loginEmailOnlyKeyBurst(normEmail), 20, 300).catch(async (err) => {
    void recordSecurityEvent({
      event: auditEvent.security.rateLimitTrip,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { severity: 'configuration', reason: 'BACKEND_UNAVAILABLE', bucket: `rl:v1:auth:login:email:burst`, error: String(err) },
    });
    return null;
  });

  // Deny if any bucket fired (null = backend error = fail-open, continue)
  if (rlShort && !rlShort.allowed) {
    setRateLimitDeniedHeaders(res, rlShort.resetAt, rlShort.nowEpochMs);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.', reason: 'short_window' });
    return;
  }
  if (rlLong && !rlLong.allowed) {
    setRateLimitDeniedHeaders(res, rlLong.resetAt, rlLong.nowEpochMs);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.', reason: 'long_window' });
    return;
  }
  if (rlEmailHourly && !rlEmailHourly.allowed) {
    setRateLimitDeniedHeaders(res, rlEmailHourly.resetAt, rlEmailHourly.nowEpochMs);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.', reason: 'email_hourly' });
    return;
  }
  if (rlEmailBurst && !rlEmailBurst.allowed) {
    setRateLimitDeniedHeaders(res, rlEmailBurst.resetAt, rlEmailBurst.nowEpochMs);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.', reason: 'email_burst' });
    return;
  }

  let result;
  try {
    result = await authService.login(email, password, organisationSlug);
  } catch (err) {
    auditService.log({
      actorType: 'user',
      action: 'login_failed',
      metadata: { email, reason: err && typeof err === 'object' && 'message' in err ? (err as any).message : 'unknown' },
      ipAddress: req.ip,
    });
    // auth.login.failure — org is unknown at this point (login rejected before session established).
    // Emit to the system sentinel org so the event is recorded; meta carries the redacted email.
    void recordSecurityEvent({
      event:          auditEvent.auth.loginFailed,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      ip:             req.ip ?? null,
      userAgent:      req.get('user-agent') ?? null,
      meta:           { emailDomain: email.split('@')[1] ?? 'unknown' },
    });
    throw err;
  }
  auditService.log({
    organisationId: result.user.organisationId,
    actorId: result.user.id,
    actorType: 'user',
    action: 'login',
    entityType: 'user',
    entityId: result.user.id,
    ipAddress: req.ip,
  });
  void recordSecurityEvent({
    event:          auditEvent.auth.loginSucceeded,
    organisationId: result.user.organisationId,
    actorUserId:    result.user.id,
    ip:             req.ip ?? null,
    userAgent:      req.get('user-agent') ?? null,
  });
  res.json(result);
}));

router.post('/api/auth/invite/accept', validateBody(acceptInviteBody), asyncHandler(async (req, res) => {
  const { token, password, firstName, lastName } = req.body as AcceptInviteInput;
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    res.status(400).json({ error: 'Validation failed', details: { password: [passwordError] } });
    return;
  }
  const result = await authService.acceptInvite(token, password, firstName, lastName);
  res.json(result);
}));

router.post('/api/auth/forgot-password', validateBody(forgotPasswordBody), asyncHandler(async (req, res) => {
  const email = String((req.body as ForgotPasswordInput).email).trim().toLowerCase();
  const limitResult = await rateLimitCheck(rateLimitKeys.authForgot(req.ip ?? 'unknown', email), 5, 300);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
    return;
  }
  const result = await authService.forgotPassword(email);
  auditService.log({
    actorType: 'user',
    action: 'password_reset_request',
    metadata: { email: String(email).toLowerCase() },
    ipAddress: req.ip,
  });
  res.json(result);
}));

router.post('/api/auth/reset-password', validateBody(resetPasswordBody), asyncHandler(async (req, res) => {
  const limitResult = await rateLimitCheck(rateLimitKeys.authReset(req.ip ?? 'unknown'), 5, 300);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
    return;
  }
  const { token, password } = req.body as ResetPasswordInput;
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    res.status(400).json({ error: 'Validation failed', details: { password: [passwordError] } });
    return;
  }
  const result = await authService.resetPassword(token, password);
  auditService.log({
    actorType: 'user',
    action: 'password_reset',
    metadata: { tokenPrefix: String(token).slice(0, 8) },
    ipAddress: req.ip,
  });
  res.json(result);
}));

router.get('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUser(req.user!.id);
  res.json(result);
}));

router.post('/api/auth/logout', authenticate, asyncHandler(async (req, res) => {
  const result = await authService.logout();
  void recordSecurityEvent({
    event:          auditEvent.auth.logout,
    organisationId: req.user!.organisationId,
    actorUserId:    req.user!.id,
    actorRole:      req.user!.role,
    ip:             req.ip ?? null,
    userAgent:      req.get('user-agent') ?? null,
  });
  res.json(result);
}));

export default router;
