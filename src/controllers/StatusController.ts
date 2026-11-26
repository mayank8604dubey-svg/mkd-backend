import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { statusRepository } from '../database/repositories/StatusRepository';

export class StatusController {
  /**
   * POST /api/v1/status
   */
  async createStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const { type = 'TEXT', textContent, mediaUrl, backgroundColorHex } = req.body;

      if (!textContent && !mediaUrl) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'textContent or mediaUrl is required' }
        });
        return;
      }

      const status = await statusRepository.createStatus({
        userId,
        type,
        textContent,
        mediaUrl,
        backgroundColorHex
      });

      res.status(201).json({
        success: true,
        data: status
      });
    } catch (error: any) {
      console.error('[StatusController] createStatus error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create status' }
      });
    }
  }

  /**
   * GET /api/v1/status
   */
  async getActiveStatuses(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const statuses = await statusRepository.getActiveStatuses();
      res.status(200).json({
        success: true,
        data: statuses
      });
    } catch (error: any) {
      console.error('[StatusController] getActiveStatuses error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch statuses' }
      });
    }
  }

  /**
   * POST /api/v1/status/:statusId/view
   */
  async markStatusViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const viewerId = req.user.userId;
      const { statusId } = req.params;

      await statusRepository.markViewed(statusId, viewerId);
      res.status(200).json({
        success: true,
        message: 'Status marked as viewed'
      });
    } catch (error: any) {
      console.error('[StatusController] markStatusViewed error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update status view' }
      });
    }
  }

  /**
   * DELETE /api/v1/status/:statusId
   */
  async deleteStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const { statusId } = req.params;

      const deleted = await statusRepository.deleteStatus(statusId, userId);
      if (deleted) {
        res.status(200).json({ success: true, message: 'Status deleted successfully' });
      } else {
        res.status(404).json({ success: false, error: 'Status not found or not owned by user' });
      }
    } catch (error: any) {
      console.error('[StatusController] deleteStatus error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to delete status' }
      });
    }
  }
}

export const statusController = new StatusController();
