# ITDV Lightning

A Lightning Network-powered Value4Value music platform showcasing independent artists from the DoerfelVerse. Built with Next.js, featuring instant Bitcoin payments, Nostr integration, and RSS feeds.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to `http://localhost:3000`

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run dev-setup` - Check environment configuration
- `npm run test-feeds` - Test RSS feed parsing
- `npm run auto-add-publishers` - Auto-generate publisher feeds
- `./scripts/update-static-data.sh` - Update static album cache

## Features

### Core Functionality
- **Lightning Network Payments**: Instant Bitcoin payments via Bitcoin Connect
- **Value4Value Model**: Support artists directly with Lightning zaps and value splits
- **Auto Boost System**: Automatic 25 sat payments when songs complete (with NWC integration)
- **Boostagrams**: Custom 250-character messages with Lightning boost payments
- **Nostr Integration**: NIP-57/NIP-73 compliant boost notes with boostagrams published to Nostr relays
- **Multi-Payment Recipients**: Automatic splitting to multiple Lightning addresses and nodes
- **NWC Bridge System**: Seamless payments for non-keysend wallets via Alby Hub relay
- **RSS Feed Parsing**: Dynamic parsing of 42 album feeds + 4 publisher feeds
- **Complete Content Coverage**: All 40 unique albums displaying (100% coverage)
- **Publisher System**: Dedicated pages for music publishers with real artwork  
- **Audio Streaming**: Full-featured audio player with playlist support
- **Content Filtering**: Albums, EPs, Singles, and Publishers views
- **Static Data Generation**: Fast loading with pre-generated content
- **Robust Caching**: Fixed RSS cache key system prevents feed collisions

### User Experience
- **Progressive Web App (PWA)**: Install on mobile devices
- **Responsive Design**: Optimized for all screen sizes
- **Boost Modal System**: Elegant popup modals for Lightning payments with album artwork headers
- **Mobile-Optimized Modals**: Vertically centered modals with touch-friendly controls
- **Dark Theme**: Elegant dark interface throughout
- **Smooth Animations**: Polished transitions and hover effects with confetti celebrations
- **Mobile-First**: Touch-friendly controls and navigation

### Technical Features
- **CDN Integration**: Optimized asset delivery via Bunny.net
- **HLS Audio Support**: Adaptive streaming for various audio formats
- **Service Worker**: Background updates and offline functionality
- **Static Site Generation**: Pre-rendered pages for optimal performance

## Architecture

- **Frontend**: Next.js 15.4.3 with TypeScript and App Router
- **Data Source**: 46 RSS feeds + static JSON files (no database required)
- **Styling**: Tailwind CSS with custom components and dark theme
- **Audio Engine**: Custom AudioContext with HLS.js support and playlist management
- **Image Processing**: Next.js Image optimization with CDN fallbacks
- **Caching System**: Robust RSS cache with unique base64 keys per feed
- **PWA Support**: Service worker with offline functionality
- **Lightning Integration**: Bitcoin Connect with WebLN and NWC support
- **Payment Methods**: Lightning addresses, node keysends, and multi-recipient splits
- **Nostr Integration**: NIP-57/NIP-73 boost notes with automatic relay publishing
- **Value Splits**: Lightning Network value tag parsing for payment distribution
- **Metadata Collection**: Automatic 2 sat fee collection for platform analytics
- **Deployment**: Vercel with automated builds and edge deployment

## Content Structure

### Publishers
Publishers have consolidated RSS feeds for easy subscription and include:
- **The Doerfels** - `https://www.doerfelverse.com/feeds/doerfels-pubfeed.xml`
- **CityBeach** - `https://www.doerfelverse.com/feeds/citybeach-pubfeed.xml`
- **Middle Season** - `https://www.doerfelverse.com/artists/middleseason/mspubfeed.xml`
- **Ryan Fonda** - `https://wavlake.com/feed/artist/d4c49f2e-0b50-4a5e-8101-7543d68e032f`

### Content Statistics  
- **40 unique albums/EPs/singles** from independent DoerfelVerse artists
- **42 individual album feeds** for granular content access
- **4 consolidated publisher feeds** for easy RSS subscription  
- **Artists featured**: The Doerfels, CityBeach, Middle Season, Ryan Fonda, Kurtisdrums, Sir TJ The Wrathful, Generation Gap, Jdog, Ben Doerfel
- **Genres**: Rock, Bluegrass, Indie, Experimental, Electronic
- **Content model**: Value for Value (free music with optional Lightning payments)

### Data Flow
1. **RSS Feed Parsing**: 46 feeds parsed with individual caching per URL
2. **Content Normalization**: Album and track data extracted and standardized
3. **Static Generation**: Pre-built JSON files for optimal loading performance
4. **API Distribution**: Content served via optimized API routes
5. **Real-time Updates**: Dynamic parsing ensures content freshness
6. **Error Handling**: Comprehensive retry logic and graceful fallbacks

