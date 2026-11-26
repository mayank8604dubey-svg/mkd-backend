import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { cryptoRepository } from '../database/repositories/CryptoRepository';

export class CryptoController {
  /**
   * POST /api/v1/crypto/prekeys
   * Upload user's public identity & prekey bundle
   */
  async uploadPreKeyBundle(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const { identityKey, signedPreKey, signature, oneTimePreKeys = [] } = req.body;

      if (!identityKey || !signedPreKey || !signature) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'identityKey, signedPreKey, and signature are required' }
        });
        return;
      }

      await cryptoRepository.savePreKeyBundle({
        userId,
        identityKey,
        signedPreKey,
        signature,
        oneTimePreKeys
      });

      res.status(200).json({
        success: true,
        message: 'PreKey bundle stored successfully'
      });
    } catch (error: any) {
      console.error('[CryptoController] uploadPreKeyBundle error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to upload PreKey bundle' }
      });
    }
  }

  /**
   * GET /api/v1/crypto/prekeys/:userId
   * Retrieve recipient's public PreKey bundle for E2EE key exchange
   */
  async getPreKeyBundle(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const bundle = await cryptoRepository.getPreKeyBundle(userId);

      if (!bundle) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No pre-key bundle found for this user' }
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: bundle
      });
    } catch (error: any) {
      console.error('[CryptoController] getPreKeyBundle error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve PreKey bundle' }
      });
    }
  }
}

export const cryptoController = new CryptoController();
