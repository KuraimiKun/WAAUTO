# WhatsApp Automation Bot (WABOT)

A TypeScript-based WhatsApp automation tool using Baileys library to send personalized bulk messages.

## Features

- 📱 WhatsApp Web integration using Baileys
- 📊 CSV file upload for contact management
- 🎨 Beautiful web interface
- ✉️ Personalized message templates
- 🔄 Real-time connection status
- 📱 QR code scanning for authentication
- 🌍 Full Arabic text support (UTF-8)
- 🔐 User authentication (Register/Login)
- 👥 Multi-user support - each user has their own WhatsApp session
- 💾 PostgreSQL database for user management

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

1. **Install PostgreSQL** (if not already installed)
   - Download from [postgresql.org](https://www.postgresql.org/download/)
   - Remember your postgres user password

2. **Create Database**
   ```bash
   psql -U postgres
   CREATE DATABASE wabot;
   \q
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and update your database credentials:
   ```
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/wabot
   SESSION_SECRET=your-super-secret-key
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed database setup instructions.

## Usage

1. Start the development server:
```bash
npm run dev
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. **Register/Login**
   - Create a new account or login with existing credentials
   - Each user gets their own isolated WhatsApp session

4. Follow the steps in the dashboard:
   - Click "Connect WhatsApp" and scan the QR code
   - Upload your CSV file with contacts
   - Write your personalized message
   - Click "Send to All Contacts"

## CSV Format

Your CSV file should have at least these columns:
- `name` - Contact name (supports Arabic and all UTF-8 characters)
- `phone` - Phone number (with country code, e.g., 1234567890)

You can add additional columns for personalization.

**Important:** Save your CSV file with UTF-8 encoding to properly display Arabic text.

Example CSV (English):
```csv
name,phone,company
John Doe,1234567890,ABC Corp
Jane Smith,0987654321,XYZ Inc
```

Example CSV (Arabic):
```csv
name,phone,company,city
أحمد محمد,1234567890,شركة التقنية,الرياض
فاطمة علي,0987654321,المؤسسة الدولية,جدة
```

## Message Personalization

Use double curly braces to insert personalized data:

English Example:
```
Hello {{name}}, 

This is a personalized message from {{company}}!

Your phone number is: {{phone}}
```

Arabic Example:
```
مرحبا {{name}}،

هذه رسالة مخصصة من {{company}}!

رقم هاتفك: {{phone}}
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run heroku-postbuild` - Build hook invoked automatically by Heroku during deploys

## Deploying to Heroku

The project is pre-configured for Heroku with:

- A `Procfile` that launches the compiled Express server (`npm run start`)
- An `app.json` manifest that provisions Heroku Postgres and seeds configuration
- A GitHub Actions workflow (`.github/workflows/heroku-deploy.yml`) that can deploy automatically when you push to `main`

### One-time Heroku setup

1. Install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) and authenticate:

   ```powershell
   heroku login
   ```

2. Create the app (replace `your-wabot-app` with a unique name):

   ```powershell
   heroku create your-wabot-app
   ```

3. Provision Postgres (the add-on injects `DATABASE_URL` automatically). The `essential-0` plan is the current entry tier—run the command below or list available plans with `heroku addons:plans heroku-postgresql` if you need a different size:

   ```powershell
   heroku addons:create heroku-postgresql:essential-0 --app your-wabot-app
   ```

4. Set required config vars (generate your own secure values):

   ```powershell
   heroku config:set SESSION_SECRET=super-secret-value --app your-wabot-app
   ```

   The `NODE_ENV` config var is defined in `app.json` and defaults to `production`.

5. Deploy the application code:
   - **If you're using the provided GitHub Actions workflow**, confirm that the `HEROKU_API_KEY`, `HEROKU_APP_NAME`, and `HEROKU_EMAIL` secrets are set, then push your latest changes to the `main` branch. Watch the “Deploy to Heroku” workflow run under the Actions tab until it reports success.
   - **If you prefer deploying from the CLI**, add Heroku as a remote and push directly:

     ```powershell
     heroku git:remote --app your-wabot-app
     git push heroku main
     ```

   After the deploy finishes, verify the release and logs:

   ```powershell
   heroku releases --app your-wabot-app
   heroku logs --tail --app your-wabot-app
   ```

### Automatic deployments from GitHub

1. In your GitHub repository settings, add the following Actions secrets:
   - `HEROKU_API_KEY` – run `heroku auth:token` to obtain it
   - `HEROKU_APP_NAME` – the name from `heroku create`
   - `HEROKU_EMAIL` – the email tied to your Heroku account
2. Push changes to the `main` branch. The `Deploy to Heroku` workflow will:
   - Install dependencies (`npm ci`)
   - Compile the TypeScript project (`npm run build`)
   - Push the build to Heroku using the Heroku API

Heroku invokes `npm run heroku-postbuild` automatically, which compiles TypeScript before starting the dyno. The Express server reads connection details from `DATABASE_URL`, enables SSL automatically in production, and trusts the Heroku proxy so secure cookies work out of the box.

> **Heads up:** Heroku’s filesystem is ephemeral. Uploaded files in `uploads/` and WhatsApp session data in `auth_info/` will reset on each deploy. Consider moving these assets to object storage (e.g., Amazon S3) for persistent production usage.

## Project Structure

```text
WABOT/
├── src/
│   ├── server.ts              # Express server with auth
│   ├── whatsapp.ts            # WhatsApp service (Baileys)
│   ├── config/
│   │   └── database.ts        # PostgreSQL connection
│   ├── models/
│   │   └── User.ts            # User model & DB initialization
│   ├── services/
│   │   └── authService.ts     # Authentication logic
│   ├── middleware/
│   │   └── auth.ts            # Auth middleware
│   └── utils/
│       └── csvParser.ts       # CSV parsing utility
├── public/
│   ├── login.html             # Login/Register page
│   └── dashboard.html         # Main dashboard (protected)
├── uploads/                   # User CSV files (auto-created)
├── auth_info/                 # WhatsApp sessions per user (auto-created)
├── .env                       # Environment variables
├── package.json
└── tsconfig.json
```

## Notes

- Each user has their own isolated WhatsApp session stored separately
- The WhatsApp session is saved locally per user, so you won't need to scan QR code every time
- User passwords are securely hashed using bcrypt
- Sessions are stored in PostgreSQL for persistence
- Messages are sent with a 2-second delay between each to avoid rate limiting
- Make sure to include country code in phone numbers (without + sign)
- Multiple users can use the system simultaneously with different WhatsApp accounts

## License

ISC