## Development

The app uses a hybrid approach:
- **Static data** for fast initial loads with 100% content coverage
- **Dynamic parsing** for real-time RSS feed updates (46 total feeds)
- **Intelligent caching** with unique cache keys to prevent feed collisions
- **Comprehensive coverage** of all albums, EPs, and singles from DoerfelVerse artists

## Recent Improvements

### UI/UX Improvements (September 2025)
- **Boost Modal Popup System**: Replaced inline boost forms with elegant popup modals across the platform
- **Album Artwork Headers**: Beautiful artwork headers in all boost modals (album, track, main page)
- **Mobile-Centered Modals**: Optimized modal positioning for mobile devices with vertical centering
- **Track Boost Artwork**: Individual track artwork display in track boost modals for consistency
- **Unified Modal Design**: Consistent design language across all boost interfaces
- **Performance Optimizations**: Reduced page load times from 17+ seconds to ~12 seconds
- **Parallel API Loading**: Non-blocking external API calls with proper timeouts and request deduplication
- **System Resource Cleanup**: Eliminated multiple accumulated Next.js servers consuming system memory
- **Codebase Cleanup**: Removed 193+ unused files including test files, demo pages, and redundant tool directories

### Lightning Network Integration (January 2025)
- **Bitcoin Connect Integration**: Full WebLN and NWC wallet support
- **Multi-Recipient Payments**: Automatic value splitting to multiple Lightning addresses/nodes
- **Nostr Boost Notes**: NIP-57/NIP-73 compliant posts to Nostr relays
- **Lightning Address Support**: Full LNURL resolution for email-style Lightning payments
- **Metadata Fee Collection**: Automatic 2 sat fee collection for platform development
- **Payment Performance**: Fixed render loop causing excessive payment recipient checks
- **Auto Boost NWC Integration**: Fixed auto boost to use NWC bridge instead of triggering WebLN popups
- **Bridge System**: Seamless integration with Alby Hub for non-keysend wallets (Coinos, Primal, etc.)
- **Payment Method Prioritization**: Smart detection prioritizes connected NWC wallets over WebLN extensions

### Auto Boost System (Latest)
- **Automatic Song-End Payments**: 25 sats automatically sent when songs complete
- **NWC Integration**: Uses connected NWC wallets (Coinos, Alby Hub, etc.) instead of browser extensions
- **Bridge Compatibility**: Seamless integration with Alby Hub bridge for non-keysend wallets
- **Dual Payment System**: Both Lightning payments and Nostr boost notes posted automatically
- **User Control**: Simple toggle to enable/disable auto boost functionality
- **Payment Method Detection**: Smart detection prioritizes NWC over WebLN to prevent unwanted popups

### Boostagram Features (Latest)
- **Custom Messages**: 250-character boostagram messages with Lightning payments
- **Sender Names**: Persistent sender name storage across boost interfaces
- **Custom Amounts**: User-defined boost amounts on all payment interfaces
- **Compact UI**: Streamlined boost interface with improved spacing and layout
- **Message Integration**: Boostagrams included in Lightning TLV records and Nostr boost posts
- **Performance Optimization**: Removed failing payment recipients to improve boost speed

### Helipad Integration (Testing - Not Live)
- **Webhook System**: Receive boost notifications from Helipad instances via webhook API
- **Platform Detection**: Visual badges distinguish between 🚁 Helipad, 📱 App, and 📡 Nostr boosts
- **Security Features**: Authorization token validation and HMAC signature verification
- **TOR Compatibility**: Works with Helipad instances behind TOR networks
- **Deduplication**: Prevents duplicate boosts from appearing multiple times
- **Nostr Publishing**: Automatically posts Helipad boosts to Nostr relays with #helipad tags
- **Real-time Display**: Helipad boosts appear instantly on the boosts page
- **In-memory Storage**: Temporary storage for development and testing purposes

### Value4Value Implementation
- **Podcasting 2.0 Value Tags**: Full parsing and support for Lightning Network value splits
- **LNURL Testing Album**: Special test album with multiple payment recipients
- **GitHub Integration**: Nostr boost posts link to project repository
- **Real-time Payments**: Instant Bitcoin payments with preimage verification

### RSS Cache System Fix
- **Fixed cache key collisions** that were causing multiple feeds to share the same cached data
- **Removed truncation bug** in RSS cache key generation (`lib/rss-cache.ts`)
- **Achievement: 100% album coverage** - All 40 required albums now display correctly
- **Added publisher feeds** for consolidated RSS subscriptions
- **Static Album Fallback**: API routes now support static album data when RSS feeds unavailable

### Content Coverage
- **42 individual album feeds** for main site display
- **4 publisher feeds** for RSS subscription consolidation  
- **Zero parsing errors** across all feeds
- **Complete artist representation** from The Doerfels, CityBeach, Middle Season, Ryan Fonda, and more

