# Quick Setup Script
# Run this in PowerShell as Administrator

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "WABOT Database Setup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if PostgreSQL is installed
$pgPath = Get-Command psql -ErrorAction SilentlyContinue

if (-not $pgPath) {
    Write-Host "ERROR: PostgreSQL is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install PostgreSQL from: https://www.postgresql.org/download/" -ForegroundColor Yellow
    exit 1
}

Write-Host "PostgreSQL found!" -ForegroundColor Green
Write-Host ""

# Get PostgreSQL password
$pgPassword = Read-Host "Enter your PostgreSQL 'postgres' user password" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword)
$pgPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# Set environment variable for psql
$env:PGPASSWORD = $pgPasswordPlain

# Create database
Write-Host "Creating database 'wabot'..." -ForegroundColor Yellow
$createDbCommand = "SELECT 'CREATE DATABASE wabot' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'wabot')\gexec"
$createDbCommand | psql -U postgres -h localhost 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database 'wabot' created successfully!" -ForegroundColor Green
} else {
    Write-Host "Database 'wabot' already exists or error occurred" -ForegroundColor Yellow
}

# Create .env file
Write-Host ""
Write-Host "Creating .env file..." -ForegroundColor Yellow

if (Test-Path ".env") {
    Write-Host ".env file already exists. Skipping..." -ForegroundColor Yellow
} else {
    $sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    $envContent = @"
DATABASE_URL=postgresql://postgres:$pgPasswordPlain@localhost:5432/wabot
SESSION_SECRET=$sessionSecret
PORT=3000
"@
    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    Write-Host ".env file created successfully!" -ForegroundColor Green
}

# Clear password from memory
$env:PGPASSWORD = $null
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run: npm install" -ForegroundColor White
Write-Host "2. Run: npm run dev" -ForegroundColor White
Write-Host "3. Open: http://localhost:3000" -ForegroundColor White
Write-Host ""
