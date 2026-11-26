import { Router } from 'express';
import { cryptoController } from '../controllers/CryptoController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Protect all crypto routes
router.use(authMiddleware);

// Upload user's public pre-key bundle
router.post('/prekeys', (req, res) => cryptoController.uploadPreKeyBundle(req, res));

// Get recipient's public pre-key bundle
router.get('/prekeys/:userId', (req, res) => cryptoController.getPreKeyBundle(req, res));

export default router;
