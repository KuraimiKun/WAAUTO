import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  WASocket
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { MessageHistoryService } from './services/messageHistoryService.js';
import ErrorLogService from './services/ErrorLogService.js';

interface Contact {
  id?: number;
  name: string;
  phone: string;
  [key: string]: any;
}

export class WhatsAppService {
  private sock: WASocket | null = null;
  private qrCode: string | null = null;
  private connectionStatus: string = 'disconnected';
  private authState: any = null;
  private userId: number;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private isReconnecting: boolean = false;

  constructor(userId: number) {
    this.userId = userId;
  }

  async initialize() {
    try {
      // Load auth state for specific user
      const authDir = `auth_info/${this.userId}`;
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      this.authState = { state, saveCreds };

      // Create socket (removed printQRInTerminal as it's deprecated)
      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
      });

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Generate QR code as data URL
          this.qrCode = await QRCode.toDataURL(qr);
          console.log('QR Code generated for user:', this.userId);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log('Connection closed for user:', this.userId, 'status code:', statusCode, 'reconnecting:', shouldReconnect);
          
          this.connectionStatus = 'disconnected';
          this.qrCode = null;
          
          // Handle different disconnect reasons
          if (statusCode === 401) {
            // Session expired or invalid - clear session files and require new QR scan
            console.log('Session expired (401) for user:', this.userId, '. Clearing session files...');
            await this.clearSessionFiles();
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            
            // Log error
            try {
              await ErrorLogService.logError({
                user_id: this.userId,
                error_type: 'session_expired',
                error_message: 'WhatsApp session expired (401). Please scan QR code again.',
                context: { statusCode: 401 },
                severity: 'warning'
              });
            } catch (logError) {
              console.error('Failed to log error:', logError);
            }
            // Don't auto-reconnect for 401 errors
          } else if (statusCode === DisconnectReason.loggedOut) {
            // User logged out - clear session files
            console.log('User', this.userId, 'logged out from WhatsApp. Clearing session...');
            await this.clearSessionFiles();
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
          } else if (statusCode === 440 || statusCode === 408 || statusCode === 428) {
            // Connection timeout errors - don't reconnect automatically
            // These indicate network/connection issues that need manual intervention
            console.log('Connection timeout (440/408/428) for user:', this.userId, '. Please reconnect manually.');
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            
            // Log error
            try {
              await ErrorLogService.logError({
                user_id: this.userId,
                error_type: 'connection_timeout',
                error_message: `WhatsApp connection timeout (${statusCode}). Network or connection issue detected.`,
                context: { statusCode },
                severity: 'error'
              });
            } catch (logError) {
              console.error('Failed to log error:', logError);
            }
            // Don't auto-reconnect for timeout errors
          } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts && !this.isReconnecting) {
            // Other errors - try to reconnect with limit
            this.reconnectAttempts++;
            this.isReconnecting = true;
            console.log(`Attempting to reconnect for user: ${this.userId} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
              this.isReconnecting = false;
              this.initialize();
            }, 5000); // Increased delay to 5 seconds
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached for user:', this.userId, '. Please reconnect manually.');
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
          }
        } else if (connection === 'open') {
          console.log('WhatsApp connected successfully for user:', this.userId);
          this.connectionStatus = 'connected';
          this.qrCode = null;
          this.reconnectAttempts = 0; // Reset reconnect counter on successful connection
          this.isReconnecting = false;
        } else if (connection === 'connecting') {
          this.connectionStatus = 'connecting';
        }
      });

      // Handle credentials update
      this.sock.ev.on('creds.update', saveCreds);

    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      this.connectionStatus = 'disconnected';
      throw error;
    }
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  getStatus(): string {
    return this.connectionStatus;
  }

  async sendMessage(phone: string, message: string, contactId?: number): Promise<boolean> {
    if (!this.sock || this.connectionStatus !== 'connected') {
      throw new Error('WhatsApp not connected');
    }

    try {
      // Format phone number (remove non-digits and add country code if needed)
      let formattedPhone = phone.replace(/\D/g, '');
      
      // Add @s.whatsapp.net suffix
      const jid = `${formattedPhone}@s.whatsapp.net`;

      await this.sock.sendMessage(jid, { text: message });
      console.log(`Message sent to ${phone}`);
      
      // Save to history
      try {
        await MessageHistoryService.addMessage({
          user_id: this.userId,
          contact_id: contactId,
          phone,
          message,
          status: 'sent'
        });
      } catch (historyError) {
        console.error('Failed to save message to history:', historyError);
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to send message to ${phone}:`, error);
      
      // Log error to database
      try {
        await ErrorLogService.logError({
          user_id: this.userId,
          error_type: 'message_send_failed',
          error_message: `Failed to send message to ${phone}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          stack_trace: error instanceof Error ? error.stack : undefined,
          context: { phone, contactId, messageLength: message.length },
          severity: 'error'
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
      
      // Save failed attempt to history
      try {
        await MessageHistoryService.addMessage({
          user_id: this.userId,
          contact_id: contactId,
          phone,
          message,
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (historyError) {
        console.error('Failed to save error to history:', historyError);
      }
      
      return false;
    }
  }

  async sendBulkMessages(contacts: Contact[], messageTemplate: string): Promise<any[]> {
    const results = [];

    for (const contact of contacts) {
      try {
        // Replace placeholders in message with contact data
        let personalizedMessage = messageTemplate;
        
        // Replace {{name}}, {{phone}}, or any other field from CSV
        Object.keys(contact).forEach(key => {
          const placeholder = new RegExp(`{{${key}}}`, 'gi');
          personalizedMessage = personalizedMessage.replace(placeholder, String(contact[key]));
        });

        const success = await this.sendMessage(contact.phone, personalizedMessage, contact.id);
        
        results.push({
          phone: contact.phone,
          name: contact.name,
          success,
          message: success ? 'Sent successfully' : 'Failed to send'
        });

        // Add delay between messages to avoid rate limiting
        await this.delay(2000);
      } catch (error) {
        results.push({
          phone: contact.phone,
          name: contact.name,
          success: false,
          message: 'Error occurred'
        });
      }
    }

    return results;
  }

  async disconnect() {
    try {
      if (this.sock) {
        // Just close the socket, DON'T logout (to preserve session)
        this.sock.end(undefined);
        this.sock = null;
      }
      
      this.connectionStatus = 'disconnected';
      this.qrCode = null;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      
      // DON'T clear session files - preserve them for reconnection
      console.log('Disconnected WhatsApp for user:', this.userId, '(session preserved)');
    } catch (error) {
      console.error('Error during disconnect:', error);
      throw error;
    }
  }
  
  async logout() {
    try {
      if (this.sock) {
        // Logout from WhatsApp (invalidates session on WhatsApp servers)
        try {
          await this.sock.logout();
        } catch (logoutError) {
          console.log('Logout error (this is normal):', logoutError);
        }
        this.sock.end(undefined);
        this.sock = null;
      }
      
      this.connectionStatus = 'disconnected';
      this.qrCode = null;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      
      // Clear session files after logout
      await this.clearSessionFiles();
      console.log('Logged out and cleared session for user:', this.userId);
    } catch (error) {
      console.error('Error during logout:', error);
      throw error;
    }
  }

  async clearSession() {
    // Clear socket connection first
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    
    this.connectionStatus = 'disconnected';
    this.qrCode = null;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    
    // Clear session files
    await this.clearSessionFiles();
  }

  private async clearSessionFiles() {
    const authDir = `auth_info/${this.userId}`;
    const fs = await import('fs');
    const path = await import('path');
    
    try {
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(authDir, file));
          } catch (unlinkError) {
            console.error(`Failed to delete ${file}:`, unlinkError);
          }
        }
        console.log('Session files cleared for user:', this.userId);
      }
    } catch (error) {
      console.error('Error clearing session files:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
