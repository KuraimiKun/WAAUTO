import pool from '../config/database.js';

export type ScheduleStrategy = 'all' | 'group' | 'selected' | 'custom';

export interface ScheduledMessage {
  id?: number;
  user_id: number;
  name?: string;
  message: string;
  strategy: ScheduleStrategy;
  contact_ids?: number[] | null;
  group_id?: number | null;
  custom_recipients?: Array<{ name?: string; phone: string }> | null;
  timezone?: string | null;
  scheduled_for: Date;
  status?: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts?: number;
  error_message?: string | null;
  created_at?: Date;
  updated_at?: Date;
  sent_at?: Date | null;
  message_template_id?: number | null;
}

export class ScheduledMessageService {
  static async createSchedule(data: ScheduledMessage): Promise<ScheduledMessage> {
    const {
      user_id,
      name,
      message,
      strategy,
      contact_ids,
      group_id,
      custom_recipients,
      timezone,
      scheduled_for,
      message_template_id
    } = data;

    const result = await pool.query(
      `INSERT INTO scheduled_messages (
        user_id, name, message, strategy, contact_ids, group_id, custom_recipients,
        timezone, scheduled_for, status, attempts, message_template_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 0, $10)
      RETURNING *`,
      [
        user_id,
        name ?? null,
        message,
        strategy,
  contact_ids ?? null,
  group_id ?? null,
  custom_recipients ?? null,
        timezone ?? null,
        scheduled_for,
        message_template_id ?? null
      ]
    );

    return this.deserialize(result.rows[0]);
  }

  static async getUpcomingSchedules(userId: number, limit = 25): Promise<ScheduledMessage[]> {
    const result = await pool.query(
      `SELECT * FROM scheduled_messages
       WHERE user_id = $1
       ORDER BY scheduled_for ASC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map(this.deserialize);
  }

  static async getScheduleById(id: number, userId: number): Promise<ScheduledMessage | null> {
    const result = await pool.query(
      `SELECT * FROM scheduled_messages WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    return result.rows[0] ? this.deserialize(result.rows[0]) : null;
  }

  static async cancelSchedule(id: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE scheduled_messages
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'sending')`,
      [id, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async getDueSchedules(limit = 10): Promise<ScheduledMessage[]> {
    const result = await pool.query(
      `SELECT * FROM scheduled_messages
       WHERE status = 'pending' AND scheduled_for <= NOW()
       ORDER BY scheduled_for ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(this.deserialize);
  }

  static async markAsSending(id: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE scheduled_messages
       SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
      [id, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async markAsSent(id: number, userId: number, message?: string): Promise<void> {
    await pool.query(
      `UPDATE scheduled_messages
       SET status = 'sent', error_message = $3, sent_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, message ?? null]
    );
  }

  static async markAsFailed(id: number, userId: number, error: string): Promise<void> {
    await pool.query(
      `UPDATE scheduled_messages
       SET status = 'failed', error_message = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, error]
    );
  }

  private static deserialize(row: any): ScheduledMessage {
    if (!row) {
      return row;
    }

    return {
      ...row,
      custom_recipients: row.custom_recipients || null,
      contact_ids: row.contact_ids || null,
      scheduled_for: row.scheduled_for instanceof Date ? row.scheduled_for : new Date(row.scheduled_for),
      sent_at: row.sent_at ? new Date(row.sent_at) : null,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      created_at: row.created_at ? new Date(row.created_at) : undefined
    } as ScheduledMessage;
  }
}

export default ScheduledMessageService;
