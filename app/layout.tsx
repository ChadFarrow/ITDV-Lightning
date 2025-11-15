import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import PWAInstallPrompt from '@/components/PWAInstallPrompt'
import ErrorBoundary from '@/components/ErrorBoundary'
import ClientErrorBoundary from '@/components/ClientErrorBoundary'
import { ToastContainer } from '@/components/Toast'
import PerformanceMonitor from '@/components/PerformanceMonitor'
import { AudioProvider } from '@/contexts/AudioContext'
import { VideoProvider } from '@/contexts/VideoContext'
import { BitcoinConnectProvider } from '@/contexts/BitcoinConnectContext'
import { LightningProvider } from '@/contexts/LightningContext'
import GlobalNowPlayingBar from '@/components/GlobalNowPlayingBar'



const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'DoerfelVerse - Music & Podcast Hub',
  description: 'Discover and listen to music and podcasts from the Doerfel family and friends',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/apple-touch-icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/apple-touch-icon-144x144.png', sizes: '144x144', type: 'image/png' },
      { url: '/apple-touch-icon-120x120.png', sizes: '120x120', type: 'image/png' },
      { url: '/apple-touch-icon-76x76.png', sizes: '76x76', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DoerfelVerse',
    startupImage: [
      {
        url: '/apple-touch-icon.png',
        media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)',
      },
    ],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'DoerfelVerse',
    'mobile-web-app-capable': 'yes',
    'format-detection': 'telephone=no',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1f2937',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Resource hints for performance */}
        <link rel="preconnect" href="https://www.doerfelverse.com" />
        <link rel="dns-prefetch" href="https://www.doerfelverse.com" />
        <link rel="preconnect" href="https://re.podtards.com" />
        <link rel="dns-prefetch" href="https://re.podtards.com" />
        <link rel="preconnect" href="https://music.behindthesch3m3s.com" />
        <link rel="dns-prefetch" href="https://music.behindthesch3m3s.com" />
        <link rel="prefetch" href="/api/albums-static-cached" as="fetch" crossOrigin="anonymous" />
        
        {/* Preload Autumn Rust GIF immediately - large 39MB file needs early start */}
        <link 
          rel="preload" 
          href="/api/proxy-image?url=https%3A%2F%2Fmusic.behindthesch3m3s.com%2Fwp-content%2Fuploads%2FSat_Skirmish%2Fautumnrust%2Fart%2FAutumn-Rust-Feed-Art.gif" 
          as="image" 
          fetchPriority="high"
        />
        
        {/* Global Error Handler Script */}
        <script
          async
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              // Global error handler for debugging
              window.addEventListener("error", function(event) {
                console.error("Layout error caught:", event.error);
                if (event.error && event.error.stack) {
                  console.error("Stack trace:", event.error.stack);
                }
              });
              
              window.addEventListener("unhandledrejection", function(event) {
                // Suppress known Bitcoin Connect balance errors
                if (event.reason && event.reason.message && 
                    event.reason.message.includes("_balanceSats is null")) {
                  event.preventDefault();
                } else {
                  console.error("Layout promise rejection caught:", event.reason);
                }
              });
            `
          }}
        />
      </head>
      <body className={inter.className}>
        <ClientErrorBoundary>
          <ErrorBoundary>
            <LightningProvider>
              <AudioProvider>
                <VideoProvider>
                  <BitcoinConnectProvider>
                  <div className="min-h-screen bg-gray-50 relative">
                    {/* Content overlay with iOS safe area padding */}
                    <div className="relative z-10 pt-ios">
                      {children}
                    </div>
                  </div>
                  <GlobalNowPlayingBar />
                  <ToastContainer />
                </BitcoinConnectProvider>
                </VideoProvider>
              </AudioProvider>
            </LightningProvider>
          </ErrorBoundary>
          <ServiceWorkerRegistration />
          <PWAInstallPrompt />
          <PerformanceMonitor />
        </ClientErrorBoundary>
      </body>
    </html>
  )
} 