import { v4 as uuidv4 } from 'uuid';
import { db, UserEntity } from '../db';

export class UserRepository {
  async findById(id: string): Promise<UserEntity | null> {
    if (db.isPg) {
      const res = await db.pgPool.query('SELECT * FROM users WHERE id = $1 AND is_active = TRUE', [id]);
      if (res.rows.length === 0) return null;
      return this.mapFromRow(res.rows[0]);
    }
    const user = db.memoryUsers.get(id);
    return user && user.isActive ? user : null;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<UserEntity | null> {
    if (db.isPg) {
      const res = await db.pgPool.query('SELECT * FROM users WHERE phone_number = $1 AND is_active = TRUE', [phoneNumber]);
      if (res.rows.length === 0) return null;
      return this.mapFromRow(res.rows[0]);
    }
    for (const user of db.memoryUsers.values()) {
      if (user.phoneNumber === phoneNumber && user.isActive) {
        return user;
      }
    }
    return null;
  }

  async create(phoneNumber: string, displayName: string = 'MKD User'): Promise<UserEntity> {
    const newUser: UserEntity = {
      id: uuidv4(),
      phoneNumber,
      displayName,
      about: 'Hey there! I am using MKD.',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (db.isPg) {
      await db.pgPool.query(
        `INSERT INTO users (id, phone_number, display_name, about, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newUser.id, newUser.phoneNumber, newUser.displayName, newUser.about, newUser.isActive, newUser.createdAt, newUser.updatedAt]
      );
      return newUser;
    }

    db.memoryUsers.set(newUser.id, newUser);
    return newUser;
  }

  async updateProfile(id: string, displayName?: string, about?: string, username?: string): Promise<UserEntity | null> {
    const user = await this.findById(id);
    if (!user) return null;

    if (displayName) user.displayName = displayName;
    if (about) user.about = about;
    if (username) user.username = username;
    user.updatedAt = new Date();

    if (db.isPg) {
      await db.pgPool.query(
        'UPDATE users SET display_name = $1, about = $2, username = $3, updated_at = $4 WHERE id = $5',
        [user.displayName, user.about, user.username, user.updatedAt, id]
      );
      return user;
    }

    db.memoryUsers.set(id, user);
    return user;
  }

  async updateAvatar(id: string, avatarUrl: string): Promise<UserEntity | null> {
    const user = await this.findById(id);
    if (!user) return null;

    user.avatarUrl = avatarUrl;
    user.updatedAt = new Date();

    if (db.isPg) {
      await db.pgPool.query('UPDATE users SET avatar_url = $1, updated_at = $2 WHERE id = $3', [avatarUrl, user.updatedAt, id]);
      return user;
    }

    db.memoryUsers.set(id, user);
    return user;
  }

  async updatePushToken(id: string, pushToken: string): Promise<void> {
    if (db.isPg) {
      await db.pgPool.query('UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2', [pushToken, id]);
      return;
    }
    const user = db.memoryUsers.get(id);
    if (user) {
      user.pushToken = pushToken;
    }
  }

  async softDelete(id: string): Promise<boolean> {
    if (db.isPg) {
      const res = await db.pgPool.query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    }
    const user = db.memoryUsers.get(id);
    if (user) {
      user.isActive = false;
      return true;
    }
    return false;
  }

  async updatePresence(id: string, isOnline: boolean, lastSeen?: Date): Promise<void> {
    const user = await this.findById(id);
    if (user) {
      user.isOnline = isOnline;
      user.lastSeen = lastSeen || new Date();
    }
  }

  private mapFromRow(row: any): UserEntity {
    return {
      id: row.id,
      phoneNumber: row.phone_number,
      displayName: row.display_name,
      username: row.username,
      about: row.about,
      avatarUrl: row.avatar_url,
      pushToken: row.push_token,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const userRepository = new UserRepository();