## Lightning Network & Value4Value

### Payment Features
- **Bitcoin Connect Integration**: WebLN and NWC wallet support
- **Multi-Recipient Payments**: Automatic splitting to artists, collaborators, and platform
- **Lightning Addresses**: Full LNURL support for email-style Lightning payments
- **Node Keysends**: Direct payments to Lightning node public keys
- **Value Splits**: Podcasting 2.0 value tag parsing for payment distribution
- **Metadata Collection**: 2 sat fee per boost for platform analytics and development

### Nostr Integration
- **Boost Notes**: NIP-57/NIP-73 compliant boost posts to Nostr relays
- **Relay Publishing**: Automatic posting to Primal, Snort, Nostr Band, Fountain, and Damus
- **Profile Integration**: Nostr profile links and nevent generation
- **Podcast Metadata**: Rich boost content with album art and track information

### Supported Payment Methods
- **WebLN**: Browser extension wallets (Alby, Zeus, etc.)
- **NWC (Nostr Wallet Connect)**: Alby Hub, Mutiny, and other NWC-compatible wallets
- **Lightning Addresses**: chadf@getalby.com, user@strike.me, etc.
- **Node Pubkeys**: Direct keysend to Lightning node addresses

## API Endpoints

### Album Data
- `GET /api/albums-static-cached` - Cached album data (fast)
- `GET /api/albums-no-db` - Fresh album data (dynamic parsing)
- `GET /api/albums-static` - Static pre-generated album data
- `GET /api/album/[id]` - Single album endpoint with static fallback

### Feed Management
- **RSS Cache Location**: `/data/rss-cache/`
- **Feed Configuration**: `/data/feeds.json` (46 feeds total)
- **Static Data**: `/data/static/albums.json`
- **LNURL Test Data**: Special album for Lightning payment testing

### Helipad Integration (Testing)
- `POST /api/helipad-webhook` - Webhook endpoint for Helipad boost notifications
- `GET /api/helipad-boosts` - Retrieve stored Helipad boosts
- `DELETE /api/helipad-boosts` - Clear Helipad boost storage (testing only)
- `POST /api/test-helipad-webhook` - Test endpoint for webhook simulation

## Troubleshooting

### Missing Albums
If albums are not displaying:
1. Check RSS cache: `ls -la data/rss-cache/`
2. Clear cache: `rm -rf data/rss-cache/*`
3. Test feeds: `npm run test-feeds`
4. Update static data: `./scripts/update-static-data.sh`

### RSS Feed Issues
- **Cache collisions**: Fixed in `lib/rss-cache.ts` - cache keys use full base64 encoding
- **Rate limiting**: Built-in retry logic with exponential backoff
- **Invalid feeds**: Comprehensive error handling and logging

### Performance
- **Slow loading**: Check CDN configuration and static generation
- **Audio issues**: Verify HLS.js and AudioContext browser support
- **Cache problems**: Clear browser cache and RSS cache directory
- **Payment render loops**: Fixed in January 2025 - payment recipients now use React useMemo

### Lightning Payment Issues
- **Wallet not connecting**: Check Bitcoin Connect status and wallet compatibility
- **Payment failures**: Verify Lightning address validity and node connectivity
- **NWC issues**: Confirm Nostr Wallet Connect string and relay connectivity
- **Missing recipients**: Check album value tags and payment recipient parsing

### Helipad Integration Issues (Testing)
- **Webhook not receiving boosts**: Verify webhook URL and authorization token configuration
- **TOR connectivity**: Ensure Helipad instance can reach public webhook URL (not localhost/ngrok)
- **Platform badges incorrect**: Check boost parsing logic and tag detection
- **Duplicate boosts**: Verify deduplication logic is working correctly
- **Storage resets**: In-memory storage clears on server restart (development only)

## Contributing

This project showcases music from independent artists in the DoerfelVerse using the Value4Value model. The platform enables direct Lightning Network payments to artists, creating a sustainable, decentralized music economy.

### Adding New Content
1. Add RSS feed URL to `/data/feeds.json`
2. Test feed parsing with `npm run test-feeds`
3. Update static data with `./scripts/update-static-data.sh`
4. Verify content appears at `http://localhost:3001`
5. Test Lightning payments and value splits for new albums

### Lightning Integration
- **Wallet Testing**: Test with multiple wallet types (WebLN, NWC, Lightning addresses)
- **Value Splits**: Verify payment recipient parsing and distribution
- **Nostr Integration**: Confirm boost notes publish to relays correctly
- **Performance**: Monitor payment recipient detection for render optimization

## Live Demo

- **Production Site**: https://zaps.podtards.com
- **Lightning Payments**: Full Bitcoin Lightning Network support
- **Nostr Integration**: Boost notes published to major Nostr relays
- **Value4Value**: Direct artist support with transparent payment splits
