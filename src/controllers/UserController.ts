import { Response } from 'express';
import { UserRepository } from '../database/repositories/UserRepository';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

const userRepo = new UserRepository();

export class UserController {
  /**
   * GET /api/v1/users/me
   */
  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const user = await userRepo.findById(req.user.userId);
      if (!user) {
        res.status(404).json({ success: false, error: 'User profile not found' });
        return;
      }
      res.status(200).json({ success: true, user });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to fetch profile' });
    }
  }

  /**
   * PUT /api/v1/users/profile
   */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { displayName, about, username } = req.body;
      const updated = await userRepo.updateProfile(req.user.userId, displayName, about, username);
      res.status(200).json({ success: true, user: updated });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to update profile' });
    }
  }

  /**
   * POST /api/v1/users/avatar
   */
  async uploadAvatar(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No avatar image file provided' });
        return;
      }

      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol;
      const avatarUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

      const updated = await userRepo.updateAvatar(req.user.userId, avatarUrl);
      res.status(200).json({ success: true, avatarUrl, user: updated });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to upload avatar' });
    }
  }

  /**
   * GET /api/v1/users/:id
   */
  async getUserById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const user = await userRepo.findById(id);
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      // Public profile view
      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          displayName: user.displayName,
          about: user.about,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to retrieve user' });
    }
  }

  /**
   * POST /api/v1/users/push-token
   */
  async updatePushToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { pushToken } = req.body;
      if (!pushToken) {
        res.status(400).json({ success: false, error: 'pushToken is required' });
        return;
      }
      await userRepo.updatePushToken(req.user.userId, pushToken);
      res.status(200).json({ success: true, message: 'Push token updated' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to update push token' });
    }
  }

  /**
   * POST /api/v1/users/contacts/sync
   * Matches address book phone numbers with registered MKD users
   */
  async syncContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { phoneNumbers } = req.body;
      if (!Array.isArray(phoneNumbers)) {
        res.status(400).json({ success: false, error: 'phoneNumbers array is required' });
        return;
      }

      const registeredContacts: any[] = [];
      for (const phone of phoneNumbers) {
        if (typeof phone === 'string' && phone.trim().length > 6) {
          const cleanPhone = phone.trim().replace(/[\s\-\(\)]/g, '');
          const user = await userRepo.findByPhoneNumber(cleanPhone);
          if (user && user.isActive) {
            registeredContacts.push({
              id: user.id,
              phoneNumber: user.phoneNumber,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              about: user.about,
              isOnline: user.isOnline,
              lastSeen: user.lastSeen
            });
          }
        }
      }

      res.status(200).json({
        success: true,
        data: registeredContacts
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Contact sync failed' });
    }
  }
}

export const userController = new UserController();
