import { query, isPostgresConnected } from '../db';

export interface PreKeyBundleEntity {
  userId: string;
  identityKey: string;
  signedPreKey: string;
  signature: string;
  oneTimePreKeys: string[];
  updatedAt: Date;
}

const memoryPreKeys = new Map<string, PreKeyBundleEntity>();

export class CryptoRepository {
  /**
   * Upload or rotate public pre-key bundle for user
   */
  async savePreKeyBundle(data: {
    userId: string;
    identityKey: string;
    signedPreKey: string;
    signature: string;
    oneTimePreKeys: string[];
  }): Promise<void> {
    const now = new Date();

    if (isPostgresConnected()) {
      await query(
        `INSERT INTO prekey_bundles (user_id, identity_key, signed_prekey, signed_prekey_signature, one_time_prekeys, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           identity_key = $2,
           signed_prekey = $3,
           signed_prekey_signature = $4,
           one_time_prekeys = $5,
           updated_at = $6;`,
        [data.userId, data.identityKey, data.signedPreKey, data.signature, JSON.stringify(data.oneTimePreKeys), now]
      );
    }

    memoryPreKeys.set(data.userId, {
      userId: data.userId,
      identityKey: data.identityKey,
      signedPreKey: data.signedPreKey,
      signature: data.signature,
      oneTimePreKeys: data.oneTimePreKeys,
      updatedAt: now
    });
  }

  /**
   * Get target user's public pre-key bundle to initiate E2EE session
   */
  async getPreKeyBundle(userId: string): Promise<PreKeyBundleEntity | null> {
    if (isPostgresConnected()) {
      const result = await query('SELECT * FROM prekey_bundles WHERE user_id = $1', [userId]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        userId: row.user_id,
        identityKey: row.identity_key,
        signedPreKey: row.signed_prekey,
        signature: row.signed_prekey_signature,
        oneTimePreKeys: typeof row.one_time_prekeys === 'string' ? JSON.parse(row.one_time_prekeys) : row.one_time_prekeys,
        updatedAt: new Date(row.updated_at)
      };
    }

    return memoryPreKeys.get(userId) || null;
  }
}

export const cryptoRepository = new CryptoRepository();
