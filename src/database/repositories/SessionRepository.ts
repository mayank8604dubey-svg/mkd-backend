import { v4 as uuidv4 } from 'uuid';
import { db, SessionEntity, OtpEntity } from '../db';

export class SessionRepository {
  async saveOtp(phoneNumber: string, otpCodeHash: string, expiresAt: Date): Promise<OtpEntity> {
    const record: OtpEntity = {
      id: uuidv4(),
      phoneNumber,
      otpCodeHash,
      attempts: 0,
      expiresAt,
      createdAt: new Date(),
    };

    if (db.isPg) {
      await db.pgPool.query(
        `INSERT INTO otp_verifications (id, phone_number, otp_code_hash, attempts, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.id, record.phoneNumber, record.otpCodeHash, record.attempts, record.expiresAt, record.createdAt]
      );
      return record;
    }

    db.memoryOtps.set(record.id, record);
    return record;
  }

  async findLatestValidOtp(phoneNumber: string): Promise<OtpEntity | null> {
    if (db.isPg) {
      const res = await db.pgPool.query(
        `SELECT * FROM otp_verifications 
         WHERE phone_number = $1 AND verified_at IS NULL AND expires_at > NOW() AND attempts < 5
         ORDER BY created_at DESC LIMIT 1`,
        [phoneNumber]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        phoneNumber: r.phone_number,
        otpCodeHash: r.otp_code_hash,
        attempts: r.attempts,
        expiresAt: r.expires_at,
        verifiedAt: r.verified_at,
        createdAt: r.created_at,
      };
    }

    const now = new Date();
    const matches = Array.from(db.memoryOtps.values())
      .filter(o => o.phoneNumber === phoneNumber && !o.verifiedAt && o.expiresAt > now && o.attempts < 5)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return matches.length > 0 ? matches[0] : null;
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    if (db.isPg) {
      await db.pgPool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1', [id]);
      return;
    }
    const otp = db.memoryOtps.get(id);
    if (otp) otp.attempts++;
  }

  async markOtpVerified(id: string): Promise<void> {
    if (db.isPg) {
      await db.pgPool.query('UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1', [id]);
      return;
    }
    const otp = db.memoryOtps.get(id);
    if (otp) otp.verifiedAt = new Date();
  }

  async createSession(userId: string, deviceId: string, refreshTokenHash: string, expiresAt: Date): Promise<SessionEntity> {
    const session: SessionEntity = {
      id: uuidv4(),
      userId,
      deviceId,
      refreshTokenHash,
      expiresAt,
      createdAt: new Date(),
    };

    if (db.isPg) {
      await db.pgPool.query(
        `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [session.id, session.userId, session.deviceId, session.refreshTokenHash, session.expiresAt, session.createdAt]
      );
      return session;
    }

    db.memorySessions.set(session.id, session);
    return session;
  }

  async findSession(userId: string, deviceId: string): Promise<SessionEntity | null> {
    if (db.isPg) {
      const res = await db.pgPool.query(
        'SELECT * FROM sessions WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL AND expires_at > NOW()',
        [userId, deviceId]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        userId: r.user_id,
        deviceId: r.device_id,
        refreshTokenHash: r.refresh_token_hash,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        createdAt: r.created_at,
      };
    }

    const now = new Date();
    for (const s of db.memorySessions.values()) {
      if (s.userId === userId && s.deviceId === deviceId && !s.revokedAt && s.expiresAt > now) {
        return s;
      }
    }
    return null;
  }

  async revokeSession(userId: string, deviceId: string): Promise<void> {
    if (db.isPg) {
      await db.pgPool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);
      return;
    }
    for (const s of db.memorySessions.values()) {
      if (s.userId === userId && s.deviceId === deviceId) {
        s.revokedAt = new Date();
      }
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    if (db.isPg) {
      await db.pgPool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1', [userId]);
      return;
    }
    for (const s of db.memorySessions.values()) {
      if (s.userId === userId) {
        s.revokedAt = new Date();
      }
    }
  }
}
