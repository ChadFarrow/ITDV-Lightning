'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function RSSGuidePage() {
  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <Image
          src="/bloodshot-lies-big.png"
          alt="Bloodshot Lies Album Art"
          fill
          className="object-cover w-full h-full"
          loading="eager"
          quality={40}
          sizes="100vw"
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k="
        />
        <div className="absolute inset-0 bg-black/80"></div>
      </div>

      {/* Content overlay */}
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b backdrop-blur-sm bg-black/50 pt-6" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="container mx-auto px-6 py-2">
            <div className="flex items-center justify-between">
              <Link 
                href="/" 
                className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back to Music</span>
              </Link>
              <h1 className="text-2xl font-bold">📡 RSS & Podcasting 2.0 Guide</h1>
              <div className="w-10 h-10 relative border border-gray-700 rounded-lg overflow-hidden">
                <Image 
                  src="/HPM-lightning-logo.jpg" 
                  alt="HPM Lightning Logo" 
                  width={40} 
                  height={40}
                  className="object-cover"
                  loading="lazy"
                  quality={60}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="container mx-auto px-6 py-8 max-w-4xl">
          <div className="prose prose-invert max-w-none">
            {/* Introduction */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-blue-400">📡 RSS Feeds & Podcasting 2.0</h2>
              <p className="text-lg mb-4">
                HPM Lightning is built on <strong>RSS feeds</strong> and <strong>Podcasting 2.0</strong> standards, enabling decentralized music distribution with built-in Lightning payment support. This creates a truly open and censorship-resistant music platform.
              </p>
              
              <div className="bg-gradient-to-r from-blue-600 to-green-600 rounded-lg p-4 text-center">
                <h3 className="text-xl font-bold mb-2">🌐 Decentralized Architecture</h3>
                <p className="text-lg">
                  <strong>46 RSS feeds</strong> power the entire platform - no central database, no single point of failure.
                </p>
              </div>
            </div>

            {/* What is RSS */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-green-400">📡 What is RSS?</h2>
              
              <p className="mb-4">
                <strong>RSS (Really Simple Syndication)</strong> is a web feed format that allows websites to publish frequently updated content. For music, RSS feeds contain album information, track metadata, and audio file URLs.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-blue-400">🎵 Music RSS Feeds</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Album metadata</strong> - title, artist, description</li>
                    <li><strong>Track information</strong> - song titles, durations</li>
                    <li><strong>Audio file URLs</strong> - direct links to music files</li>
                    <li><strong>Cover artwork</strong> - album art images</li>
                    <li><strong>Release dates</strong> - when music was published</li>
                  </ul>
                </div>
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">🔄 Real-time Updates</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Automatic updates</strong> when new music is added</li>
                    <li><strong>No manual refresh</strong> needed</li>
                    <li><strong>Instant availability</strong> of new releases</li>
                    <li><strong>Version control</strong> - track changes over time</li>
                  </ul>
                </div>
              </div>

              <h3 className="text-xl font-semibold mb-3">How HPM Lightning Uses RSS</h3>
              <p className="mb-4">
                The platform parses RSS feeds from 46 different sources to build the music catalog. Each album has its own RSS feed, ensuring that new tracks and updates are automatically reflected on the site.
              </p>
            </div>

            {/* Podcasting 2.0 */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-purple-400">🎙️ Podcasting 2.0 Standards</h2>
              
              <p className="mb-4">
                <strong>Podcasting 2.0</strong> is a set of RSS extensions that enable advanced features like Lightning payments, value splits, and enhanced metadata. HPM Lightning implements these standards for music distribution.
              </p>

              <div className="space-y-6">
                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-yellow-400">⚡ Lightning Value Tags</h3>
                  <p className="mb-3">Podcasting 2.0 includes special tags for Lightning payments:</p>
                  <div className="bg-black/70 rounded-lg p-4">
                    <pre className="text-sm text-gray-300 overflow-x-auto">
{`<podcast:value type="lightning" method="keysend">
  <podcast:valueRecipient 
    name="Artist Name" 
    address="03abc123..." 
    split="80" 
    type="node" />
  <podcast:valueRecipient 
    name="Producer" 
    address="02def456..." 
    split="15" 
    type="node" />
  <podcast:valueRecipient 
    name="Platform" 
    address="03740ea0..." 
    split="2" 
    type="node" 
    fee="true" />
</podcast:value>`}
                    </pre>
                  </div>
                  <p className="text-sm mt-3 text-gray-300">
                    This tells the platform how to split payments automatically when users send boosts.
                  </p>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">🏷️ Enhanced Metadata</h3>
                  <p className="mb-3">Podcasting 2.0 adds rich metadata to RSS feeds:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-black/70 rounded-lg p-3">
                      <h4 className="font-semibold text-blue-400 mb-2">📋 Standard Tags</h4>
                      <ul className="text-sm space-y-1">
                        <li><code>podcast:guid</code> - Unique identifiers</li>
                        <li><code>podcast:medium</code> - Content type (music)</li>
                        <li><code>podcast:category</code> - Genre classification</li>
                        <li><code>podcast:explicit</code> - Content warnings</li>
                      </ul>
                    </div>
                    <div className="bg-black/70 rounded-lg p-3">
                      <h4 className="font-semibold text-purple-400 mb-2">⚡ Lightning Tags</h4>
                      <ul className="text-sm space-y-1">
                        <li><code>podcast:value</code> - Payment information</li>
                        <li><code>podcast:funding</code> - Support links</li>
                        <li><code>podcast:podroll</code> - Recommendations</li>
                        <li><code>podcast:transcript</code> - Lyrics/transcripts</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feed Structure */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-orange-400">🏗️ Feed Structure</h2>
              
              <div className="space-y-6">
                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-blue-400">📊 Feed Statistics</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-black/70 rounded-lg p-4">
                      <h4 className="font-semibold text-green-400 mb-2">🎵 Individual Feeds</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Album Feeds:</span>
                          <span className="font-semibold text-blue-400">42</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Publisher Feeds:</span>
                          <span className="font-semibold text-green-400">4</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Total Feeds:</span>
                          <span className="font-semibold text-purple-400">46</span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-black/70 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-400 mb-2">📈 Content Coverage</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Unique Albums:</span>
                          <span className="font-semibold text-blue-400">40</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Coverage:</span>
                          <span className="font-semibold text-green-400">100%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Parsing Errors:</span>
                          <span className="font-semibold text-green-400">0</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">🎯 Feed Types</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-black/70 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-400 mb-2">🎵 Album Feeds</h4>
                      <p className="text-sm mb-3">Individual RSS feeds for each album/EP/single:</p>
                      <ul className="text-sm space-y-1">
                        <li>• Bloodshot Lies - The Album</li>
                        <li>• Think EP</li>
                        <li>• Music From The Doerfel-Verse</li>
                        <li>• Individual singles and EPs</li>
                      </ul>
                    </div>
                    <div className="bg-black/70 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-400 mb-2">🏢 Publisher Feeds</h4>
                      <p className="text-sm mb-3">Consolidated feeds for easy subscription:</p>
                      <ul className="text-sm space-y-1">
                        <li>• The Doerfels Publisher Feed</li>
                        <li>• CityBeach Publisher Feed</li>
                        <li>• Middle Season Publisher Feed</li>
                        <li>• Ryan Fonda Publisher Feed</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* How It Works */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-indigo-400">⚙️ How RSS Powers HPM Lightning</h2>
              
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold">1</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Feed Discovery</h3>
                    <p className="mb-3">The platform discovers and monitors RSS feeds:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300">
                      <li><strong>46 RSS feeds</strong> are monitored continuously</li>
                      <li><strong>Automatic parsing</strong> extracts music metadata</li>
                      <li><strong>Error handling</strong> ensures robust operation</li>
                      <li><strong>Cache management</strong> optimizes performance</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold">2</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Content Processing</h3>
                    <p className="mb-3">RSS data is processed and normalized:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300">
                      <li><strong>Metadata extraction</strong> - titles, artists, descriptions</li>
                      <li><strong>Audio URL parsing</strong> - direct links to music files</li>
                      <li><strong>Value tag processing</strong> - Lightning payment info</li>
                      <li><strong>Image optimization</strong> - album artwork processing</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold">3</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Platform Integration</h3>
                    <p className="mb-3">Processed data powers the platform:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300">
                      <li><strong>Music catalog</strong> - albums, tracks, artists</li>
                      <li><strong>Payment system</strong> - Lightning value splits</li>
                      <li><strong>Search functionality</strong> - find music by metadata</li>
                      <li><strong>Real-time updates</strong> - new content appears instantly</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold">4</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">User Experience</h3>
                    <p className="mb-3">Users interact with the processed data:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300">
                      <li><strong>Browse music</strong> - organized by RSS metadata</li>
                      <li><strong>Stream audio</strong> - direct from RSS URLs</li>
                      <li><strong>Send boosts</strong> - using Podcasting 2.0 value tags</li>
                      <li><strong>Discover content</strong> - through RSS-based recommendations</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Benefits */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-teal-400">🌟 Benefits of RSS & Podcasting 2.0</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-blue-400">🌐 Decentralization</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>No central database</strong> - content lives in RSS feeds</li>
                    <li><strong>Censorship-resistant</strong> - cannot be shut down</li>
                    <li><strong>Artist-controlled</strong> - artists own their feeds</li>
                    <li><strong>Open standards</strong> - anyone can participate</li>
                  </ul>
                </div>
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">⚡ Lightning Integration</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Built-in payments</strong> - value tags in RSS</li>
                    <li><strong>Automatic splits</strong> - multi-recipient payments</li>
                    <li><strong>Transparent fees</strong> - clear payment distribution</li>
                    <li><strong>Global reach</strong> - works anywhere</li>
                  </ul>
                </div>
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-purple-400">🔄 Real-time Updates</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Instant availability</strong> - new music appears immediately</li>
                    <li><strong>No manual updates</strong> - feeds update automatically</li>
                    <li><strong>Version control</strong> - track changes over time</li>
                    <li><strong>Reliable delivery</strong> - RSS is battle-tested</li>
                  </ul>
                </div>
                <div className="bg-black/70 rounded-lg p-4">
                  <h3 className="text-xl font-semibold mb-3 text-yellow-400">🎵 Rich Metadata</h3>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Comprehensive info</strong> - titles, artists, descriptions</li>
                    <li><strong>Audio files</strong> - direct links to music</li>
                    <li><strong>Cover artwork</strong> - album images</li>
                    <li><strong>Payment info</strong> - Lightning addresses and splits</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Technical Details */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-red-400">🔧 Technical Implementation</h2>
              
              <div className="space-y-6">
                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-blue-400">📡 RSS Parsing</h3>
                  <p className="mb-3">The platform uses advanced RSS parsing:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
                    <li><strong>Fast XML Parser</strong> - efficient RSS processing</li>
                    <li><strong>Error handling</strong> - graceful fallbacks for malformed feeds</li>
                    <li><strong>Cache system</strong> - unique keys prevent feed collisions</li>
                    <li><strong>Rate limiting</strong> - prevents overwhelming feed servers</li>
                  </ul>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">⚡ Value Tag Processing</h3>
                  <p className="mb-3">Podcasting 2.0 value tags are processed:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
                    <li><strong>Lightning address parsing</strong> - extract payment info</li>
                    <li><strong>Value split calculation</strong> - determine payment distribution</li>
                    <li><strong>Node key validation</strong> - verify Lightning addresses</li>
                    <li><strong>Fee handling</strong> - process platform fees</li>
                  </ul>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-purple-400">🔄 Caching Strategy</h3>
                  <p className="mb-3">Intelligent caching optimizes performance:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
                    <li><strong>Unique cache keys</strong> - base64 encoded feed URLs</li>
                    <li><strong>TTL management</strong> - automatic cache expiration</li>
                    <li><strong>Static fallbacks</strong> - pre-generated content</li>
                    <li><strong>Background updates</strong> - non-blocking feed refreshes</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* For Developers */}
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/30">
              <h2 className="text-3xl font-bold mb-4 text-indigo-400">👨‍💻 For Developers</h2>
              
              <div className="space-y-6">
                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-blue-400">🔗 RSS Feed URLs</h3>
                  <p className="mb-3">Example RSS feed URLs used by the platform:</p>
                  <div className="bg-black/70 rounded-lg p-4">
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-400">Publisher Feeds:</span>
                        <div className="font-mono text-blue-400 text-xs mt-1">
                          https://www.doerfelverse.com/feeds/doerfels-pubfeed.xml
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-400">Album Feeds:</span>
                        <div className="font-mono text-green-400 text-xs mt-1">
                          https://www.doerfelverse.com/feeds/bloodshot-lies.xml
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-green-400">📋 RSS Schema</h3>
                  <p className="mb-3">Key RSS elements used by the platform:</p>
                  <div className="bg-black/70 rounded-lg p-4">
                    <pre className="text-sm text-gray-300 overflow-x-auto">
{`<rss>
  <channel>
    <title>Album Title</title>
    <description>Album description</description>
    <image>
      <url>https://example.com/cover.jpg</url>
    </image>
    <item>
      <title>Track Title</title>
      <enclosure url="https://example.com/track.mp3" />
      <podcast:value type="lightning" method="keysend">
        <podcast:valueRecipient name="Artist" address="03..." split="80" />
      </podcast:value>
    </item>
  </channel>
</rss>`}
                    </pre>
                  </div>
                </div>

                <div className="bg-black/70 rounded-lg p-6">
                  <h3 className="text-xl font-semibold mb-3 text-purple-400">🛠️ API Endpoints</h3>
                  <p className="mb-3">Platform API endpoints for RSS data:</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Static Cache:</span>
                      <code className="text-blue-400">/api/albums-static-cached</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Dynamic Data:</span>
                      <code className="text-green-400">/api/albums-no-db</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Single Album:</span>
                      <code className="text-purple-400">/api/album/[id]</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Call to Action */}
            <div className="bg-gradient-to-r from-green-600 to-blue-600 rounded-xl p-8 text-center">
              <h2 className="text-3xl font-bold mb-4">📡 Experience Decentralized Music</h2>
              <p className="text-lg mb-6">
                Discover how RSS feeds and Podcasting 2.0 create a truly open music platform!
              </p>
              <div className="space-y-4">
                <Link 
                  href="/"
                  className="inline-block bg-white text-green-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
                >
                  🎵 Explore the Platform
                </Link>
                <div className="text-sm text-green-100">
                  <p><strong>Powered by open standards and Lightning Network!</strong></p>
                  <p className="mt-2">📡⚡</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
