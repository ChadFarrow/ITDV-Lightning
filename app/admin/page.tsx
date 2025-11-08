'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';

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
  const [priority, setPriority] = useState<'core' | 'extended' | 'low'>('extended');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [adding, setAdding] = useState(false);
  const [extractingColors, setExtractingColors] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Check if already authenticated on page load
  useEffect(() => {
    checkAuth();
  }, []);

  // Load feeds when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadFeeds();
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
      const response = await fetch('/api/admin/manage-feeds');
      if (response.ok) {
        const data = await response.json();
        setFeeds(data.feeds || []);
      }
    } catch (error) {
      console.error('Failed to load feeds:', error);
    }
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
        body: JSON.stringify({ urls, priority }),
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
        showMessage('error', 'Failed to delete feed');
      }
    } catch (error) {
      showMessage('error', 'Failed to delete feed');
    }
  };

  const handleExtractColors = async () => {
    if (!confirm('Extract colors from all album artwork? This may take a few minutes.')) return;

    setExtractingColors(true);
    try {
      const response = await fetch('/api/admin/extract-colors', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        showMessage('success', `Color extraction complete! Processed ${data.processed} albums.`);
      } else {
        const error = await response.json();
        showMessage('error', error.error || 'Failed to extract colors');
      }
    } catch (error) {
      showMessage('error', 'Failed to extract colors');
    } finally {
      setExtractingColors(false);
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
                  required
                />
              </div>

              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-300 mb-2">
                  Priority
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="core">Core (loads first)</option>
                  <option value="extended">Extended (default)</option>
                  <option value="low">Low (loads last)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={adding}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {adding && <Loader2 className="w-4 h-4 animate-spin" />}
                {adding ? 'Adding Feeds...' : 'Add Feeds'}
              </button>
            </form>

            <p className="text-sm text-gray-400 mt-4">
              Feeds will be automatically parsed and the static cache will be regenerated.
            </p>
          </div>

          {/* Color Extraction */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold mb-4">Album Artwork Colors</h2>
            <p className="text-gray-400 mb-4">
              Extract dominant colors from all album artwork to enable dynamic backgrounds in the Now Playing screen.
            </p>
            <button
              onClick={handleExtractColors}
              disabled={extractingColors}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {extractingColors && <Loader2 className="w-4 h-4 animate-spin" />}
              {extractingColors ? 'Extracting Colors...' : 'Extract Colors from All Albums'}
            </button>
          </div>

          {/* Feeds List */}
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold mb-4">Current Feeds</h2>

            {feeds.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No feeds configured yet.</p>
            ) : (
              <div className="space-y-2">
                {feeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center justify-between p-4 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate">{feed.title}</h3>
                      <p className="text-sm text-gray-400 truncate">{feed.originalUrl}</p>
                      <div className="flex gap-2 mt-1">
                        <span className={`text-xs px-2 py-1 rounded ${
                          feed.priority === 'core' ? 'bg-blue-600/20 text-blue-400' :
                          feed.priority === 'extended' ? 'bg-green-600/20 text-green-400' :
                          'bg-gray-600/20 text-gray-400'
                        }`}>
                          {feed.priority}
                        </span>
                        <span className="text-xs px-2 py-1 rounded bg-purple-600/20 text-purple-400">
                          {feed.type}
                        </span>
                      </div>
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}