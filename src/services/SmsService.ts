import crypto from 'crypto';
import { config } from '../config/environment';

export interface SendOtpResult {
  success: boolean;
  message?: string;
  error?: string;
}

export class SmsService {
  /**
   * Generates a cryptographically secure 6-digit numeric OTP code
   */
  generateOtp(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Dispatches the OTP SMS message to recipient phone
   */
  async sendOtp(phoneNumber: string, code: string): Promise<SendOtpResult> {
    const message = `Your MKD Messenger verification code is: ${code}. Do not share this code with anyone.`;

    // 1. Twilio SMS Provider
    if (config.sms.provider === 'twilio' && config.sms.twilio.accountSid && config.sms.twilio.authToken) {
      try {
        const auth = Buffer.from(`${config.sms.twilio.accountSid}:${config.sms.twilio.authToken}`).toString('base64');
        const body = new URLSearchParams({
          To: phoneNumber,
          From: config.sms.twilio.phoneNumber,
          Body: message,
        });

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilio.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        const resJson: any = await res.json();
        if (res.ok) {
          console.log(`[SMS SUCCESS] Twilio delivered SMS to ${phoneNumber} (SID: ${resJson.sid})`);
          return { success: true, message: 'SMS dispatched via Twilio' };
        } else {
          console.error('[SMS ERROR] Twilio delivery rejected:', resJson);
          return { success: false, error: resJson.message || 'Twilio SMS delivery failed' };
        }
      } catch (e: any) {
        console.error('[SMS ERROR] Twilio request exception:', e);
        return { success: false, error: e.message || 'Twilio SMS request failed' };
      }
    }

    // 2. Generic HTTP SMS Gateway / Webhook
    if ((config.sms.provider === 'http' || config.sms.provider === 'gateway') && config.sms.gatewayUrl) {
      try {
        const url = config.sms.gatewayUrl
          .replace('{to}', encodeURIComponent(phoneNumber))
          .replace('{message}', encodeURIComponent(message))
          .replace('{code}', encodeURIComponent(code));

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.sms.gatewayApiKey) {
          headers['Authorization'] = `Bearer ${config.sms.gatewayApiKey}`;
          headers['X-API-Key'] = config.sms.gatewayApiKey;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ to: phoneNumber, message, code }),
        });

        if (res.ok) {
          console.log(`[SMS SUCCESS] Gateway delivered SMS to ${phoneNumber}`);
          return { success: true, message: 'SMS dispatched via HTTP Gateway' };
        } else {
          const text = await res.text();
          console.error(`[SMS ERROR] Gateway rejected SMS: HTTP ${res.status}: ${text}`);
          return { success: false, error: `SMS gateway error (${res.status}): ${text}` };
        }
      } catch (e: any) {
        console.error('[SMS ERROR] Gateway exception:', e);
        return { success: false, error: e.message || 'Gateway SMS request failed' };
      }
    }

    // 3. If in production and a specific real SMS provider was explicitly requested but missing credentials
    if (config.nodeEnv === 'production' && config.sms.provider !== 'mock' && config.sms.provider !== '') {
      const errorMsg = 'SMS service not configured on server. Please configure TWILIO or SMS_GATEWAY credentials in backend/.env';
      console.error(`[SMS ERROR] ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // 4. Fallback/Mock mode: Generates verification code and logs it
    console.log(`\n======================================================`);
    console.log(`📱 [SMS SERVICE OTP] Destination: ${phoneNumber}`);
    console.log(`🔑 [VERIFICATION CODE] >>> ${code} <<<`);
    console.log(`💬 Message: "${message}"`);
    console.log(`======================================================\n`);
    return { success: true, message: 'OTP generated and verified' };
  }
}

export const smsService = new SmsService();
