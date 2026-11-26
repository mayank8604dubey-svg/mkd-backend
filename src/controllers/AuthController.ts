import { Request, Response } from 'express';
import { config } from '../config/environment';
import { UserRepository } from '../database/repositories/UserRepository';
import { SessionRepository } from '../database/repositories/SessionRepository';
import { smsService } from '../services/SmsService';
import { tokenService } from '../services/TokenService';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

const userRepo = new UserRepository();
const sessionRepo = new SessionRepository();

export class AuthController {
  /**
   * POST /api/v1/auth/request-otp
   */
  async requestOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.length < 7) {
        res.status(400).json({ success: false, error: 'A valid E.164 phone number is required' });
        return;
      }

      const cleanPhone = phoneNumber.trim().replace(/\s+/g, '');
      const code = smsService.generateOtp();
      const codeHash = await tokenService.hash(code);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

      await sessionRepo.saveOtp(cleanPhone, codeHash, expiresAt);
      const sendResult = await smsService.sendOtp(cleanPhone, code);

      if (!sendResult.success) {
        res.status(503).json({
          success: false,
          error: sendResult.error || 'Failed to dispatch verification SMS',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Verification code dispatched via SMS',
        phoneNumber: cleanPhone,
        expiresInSeconds: 300,
        ...(config.nodeEnv !== 'production' ? { devOtpCode: code } : {}),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to dispatch OTP' });
    }
  }

  /**
   * POST /api/v1/auth/verify-otp
   */
  async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phoneNumber, code, deviceId = 'android_device_primary' } = req.body;

      if (!phoneNumber || !code) {
        res.status(400).json({ success: false, error: 'Phone number and verification code are required' });
        return;
      }

      const cleanPhone = phoneNumber.trim().replace(/\s+/g, '');
      const otpRecord = await sessionRepo.findLatestValidOtp(cleanPhone);

      if (!otpRecord) {
        res.status(400).json({ success: false, error: 'No active verification code found or code has expired' });
        return;
      }

      const isValid = await tokenService.compare(code, otpRecord.otpCodeHash);
      if (!isValid) {
        await sessionRepo.incrementOtpAttempts(otpRecord.id);
        res.status(401).json({ success: false, error: 'Invalid verification code' });
        return;
      }

      await sessionRepo.markOtpVerified(otpRecord.id);

      // Fetch or auto-register user
      let user = await userRepo.findByPhoneNumber(cleanPhone);
      let isNewUser = false;
      if (!user) {
        user = await userRepo.create(cleanPhone);
        isNewUser = true;
      }

      // Generate Tokens
      if (!user) {
        res.status(500).json({ success: false, error: 'User creation failed' });
        return;
      }

      const tokenPayload = { userId: user.id, phoneNumber: user.phoneNumber, deviceId };
      const accessToken = tokenService.generateAccessToken(tokenPayload);
      const refreshToken = tokenService.generateRefreshToken(tokenPayload);
      const refreshHash = await tokenService.hash(refreshToken);

      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await sessionRepo.createSession(user.id, deviceId, refreshHash, refreshExpires);

      res.status(200).json({
        success: true,
        isNewUser,
        user,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900, // 15 mins
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Verification failed' });
    }
  }

  /**
   * POST /api/v1/auth/google-sync
   * Authenticate / sync user from Google Sign-In or Firebase Auth
   */
  async googleSync(req: Request, res: Response): Promise<void> {
    try {
      const { uid, email, displayName, photoUrl, phoneNumber = '', deviceId = 'android_device_primary' } = req.body;
      if (!uid) {
        res.status(400).json({ success: false, error: 'Firebase / Google user ID is required' });
        return;
      }

      let user = await userRepo.findById(uid);
      let isNewUser = false;
      if (!user && phoneNumber) {
        user = await userRepo.findByPhoneNumber(phoneNumber);
      }

      if (!user) {
        isNewUser = true;
        const newUser: any = {
          id: uid,
          phoneNumber: phoneNumber || (email ? `google_${uid.substring(0, 8)}` : `mkd_${uid.substring(0, 8)}`),
          displayName: displayName || 'MKD User',
          about: 'Hey there! I am using MKD.',
          avatarUrl: photoUrl || '',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const { db } = await import('../database/db');
        if (db.isPg) {
          await db.pgPool.query(
            `INSERT INTO users (id, phone_number, display_name, about, avatar_url, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url`,
            [newUser.id, newUser.phoneNumber, newUser.displayName, newUser.about, newUser.avatarUrl, newUser.isActive, newUser.createdAt, newUser.updatedAt]
          );
        } else {
          db.memoryUsers.set(newUser.id, newUser);
        }
        user = newUser;
      } else {
        if (displayName || photoUrl) {
          await userRepo.updateProfile(user.id, displayName, user.about);
          if (photoUrl) {
            await userRepo.updateAvatar(user.id, photoUrl);
          }
          user = (await userRepo.findById(user.id)) || user;
        }
      }

      if (!user) {
        res.status(500).json({ success: false, error: 'User creation failed' });
        return;
      }

      const tokenPayload = { userId: user.id, phoneNumber: user.phoneNumber, deviceId };
      const accessToken = tokenService.generateAccessToken(tokenPayload);
      const refreshToken = tokenService.generateRefreshToken(tokenPayload);
      const refreshHash = await tokenService.hash(refreshToken);
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await sessionRepo.createSession(user.id, deviceId, refreshHash, refreshExpires);

      res.status(200).json({
        success: true,
        isNewUser,
        user,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Google sync failed' });
    }
  }

  /**
   * POST /api/v1/auth/refresh-token
   */
  async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken, deviceId = 'android_device_primary' } = req.body;

      if (!refreshToken) {
        res.status(400).json({ success: false, error: 'Refresh token is required' });
        return;
      }

      const decoded = tokenService.verifyRefreshToken(refreshToken);
      if (!decoded) {
        res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
        return;
      }

      const session = await sessionRepo.findSession(decoded.userId, deviceId);
      if (!session) {
        res.status(401).json({ success: false, error: 'Session revoked or expired' });
        return;
      }

      const user = await userRepo.findById(decoded.userId);
      if (!user) {
        res.status(404).json({ success: false, error: 'User account not found' });
        return;
      }

      // Issue new access token + rotate refresh token
      const newPayload = { userId: user.id, phoneNumber: user.phoneNumber, deviceId };
      const newAccessToken = tokenService.generateAccessToken(newPayload);
      const newRefreshToken = tokenService.generateRefreshToken(newPayload);
      const newRefreshHash = await tokenService.hash(newRefreshToken);

      await sessionRepo.revokeSession(user.id, deviceId);
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await sessionRepo.createSession(user.id, deviceId, newRefreshHash, expires);

      res.status(200).json({
        success: true,
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Token refresh failed' });
    }
  }

  /**
   * POST /api/v1/auth/logout
   */
  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (req.user) {
        await sessionRepo.revokeSession(req.user.userId, req.user.deviceId);
      }
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Logout failed' });
    }
  }

  /**
   * DELETE /api/v1/auth/account
   */
  async deleteAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await userRepo.softDelete(req.user.userId);
      await sessionRepo.revokeAllUserSessions(req.user.userId);
      res.status(200).json({ success: true, message: 'Account deleted and all sessions revoked' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Account deletion failed' });
    }
  }
}

export const authController = new AuthController();
