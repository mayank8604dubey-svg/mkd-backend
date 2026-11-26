import { query, isPostgresConnected } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { userRepository } from './UserRepository';

export interface ChatParticipant {
  chatId: string;
  userId: string;
  role: 'MEMBER' | 'ADMIN';
  joinedAt: Date;
}

export interface MessageEntity {
  id: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  mediaUrl?: string;
  mediaDuration?: number;
  mediaSize?: number;
  replyToId?: string;
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
  };
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ';
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatEntity {
  id: string;
  isGroup: boolean;
  name?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  participants: string[];
  recipient?: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    phoneNumber: string;
    about?: string;
    isOnline?: boolean;
    lastSeen?: Date;
  };
  lastMessage?: MessageEntity;
  unreadCount: number;
}

// In-Memory storage fallback when PostgreSQL is not connected
const memoryChats = new Map<string, any>();
const memoryParticipants = new Map<string, { chatId: string; userId: string; role: string; joinedAt: Date }[]>();
const memoryMessages = new Map<string, MessageEntity[]>();
const memoryReceipts = new Map<string, Map<string, { status: string; timestamp: Date }>>(); // messageId -> userId -> receipt

export class ChatRepository {
  /**
   * Find an existing 1-on-1 direct chat between two users, or create a new one
   */
  async getOrCreateDirectChat(userId1: string, userId2: string): Promise<ChatEntity> {
    if (isPostgresConnected()) {
      // Find chat where both users are participants and is_group = false
      const findSql = `
        SELECT c.id, c.is_group, c.name, c.avatar_url, c.created_at, c.updated_at
        FROM chats c
        JOIN chat_participants cp1 ON c.id = cp1.chat_id AND cp1.user_id = $1
        JOIN chat_participants cp2 ON c.id = cp2.chat_id AND cp2.user_id = $2
        WHERE c.is_group = FALSE
        LIMIT 1;
      `;
      const result = await query(findSql, [userId1, userId2]);

      if (result.rows.length > 0) {
        return this.formatChatEntity(result.rows[0], userId1);
      }

      // Create new direct chat
      const chatId = uuidv4();
      await query(
        'INSERT INTO chats (id, is_group, created_at, updated_at) VALUES ($1, FALSE, NOW(), NOW())',
        [chatId]
      );

      await query(
        `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
         VALUES ($1, $2, 'MEMBER', NOW()), ($1, $3, 'MEMBER', NOW())`,
        [chatId, userId1, userId2]
      );

      return (await this.getChatById(chatId, userId1))!;
    } else {
      // In-Memory implementation
      for (const [id, chat] of memoryChats.entries()) {
        if (!chat.is_group) {
          const parts = memoryParticipants.get(id) || [];
          const userIds = parts.map(p => p.userId);
          if (userIds.includes(userId1) && userIds.includes(userId2)) {
            return this.formatChatEntityMemory(chat, userId1);
          }
        }
      }

      // Create new chat in memory
      const chatId = uuidv4();
      const now = new Date();
      const chat = {
        id: chatId,
        is_group: false,
        name: null,
        avatar_url: null,
        created_at: now,
        updated_at: now
      };
      memoryChats.set(chatId, chat);
      memoryParticipants.set(chatId, [
        { chatId, userId: userId1, role: 'MEMBER', joinedAt: now },
        { chatId, userId: userId2, role: 'MEMBER', joinedAt: now }
      ]);
      memoryMessages.set(chatId, []);

      return this.formatChatEntityMemory(chat, userId1);
    }
  }

  /**
   * Get all chats for a specific user
   */
  async getUserChats(userId: string): Promise<ChatEntity[]> {
    if (isPostgresConnected()) {
      const sql = `
        SELECT c.id, c.is_group, c.name, c.avatar_url, c.created_at, c.updated_at
        FROM chats c
        JOIN chat_participants cp ON c.id = cp.chat_id
        WHERE cp.user_id = $1
        ORDER BY c.updated_at DESC;
      `;
      const result = await query(sql, [userId]);
      const chats: ChatEntity[] = [];

      for (const row of result.rows) {
        const chat = await this.formatChatEntity(row, userId);
        chats.push(chat);
      }
      return chats;
    } else {
      const chats: ChatEntity[] = [];
      for (const [id, chat] of memoryChats.entries()) {
        const parts = memoryParticipants.get(id) || [];
        if (parts.some(p => p.userId === userId)) {
          chats.push(await this.formatChatEntityMemory(chat, userId));
        }
      }
      return chats.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }
  }

