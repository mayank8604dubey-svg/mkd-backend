import { Router } from 'express';
import { statusController } from '../controllers/StatusController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Protect all status routes
router.use(authMiddleware);

// Get active statuses
router.get('/', (req, res) => statusController.getActiveStatuses(req, res));

// Post new status
router.post('/', (req, res) => statusController.createStatus(req, res));

// Mark status as viewed
router.post('/:statusId/view', (req, res) => statusController.markStatusViewed(req, res));

// Delete own status
router.delete('/:statusId', (req, res) => statusController.deleteStatus(req, res));

export default router;
