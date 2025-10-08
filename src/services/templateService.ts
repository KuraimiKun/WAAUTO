import pool from '../config/database.js';

export interface MessageTemplate {
  id?: number;
  user_id: number;
  name: string;
  content: string;
  language?: string;
  category?: string;
  created_at?: Date;
  updated_at?: Date;
}

export class TemplateService {
  // Get all templates for a user
  static async getAllTemplates(userId: number): Promise<MessageTemplate[]> {
    const result = await pool.query(
      'SELECT * FROM message_templates WHERE user_id = $1 ORDER BY name ASC',
      [userId]
    );
    
    return result.rows;
  }

  // Create a template
  static async createTemplate(template: MessageTemplate): Promise<MessageTemplate> {
    const { user_id, name, content, language, category } = template;
    
    const result = await pool.query(
      'INSERT INTO message_templates (user_id, name, content, language, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [user_id, name, content, language || 'en', category]
    );
    
    return result.rows[0];
  }

  // Update a template
  static async updateTemplate(templateId: number, userId: number, updates: Partial<MessageTemplate>): Promise<MessageTemplate> {
    const { name, content, language, category } = updates;
    
    const result = await pool.query(
      `UPDATE message_templates 
       SET name = COALESCE($1, name),
           content = COALESCE($2, content),
           language = COALESCE($3, language),
           category = COALESCE($4, category),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [name, content, language, category, templateId, userId]
    );
    
    return result.rows[0];
  }

  // Delete a template
  static async deleteTemplate(templateId: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM message_templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );
    
    return (result.rowCount ?? 0) > 0;
  }

  // Get template by ID
  static async getTemplateById(templateId: number, userId: number): Promise<MessageTemplate | null> {
    const result = await pool.query(
      'SELECT * FROM message_templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );
    
    return result.rows[0] || null;
  }
}
