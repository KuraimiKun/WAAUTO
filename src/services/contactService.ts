import pool from '../config/database.js';

export interface Contact {
  id?: number;
  user_id: number;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  city?: string;
  country?: string;
  tags?: string[];
  custom_fields?: any;
  created_at?: Date;
  updated_at?: Date;
}

export class ContactService {
  // Get all contacts for a user
  static async getAllContacts(userId: number, options: { tag?: string } = {}): Promise<Contact[]> {
    const { tag } = options;
    const params: any[] = [userId];
    let query = 'SELECT * FROM contacts WHERE user_id = $1';

    if (tag) {
      params.push(tag);
      query += ` AND $${params.length} = ANY(tags)`;
    }

    query += ' ORDER BY name ASC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  // Add a single contact
  static async addContact(contact: Contact): Promise<Contact> {
    const { user_id, name, phone, email, company, city, country, tags, custom_fields } = contact;
    
    const result = await pool.query(
      `INSERT INTO contacts (user_id, name, phone, email, company, city, country, tags, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, phone) 
       DO UPDATE SET name = $2, email = $4, company = $5, city = $6, country = $7, tags = $8, custom_fields = $9, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [user_id, name, phone, email, company, city, country, tags, custom_fields]
    );
    
    return result.rows[0];
  }

  // Bulk add contacts
  static async addBulkContacts(userId: number, contacts: Omit<Contact, 'user_id'>[]): Promise<number> {
    const client = await pool.connect();
    let count = 0;
    
    try {
      await client.query('BEGIN');
      
      for (const contact of contacts) {
        await client.query(
          `INSERT INTO contacts (user_id, name, phone, email, company, city, country, tags, custom_fields)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id, phone) 
           DO UPDATE SET name = $2, email = $4, company = $5, city = $6, country = $7, updated_at = CURRENT_TIMESTAMP`,
          [userId, contact.name, contact.phone, contact.email, contact.company, contact.city, contact.country, contact.tags, contact.custom_fields]
        );
        count++;
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    return count;
  }

  // Update a contact
  static async updateContact(contactId: number, userId: number, updates: Partial<Contact>): Promise<Contact> {
    const { name, phone, email, company, city, country, tags, custom_fields } = updates;
    
    const result = await pool.query(
      `UPDATE contacts 
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           company = COALESCE($4, company),
           city = COALESCE($5, city),
           country = COALESCE($6, country),
           tags = COALESCE($7, tags),
           custom_fields = COALESCE($8, custom_fields),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10
       RETURNING *`,
      [name, phone, email, company, city, country, tags, custom_fields, contactId, userId]
    );
    
    return result.rows[0];
  }

  // Delete a contact
  static async deleteContact(contactId: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND user_id = $2',
      [contactId, userId]
    );
    
    return (result.rowCount ?? 0) > 0;
  }

  // Delete multiple contacts
  static async deleteMultipleContacts(contactIds: number[], userId: number): Promise<number> {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = ANY($1) AND user_id = $2',
      [contactIds, userId]
    );
    
    return result.rowCount ?? 0;
  }

  // Search contacts
  static async searchContacts(userId: number, query: string): Promise<Contact[]> {
    const result = await pool.query(
      `SELECT * FROM contacts 
       WHERE user_id = $1 
       AND (name ILIKE $2 OR phone ILIKE $2 OR company ILIKE $2 OR city ILIKE $2)
       ORDER BY name ASC`,
      [userId, `%${query}%`]
    );
    
    return result.rows;
  }

  // Get contact by ID
  static async getContactById(contactId: number, userId: number): Promise<Contact | null> {
    const result = await pool.query(
      'SELECT * FROM contacts WHERE id = $1 AND user_id = $2',
      [contactId, userId]
    );
    
    return result.rows[0] || null;
  }

  // Get contacts count
  static async getContactsCount(userId: number, options: { tag?: string } = {}): Promise<number> {
    const { tag } = options;
    const params: any[] = [userId];
    let query = 'SELECT COUNT(*) as count FROM contacts WHERE user_id = $1';

    if (tag) {
      params.push(tag);
      query += ` AND $${params.length} = ANY(tags)`;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count);
  }

  static async getContactsByIds(userId: number, contactIds: number[]): Promise<Contact[]> {
    if (!contactIds || contactIds.length === 0) {
      return [];
    }

    const result = await pool.query(
      `SELECT * FROM contacts WHERE user_id = $1 AND id = ANY($2)`,
      [userId, contactIds]
    );

    return result.rows;
  }

  static async getTagSummary(userId: number): Promise<Array<{ tag: string; count: number }>> {
    const result = await pool.query(
      `SELECT tag, COUNT(*)
       FROM (
         SELECT UNNEST(tags) AS tag
         FROM contacts
         WHERE user_id = $1 AND tags IS NOT NULL
       ) t
       WHERE tag IS NOT NULL AND tag <> ''
       GROUP BY tag
       ORDER BY COUNT(*) DESC, tag ASC`,
      [userId]
    );

    return result.rows.map((row) => ({ tag: row.tag, count: parseInt(row.count, 10) }));
  }
}