  /**
   * Get a specific chat by ID
   */
  async getChatById(chatId: string, currentUserId: string): Promise<ChatEntity | null> {
    if (isPostgresConnected()) {
      const result = await query('SELECT * FROM chats WHERE id = $1', [chatId]);
      if (result.rows.length === 0) return null;
      return this.formatChatEntity(result.rows[0], currentUserId);
    } else {
      const chat = memoryChats.get(chatId);
      if (!chat) return null;
      return this.formatChatEntityMemory(chat, currentUserId);
    }
  }

  /**
   * Create a new group chat
   */
  async createGroup(creatorId: string, name: string, description: string = '', avatarUrl: string = '', memberIds: string[] = []): Promise<ChatEntity> {
    const chatId = uuidv4();
    const now = new Date();
    const allMembers = Array.from(new Set([creatorId, ...memberIds]));

    if (isPostgresConnected()) {
      await query(
        'INSERT INTO chats (id, is_group, name, avatar_url, created_at, updated_at) VALUES ($1, TRUE, $2, $3, $4, $4)',
        [chatId, name, avatarUrl || null, now]
      );

      for (const mId of allMembers) {
        const role = mId === creatorId ? 'ADMIN' : 'MEMBER';
        await query(
          'INSERT INTO chat_participants (chat_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)',
          [chatId, mId, role, now]
        );
      }

      // Initial system message
      const creator = await userRepository.findById(creatorId);
      await this.saveMessage({
        chatId,
        senderId: creatorId,
        content: `${creator?.displayName || 'User'} created group "${name}"`,
        messageType: 'TEXT'
      });

      return (await this.getChatById(chatId, creatorId))!;
    } else {
      const chat = {
        id: chatId,
        is_group: true,
        name,
        avatar_url: avatarUrl || null,
        created_at: now,
        updated_at: now
      };
      memoryChats.set(chatId, chat);

      const parts = allMembers.map(mId => ({
        chatId,
        userId: mId,
        role: mId === creatorId ? 'ADMIN' : 'MEMBER',
        joinedAt: now
      }));
      memoryParticipants.set(chatId, parts);
      memoryMessages.set(chatId, []);

      const creator = await userRepository.findById(creatorId);
      await this.saveMessage({
        chatId,
        senderId: creatorId,
        content: `${creator?.displayName || 'User'} created group "${name}"`,
        messageType: 'TEXT'
      });

      return this.formatChatEntityMemory(chat, creatorId);
    }
  }

  /**
   * Get members of a group with role and user profile
   */
  async getGroupMembers(chatId: string): Promise<any[]> {
    if (isPostgresConnected()) {
      const sql = `
        SELECT cp.user_id, cp.role, cp.joined_at, u.display_name, u.avatar_url, u.phone_number, u.about
        FROM chat_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.chat_id = $1
        ORDER BY cp.role DESC, cp.joined_at ASC;
      `;
      const result = await query(sql, [chatId]);
      return result.rows.map((r: any) => ({
        userId: r.user_id,
        role: r.role,
        joinedAt: r.joined_at,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        phoneNumber: r.phone_number,
        about: r.about
      }));
    } else {
      const parts = memoryParticipants.get(chatId) || [];
      const list = [];
      for (const p of parts) {
        const u = await userRepository.findById(p.userId);
        list.push({
          userId: p.userId,
          role: p.role,
          joinedAt: p.joinedAt,
          displayName: u?.displayName || 'MKD Member',
          avatarUrl: u?.avatarUrl,
          phoneNumber: u?.phoneNumber || '',
          about: u?.about
        });
      }
      return list;
    }
  }

