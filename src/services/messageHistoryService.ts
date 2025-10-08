import pool from '../config/database.js';

export interface MessageHistory {
  id?: number;
  user_id: number;
  contact_id?: number;
  phone: string;
  message: string;
  status: 'sent' | 'failed' | 'pending';
  sent_at?: Date;
  error_message?: string;
}

export class MessageHistoryService {
  // Add message to history
  static async addMessage(message: MessageHistory): Promise<MessageHistory> {
    const { user_id, contact_id, phone, message: content, status, error_message } = message;
    
    const result = await pool.query(
      'INSERT INTO message_history (user_id, contact_id, phone, message, status, error_message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [user_id, contact_id, phone, content, status, error_message]
    );
    
    return result.rows[0];
  }

  // Get message history for a user
  static async getHistory(userId: number, limit: number = 100, offset: number = 0): Promise<any[]> {
    const result = await pool.query(
      `SELECT mh.*, c.name as contact_name
       FROM message_history mh
       LEFT JOIN contacts c ON mh.contact_id = c.id
       WHERE mh.user_id = $1
       ORDER BY mh.sent_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    
    return result.rows;
  }

  // Get statistics
  static async getStatistics(userId: number): Promise<any> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_messages,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_messages,
        COUNT(DISTINCT phone) as unique_recipients
       FROM message_history
       WHERE user_id = $1`,
      [userId]
    );
    
    return result.rows[0];
  }

  // Get today's statistics
  static async getTodayStatistics(userId: number): Promise<any> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_messages,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_messages
       FROM message_history
       WHERE user_id = $1 AND DATE(sent_at) = CURRENT_DATE`,
      [userId]
    );
    
    return result.rows[0];
  }

  // Delete old history (older than X days)
  static async deleteOldHistory(userId: number, days: number): Promise<number> {
    const result = await pool.query(
      'DELETE FROM message_history WHERE user_id = $1 AND sent_at < NOW() - INTERVAL \'$2 days\'',
      [userId, days]
    );
    
    return result.rowCount ?? 0;
  }
}
