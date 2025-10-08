import pool from '../config/database.js';

export interface ErrorLog {
  id: number;
  user_id: number;
  error_type: string;
  error_message: string;
  stack_trace?: string;
  context?: any;
  severity: 'info' | 'warning' | 'error' | 'critical';
  resolved: boolean;
  created_at: Date;
}

export interface CreateErrorLogInput {
  user_id: number;
  error_type: string;
  error_message: string;
  stack_trace?: string;
  context?: any;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}

export class ErrorLogService {
  // Log an error
  async logError(input: CreateErrorLogInput): Promise<ErrorLog> {
    const query = `
      INSERT INTO error_logs (user_id, error_type, error_message, stack_trace, context, severity)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      input.user_id,
      input.error_type,
      input.error_message,
      input.stack_trace || null,
      input.context ? JSON.stringify(input.context) : null,
      input.severity || 'error'
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Get all errors for a user
  async getUserErrors(userId: number, limit: number = 100, includeResolved: boolean = false): Promise<ErrorLog[]> {
    const query = `
      SELECT * FROM error_logs
      WHERE user_id = $1
      ${!includeResolved ? 'AND resolved = false' : ''}
      ORDER BY created_at DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [userId, limit]);
    return result.rows;
  }

  // Get error by ID
  async getErrorById(errorId: number, userId: number): Promise<ErrorLog | null> {
    const query = 'SELECT * FROM error_logs WHERE id = $1 AND user_id = $2';
    const result = await pool.query(query, [errorId, userId]);
    return result.rows[0] || null;
  }

  // Mark error as resolved
  async resolveError(errorId: number, userId: number): Promise<boolean> {
    const query = `
      UPDATE error_logs
      SET resolved = true
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [errorId, userId]);
    return result.rows.length > 0;
  }

  // Delete error
  async deleteError(errorId: number, userId: number): Promise<boolean> {
    const query = 'DELETE FROM error_logs WHERE id = $1 AND user_id = $2';
    const result = await pool.query(query, [errorId, userId]);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Get error statistics
  async getErrorStats(userId: number): Promise<{
    total: number;
    unresolved: number;
    critical: number;
    error: number;
    warning: number;
    today: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolved = false) as unresolved,
        COUNT(*) FILTER (WHERE severity = 'critical' AND resolved = false) as critical,
        COUNT(*) FILTER (WHERE severity = 'error' AND resolved = false) as error,
        COUNT(*) FILTER (WHERE severity = 'warning' AND resolved = false) as warning,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today
      FROM error_logs
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return {
      total: parseInt(result.rows[0].total) || 0,
      unresolved: parseInt(result.rows[0].unresolved) || 0,
      critical: parseInt(result.rows[0].critical) || 0,
      error: parseInt(result.rows[0].error) || 0,
      warning: parseInt(result.rows[0].warning) || 0,
      today: parseInt(result.rows[0].today) || 0,
    };
  }

  // Clear all resolved errors for a user
  async clearResolvedErrors(userId: number): Promise<number> {
    const query = 'DELETE FROM error_logs WHERE user_id = $1 AND resolved = true';
    const result = await pool.query(query, [userId]);
    return result.rowCount || 0;
  }

  // Mark all errors as resolved
  async resolveAllErrors(userId: number): Promise<number> {
    const query = 'UPDATE error_logs SET resolved = true WHERE user_id = $1 AND resolved = false';
    const result = await pool.query(query, [userId]);
    return result.rowCount || 0;
  }
}

export default new ErrorLogService();
