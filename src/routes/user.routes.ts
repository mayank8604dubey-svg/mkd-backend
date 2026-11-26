import { Router } from 'express';
import { userController } from '../controllers/UserController';
import { authMiddleware } from '../middleware/auth.middleware';
import { avatarUpload } from '../services/StorageService';

export const userRouter = Router();

userRouter.use(authMiddleware);

userRouter.get('/me', (req, res) => userController.getMe(req, res));
userRouter.put('/profile', (req, res) => userController.updateProfile(req, res));
userRouter.post('/avatar', avatarUpload.single('avatar'), (req, res) => userController.uploadAvatar(req, res));
userRouter.get('/:id', (req, res) => userController.getUserById(req, res));
userRouter.post('/push-token', (req, res) => userController.updatePushToken(req, res));
userRouter.post('/contacts/sync', (req, res) => userController.syncContacts(req, res));
