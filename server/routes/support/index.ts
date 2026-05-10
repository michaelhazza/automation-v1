import { Router } from 'express';
import supportTicketsRoutes from './supportTicketsRoutes.js';
import supportDraftsRoutes from './supportDraftsRoutes.js';
import supportInboxesRoutes from './supportInboxesRoutes.js';
import supportAgentInstallRoute from './supportAgentInstallRoute.js';

const router = Router();

router.use('/', supportTicketsRoutes);
router.use('/', supportDraftsRoutes);
router.use('/', supportInboxesRoutes);
router.use('/', supportAgentInstallRoute);

export default router;
