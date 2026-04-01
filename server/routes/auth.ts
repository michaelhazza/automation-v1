import { Router } from 'express';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttemptTimestamps = new Map<string, number[]>();

function enforceLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const attempts = loginAttemptTimestamps.get(key) ?? [];
  const windowed = attempts.filter((ts) => now - ts < LOGIN_WINDOW_MS);
  if (windowed.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttemptTimestamps.set(key, windowed);
    return false;
  }
  windowed.push(now);
  loginAttemptTimestamps.set(key, windowed);
  return true;
}

// Validates password strength: min 8 chars, uppercase, number, special character
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

router.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password, organisationSlug } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Validation failed', details: 'email and password are required' });
    return;
  }
  const rateKey = `${req.ip}:${String(email).toLowerCase()}`;
  if (!enforceLoginRateLimit(rateKey)) {
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    return;
  }
  const result = await authService.login(email, password, organisationSlug);
  res.json(result);
}));

router.post('/api/auth/invite/accept', asyncHandler(async (req, res) => {
  const { token, password, firstName, lastName } = req.body;
  if (!token || !password || !firstName || !lastName) {
    res.status(400).json({ error: 'Validation failed', details: 'token, password, firstName, lastName are required' });
    return;
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    res.status(400).json({ error: 'Validation failed', details: passwordError });
    return;
  }
  const result = await authService.acceptInvite(token, password, firstName, lastName);
  res.json(result);
}));

router.post('/api/auth/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Validation failed', details: 'email is required' });
    return;
  }
  const result = await authService.forgotPassword(email);
  res.json(result);
}));

router.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: 'Validation failed', details: 'token and password are required' });
    return;
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    res.status(400).json({ error: 'Validation failed', details: passwordError });
    return;
  }
  const result = await authService.resetPassword(token, password);
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
