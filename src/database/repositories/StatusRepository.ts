import { query, isPostgresConnected } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { userRepository } from './UserRepository';

export interface StatusEntity {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: 'TEXT' | 'IMAGE' | 'VIDEO';
  textContent?: string;
  mediaUrl?: string;
  backgroundColorHex?: string;
  createdAt: number;
  expiresAt: number;
  viewedBy: string[];
}

const memoryStatuses = new Map<string, StatusEntity>();

export class StatusRepository {
  /**
   * Create a new status update with 24-hour expiration
   */
  async createStatus(data: {
    userId: string;
    type: 'TEXT' | 'IMAGE' | 'VIDEO';
    textContent?: string;
    mediaUrl?: string;
    backgroundColorHex?: string;
  }): Promise<StatusEntity> {
    const statusId = uuidv4();
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours

    const user = await userRepository.findById(data.userId);
    const userName = user?.displayName || 'MKD User';
    const userAvatar = user?.avatarUrl;

    if (isPostgresConnected()) {
      await query(
        `INSERT INTO status_updates (id, user_id, media_type, media_url, text_content, background_color, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          statusId,
          data.userId,
          data.type,
          data.mediaUrl || null,
          data.textContent || null,
          data.backgroundColorHex || '#00A884',
          new Date(now),
          new Date(expiresAt)
        ]
      );
    }

    const entity: StatusEntity = {
      id: statusId,
      userId: data.userId,
      userName,
      userAvatar,
      type: data.type,
      textContent: data.textContent,
      mediaUrl: data.mediaUrl,
      backgroundColorHex: data.backgroundColorHex || '#00A884',
      createdAt: now,
      expiresAt,
      viewedBy: []
    };

    memoryStatuses.set(statusId, entity);
    return entity;
  }

  /**
   * Get all active statuses that have not expired (< 24 hours old)
   */
  async getActiveStatuses(): Promise<StatusEntity[]> {
    const now = Date.now();

    if (isPostgresConnected()) {
      const sql = `
        SELECT s.*, u.display_name, u.avatar_url
        FROM status_updates s
        JOIN users u ON s.user_id = u.id
        WHERE s.expires_at > NOW()
        ORDER BY s.created_at DESC;
      `;
      const result = await query(sql);
      const list: StatusEntity[] = [];

      for (const row of result.rows) {
        // Query viewers
        const viewersRes = await query('SELECT viewer_id FROM status_views WHERE status_id = $1', [row.id]);
        const viewers = viewersRes.rows.map((r: any) => r.viewer_id);

        list.push({
          id: row.id,
          userId: row.user_id,
          userName: row.display_name,
          userAvatar: row.avatar_url,
          type: row.media_type,
          textContent: row.text_content,
          mediaUrl: row.media_url,
          backgroundColorHex: row.background_color,
          createdAt: new Date(row.created_at).getTime(),
          expiresAt: new Date(row.expires_at).getTime(),
          viewedBy: viewers
        });
      }
      return list;
    } else {
      const active: StatusEntity[] = [];
      for (const status of memoryStatuses.values()) {
        if (status.expiresAt > now) {
          active.push(status);
        }
      }
      return active.sort((a, b) => b.createdAt - a.createdAt);
    }
  }

  /**
   * Mark status as viewed by user
   */
  async markViewed(statusId: string, viewerId: string): Promise<void> {
    if (isPostgresConnected()) {
      await query(
        `INSERT INTO status_views (status_id, viewer_id, viewed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (status_id, viewer_id) DO NOTHING`,
        [statusId, viewerId]
      );
    }

    const memoryItem = memoryStatuses.get(statusId);
    if (memoryItem && !memoryItem.viewedBy.includes(viewerId)) {
      memoryItem.viewedBy.push(viewerId);
    }
  }

  /**
   * Delete user's status
   */
  async deleteStatus(statusId: string, userId: string): Promise<boolean> {
    if (isPostgresConnected()) {
      const res = await query('DELETE FROM status_updates WHERE id = $1 AND user_id = $2', [statusId, userId]);
      return (res.rowCount ?? 0) > 0;
    }

    const item = memoryStatuses.get(statusId);
    if (item && item.userId === userId) {
      memoryStatuses.delete(statusId);
      return true;
    }
    return false;
  }
}

export const statusRepository = new StatusRepository();
