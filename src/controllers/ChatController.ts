import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { chatRepository } from '../database/repositories/ChatRepository';
import { userRepository } from '../database/repositories/UserRepository';
import { getChatGateway } from '../websocket/ChatGateway';
import { pushNotificationService } from '../services/PushNotificationService';

export class ChatController {
  /**
   * Get all conversations for current user
   */
  async getUserChats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const chats = await chatRepository.getUserChats(userId);
      res.status(200).json({
        success: true,
        data: chats
      });
    } catch (error: any) {
      console.error('[ChatController] getUserChats error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve conversations' }
      });
    }
  }

  /**
   * Start or retrieve 1-to-1 direct chat
   */
  async getOrCreateDirectChat(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const currentUserId = req.user.userId;
      let { targetUserId, phoneNumber } = req.body;

      if (!targetUserId && !phoneNumber) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'targetUserId or phoneNumber is required' }
        });
        return;
      }

      if (phoneNumber && !targetUserId) {
        const user = await userRepository.findByPhoneNumber(phoneNumber);
        if (!user) {
          res.status(404).json({
            success: false,
            error: { code: 'USER_NOT_FOUND', message: 'No registered MKD user with this phone number' }
          });
          return;
        }
        targetUserId = user.id;
      }

      if (currentUserId === targetUserId) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_CHAT', message: 'Cannot start direct chat with yourself' }
        });
        return;
      }

      const chat = await chatRepository.getOrCreateDirectChat(currentUserId, targetUserId);
      res.status(200).json({
        success: true,
        data: chat
      });
    } catch (error: any) {
      console.error('[ChatController] getOrCreateDirectChat error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create or retrieve direct chat' }
      });
    }
  }

  /**
   * Get messages for a specific chat with pagination
   */
  async getChatMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const { chatId } = req.params;
      const limit = parseInt(req.query.limit as string || '50', 10);
      const before = req.query.before ? new Date(req.query.before as string) : undefined;

      const participants = await chatRepository.getChatParticipantIds(chatId);
      if (!participants.includes(userId)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' }
        });
        return;
      }

      const messages = await chatRepository.getMessages(chatId, limit, before);
      res.status(200).json({
        success: true,
        data: messages
      });
    } catch (error: any) {
      console.error('[ChatController] getChatMessages error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to load messages' }
      });
    }
  }

  /**
   * Send a message via REST API (fallback if WebSocket is offline)
   */
  async sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const senderId = req.user.userId;
      const { chatId } = req.params;
      const { content, messageType, mediaUrl, mediaDuration, mediaSize, replyToId } = req.body;

      const participants = await chatRepository.getChatParticipantIds(chatId);
      if (!participants.includes(senderId)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' }
        });
        return;
      }

      const message = await chatRepository.saveMessage({
        chatId,
        senderId,
        content: content || '',
        messageType: messageType || 'TEXT',
        mediaUrl,
        mediaDuration,
        mediaSize,
        replyToId
      });

      // Forward to online participants via WebSocket gateway and push notifications
      const gateway = getChatGateway();
      let senderUser: any = null;
      try {
        senderUser = await userRepository.findById(senderId);
      } catch (e) {}
      const senderName = senderUser?.displayName || 'MKD';

      for (const pId of participants) {
        if (pId !== senderId) {
          if (gateway && gateway.isUserOnline(pId)) {
            gateway.sendToUser(pId, {
              type: 'message:receive',
              data: message
            });
          }

          // Background push notification
          try {
            const targetUser = await userRepository.findById(pId);
            if (targetUser?.pushToken) {
              await pushNotificationService.sendPushNotification({
                pushToken: targetUser.pushToken,
                title: senderName,
                body: message.messageType === 'TEXT' ? (message.content || 'New message') : `[${message.messageType}]`,
                data: {
                  type: 'NEW_MESSAGE',
                  chatId: chatId,
                  messageId: message.id,
                  senderId: senderId,
                  senderName: senderName
                }
              });
            }
          } catch (e: any) {
            console.error('[ChatController] push notification error:', e.message);
          }
        }
      }

      res.status(201).json({
        success: true,
        data: message
      });
    } catch (error: any) {
      console.error('[ChatController] sendMessage error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to send message' }
      });
    }
  }

  /**
   * Mark all unread messages in a chat as read
   */
  async markChatAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = req.user.userId;
      const { chatId } = req.params;

      const readMessageIds = await chatRepository.markChatAsRead(chatId, userId);

      // Notify peer participants via WebSocket
      const gateway = getChatGateway();
      if (gateway) {
        const participants = await chatRepository.getChatParticipantIds(chatId);
        for (const pId of participants) {
          if (pId !== userId) {
            gateway.sendToUser(pId, {
              type: 'message:status_update',
              data: {
                chatId,
                messageIds: readMessageIds,
                status: 'READ',
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      }

      res.status(200).json({
        success: true,
        data: {
          markedReadCount: readMessageIds.length,
          messageIds: readMessageIds
        }
      });
    } catch (error: any) {
      console.error('[ChatController] markChatAsRead error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to mark messages as read' }
      });
    }
  }

  /**
   * Create a new group chat
   */
  async createGroup(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const creatorId = req.user.userId;
      const { name, description = '', avatarUrl = '', memberIds = [] } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Group name is required' }
        });
        return;
      }

      const group = await chatRepository.createGroup(creatorId, name.trim(), description, avatarUrl, memberIds);
      res.status(201).json({
        success: true,
        data: group
      });
    } catch (error: any) {
      console.error('[ChatController] createGroup error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create group' }
      });
    }
  }

  /**
   * Get members of a group
   */
  async getGroupMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { chatId } = req.params;
      const members = await chatRepository.getGroupMembers(chatId);
      res.status(200).json({
        success: true,
        data: members
      });
    } catch (error: any) {
      console.error('[ChatController] getGroupMembers error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to get group members' }
      });
    }
  }

  /**
   * Add members to group
   */
  async addGroupMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const currentUserId = req.user.userId;
      const { chatId } = req.params;
      const { memberIds } = req.body;

      if (!Array.isArray(memberIds) || memberIds.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'memberIds array is required' }
        });
        return;
      }

      await chatRepository.addGroupMembers(chatId, currentUserId, memberIds);
      res.status(200).json({
        success: true,
        message: 'Members added successfully'
      });
    } catch (error: any) {
      console.error('[ChatController] addGroupMembers error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to add members' }
      });
    }
  }

  /**
   * Remove member from group or leave group
   */
  async removeGroupMember(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const currentUserId = req.user.userId;
      const { chatId, targetUserId } = req.params;

      await chatRepository.removeGroupMember(chatId, currentUserId, targetUserId);
      res.status(200).json({
        success: true,
        message: 'Member removed successfully'
      });
    } catch (error: any) {
      console.error('[ChatController] removeGroupMember error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to remove member' }
      });
    }
  }
}

export const chatController = new ChatController();
