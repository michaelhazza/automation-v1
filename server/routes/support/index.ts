import { Router } from 'express';
import supportTicketsRoutes from './supportTicketsRoutes.js';
import supportDraftsRoutes from './supportDraftsRoutes.js';
import supportInboxesRoutes from './supportInboxesRoutes.js';
import supportAgentInstallRoute from './supportAgentInstallRoute.js';
import supportAgentRoutes from './supportAgentRoutes.js';
import supportEvalsRoutes from './supportEvalsRoutes.js';

const router = Router({ mergeParams: true });

router.use('/', supportTicketsRoutes);
router.use('/', supportDraftsRoutes);
router.use('/', supportInboxesRoutes);
router.use('/', supportAgentInstallRoute);
router.use('/', supportAgentRoutes);
router.use('/', supportEvalsRoutes);

export default router;