  /**
   * Add new members to a group
   */
  async addGroupMembers(chatId: string, currentUserId: string, newMemberIds: string[]): Promise<boolean> {
    const now = new Date();
    if (isPostgresConnected()) {
      for (const mId of newMemberIds) {
        await query(
          `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
           VALUES ($1, $2, 'MEMBER', $3)
           ON CONFLICT (chat_id, user_id) DO NOTHING`,
          [chatId, mId, now]
        );
      }
      return true;
    } else {
      const parts = memoryParticipants.get(chatId) || [];
      const existingIds = new Set(parts.map(p => p.userId));
      for (const mId of newMemberIds) {
        if (!existingIds.has(mId)) {
          parts.push({ chatId, userId: mId, role: 'MEMBER', joinedAt: now });
        }
      }
      memoryParticipants.set(chatId, parts);
      return true;
    }
  }

  /**
   * Remove a member from a group (or member leaves group)
   */
  async removeGroupMember(chatId: string, currentUserId: string, targetUserId: string): Promise<boolean> {
    if (isPostgresConnected()) {
      await query('DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, targetUserId]);
      return true;
    } else {
      const parts = memoryParticipants.get(chatId) || [];
      const updated = parts.filter(p => p.userId !== targetUserId);
      memoryParticipants.set(chatId, updated);
      return true;
    }
  }

  /**
   * Get participant IDs for a chat
   */
  async getChatParticipantIds(chatId: string): Promise<string[]> {
    if (isPostgresConnected()) {
      const result = await query('SELECT user_id FROM chat_participants WHERE chat_id = $1', [chatId]);
      return result.rows.map((r: any) => r.user_id);
    } else {
      const parts = memoryParticipants.get(chatId) || [];
      return parts.map(p => p.userId);
    }
  }

  /**
   * Save a new message
   */
  async saveMessage(data: {
    id?: string;
    chatId: string;
    senderId: string;
    content: string;
    messageType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
    mediaUrl?: string;
    mediaDuration?: number;
    mediaSize?: number;
    replyToId?: string;
  }): Promise<MessageEntity> {
    const messageId = data.id || uuidv4();
    const type = data.messageType || 'TEXT';
    const now = new Date();

    if (isPostgresConnected()) {
      const insertSql = `
        INSERT INTO messages (id, chat_id, sender_id, content, message_type, media_url, media_duration, media_size, reply_to_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING *;
      `;
      const result = await query(insertSql, [
        messageId,
        data.chatId,
        data.senderId,
        data.content,
        type,
        data.mediaUrl || null,
        data.mediaDuration || null,
        data.mediaSize || null,
        data.replyToId || null,
        now
      ]);

      // Record sender receipt as SENT
      await query(
        `INSERT INTO message_receipts (message_id, user_id, status, timestamp)
         VALUES ($1, $2, 'SENT', $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET status = 'SENT', timestamp = $3;`,
        [messageId, data.senderId, now]
      );

      // Update chat's updated_at timestamp
      await query('UPDATE chats SET updated_at = $1 WHERE id = $2', [now, data.chatId]);

      const sender = await userRepository.findById(data.senderId);

      return {
        id: messageId,
        chatId: data.chatId,
        senderId: data.senderId,
        senderName: sender?.displayName || 'User',
        content: data.content,
        messageType: type,
        mediaUrl: data.mediaUrl,
        mediaDuration: data.mediaDuration,
        mediaSize: data.mediaSize,
        replyToId: data.replyToId,
        status: 'SENT',
        isDeleted: false,
        createdAt: now,
        updatedAt: now
      };
    } else {
      const sender = await userRepository.findById(data.senderId);
      const msg: MessageEntity = {
        id: messageId,
        chatId: data.chatId,
        senderId: data.senderId,
        senderName: sender?.displayName || 'User',
        content: data.content,
        messageType: type,
        mediaUrl: data.mediaUrl,
        mediaDuration: data.mediaDuration,
        mediaSize: data.mediaSize,
        replyToId: data.replyToId,
        status: 'SENT',
        isDeleted: false,
        createdAt: now,
        updatedAt: now
      };

      const msgs = memoryMessages.get(data.chatId) || [];
      msgs.push(msg);
      memoryMessages.set(data.chatId, msgs);

      // Update chat updated_at
      const chat = memoryChats.get(data.chatId);
      if (chat) {
        chat.updated_at = now;
      }

      // Record sender receipt
      if (!memoryReceipts.has(messageId)) {
        memoryReceipts.set(messageId, new Map());
      }
      memoryReceipts.get(messageId)!.set(data.senderId, { status: 'SENT', timestamp: now });

      return msg;
    }
  }

  /**
   * Get paginated messages for a chat
   */
  async getMessages(chatId: string, limit: number = 50, beforeTimestamp?: Date): Promise<MessageEntity[]> {
    if (isPostgresConnected()) {
      let sql = `
        SELECT m.*, u.display_name as sender_name
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chat_id = $1 AND m.is_deleted = FALSE
      `;
      const params: any[] = [chatId];

      if (beforeTimestamp) {
        params.push(beforeTimestamp);
        sql += ` AND m.created_at < $${params.length}`;
      }

      params.push(limit);
      sql += ` ORDER BY m.created_at DESC LIMIT $${params.length};`;

      const result = await query(sql, params);
      const messages: MessageEntity[] = [];

      for (const row of result.rows) {
        // Query highest receipt status for this message
        const receiptRes = await query(
          `SELECT status FROM message_receipts WHERE message_id = $1 AND user_id != $2 ORDER BY timestamp DESC LIMIT 1;`,
          [row.id, row.sender_id]
        );
        const receiptStatus = receiptRes.rows.length > 0 ? receiptRes.rows[0].status : 'SENT';

        messages.push({
          id: row.id,
          chatId: row.chat_id,
          senderId: row.sender_id,
          senderName: row.sender_name,
          content: row.content,
          messageType: row.message_type,
          mediaUrl: row.media_url,
          mediaDuration: row.media_duration,
          mediaSize: row.media_size,
          replyToId: row.reply_to_id,
          status: receiptStatus,
          isDeleted: row.is_deleted,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        });
      }

      // Return ascending order (chronological)
      return messages.reverse();
    } else {
      const msgs = memoryMessages.get(chatId) || [];
      let filtered = msgs.filter(m => !m.isDeleted);
      if (beforeTimestamp) {
        filtered = filtered.filter(m => m.createdAt.getTime() < beforeTimestamp.getTime());
      }
      const slice = filtered.slice(Math.max(0, filtered.length - limit));
      return slice;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    if (isPostgresConnected()) {
      await query('UPDATE messages SET is_deleted = TRUE, content = $1, media_url = NULL WHERE id = $2', ['🚫 This message was deleted', messageId]);
      return true;
    } else {
      for (const [chatId, msgs] of memoryMessages.entries()) {
        const msg = msgs.find(m => m.id === messageId);
        if (msg) {
          msg.isDeleted = true;
          msg.content = '🚫 This message was deleted';
          msg.mediaUrl = undefined;
          return true;
        }
      }
      return false;
    }
  }

  /**
   * Update message delivery or read receipt
   */
  async updateReceipt(messageId: string, userId: string, status: 'DELIVERED' | 'READ'): Promise<void> {
    const now = new Date();
    if (isPostgresConnected()) {
      await query(
        `INSERT INTO message_receipts (message_id, user_id, status, timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (message_id, user_id) DO UPDATE
         SET status = CASE
           WHEN message_receipts.status = 'READ' THEN 'READ'
           ELSE $3
         END,
         timestamp = $4;`,
        [messageId, userId, status, now]
      );
    } else {
      if (!memoryReceipts.has(messageId)) {
        memoryReceipts.set(messageId, new Map());
      }
      const existing = memoryReceipts.get(messageId)!.get(userId);
      if (existing?.status !== 'READ') {
        memoryReceipts.get(messageId)!.set(userId, { status, timestamp: now });
      }

      // Also update in memoryMessages list for convenience
      for (const [_, msgList] of memoryMessages.entries()) {
        const found = msgList.find(m => m.id === messageId);
        if (found) {
          if (status === 'READ') found.status = 'READ';
          else if (status === 'DELIVERED' && found.status !== 'READ') found.status = 'DELIVERED';
          break;
        }
      }
    }
  }

  /**
   * Mark all unread incoming messages in a chat as READ
   */
  async markChatAsRead(chatId: string, currentUserId: string): Promise<string[]> {
    const updatedMessageIds: string[] = [];
    const now = new Date();

    if (isPostgresConnected()) {
      // Find unread messages where current user is recipient
      const unreadSql = `
        SELECT m.id
        FROM messages m
        WHERE m.chat_id = $1 AND m.sender_id != $2
          AND NOT EXISTS (
            SELECT 1 FROM message_receipts mr
            WHERE mr.message_id = m.id AND mr.user_id = $2 AND mr.status = 'READ'
          );
      `;
      const result = await query(unreadSql, [chatId, currentUserId]);

      for (const row of result.rows) {
        await this.updateReceipt(row.id, currentUserId, 'READ');
        updatedMessageIds.push(row.id);
      }
    } else {
      const msgs = memoryMessages.get(chatId) || [];
      for (const msg of msgs) {
        if (msg.senderId !== currentUserId) {
          await this.updateReceipt(msg.id, currentUserId, 'READ');
          updatedMessageIds.push(msg.id);
        }
      }
    }

    return updatedMessageIds;
  }

  // --- Helper methods for entity formatting ---

  private async formatChatEntity(row: any, currentUserId: string): Promise<ChatEntity> {
    const participantIds = await this.getChatParticipantIds(row.id);
    let recipient: any = undefined;

    if (!row.is_group) {
      const otherUserId = participantIds.find(id => id !== currentUserId) || currentUserId;
      const user = await userRepository.findById(otherUserId);
      if (user) {
        recipient = {
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          phoneNumber: user.phoneNumber,
          about: user.about,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        };
      }
    }

    // Get last message
    const msgs = await this.getMessages(row.id, 1);
    const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

    // Calculate unread count
    let unreadCount = 0;
    if (isPostgresConnected()) {
      const countRes = await query(
        `SELECT COUNT(*) as count
         FROM messages m
         WHERE m.chat_id = $1 AND m.sender_id != $2
           AND NOT EXISTS (
             SELECT 1 FROM message_receipts mr
             WHERE mr.message_id = m.id AND mr.user_id = $2 AND mr.status = 'READ'
           );`,
        [row.id, currentUserId]
      );
      unreadCount = parseInt(countRes.rows[0]?.count || '0', 10);
    }

    return {
      id: row.id,
      isGroup: row.is_group,
      name: row.name || (recipient ? recipient.displayName : 'Chat'),
      avatarUrl: row.avatar_url || (recipient ? recipient.avatarUrl : undefined),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      participants: participantIds,
      recipient,
      lastMessage,
      unreadCount
    };
  }

  private async formatChatEntityMemory(chat: any, currentUserId: string): Promise<ChatEntity> {
    const parts = memoryParticipants.get(chat.id) || [];
    const participantIds = parts.map(p => p.userId);
    let recipient: any = undefined;

    if (!chat.is_group) {
      const otherUserId = participantIds.find(id => id !== currentUserId) || currentUserId;
      const user = await userRepository.findById(otherUserId);
      if (user) {
        recipient = {
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          phoneNumber: user.phoneNumber,
          about: user.about,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        };
      }
    }

    const msgs = memoryMessages.get(chat.id) || [];
    const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
    const unreadCount = msgs.filter(m => m.senderId !== currentUserId && m.status !== 'READ').length;

    return {
      id: chat.id,
      isGroup: chat.is_group,
      name: chat.name || (recipient ? recipient.displayName : 'Chat'),
      avatarUrl: chat.avatar_url || (recipient ? recipient.avatarUrl : undefined),
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
      participants: participantIds,
      recipient,
      lastMessage,
      unreadCount
    };
  }
}

export const chatRepository = new ChatRepository();
