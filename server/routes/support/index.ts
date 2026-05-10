import { Router } from 'express';
import supportTicketsRoutes from './supportTicketsRoutes.js';
import supportDraftsRoutes from './supportDraftsRoutes.js';
import supportInboxesRoutes from './supportInboxesRoutes.js';

const router = Router();

router.use('/', supportTicketsRoutes);
router.use('/', supportDraftsRoutes);
router.use('/', supportInboxesRoutes);

export default router;
