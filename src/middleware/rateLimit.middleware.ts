import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryRateLimit = new Map<string, RateLimitRecord>();

/**
 * Sliding Window Rate Limiter
 * Restricts OTP requests to max 3 per 10 minutes per phone number/IP
 */
export function otpRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const identifier = req.body.phoneNumber || req.ip || 'anonymous';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxRequests = 3;

  const record = memoryRateLimit.get(identifier);

  if (!record || now > record.resetAt) {
    memoryRateLimit.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    next();
    return;
  }

  if (record.count >= maxRequests) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    res.status(429).json({
      success: false,
      error: `Too many OTP requests. Please wait ${retryAfterSec} seconds before requesting a new code.`,
      retryAfterSeconds: retryAfterSec,
    });
    return;
  }

  record.count++;
  next();
}
