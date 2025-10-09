import pool from '../config/database.js';

export interface Group {
  id?: number;
  user_id: number;
  name: string;
  description?: string;
  created_at?: Date;
}

export class GroupService {
  // Get all groups for a user
  static async getAllGroups(userId: number): Promise<any[]> {
    const result = await pool.query(
      `SELECT g.*, COUNT(cgm.contact_id) as member_count
       FROM contact_groups g
       LEFT JOIN contact_group_members cgm ON g.id = cgm.group_id
       WHERE g.user_id = $1
       GROUP BY g.id
       ORDER BY g.name ASC`,
      [userId]
    );
    
    return result.rows;
  }

  // Create a group
  static async createGroup(group: Group): Promise<Group> {
    const { user_id, name, description } = group;
    
    const result = await pool.query(
      'INSERT INTO contact_groups (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [user_id, name, description]
    );
    
    return result.rows[0];
  }

  // Update a group
  static async updateGroup(groupId: number, userId: number, updates: Partial<Group>): Promise<Group> {
    const { name, description } = updates;
    
    const result = await pool.query(
      `UPDATE contact_groups 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description)
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [name, description, groupId, userId]
    );
    
    return result.rows[0];
  }

  // Delete a group
  static async deleteGroup(groupId: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM contact_groups WHERE id = $1 AND user_id = $2',
      [groupId, userId]
    );
    
    return (result.rowCount ?? 0) > 0;
  }

  // Add contacts to a group
  static async addContactsToGroup(groupId: number, contactIds: number[]): Promise<number> {
    const client = await pool.connect();
    let count = 0;
    
    try {
      await client.query('BEGIN');
      
      for (const contactId of contactIds) {
        await client.query(
          'INSERT INTO contact_group_members (group_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [groupId, contactId]
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

  // Remove contacts from a group
  static async removeContactsFromGroup(groupId: number, contactIds: number[]): Promise<number> {
    const result = await pool.query(
      'DELETE FROM contact_group_members WHERE group_id = $1 AND contact_id = ANY($2)',
      [groupId, contactIds]
    );
    
    return result.rowCount ?? 0;
  }

  // Get group members
  static async getGroupMembers(groupId: number, userId: number): Promise<any[]> {
    const result = await pool.query(
      `SELECT c.* FROM contacts c
       JOIN contact_group_members cgm ON c.id = cgm.contact_id
       JOIN contact_groups g ON cgm.group_id = g.id
       WHERE g.id = $1 AND g.user_id = $2
       ORDER BY c.name ASC`,
      [groupId, userId]
    );
    
    return result.rows;
  }

  static async getGroupById(groupId: number, userId: number): Promise<Group | null> {
    const result = await pool.query(
      `SELECT * FROM contact_groups WHERE id = $1 AND user_id = $2`,
      [groupId, userId]
    );

    return result.rows[0] || null;
  }
}
