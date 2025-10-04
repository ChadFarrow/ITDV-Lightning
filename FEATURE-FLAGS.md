# Feature Flag System for Lightning Features

This system allows you to maintain both Lightning-enabled and basic versions from a single codebase.

## Quick Start

### Development
```bash
# Run Lightning version (default)
npm run dev:lightning

# Run Basic version (no Lightning features)
npm run dev:basic
```

### Building
```bash
# Build Lightning version
npm run build:lightning

# Build Basic version
npm run build:basic

# Build both versions
npm run build:both
```

## Implementation Pattern

### 1. Import the feature flag
```tsx
import { isLightningEnabled } from '@/lib/feature-flags';
```

### 2. Conditionally render Lightning components
```tsx
// In any component
{isLightningEnabled() && <BitcoinConnectPayment />}
{isLightningEnabled() && <BoostButton />}
```

### 3. Components to Update

Apply this pattern to these key areas:

#### Header Component ✅
```tsx
{isLightningEnabled() && <ClientOnlyLightningWallet />}
```

#### Main Page (app/page.tsx)
```tsx
// Boost modal and buttons
{isLightningEnabled() && (
  <button onClick={handleBoostClick}>
    <Zap className="w-4 h-4" /> Boost
  </button>
)}
```

#### Album Pages (app/album/[id]/AlbumDetailClient.tsx)
```tsx
// Boost buttons in album view
{isLightningEnabled() && (
  <BitcoinConnectPayment 
    recipientPubkey={...}
    amount={boostAmount}
  />
)}
```

#### Album Cards (components/AlbumCard.tsx)
```tsx
// Lightning boost buttons on album cards
{isLightningEnabled() && <BoostButton />}
```

## Configuration Files

### Lightning Version (.env.lightning)
```env
NEXT_PUBLIC_ENABLE_LIGHTNING=true
NEXT_PUBLIC_SITE_NAME="ITDV Lightning"
NEXT_PUBLIC_SITE_URL="https://itdv.podtards.com"
```

### Basic Version (.env.basic)
```env
NEXT_PUBLIC_ENABLE_LIGHTNING=false
NEXT_PUBLIC_SITE_NAME="ITDV Music"
NEXT_PUBLIC_SITE_URL="https://music.podtards.com"
```

## Deployment

### Option 1: Separate Deployments
- Deploy Lightning version to `itdv.podtards.com`
- Deploy Basic version to `music.podtards.com`

### Option 2: Environment-Based
Set environment variables directly in your hosting platform:
- Vercel: Project Settings → Environment Variables
- Netlify: Site Settings → Environment Variables

## Benefits

1. **Single Codebase**: Maintain both versions from one repository
2. **Easy Switching**: Simple npm scripts to switch modes
3. **Clean Code**: Lightning features cleanly separated
4. **Flexible Deployment**: Deploy to different domains or same domain
5. **Feature Testing**: Easy A/B testing of Lightning features

## Advanced Usage

### Context-Based Features
You can also disable Lightning contexts entirely:

```tsx
// In layout.tsx
{isLightningEnabled() && (
  <BitcoinConnectProvider>
    {children}
  </BitcoinConnectProvider>
)}
```

### Build-Time Optimizations
The feature flags work at build time, so unused Lightning code will be tree-shaken out of the basic version, reducing bundle size.