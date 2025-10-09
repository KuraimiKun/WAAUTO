import pool from '../config/database.js';

export async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create session table (for express-session with connect-pg-simple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Create contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        company VARCHAR(255),
        city VARCHAR(255),
        country VARCHAR(255),
        tags TEXT[],
        custom_fields JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, phone)
      )
    `);

    // Create contact groups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_groups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      )
    `);

    // Create contact group members junction table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_group_members (
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (contact_id, group_id)
      )
    `);

    // Create message templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        language VARCHAR(10) DEFAULT 'en',
        category VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      )
    `);

    // Create message history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        phone VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT
      )
    `);

    // Create scheduled messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255),
        message TEXT NOT NULL,
        strategy VARCHAR(30) DEFAULT 'all',
        contact_ids INTEGER[],
        group_id INTEGER REFERENCES contact_groups(id) ON DELETE CASCADE,
        custom_recipients JSONB,
        timezone VARCHAR(64),
        scheduled_for TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP,
        message_template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL
      )
    `);

    // Ensure new columns exist for legacy databases
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS strategy VARCHAR(30) DEFAULT 'all'`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS contact_ids INTEGER[]`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS custom_recipients JSONB`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS error_message TEXT`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS message_template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL`);

    // Message history enhancements
    await client.query(`ALTER TABLE message_history ADD COLUMN IF NOT EXISTS scheduled_message_id INTEGER REFERENCES scheduled_messages(id) ON DELETE SET NULL`);

    // Create error logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        error_type VARCHAR(50) NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        context JSONB,
        severity VARCHAR(20) DEFAULT 'error',
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
      CREATE INDEX IF NOT EXISTS idx_contact_groups_user_id ON contact_groups(user_id);
      CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_message_history_user_id ON message_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_message_history_sent_at ON message_history(sent_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_id ON scheduled_messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_scheduled_messages_scheduled_for ON scheduled_messages(scheduled_for);
  CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status ON scheduled_messages(status);
      CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON error_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved);
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

export interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  created_at: Date;
}
