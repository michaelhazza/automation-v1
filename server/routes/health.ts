import { Router } from 'express';
import { healthService } from '../services/healthService.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json(healthService.checkHealth());
});

export default router;
