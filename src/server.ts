import express, { Request, Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import pool from './config/database.js';
import { initializeDatabase } from './models/User.js';
import { AuthService } from './services/authService.js';
import { ContactService } from './services/contactService.js';
import { GroupService } from './services/groupService.js';
import { TemplateService } from './services/templateService.js';
import { MessageHistoryService } from './services/messageHistoryService.js';
import ErrorLogService from './services/ErrorLogService.js';
import ScheduledMessageService, { ScheduleStrategy } from './services/ScheduledMessageService.js';
import { requireAuth, requireGuest } from './middleware/auth.js';
import { WhatsAppService } from './whatsapp.js';
import { parseCSV } from './utils/csvParser.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL session store
const PgSession = connectPgSimple(session);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration BEFORE static files
app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

// Multer configuration for CSV upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = (req.session as any).userId;
    const userUploadDir = `uploads/${userId}`;
    
    if (!fs.existsSync(userUploadDir)) {
      fs.mkdirSync(userUploadDir, { recursive: true });
    }
    
    cb(null, userUploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Store WhatsApp service instances per user
const whatsappServices = new Map<number, WhatsAppService>();

function getWhatsAppService(userId: number): WhatsAppService {
  if (!whatsappServices.has(userId)) {
    whatsappServices.set(userId, new WhatsAppService(userId));
  }
  return whatsappServices.get(userId)!;
}

// Initialize database
await initializeDatabase();

// ============= AUTH ROUTES =============

// Serve login page
app.get('/', (req: Request, res: Response) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
  }
});

