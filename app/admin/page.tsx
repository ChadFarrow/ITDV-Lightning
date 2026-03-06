'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Loader2, ChevronUp, ChevronDown, Pin, X } from 'lucide-react';

interface Feed {
  id: string;
  originalUrl: string;
  type: 'album' | 'publisher';
  title: string;
  priority: 'core' | 'extended' | 'low';
  status: 'active' | 'inactive';
  trackFilter?: string;
  addedAt: string;
  lastUpdated: string;
}

export default function AdminFeedManager() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedUrls, setFeedUrls] = useState('');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [adding, setAdding] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAllFeeds, setShowAllFeeds] = useState(false);

  // Pinned albums and EPs state
  const [pinnedAlbums, setPinnedAlbums] = useState<string[]>([]);
  const [pinnedEPs, setPinnedEPs] = useState<string[]>([]);
  const [availableAlbums, setAvailableAlbums] = useState<{ title: string; trackCount: number }[]>([]);
  const [selectedAlbumToPin, setSelectedAlbumToPin] = useState('');
  const [selectedEPToPin, setSelectedEPToPin] = useState('');
  const [savingPinned, setSavingPinned] = useState(false);

  // Check if already authenticated on page load
  useEffect(() => {
    checkAuth();
  }, []);

  // Load feeds and pinned albums when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadFeeds();
      loadPinnedAlbums();
      loadAvailableAlbums();
    }
  }, [isAuthenticated]);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/admin/simple-auth');
      if (response.ok) {
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/admin/simple-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        setIsAuthenticated(true);
        showMessage('success', 'Logged in successfully!');
      } else {
        showMessage('error', 'Invalid password');
      }
    } catch (error) {
      showMessage('error', 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/admin/simple-auth', { method: 'DELETE' });
      setIsAuthenticated(false);
      setPassword('');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const loadFeeds = async () => {
    try {
      // Use public endpoint for reading (doesn't require auth)
      const response = await fetch('/api/feeds');
      if (response.ok) {
        const data = await response.json();
        setFeeds(data.feeds || []);
      }
    } catch (error) {
      console.error('Failed to load feeds:', error);
    }
  };

  const loadPinnedAlbums = async () => {
    try {
      // Use public endpoint for reading (doesn't require auth)
      const response = await fetch('/api/pinned-albums');
      if (response.ok) {
        const data = await response.json();
        setPinnedAlbums(data.pinnedAlbums || []);
        setPinnedEPs(data.pinnedEPs || []);
      }
    } catch (error) {
      console.error('Failed to load pinned albums:', error);
    }
  };

  const loadAvailableAlbums = async () => {
    try {
      const response = await fetch('/api/albums-static-cached');
      if (response.ok) {
        const data = await response.json();
        const albums = data.albums || [];
        // Store both title and track count for filtering
        const albumsWithCount = albums.map((album: any) => ({
          title: album.title,
          trackCount: album.tracks?.length || 0
        })).sort((a: any, b: any) => a.title.localeCompare(b.title));
        setAvailableAlbums(albumsWithCount);
      }
    } catch (error) {
      console.error('Failed to load available albums:', error);
    }
  };

  // Filter available items by type
  const availableAlbumsOnly = availableAlbums.filter(a => a.trackCount > 6);
  const availableEPsOnly = availableAlbums.filter(a => a.trackCount >= 2 && a.trackCount <= 6);

  const handleSavePinnedAlbums = async () => {
    setSavingPinned(true);
    try {
      const response = await fetch('/api/admin/pinned-albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedAlbums, pinnedEPs }),
      });

      if (response.ok) {
        showMessage('success', 'Pinned order saved successfully!');
      } else {
        showMessage('error', 'Failed to save pinned order');
      }
    } catch (error) {
      showMessage('error', 'Failed to save pinned order');
    } finally {
      setSavingPinned(false);
    }
  };

  const handleAddPinnedAlbum = () => {
    if (selectedAlbumToPin && !pinnedAlbums.includes(selectedAlbumToPin)) {
      setPinnedAlbums([...pinnedAlbums, selectedAlbumToPin]);
      setSelectedAlbumToPin('');
    }
  };

  const handleAddPinnedEP = () => {
    if (selectedEPToPin && !pinnedEPs.includes(selectedEPToPin)) {
      setPinnedEPs([...pinnedEPs, selectedEPToPin]);
      setSelectedEPToPin('');
    }
  };

  const handleRemovePinnedAlbum = (title: string) => {
    setPinnedAlbums(pinnedAlbums.filter(t => t !== title));
  };

  const handleRemovePinnedEP = (title: string) => {
    setPinnedEPs(pinnedEPs.filter(t => t !== title));
  };

  const handleMovePinnedAlbum = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...pinnedAlbums];
    if (direction === 'up' && index > 0) {
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    } else if (direction === 'down' && index < pinnedAlbums.length - 1) {
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    }
    setPinnedAlbums(newOrder);
  };

  const handleMovePinnedEP = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...pinnedEPs];
    if (direction === 'up' && index > 0) {
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    } else if (direction === 'down' && index < pinnedEPs.length - 1) {
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    }
    setPinnedEPs(newOrder);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleAddFeeds = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);

    try {
      // Split URLs by newline or comma
      const urls = feedUrls
        .split(/[\n,]+/)
        .map(url => url.trim())
        .filter(url => url);

      if (urls.length === 0) {
        showMessage('error', 'Please enter at least one feed URL');
        setAdding(false);
        return;
      }

      const response = await fetch('/api/admin/manage-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, priority: 'extended' }),
      });

      if (response.ok) {
        const data = await response.json();
        showMessage('success', `Added ${data.added.length} feed(s) successfully!`);
        setFeedUrls('');
        loadFeeds();
      } else {
        const error = await response.json();
        showMessage('error', error.error || 'Failed to add feeds');
      }
    } catch (error) {
      showMessage('error', 'Failed to add feeds');
    } finally {
      setAdding(false);
    }
  };

  const handleReparseFeeds = async () => {
    setReparsing(true);

    try {
      // Split URLs by newline or comma
      const urls = feedUrls
        .split(/[\n,]+/)
        .map(url => url.trim())
        .filter(url => url);

      if (urls.length === 0) {
        showMessage('error', 'Please enter at least one feed URL');
        setReparsing(false);
        return;
      }

      const response = await fetch('/api/admin/manage-feeds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.errors && data.errors.length > 0) {
          const errorDetails = data.errors.map((e: any) => e.error).join(', ');
          showMessage('error', `Reparsed ${data.reparsed.length} feed(s), but ${data.errors.length} failed: ${errorDetails}`);
        } else {
          showMessage('success', `Reparsed ${data.reparsed.length} feed(s) successfully!`);
        }
        setFeedUrls('');
        loadFeeds();
      } else {
        const error = await response.json();
        showMessage('error', error.error || 'Failed to reparse feeds');
      }
    } catch (error) {
      showMessage('error', 'Failed to reparse feeds');
    } finally {
      setReparsing(false);
    }
  };

  const handleDeleteFeed = async (id: string) => {
    if (!confirm('Are you sure you want to delete this feed?')) return;

    try {
      const response = await fetch('/api/admin/manage-feeds', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        showMessage('success', 'Feed deleted successfully!');
        loadFeeds();
      } else {
        const data = await response.json().catch(() => ({}));
        const detail = data.error || `Server returned ${response.status}`;
        showMessage('error', `Failed to delete feed: ${detail}`);
      }
    } catch (error) {
      showMessage('error', `Failed to delete feed: ${error instanceof Error ? error.message : 'Network error'}`);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-black/50 backdrop-blur-sm rounded-xl p-8 border border-white/10">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">RSS Feed Manager</h1>
            <p className="text-gray-400">Enter password to manage feeds</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                placeholder="Enter admin password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Authenticating...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* Toast Message */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        } text-white animate-slide-in`}>
          {message.text}
        </div>
      )}

      {/* Header */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10 sticky top-0 z-40">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="p-2 hover:bg-white/10 rounded-lg transition-colors group"
                title="Back to site"
              >
                <ArrowLeft className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">RSS Feed Manager</h1>
                <p className="text-gray-400 text-sm">{feeds.length} feeds configured</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Add Feeds Form */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Add New Feeds
            </h2>

            <form onSubmit={handleAddFeeds} className="space-y-4">
              <div>
                <label htmlFor="feedUrls" className="block text-sm font-medium text-gray-300 mb-2">
                  Feed URLs (one per line or comma-separated)
                </label>
                <textarea
                  id="feedUrls"
                  value={feedUrls}
                  onChange={(e) => setFeedUrls(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono text-sm"
                  placeholder="https://example.com/feed.xml&#10;https://example.com/another-feed.xml"
                  rows={5}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={adding || reparsing}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {adding && <Loader2 className="w-4 h-4 animate-spin" />}
                  {adding ? 'Adding...' : 'Add Feeds'}
                </button>
                <button
                  type="button"
                  onClick={handleReparseFeeds}
                  disabled={adding || reparsing}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {reparsing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {reparsing ? 'Reparsing...' : 'Reparse Feeds'}
                </button>
              </div>
            </form>

            <p className="text-sm text-gray-400 mt-4">
              Feeds will be automatically parsed and the static cache will be regenerated.
            </p>
          </div>

          {/* Pinned Albums */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Pin className="w-5 h-5" />
              Pinned Albums (7+ tracks)
            </h2>
            <p className="text-gray-400 mb-4">
              These appear at the top of the Albums section.
            </p>

            {/* Add album to pinned list */}
            <div className="flex gap-2 mb-4">
              <select
                value={selectedAlbumToPin}
                onChange={(e) => setSelectedAlbumToPin(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800/50 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">Select album to pin...</option>
                {availableAlbumsOnly
                  .filter(a => !pinnedAlbums.includes(a.title))
                  .map((a) => (
                    <option key={a.title} value={a.title}>{a.title} ({a.trackCount} tracks)</option>
                  ))}
              </select>
              <button
                onClick={handleAddPinnedAlbum}
                disabled={!selectedAlbumToPin}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Pinned albums list */}
            {pinnedAlbums.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No pinned albums.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {pinnedAlbums.map((title, index) => (
                  <div
                    key={title}
                    className="flex items-center gap-2 p-3 bg-gray-800/30 rounded-lg"
                  >
                    <span className="text-gray-500 text-sm w-6">{index + 1}.</span>
                    <span className="flex-1 text-white truncate">{title}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleMovePinnedAlbum(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                        title="Move up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMovePinnedAlbum(index, 'down')}
                        disabled={index === pinnedAlbums.length - 1}
                        className="p-1.5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                        title="Move down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemovePinnedAlbum(title)}
                        className="p-1.5 hover:bg-red-600/20 text-red-400 rounded transition-colors"
                        title="Remove"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pinned EPs */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Pin className="w-5 h-5" />
              Pinned EPs (2-6 tracks)
            </h2>
            <p className="text-gray-400 mb-4">
              These appear at the top of the EPs section.
            </p>

            {/* Add EP to pinned list */}
            <div className="flex gap-2 mb-4">
              <select
                value={selectedEPToPin}
                onChange={(e) => setSelectedEPToPin(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800/50 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">Select EP to pin...</option>
                {availableEPsOnly
                  .filter(a => !pinnedEPs.includes(a.title))
                  .map((a) => (
                    <option key={a.title} value={a.title}>{a.title} ({a.trackCount} tracks)</option>
                  ))}
              </select>
              <button
                onClick={handleAddPinnedEP}
                disabled={!selectedEPToPin}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Pinned EPs list */}
            {pinnedEPs.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No pinned EPs.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {pinnedEPs.map((title, index) => (
                  <div
                    key={title}
                    className="flex items-center gap-2 p-3 bg-gray-800/30 rounded-lg"
                  >
                    <span className="text-gray-500 text-sm w-6">{index + 1}.</span>
                    <span className="flex-1 text-white truncate">{title}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleMovePinnedEP(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                        title="Move up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMovePinnedEP(index, 'down')}
                        disabled={index === pinnedEPs.length - 1}
                        className="p-1.5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                        title="Move down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemovePinnedEP(title)}
                        className="p-1.5 hover:bg-red-600/20 text-red-400 rounded transition-colors"
                        title="Remove"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <button
              onClick={handleSavePinnedAlbums}
              disabled={savingPinned}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {savingPinned && <Loader2 className="w-4 h-4 animate-spin" />}
              {savingPinned ? 'Saving...' : 'Save Pinned Order'}
            </button>
          </div>

          {/* Feeds List */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Current Feeds</h2>
              <span className="text-gray-400 text-sm">{feeds.length} feeds</span>
            </div>

            {feeds.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No feeds configured yet.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {[...feeds]
                    .sort((a, b) => new Date(b.lastUpdated || b.addedAt).getTime() - new Date(a.lastUpdated || a.addedAt).getTime())
                    .slice(0, showAllFeeds ? feeds.length : 3)
                    .map((feed) => (
                      <div
                        key={feed.id}
                        className="flex items-center justify-between p-4 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-white truncate">{feed.title}</h3>
                          <p className="text-sm text-gray-400 truncate">{feed.originalUrl}</p>
                          <span className="text-xs px-2 py-1 rounded bg-purple-600/20 text-purple-400 mt-1 inline-block">
                            {feed.type}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteFeed(feed.id)}
                          className="ml-4 p-2 hover:bg-red-600/20 text-red-400 rounded-lg transition-colors"
                          title="Delete feed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                </div>
                {feeds.length > 3 && (
                  <button
                    onClick={() => setShowAllFeeds(!showAllFeeds)}
                    className="w-full mt-4 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm"
                  >
                    {showAllFeeds ? `Show less` : `Show all ${feeds.length} feeds`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}