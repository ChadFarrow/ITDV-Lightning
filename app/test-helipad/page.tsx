'use client';

import { useState, useEffect } from 'react';

export default function TestHelipadBoosts() {
  const [boosts, setBoosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBoosts = async () => {
      try {
        console.log('🔍 Testing Helipad boosts API...');
        const response = await fetch('/api/helipad-boosts?limit=50');
        console.log('📊 Response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📊 API response:', data);
        
        setBoosts(data.boosts || []);
        setLoading(false);
      } catch (err) {
        console.error('❌ Error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchBoosts();
  }, []);

  if (loading) {
    return <div className="p-8">Loading Helipad boosts...</div>;
  }

  if (error) {
    return <div className="p-8 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Helipad Boosts Test</h1>
      <p className="mb-4">Found {boosts.length} boosts</p>
      
      {boosts.map((boost) => (
        <div key={boost.id} className="border p-4 mb-4 rounded">
          <div className="font-bold">ID: {boost.id}</div>
          <div>Amount: {boost.amount} sats</div>
          <div>Sender: {boost.sender?.name}</div>
          <div>Podcast: {boost.podcast?.title}</div>
          <div>Episode: {boost.episode?.title}</div>
          <div>Message: {boost.message}</div>
          <div>Platform: {boost.platform}</div>
          <div>Timestamp: {new Date(boost.timestamp).toLocaleString()}</div>
          
          {/* Test platform badge */}
          <div className="mt-2">
            {(boost.isFromHelipad || boost.platform === 'helipad') && (
              <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs font-medium">
                🚁 Helipad
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
