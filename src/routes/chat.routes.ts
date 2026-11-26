import { Router } from 'express';
import { chatController } from '../controllers/ChatController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Protect all chat routes with JWT authentication
router.use(authMiddleware);

// Get conversations list
router.get('/', (req, res) => chatController.getUserChats(req, res));

// Start or get direct 1-to-1 chat
router.post('/direct', (req, res) => chatController.getOrCreateDirectChat(req, res));

// Create group chat
router.post('/group', (req, res) => chatController.createGroup(req, res));

// Group members management
router.get('/:chatId/members', (req, res) => chatController.getGroupMembers(req, res));
router.post('/:chatId/members', (req, res) => chatController.addGroupMembers(req, res));
router.delete('/:chatId/members/:targetUserId', (req, res) => chatController.removeGroupMember(req, res));

// Get chat messages
router.get('/:chatId/messages', (req, res) => chatController.getChatMessages(req, res));

// Send message (REST fallback)
router.post('/:chatId/messages', (req, res) => chatController.sendMessage(req, res));

// Mark chat as read
router.post('/:chatId/read', (req, res) => chatController.markChatAsRead(req, res));

export default router;
