# Feed Display Fix Summary

## Issue
Feed from podcastindex.org (ID 7621579) was added but not appearing on the main page.

## Root Cause
The podcastindex.org URL (`https://podcastindex.org/podcast/7621579`) is **not an RSS feed URL** - it's a podcast index page. The system requires the actual RSS feed URL to parse and display feeds.

## Solution Implemented

### 1. Feed Information
- **Podcast**: Think EP LIVE!
- **Correct RSS Feed URL**: `https://www.doerfelverse.com/feeds/think-ep-live.xml`
- **Podcast Index ID**: 7621579

### 2. Changes Made

#### a) Cache Busting Support
- **File**: `app/api/albums/route.ts`
- Added support for `?refresh=1` or `?nocache=1` query parameters to force cache refresh
- Server-side cache (5 min TTL) can now be cleared on demand

#### b) Client-Side Cache Clearing
- **File**: `app/page.tsx`
- Added support for `?refresh=1` or `?nocache=1` query parameters
- Clears localStorage cache when refresh parameter is present
- Passes refresh parameter to API endpoints

#### c) Feed Verification Endpoint
- **File**: `app/api/admin/ensure-feed/route.ts`
- New endpoint to ensure a feed exists with the correct RSS feed URL
- Validates feed can be parsed before adding
- Detects and warns about incorrect podcastindex.org URLs

#### d) Cache Clearing Endpoint
- **File**: `app/api/admin/clear-cache/route.ts`
- Admin endpoint for cache management

### 3. How to Fix the Issue

#### Option 1: Use the Admin Panel (Recommended)
1. Go to `/admin/feeds`
2. Check if there's a feed with the podcastindex.org URL
3. If found, remove it
4. Add a new feed with:
   - **URL**: `https://www.doerfelverse.com/feeds/think-ep-live.xml`
   - **Type**: `album`
   - **Priority**: `core`
5. Visit the main page with `?refresh=1` to clear cache

#### Option 2: Use the Ensure Feed API
```bash
POST /api/admin/ensure-feed
{
  "rssFeedUrl": "https://www.doerfelverse.com/feeds/think-ep-live.xml",
  "podcastIndexId": "7621579"
}
```

#### Option 3: Run the Fix Script
```bash
node scripts/fix-think-ep-live-feed.js
```

### 4. Verifying the Fix

1. **Check Feed in Database**:
   ```bash
   GET /api/admin/feeds
   ```
   Look for feed with URL: `https://www.doerfelverse.com/feeds/think-ep-live.xml`

2. **Test Feed Parsing**:
   ```bash
   GET /api/albums?refresh=1
   ```
   Check if "Think EP LIVE!" appears in the albums list

3. **Clear All Caches**:
   - Server-side: Visit `/api/albums?refresh=1`
   - Client-side: Visit main page with `?refresh=1` or clear localStorage:
     ```javascript
     localStorage.removeItem('cachedAlbums');
     localStorage.removeItem('albumsCacheTimestamp');
     ```

4. **Check Main Page**:
   - Visit the main page
   - Look for "Think EP LIVE!" in the album list
   - If not visible, check browser console for errors

### 5. Troubleshooting

#### Feed Not Appearing After Adding
1. **Check Feed Status**: Ensure feed has `status: 'active'` in database
2. **Check Feed Type**: Must be `type: 'album'` (not 'publisher')
3. **Clear Caches**: Use `?refresh=1` on both API and main page
4. **Check Server Logs**: Look for parsing errors in console
5. **Verify RSS URL**: Test the RSS feed URL directly in browser

#### Feed Parsing Errors
- Check if RSS feed URL is accessible: `curl -I <rss-url>`
- Verify RSS feed returns valid XML
- Check server logs for specific parsing errors

#### Cache Issues
- Server cache: 5 minutes TTL, use `?refresh=1` to bypass
- Client cache: 30 minutes TTL, use `?refresh=1` or clear localStorage
- Static cache: May need to regenerate via `scripts/regenerate-static-cache.js`

### 6. Important Notes

- **Database is Primary Source**: The system uses Vercel Postgres database, not `feeds.json`
- **feeds.json is for Seeding**: The `feeds.json` file is used to seed the database on initialization
- **Cache Layers**: There are multiple cache layers (server, client, static) - all may need clearing
- **Feed Must Be Active**: Only feeds with `status: 'active'` are processed

### 7. Files Modified

- `app/api/albums/route.ts` - Added cache busting support
- `app/page.tsx` - Added client-side cache clearing
- `app/api/admin/ensure-feed/route.ts` - New endpoint for feed verification
- `app/api/admin/clear-cache/route.ts` - New cache management endpoint
- `scripts/fix-think-ep-live-feed.js` - Diagnostic and fix script

### 8. Next Steps

1. Ensure the feed exists in the database with the correct RSS feed URL
2. Remove any feeds with incorrect podcastindex.org URLs
3. Clear all caches using `?refresh=1`
4. Verify the feed appears on the main page
5. If issues persist, check server logs for parsing errors

