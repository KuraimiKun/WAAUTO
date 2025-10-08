import bcrypt from 'bcrypt';
import pool from '../config/database.js';
import { User } from '../models/User.js';

export class AuthService {
  private static SALT_ROUNDS = 10;

  static async register(username: string, email: string, password: string): Promise<User | null> {
    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

      const result = await pool.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
        [username, email, hashedPassword]
      );

      return result.rows[0];
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Username or email already exists');
      }
      throw error;
    }
  }

  static async login(username: string, password: string): Promise<User | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return null;
      }

      // Don't return password
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  static async getUserById(id: number): Promise<User | null> {
    try {
      const result = await pool.query(
        'SELECT id, username, email, created_at FROM users WHERE id = $1',
        [id]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Get user error:', error);
      throw error;
    }
  }
}
