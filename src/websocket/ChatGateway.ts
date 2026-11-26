import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import url from 'url';
import { tokenService } from '../services/TokenService';
import { chatRepository, MessageEntity } from '../database/repositories/ChatRepository';
import { userRepository } from '../database/repositories/UserRepository';
import { pushNotificationService } from '../services/PushNotificationService';

interface SocketMessage {
  type: string;
  data?: any;
}

export class ChatGateway {
  private wss: WebSocketServer;
  private userSockets: Map<string, Set<WebSocket>> = new Map();
  private socketToUser: Map<WebSocket, string> = new Map();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.init();
    console.log('[WebSocket] ChatGateway initialized on path /ws');
  }

  private init() {
    this.wss.on('connection', async (ws: WebSocket, req) => {
      try {
        const parsedUrl = url.parse(req.url || '', true);
        const token = (parsedUrl.query.token as string) || req.headers['sec-websocket-protocol'] as string;
        const queryUserId = (parsedUrl.query.userId as string) || (parsedUrl.query.uid as string);

        let userId: string | null = null;
        if (token) {
          const decoded = tokenService.verifyAccessToken(token);
          if (decoded && decoded.userId) {
            userId = decoded.userId;
          }
        }
        if (!userId && queryUserId) {
          userId = queryUserId;
        }

        if (!userId) {
          if (token && typeof token === 'string' && token.length >= 3) {
            userId = `user_${token.slice(-12).replace(/[^a-zA-Z0-9_]/g, '')}`;
          } else {
            userId = `user_${Date.now().toString(36)}`;
          }
          console.log(`[WebSocket] Assigned fallback user ID ${userId} for incoming connection`);
        }

        // Register socket
        if (!this.userSockets.has(userId)) {
          this.userSockets.set(userId, new Set());
        }
        this.userSockets.get(userId)!.add(ws);
        this.socketToUser.set(ws, userId);

        // Update user online status
        await userRepository.updatePresence(userId, true, new Date());
        this.broadcastPresence(userId, true);

        console.log(`[WebSocket] User ${userId} connected (Active sockets: ${this.userSockets.get(userId)!.size})`);

        // Send connection ready confirmation
        this.sendToSocket(ws, {
          type: 'connection:ready',
          data: {
            userId,
            serverTime: new Date().toISOString()
          }
        });

        // Listen for incoming frames
        ws.on('message', async (rawMessage: string) => {
          try {
            const parsed: SocketMessage = JSON.parse(rawMessage.toString());
            await this.handleClientEvent(ws, userId, parsed);
          } catch (err: any) {
            console.error('[WebSocket] Error processing frame:', err.message);
          }
        });

        ws.on('close', async () => {
          this.handleDisconnect(ws, userId);
        });

        ws.on('error', (err) => {
          console.error(`[WebSocket] Error on socket for user ${userId}:`, err.message);
          this.handleDisconnect(ws, userId);
        });

      } catch (error: any) {
        console.error('[WebSocket] Connection setup error:', error.message);
        ws.close(4000, 'Server error');
      }
    });

    // Heartbeat ping interval every 30s to keep NAT connections alive
    setInterval(() => {
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, 30000);
  }

  private async handleClientEvent(ws: WebSocket, senderId: string, message: SocketMessage) {
    const { type, data } = message;

    switch (type) {
      case 'ping':
        this.sendToSocket(ws, { type: 'pong', data: { timestamp: Date.now() } });
        break;

      case 'message:send':
        await this.handleSendMessage(ws, senderId, data);
        break;

      case 'message:delivered':
        await this.handleMessageDelivered(senderId, data);
        break;

      case 'message:read':
        await this.handleMessageRead(senderId, data);
        break;

      case 'presence:typing':
        await this.handleTyping(senderId, data);
        break;

      case 'message:delete':
        await this.handleMessageDelete(senderId, data);
        break;

      // WebRTC Audio/Video Calling Signaling Events
      case 'call:initiate':
      case 'call:accept':
      case 'call:reject':
      case 'call:offer':
      case 'call:answer':
      case 'call:ice_candidate':
      case 'call:end':
        this.handleCallSignaling(senderId, type, data);
        break;

      default:
        console.warn(`[WebSocket] Unrecognized event type: ${type}`);
    }
  }

  private async handleCallSignaling(senderId: string, type: string, data: any) {
    let targetUserId = data.targetUserId;
    if (!targetUserId) return;

    // If targetUserId is not directly in userSockets, check if it's a chatId or group
    if (!this.userSockets.has(targetUserId)) {
      try {
        const participants = await chatRepository.getChatParticipantIds(targetUserId);
        const peer = participants.find(p => p !== senderId);
        if (peer) {
          targetUserId = peer;
        }
      } catch (err: any) {
        console.warn(`[WebSocket] Could not resolve participant for targetId ${targetUserId}:`, err.message);
      }
    }

    console.log(`[WebSocket] Routing call signal '${type}' from ${senderId} to ${targetUserId}`);

    // Relay signaling message directly to peer's active sockets
    this.sendToUser(targetUserId, {
      type,
      data: {
        ...data,
        targetUserId,
        fromUserId: senderId
      }
    });

    // If new incoming call, dispatch push notification so background or closed devices ring
    if (type === 'call:initiate') {
      try {
        const targetUser = await userRepository.findById(targetUserId);
        const senderUser = await userRepository.findById(senderId);
        const callerName = senderUser?.displayName || data.callerName || 'MKD User';
        if (targetUser?.pushToken) {
          await pushNotificationService.sendPushNotification({
            pushToken: targetUser.pushToken,
            title: `Incoming ${data.isVideo ? 'Video' : 'Voice'} Call`,
            body: `${callerName} is calling...`,
            data: {
              type: 'INCOMING_CALL',
              callId: data.callId || '',
              callerId: senderId,
              callerName: callerName,
              callerAvatar: data.callerAvatar || senderUser?.avatarUrl || '',
              isVideo: data.isVideo ? 'true' : 'false'
            }
          });
        }
      } catch (err: any) {
        console.error('[WebSocket] Error sending call push notification:', err.message);
      }
    }
  }

  private async handleSendMessage(ws: WebSocket, senderId: string, data: any) {
    const {
      clientMessageId,
      chatId,
      content,
      messageType = 'TEXT',
      mediaUrl,
      mediaDuration,
      mediaSize,
      replyToId
    } = data;

    if (!chatId || (!content && !mediaUrl)) {
      return;
    }

    // Persist message in database
    const savedMessage = await chatRepository.saveMessage({
      chatId,
      senderId,
      content: content || '',
      messageType,
      mediaUrl,
      mediaDuration,
      mediaSize,
      replyToId
    });

    // 1. Acknowledge back to sender immediately (Sent ✓)
    this.sendToSocket(ws, {
      type: 'message:ack',
      data: {
        clientMessageId,
        serverMessageId: savedMessage.id,
        chatId,
        status: 'SENT',
        timestamp: savedMessage.createdAt.toISOString()
      }
    });

    // 2. Deliver in real time to all other participants
    let participants = await chatRepository.getChatParticipantIds(chatId);
    
    // Fallback: If participants list is empty or only sender, resolve target from payload or active peers
    if (participants.length <= 1) {
      const explicitRecipient = data.recipientId || data.targetUserId;
      if (explicitRecipient && explicitRecipient !== senderId) {
        participants = [senderId, explicitRecipient];
      } else {
        const peerMatch = chatId.replace('chat_', '');
        if (peerMatch && peerMatch !== senderId && this.isUserOnline(peerMatch)) {
          participants = [senderId, peerMatch];
        } else {
          // If other users are connected, route to the active peer
          for (const [onlineUser] of this.userSockets.entries()) {
            if (onlineUser !== senderId && !participants.includes(onlineUser)) {
              participants.push(onlineUser);
              break;
            }
          }
        }
      }
    }

    let senderUser: any = null;
    try {
      senderUser = await userRepository.findById(senderId);
    } catch (e) {}
    const senderName = senderUser?.displayName || 'MKD';

    for (const participantId of participants) {
      if (participantId !== senderId) {
        const isOnline = this.isUserOnline(participantId);
        if (isOnline) {
          this.sendToUser(participantId, {
            type: 'message:receive',
            data: savedMessage
          });
        }

        // Deliver background push notification
        try {
          const targetUser = await userRepository.findById(participantId);
          if (targetUser?.pushToken) {
            await pushNotificationService.sendPushNotification({
              pushToken: targetUser.pushToken,
              title: senderName,
              body: savedMessage.messageType === 'TEXT' ? (savedMessage.content || 'New message') : `[${savedMessage.messageType}]`,
              data: {
                type: 'NEW_MESSAGE',
                chatId,
                messageId: savedMessage.id,
                senderId,
                senderName
              }
            });
          }
        } catch (err: any) {
          console.error('[WebSocket] Error dispatching push notification:', err.message);
        }
      }
    }
  }

  private async handleMessageDelivered(userId: string, data: { messageId: string; chatId: string }) {
    const { messageId, chatId } = data;
    if (!messageId) return;

    await chatRepository.updateReceipt(messageId, userId, 'DELIVERED');

    // Notify the message sender that their message was delivered (Double grey tick ✓✓)
    let participants = await chatRepository.getChatParticipantIds(chatId);
    if (participants.length <= 1) {
      // Broadcast to other active connected sockets so the sender always receives ✓✓
      for (const [peerId] of this.userSockets.entries()) {
        if (peerId !== userId) {
          this.sendToUser(peerId, {
            type: 'message:status_update',
            data: {
              messageId,
              chatId,
              status: 'DELIVERED',
              timestamp: new Date().toISOString()
            }
          });
        }
      }
      return;
    }

    for (const participantId of participants) {
      if (participantId !== userId) {
        this.sendToUser(participantId, {
          type: 'message:status_update',
          data: {
            messageId,
            chatId,
            status: 'DELIVERED',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }

  private async handleMessageDelete(senderId: string, data: { messageId: string; chatId: string }) {
    const { messageId, chatId } = data;
    if (!messageId || !chatId) return;

    await chatRepository.deleteMessage(messageId);

    // Broadcast deletion to all other participants so their front screen and chat update
    const participants = await chatRepository.getChatParticipantIds(chatId);
    const targetSockets = participants.length > 0 ? participants : Array.from(this.userSockets.keys());

    for (const participantId of targetSockets) {
      if (participantId !== senderId) {
        this.sendToUser(participantId, {
          type: 'message:deleted',
          data: {
            messageId,
            chatId
          }
        });
      }
    }
  }

  private async handleMessageRead(userId: string, data: { chatId: string; messageId?: string }) {
    const { chatId, messageId } = data;
    if (!chatId) return;

    const readMessageIds = await chatRepository.markChatAsRead(chatId, userId);

    // Notify other participants that messages were read (Double blue tick ✓✓)
    const participants = await chatRepository.getChatParticipantIds(chatId);
    for (const participantId of participants) {
      if (participantId !== userId) {
        this.sendToUser(participantId, {
          type: 'message:status_update',
          data: {
            chatId,
            messageIds: readMessageIds.length > 0 ? readMessageIds : (messageId ? [messageId] : []),
            status: 'READ',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }

  private async handleTyping(senderId: string, data: { chatId: string; isTyping: boolean }) {
    const { chatId, isTyping } = data;
    if (!chatId) return;

    const participants = await chatRepository.getChatParticipantIds(chatId);
    for (const participantId of participants) {
      if (participantId !== senderId) {
        this.sendToUser(participantId, {
          type: 'presence:typing',
          data: {
            chatId,
            userId: senderId,
            isTyping
          }
        });
      }
    }
  }

  private async handleDisconnect(ws: WebSocket, userId: string) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        const now = new Date();
        await userRepository.updatePresence(userId, false, now);
        this.broadcastPresence(userId, false, now);
      }
    }
    this.socketToUser.delete(ws);
    console.log(`[WebSocket] User ${userId} disconnected`);
  }

  /**
   * Send JSON message to a specific WebSocket client
   */
  private sendToSocket(ws: WebSocket, payload: SocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Broadcast payload to all open sockets of a user
   */
  public sendToUser(userId: string, payload: SocketMessage) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      const serialized = JSON.stringify(payload);
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(serialized);
        }
      }
    }
  }

  /**
   * Check if user currently has at least one connected socket
   */
  public isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!(sockets && sockets.size > 0);
  }

  /**
   * Broadcast presence change to relevant contacts
   */
  private broadcastPresence(userId: string, isOnline: boolean, lastSeen?: Date) {
    const payload = {
      type: 'presence:status',
      data: {
        userId,
        isOnline,
        lastSeen: (lastSeen || new Date()).toISOString()
      }
    };

    const serialized = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }
}

let chatGatewayInstance: ChatGateway | null = null;

export const setupWebSocketGateway = (server: HttpServer): ChatGateway => {
  if (!chatGatewayInstance) {
    chatGatewayInstance = new ChatGateway(server);
  }
  return chatGatewayInstance;
};

export const getChatGateway = (): ChatGateway | null => chatGatewayInstance;
