import { Pool } from 'pg';
import { config } from '../config/environment';

export interface UserEntity {
  id: string;
  phoneNumber: string;
  displayName: string;
  username?: string;
  about: string;
  avatarUrl?: string;
  pushToken?: string;
  isOnline?: boolean;
  lastSeen?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionEntity {
  id: string;
  userId: string;
  deviceId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface OtpEntity {
  id: string;
  phoneNumber: string;
  otpCodeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt?: Date;
  createdAt: Date;
}

/**
 * Universal Database Client:
 * Uses PostgreSQL Pool when accessible, and falls back to a high-performance in-memory
 * concurrent store for standalone development, immediate testing, and CI environments.
 */
class DatabaseManager {
  private pool: Pool | null = null;
  private isConnectedToPg = false;

  // In-Memory storage fallback
  public memoryUsers = new Map<string, UserEntity>();
  public memorySessions = new Map<string, SessionEntity>();
  public memoryOtps = new Map<string, OtpEntity>();

  constructor() {
    this.init();
  }

  private async init() {
    try {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 2000,
      });

      const client = await this.pool.connect();
      client.release();
      this.isConnectedToPg = true;
      console.log('✅ Connected to PostgreSQL Database');
    } catch (err) {
      this.isConnectedToPg = false;
      console.log('ℹ️ PostgreSQL not reached, running in standalone local memory-store mode');
    }
  }

  public get isPg(): boolean {
    return this.isConnectedToPg && this.pool !== null;
  }

  public get pgPool(): Pool {
    if (!this.pool) throw new Error('Database pool not initialized');
    return this.pool;
  }
}

export const db = new DatabaseManager();

export async function query(text: string, params?: any[]) {
  return db.pgPool.query(text, params);
}

export function isPostgresConnected(): boolean {
  return db.isPg;
}
