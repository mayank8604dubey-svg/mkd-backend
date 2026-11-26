import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://mkd_user:mkd_secure_password_2026@localhost:5432/mkd_messenger',
  
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'mkd_jwt_access_super_secret_key_change_in_production_2026_xyz',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'mkd_jwt_refresh_super_secret_key_change_in_production_2026_xyz',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
  },
  
  sms: {
    provider: process.env.SMS_PROVIDER || 'mock',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    },
    gatewayUrl: process.env.SMS_GATEWAY_URL || '',
    gatewayApiKey: process.env.SMS_GATEWAY_API_KEY || '',
  },
  
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  uploadDir: path.resolve(__dirname, '../../uploads'),
};
