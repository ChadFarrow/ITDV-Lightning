# Admin Feed Manager

## Overview

Simple password-protected admin interface for managing RSS feeds at `/admin`.

## Setup

1. **Set Admin Password**

   Add to `.env.local` or `.env`:
   ```bash
   ADMIN_PASSWORD=your_secure_password_here
   ```

   Default password (if not set): `doerfel`

2. **Access the Admin Page**

   Navigate to `/admin` and enter the password.

## Features

- **Add Feeds**: Paste RSS feed URLs (one per line or comma-separated)
- **Auto-Parse**: Feeds are automatically parsed to extract metadata
- **Priority Management**: Set feed priority (core, extended, low)
- **Auto-Regenerate**: Static cache automatically regenerates after adding/deleting feeds
- **Delete Feeds**: Remove feeds with a single click

## API Endpoints

### Authentication
- `POST /api/admin/simple-auth` - Login
- `GET /api/admin/simple-auth` - Check auth status
- `DELETE /api/admin/simple-auth` - Logout

### Feed Management
- `POST /api/admin/manage-feeds` - Add feeds
- `GET /api/admin/manage-feeds` - List feeds
- `DELETE /api/admin/manage-feeds` - Remove feed

## Security

- Password-protected with session-based authentication
- HTTPOnly cookies for session tokens
- Sessions expire after 24 hours
- All feed management endpoints require authentication

## Usage

1. Visit `/admin`
2. Enter password
3. Paste RSS feed URLs in the text area
4. Select priority level
5. Click "Add Feeds"
6. Feeds are parsed, added to `data/feeds.json`, and static cache is regenerated automatically

## Notes

- Sessions are stored in-memory (not persistent across server restarts)
- For production, consider using Redis or database for session storage
- Default password should be changed in production
