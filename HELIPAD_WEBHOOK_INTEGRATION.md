# Helipad Webhook Integration

This document explains how to integrate Helipad boosts into the ITDV Lightning site.

## Overview

The Helipad webhook integration allows the site to receive boost notifications from Helipad and display them alongside existing Nostr boosts. When Helipad sends a boost webhook, it gets posted to Nostr relays with appropriate tags and metadata.

## API Endpoints

### 1. Helipad Webhook Endpoint
**URL:** `/api/helipad-webhook`  
**Method:** `POST`  
**Purpose:** Receives boost notifications from Helipad

#### Expected Payload Format
```json
{
  "id": "unique-boost-id",
  "amount": 1000,
  "message": "Optional boost message",
  "sender": {
    "name": "Sender Name",
    "pubkey": "hex-pubkey",
    "npub": "npub1..."
  },
  "recipient": {
    "name": "Recipient Name", 
    "pubkey": "hex-pubkey",
    "npub": "npub1..."
  },
  "podcast": {
    "title": "Podcast Title",
    "artist": "Podcast Artist",
    "album": "Album Name",
    "episode": "Episode Title",
    "guid": "episode-guid",
    "feedGuid": "feed-guid",
    "publisherGuid": "publisher-guid",
    "feedUrl": "https://example.com/feed.xml",
    "publisherUrl": "https://example.com",
    "imageUrl": "https://example.com/image.jpg"
  },
  "timestamp": 1234567890,
  "platform": "helipad",
  "boostType": "boost"
}
```

#### Response Format
```json
{
  "success": true,
  "message": "Boost posted to Nostr successfully",
  "nostrEventId": "event-id",
  "nevent": "nostr:nevent1...",
  "boostId": "helipad-boost-id",
  "amount": 1000
}
```

### 2. Test Webhook Endpoint
**URL:** `/api/test-helipad-webhook`  
**Method:** `POST`  
**Purpose:** Test the webhook functionality with sample data

#### Usage
```bash
# Test with sample data
curl -X POST http://localhost:3000/api/test-helipad-webhook

# Test with custom data
curl -X POST http://localhost:3000/api/test-helipad-webhook \
  -H "Content-Type: application/json" \
  -d '{"id":"test-123","amount":500,"message":"Test boost"}'
```

## Configuration

### Environment Variables

Add these to your `.env.local` file:

```bash
# Helipad webhook secret for signature verification
HELIPAD_WEBHOOK_SECRET=your-webhook-secret-here

# Helipad authorization token (optional but recommended)
HELIPAD_AUTH_TOKEN=your-auth-token-here

# Site Nostr keys (required for posting boosts)
NEXT_PUBLIC_SITE_NOSTR_NPUB=npub1...
NEXT_PUBLIC_SITE_NOSTR_NSEC=nsec1...
```

### Helipad Configuration

In your Helipad account settings, configure the webhook URL:
- **Webhook URL:** `https://yourdomain.com/api/helipad-webhook`
- **Events:** Select "Boost" events
- **Secret:** Use the same secret as `HELIPAD_WEBHOOK_SECRET`
- **Authorization Token:** Use the same token as `HELIPAD_AUTH_TOKEN` (optional but recommended)

## How It Works

1. **Webhook Reception:** Helipad sends boost data to `/api/helipad-webhook`
2. **Authorization Verification:** The webhook verifies the Authorization token (if configured)
3. **Signature Verification:** The webhook verifies the request signature using HMAC-SHA256
4. **Data Conversion:** Helipad boost data is converted to the site's `TrackMetadata` format
5. **Nostr Posting:** The boost is posted to Nostr relays with:
   - Kind 1 (text note)
   - `#helipad` tag
   - `#boost` tag  
   - `#podcast` tag
   - Podcast metadata tags (k/i pairs)
6. **Display Integration:** The boost appears on `/boosts` page with a "🚁 Helipad" platform indicator

## Boost Display

Helipad boosts are displayed on the `/boosts` page with:
- **Platform Badge:** Blue "🚁 Helipad" indicator
- **Same Format:** Amount, track info, message, timestamp
- **Nostr Integration:** Full Nostr event with replies support
- **Mixed Timeline:** Combined with regular Nostr boosts, sorted by timestamp

## Security Features

- **Authorization Token:** Bearer token authentication (optional but recommended)
- **Signature Verification:** HMAC-SHA256 signature verification
- **HTTPS Required:** Webhook endpoint requires HTTPS in production
- **Rate Limiting:** Built-in protection against spam
- **Error Handling:** Graceful handling of malformed requests
- **Constant-Time Comparisons:** Prevents timing attacks on tokens and signatures

## Testing

1. **Local Testing:** Use `/api/test-helipad-webhook` endpoint
2. **Webhook Testing:** Use tools like ngrok to expose local server
3. **Production Testing:** Configure webhook URL in Helipad settings

## Troubleshooting

### Common Issues

1. **No boosts appearing:**
   - Check if Nostr keys are configured
   - Verify webhook is receiving requests
   - Check browser console for errors

2. **Signature verification failing:**
   - Ensure `HELIPAD_WEBHOOK_SECRET` matches Helipad configuration
   - Check that Helipad is sending the signature header

3. **Boosts not posting to Nostr:**
   - Verify `NEXT_PUBLIC_SITE_NOSTR_NSEC` is properly configured
   - Check relay connectivity
   - Review server logs for errors

### Debugging

Enable debug logging by checking browser console and server logs. The webhook provides detailed logging for each step of the process.

## Future Enhancements

- Database storage for Helipad boosts
- Real-time updates via WebSocket
- Boost analytics and statistics
- Custom boost templates
- Integration with other podcast platforms
