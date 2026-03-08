# Claude Code Instructions

## Project Overview
ITDV-Site is a Next.js web application that serves as a platform for showcasing music content from various artists, with a focus on The Doerfels and related artists.

## Key Technologies
- Next.js
- TypeScript
- Tailwind CSS
- Service Workers for PWA functionality
- RSS Feed parsing
- CDN integration (Bunny.net)
- BoostBox integration (tardbox.com) for boost metadata logging

## Important Directories
- `/app` - Next.js pages and routes
- `/components` - Reusable React components
- `/lib` - Core utilities and services
- `/public` - Static assets
- `/scripts` - Utility scripts for deployment and maintenance

## Code Style Guidelines
1. Use TypeScript for type safety
2. Follow Next.js best practices for routing and data fetching
3. Use Tailwind CSS for styling
4. Implement proper error handling and loading states
5. Optimize for mobile-first design
6. Ensure PWA compatibility

## Common Tasks
1. Adding new artist content
2. Managing RSS feeds
3. Optimizing image and audio delivery
4. Maintaining service worker functionality
5. Managing CDN integration
6. BoostBox integration (boost/stream metadata posted to tardbox.com via `lib/boostbox-service.ts`)

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## Testing Guidelines
1. Test on both desktop and mobile devices
2. Verify PWA functionality
3. Check CDN integration
4. Validate RSS feed parsing
5. Test audio playback across different scenarios

## Performance Requirements
1. Fast initial page load
2. Optimized image loading
3. Efficient audio streaming
4. Smooth transitions between pages
5. Reliable offline functionality

## Security Considerations
1. Secure API endpoints
2. Safe CDN usage
3. Protected admin routes
4. Proper environment variable handling
5. Regular security audits
6. BoostBox API key is client-side (`NEXT_PUBLIC_` prefix) by design — BoostBox expects this