// Serve dashboard for authenticated users
app.get('/dashboard', requireAuth, (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

// Register
app.post('/api/auth/register', requireGuest, async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const user = await AuthService.register(username, email, password);
    
    if (user) {
      req.session.userId = user.id;
      req.session.username = user.username;
      
      res.json({ 
        message: 'Registration successful',
        user: { id: user.id, username: user.username, email: user.email }
      });
    }
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Login
app.post('/api/auth/login', requireGuest, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await AuthService.login(username, password);
    
    if (user) {
      req.session.userId = user.id;
      req.session.username = user.username;
      
      res.json({ 
        message: 'Login successful',
        user: { id: user.id, username: user.username, email: user.email }
      });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  
  // Disconnect WhatsApp if connected (preserve session for next login)
  if (userId && whatsappServices.has(userId)) {
    const service = whatsappServices.get(userId);
    try {
      await service?.disconnect();
      console.log('WhatsApp disconnected for user:', userId, '(session preserved for next login)');
    } catch (error) {
      console.error('Error disconnecting WhatsApp during app logout:', error);
    }
    whatsappServices.delete(userId);
  }
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await AuthService.getUserById(req.session.userId!);
    if (user) {
      res.json({ user });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ============= WHATSAPP ROUTES (Protected) =============

// Initialize WhatsApp connection and get QR code
app.post('/api/connect', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const whatsappService = getWhatsAppService(userId);
    
    await whatsappService.initialize();
    res.json({ message: 'WhatsApp connection initialized' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize WhatsApp connection' });
  }
});

// Get QR code for authentication
app.get('/api/qr', requireAuth, (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const whatsappService = getWhatsAppService(userId);
  const qrCode = whatsappService.getQRCode();
  if (qrCode) {
    res.json({ qr: qrCode });
  } else {
    res.status(404).json({ error: 'QR code not available' });
  }
});

// Check connection status
app.get('/api/status', requireAuth, (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const whatsappService = getWhatsAppService(userId);
  const status = whatsappService.getStatus();
  res.json({ status });
});

// Upload CSV file
app.post('/api/upload-csv', requireAuth, upload.single('csvFile'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const contacts = await parseCSV(req.file.path);
    res.json({ 
      message: 'CSV file uploaded successfully',
      count: contacts.length,
      contacts 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse CSV file' });
  }
});

// Send messages to all contacts
app.post('/api/send-messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const { contacts, message } = req.body;
    const userId = req.session.userId!;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts provided' });
    }

    if (!message) {
      return res.status(400).json({ error: 'No message provided' });
    }

    const whatsappService = getWhatsAppService(userId);
    const results = await whatsappService.sendBulkMessages(contacts, message);
    
    res.json({ 
      message: 'Messages sent',
      results 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send messages' });
  }
});

// ============= SCHEDULED MESSAGES ROUTES =============

app.get('/api/scheduled-messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 25;
    const schedules = await ScheduledMessageService.getUpcomingSchedules(userId, limit);
    res.json({ schedules });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch scheduled messages' });
  }
});

app.get('/api/scheduled-messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const scheduleId = parseInt(req.params.id);

    const schedule = await ScheduledMessageService.getScheduleById(scheduleId, userId);
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    res.json({ schedule });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

app.post('/api/scheduled-messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const {
      name,
      message,
      scheduled_for,
      strategy,
      contact_ids,
      group_id,
      custom_recipients,
      timezone,
      message_template_id
    } = req.body;

    if (!message || !scheduled_for || !strategy) {
      return res.status(400).json({ error: 'Message, strategy and schedule time are required' });
    }

    const scheduleTime = new Date(scheduled_for);
    if (Number.isNaN(scheduleTime.getTime())) {
      return res.status(400).json({ error: 'Invalid schedule time provided' });
    }

    if (scheduleTime.getTime() < Date.now() + 60_000) {
      return res.status(400).json({ error: 'Schedule time must be at least 1 minute in the future' });
    }

    const validStrategies: ScheduleStrategy[] = ['all', 'group', 'selected', 'custom'];
    if (!validStrategies.includes(strategy)) {
      return res.status(400).json({ error: 'Invalid strategy type' });
    }

    let normalizedContactIds: number[] | undefined;
    let normalizedCustom: Array<{ name?: string; phone: string }> | undefined;
    let normalizedGroupId: number | undefined;

    if (strategy === 'selected') {
      if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one contact to schedule for selected strategy' });
      }
      normalizedContactIds = contact_ids
        .map((id: any) => parseInt(id))
        .filter((id: number) => !Number.isNaN(id));
      if (!normalizedContactIds.length) {
        return res.status(400).json({ error: 'No valid contact IDs provided' });
      }
    }

    if (strategy === 'group') {
      const parsedGroupId = parseInt(group_id);
      if (Number.isNaN(parsedGroupId)) {
        return res.status(400).json({ error: 'Group strategy requires a valid group id' });
      }
      const group = await GroupService.getGroupById(parsedGroupId, userId);
      if (!group) {
        return res.status(404).json({ error: 'Group not found for scheduling' });
      }
      normalizedGroupId = parsedGroupId;
    }

    if (strategy === 'custom') {
      if (!Array.isArray(custom_recipients) || custom_recipients.length === 0) {
        return res.status(400).json({ error: 'Provide at least one custom recipient' });
      }
      normalizedCustom = custom_recipients
        .map((recipient: any) => ({
          name: recipient?.name?.toString(),
          phone: recipient?.phone?.toString() ?? ''
        }))
        .filter((recipient) => recipient.phone.trim().length > 0);

      if (!normalizedCustom.length) {
        return res.status(400).json({ error: 'Custom recipients must include valid phone numbers' });
      }
    }

    const schedule = await ScheduledMessageService.createSchedule({
      user_id: userId,
      name,
      message,
      strategy,
      contact_ids: normalizedContactIds,
      group_id: normalizedGroupId,
      custom_recipients: normalizedCustom,
      timezone,
      scheduled_for: scheduleTime,
      message_template_id
    });

    res.json({ message: 'Message scheduled successfully', schedule });
  } catch (error) {
    console.error('Failed to create scheduled message:', error);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

app.post('/api/scheduled-messages/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const scheduleId = parseInt(req.params.id);

    if (Number.isNaN(scheduleId)) {
      return res.status(400).json({ error: 'Invalid schedule id' });
    }

    const cancelled = await ScheduledMessageService.cancelSchedule(scheduleId, userId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Schedule not found or already processed' });
    }

    res.json({ message: 'Scheduled message cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel scheduled message' });
  }
});

// Disconnect WhatsApp
app.post('/api/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const whatsappService = getWhatsAppService(userId);
    
    await whatsappService.disconnect();
    whatsappServices.delete(userId);
    
    res.json({ message: 'WhatsApp disconnected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Clear WhatsApp session (for expired sessions)
app.post('/api/clear-session', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const whatsappService = getWhatsAppService(userId);
    
    await whatsappService.clearSession();
    whatsappServices.delete(userId);
    
    res.json({ message: 'WhatsApp session cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear session' });
  }
});

// ============= CONTACTS ROUTES (Protected) =============

// Get all contacts (with optional tag filter)
app.get('/api/contacts', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    const contacts = await ContactService.getAllContacts(userId, { tag });
    const count = await ContactService.getContactsCount(userId, { tag });
    
    res.json({ contacts, count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Get tag summary
app.get('/api/contacts/tags', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const tags = await ContactService.getTagSummary(userId);
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contact tags' });
  }
});

// Add a contact
app.post('/api/contacts', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const contactData = { ...req.body, user_id: userId };
    
    if (!contactData.name || !contactData.phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }
    
    const contact = await ContactService.addContact(contactData);
    res.json({ message: 'Contact added successfully', contact });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add contact', details: error.message });
  }
});

// Update a contact
app.put('/api/contacts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const contactId = parseInt(req.params.id);
    
    const contact = await ContactService.updateContact(contactId, userId, req.body);
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json({ message: 'Contact updated successfully', contact });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Delete a contact
app.delete('/api/contacts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const contactId = parseInt(req.params.id);
    
    const deleted = await ContactService.deleteContact(contactId, userId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Delete multiple contacts
app.post('/api/contacts/delete-bulk', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { contactIds } = req.body;
    
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }
    
    const count = await ContactService.deleteMultipleContacts(contactIds, userId);
    res.json({ message: `${count} contacts deleted successfully`, count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contacts' });
  }
});

// Search contacts
app.get('/api/contacts/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const query = req.query.q as string;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const contacts = await ContactService.searchContacts(userId, query);
    res.json({ contacts, count: contacts.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search contacts' });
  }
});

// Import contacts from CSV (save to database)
app.post('/api/contacts/import-csv', requireAuth, upload.single('csvFile'), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const contacts = await parseCSV(req.file.path);
    
    // Save to database
    const count = await ContactService.addBulkContacts(userId, contacts);
    
    res.json({ 
      message: `${count} contacts imported successfully`,
      count
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to import contacts', details: error.message });
  }
});

// ============= GROUPS ROUTES (Protected) =============

// Get all groups
app.get('/api/groups', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const groups = await GroupService.getAllGroups(userId);
    
    res.json({ groups, count: groups.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Create a group
app.post('/api/groups', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    
    const group = await GroupService.createGroup({ user_id: userId, name, description });
    res.json({ message: 'Group created successfully', group });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update a group
app.put('/api/groups/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const groupId = parseInt(req.params.id);
    
    const group = await GroupService.updateGroup(groupId, userId, req.body);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    res.json({ message: 'Group updated successfully', group });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete a group
app.delete('/api/groups/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const groupId = parseInt(req.params.id);
    
    const deleted = await GroupService.deleteGroup(groupId, userId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Add contacts to a group
app.post('/api/groups/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const groupId = parseInt(req.params.id);
    const { contactIds } = req.body;
    
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }
    
    const count = await GroupService.addContactsToGroup(groupId, contactIds);
    res.json({ message: `${count} contacts added to group`, count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add contacts to group' });
  }
});

// Remove contacts from a group
app.delete('/api/groups/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const groupId = parseInt(req.params.id);
    const { contactIds } = req.body;
    
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }
    
    const count = await GroupService.removeContactsFromGroup(groupId, contactIds);
    res.json({ message: `${count} contacts removed from group`, count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove contacts from group' });
  }
});

// Get group members
app.get('/api/groups/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const groupId = parseInt(req.params.id);
    
    const members = await GroupService.getGroupMembers(groupId, userId);
    res.json({ members, count: members.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group members' });
  }
});

// ============= TEMPLATES ROUTES (Protected) =============

// Get all templates
app.get('/api/templates', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const templates = await TemplateService.getAllTemplates(userId);
    
    res.json({ templates, count: templates.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Create a template
app.post('/api/templates', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { name, content, language, category } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    
    const template = await TemplateService.createTemplate({ 
      user_id: userId, 
      name, 
      content, 
      language, 
      category 
    });
    
    res.json({ message: 'Template created successfully', template });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update a template
app.put('/api/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const templateId = parseInt(req.params.id);
    
    const template = await TemplateService.updateTemplate(templateId, userId, req.body);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ message: 'Template updated successfully', template });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete a template
app.delete('/api/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const templateId = parseInt(req.params.id);
    
    const deleted = await TemplateService.deleteTemplate(templateId, userId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Get template by ID
app.get('/api/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const templateId = parseInt(req.params.id);
    
    const template = await TemplateService.getTemplateById(templateId, userId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ template });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// ============= MESSAGE HISTORY ROUTES (Protected) =============

// Get message history
app.get('/api/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const history = await MessageHistoryService.getHistory(userId, limit, offset);
    
    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch message history' });
  }
});

// Get statistics
app.get('/api/history/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    const stats = await MessageHistoryService.getStatistics(userId);
    const todayStats = await MessageHistoryService.getTodayStatistics(userId);
    
    res.json({ 
      allTime: stats,
      today: todayStats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ============= ERROR LOG ROUTES (Protected) =============

// Get error logs
app.get('/api/errors', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 100;
    const includeResolved = req.query.includeResolved === 'true';
    
    const errors = await ErrorLogService.getUserErrors(userId, limit, includeResolved);
    
    res.json({ errors, count: errors.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch error logs' });
  }
});

// Get error statistics
app.get('/api/errors/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    const stats = await ErrorLogService.getErrorStats(userId);
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch error statistics' });
  }
});

// Get error by ID
app.get('/api/errors/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const errorId = parseInt(req.params.id);
    
    const error = await ErrorLogService.getErrorById(errorId, userId);
    
    if (error) {
      res.json(error);
    } else {
      res.status(404).json({ error: 'Error not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch error details' });
  }
});

// Mark error as resolved
app.patch('/api/errors/:id/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const errorId = parseInt(req.params.id);
    
    const success = await ErrorLogService.resolveError(errorId, userId);
    
    if (success) {
      res.json({ message: 'Error marked as resolved' });
    } else {
      res.status(404).json({ error: 'Error not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve error' });
  }
});

// Delete error
app.delete('/api/errors/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const errorId = parseInt(req.params.id);
    
    const success = await ErrorLogService.deleteError(errorId, userId);
    
    if (success) {
      res.json({ message: 'Error deleted successfully' });
    } else {
      res.status(404).json({ error: 'Error not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete error' });
  }
});

// Resolve all errors
app.post('/api/errors/resolve-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    const count = await ErrorLogService.resolveAllErrors(userId);
    
    res.json({ message: `${count} errors marked as resolved` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve all errors' });
  }
});

// Clear resolved errors
app.delete('/api/errors/clear-resolved', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    const count = await ErrorLogService.clearResolvedErrors(userId);
    
    res.json({ message: `${count} resolved errors cleared` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear resolved errors' });
  }
});

// Serve static files for CSS, JS, images, etc. (but not HTML files)
// This is placed AFTER all routes so route handlers take precedence
app.use(express.static(path.join(__dirname, '../public'), {
  index: false, // Don't serve index.html automatically
  extensions: ['css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico']
}));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
