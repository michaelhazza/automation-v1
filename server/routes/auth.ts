import { Router } from 'express';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Validates password strength: min 8 chars, uppercase, number, special character
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Validation failed', details: 'email and password are required' });
      return;
    }
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/auth/invite/accept', async (req, res) => {
  try {
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
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Validation failed', details: 'email is required' });
      return;
    }
    const result = await authService.forgotPassword(email);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/auth/reset-password', async (req, res) => {
  try {
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
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const result = await authService.getCurrentUser(req.user!.id);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    const result = await authService.logout();
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
