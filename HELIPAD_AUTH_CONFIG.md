# Helipad Webhook Configuration Example

## Environment Variables Setup

Create or update your `.env.local` file with these variables:

```bash
# Helipad webhook secret for signature verification
HELIPAD_WEBHOOK_SECRET=your-webhook-secret-here

# Helipad authorization token (optional but recommended)
HELIPAD_AUTH_TOKEN=your-secure-auth-token-here

# Site Nostr keys (required for posting boosts to Nostr)
NEXT_PUBLIC_SITE_NOSTR_NPUB=npub1...
NEXT_PUBLIC_SITE_NOSTR_NSEC=nsec1...
```

## Authorization Token Usage

### Supported Formats:
- `Authorization: Bearer your-token-here`
- `Authorization: your-token-here`

### Security Features:
- ✅ Constant-time comparison (prevents timing attacks)
- ✅ Supports both Bearer and direct token formats
- ✅ Optional but recommended for production
- ✅ Returns 401 Unauthorized for invalid tokens

### Testing with curl:

```bash
# With Bearer token
curl -X POST https://your-domain.com/api/helipad-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token-here" \
  -d '{"id":"test","amount":100}'

# With direct token
curl -X POST https://your-domain.com/api/helipad-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: your-token-here" \
  -d '{"id":"test","amount":100}'
```

### Helipad Configuration:
In your Helipad webhook settings:
- **Webhook URL:** `https://your-domain.com/api/helipad-webhook`
- **Authorization Token:** `your-secure-auth-token-here`
- **Events:** Select "Boost" events

## Current Status:
- ✅ Authorization token support implemented
- ✅ Security validation working
- ✅ Test endpoint updated
- ✅ Documentation updated
- ⚠️ Set `HELIPAD_AUTH_TOKEN` in `.env.local` to enable auth validation
