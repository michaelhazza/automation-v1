import { Router } from 'express';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { auditService } from '../services/auditService.js';
import { validateBody } from '../middleware/validate.js';
import { loginBody, acceptInviteBody, forgotPasswordBody, resetPasswordBody, signupBody } from '../schemas/auth.js';
import type { LoginInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput, SignupInput } from '../schemas/auth.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';

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
  const limitResult = await rateLimitCheck(rateLimitKeys.authSignup(req.ip ?? 'unknown'), 10, 900);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
    return;
  }
  const { agencyName, email, password } = req.body as SignupInput;
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
  res.status(201).json(result);
}));

router.post('/api/auth/login', validateBody(loginBody), asyncHandler(async (req, res) => {
  const { email, password, organisationSlug } = req.body as LoginInput;
  const limitResult = await rateLimitCheck(rateLimitKeys.authLogin(req.ip ?? 'unknown', String(email)), 10, 60);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    return;
  }
  let result;
  try {
    result = await authService.login(email, password, organisationSlug);
  } catch (err) {
    auditService.log({
      actorType: 'user',
      action: 'login_failed',
      metadata: { email: String(email).toLowerCase(), reason: err && typeof err === 'object' && 'message' in err ? (err as any).message : 'unknown' },
      ipAddress: req.ip,
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
  const limitResult = await rateLimitCheck(rateLimitKeys.authForgot(req.ip ?? 'unknown'), 5, 300);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
    res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
    return;
  }
  const { email } = req.body as ForgotPasswordInput;
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
  res.json(result);
}));

export default router;
