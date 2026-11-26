import { Router } from 'express';
import { mediaController, mediaUploadMiddleware } from '../controllers/MediaController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Protect media routes with JWT auth
router.use(authMiddleware);

// Upload media file (multipart/form-data)
router.post('/upload', mediaUploadMiddleware, (req, res) => mediaController.uploadMedia(req, res));

export default router;
