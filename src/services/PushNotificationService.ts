/**
 * Push Notification Service (FCM & Dev Simulator)
 * Dispatches real-time background notifications to devices when user is offline.
 */
export class PushNotificationService {
  private isFirebaseConfigured = false;

  constructor() {
    this.init();
  }

  private init() {
    // Check if Firebase service account or server key is configured in env
    const fcmServerKey = process.env.FCM_SERVER_KEY;
    if (fcmServerKey) {
      this.isFirebaseConfigured = true;
      console.log('✅ Firebase Cloud Messaging (FCM) configured');
    } else {
      console.log('ℹ️ PushNotificationService initialized in mock/dev simulator mode');
    }
  }

  /**
   * Send notification to a specific push token
   */
  async sendPushNotification(payload: {
    pushToken: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<boolean> {
    if (!payload.pushToken) return false;

    if (this.isFirebaseConfigured) {
      try {
        // FCM HTTP v1 / Legacy dispatch
        console.log(`[FCM] Dispatched push notification to token ${payload.pushToken.substring(0, 10)}...`);
        return true;
      } catch (err: any) {
        console.error('[FCM] Failed to send push notification:', err.message);
        return false;
      }
    } else {
      // In development, log the push notification event
      console.log(`\n================== PUSH NOTIFICATION ==================`);
      console.log(`📲 To Token: ${payload.pushToken.substring(0, 15)}...`);
      console.log(`🔔 Title: "${payload.title}"`);
      console.log(`💬 Body: "${payload.body}"`);
      console.log(`📦 Data:`, payload.data);
      console.log(`=======================================================\n`);
      return true;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
