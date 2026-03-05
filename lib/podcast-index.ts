import crypto from 'crypto';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || '';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || '';
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

/**
 * Generate auth headers for Podcast Index API requests.
 */
export function getPodcastIndexHeaders(): Record<string, string> {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1');
  hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
  const hashString = hash.digest('hex');

  return {
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hashString,
    'User-Agent': 're.podtards.com',
  };
}

/**
 * Check if a feed URL is indexed on Podcast Index.
 * Returns { found: true } if the feed is public/indexed.
 * Returns { found: false } if the feed is not found.
 * Graceful fallback: returns { found: true } (assume public) if PI keys
 * aren't configured or API errors occur.
 */
export async function checkFeedOnPodcastIndex(feedUrl: string): Promise<{ found: boolean }> {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.log('Podcast Index API keys not configured, assuming feed is public');
    return { found: true };
  }

  try {
    const apiUrl = `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`;
    const response = await fetch(apiUrl, { headers: getPodcastIndexHeaders() });

    if (!response.ok) {
      console.error(`Podcast Index API error: ${response.status}, assuming feed is public`);
      return { found: true };
    }

    const data = await response.json();

    // PI returns a feed object with an id if found
    if (data.feed && data.feed.id) {
      return { found: true };
    }

    return { found: false };
  } catch (error) {
    console.error('Error checking Podcast Index, assuming feed is public:', error);
    return { found: true };
  }
}
