import { Router } from 'express';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/auth.middleware';
import { otpRateLimiter } from '../middleware/rateLimit.middleware';

export const authRouter = Router();

authRouter.post('/request-otp', otpRateLimiter, (req, res) => authController.requestOtp(req, res));
authRouter.post('/verify-otp', (req, res) => authController.verifyOtp(req, res));
authRouter.post('/google-sync', (req, res) => authController.googleSync(req, res));
authRouter.post('/refresh-token', (req, res) => authController.refreshToken(req, res));
authRouter.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
authRouter.delete('/account', authMiddleware, (req, res) => authController.deleteAccount(req, res));
