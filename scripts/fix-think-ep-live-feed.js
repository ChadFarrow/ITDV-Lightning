/**
 * Script to ensure "Think EP LIVE!" feed is properly configured
 * This script:
 * 1. Ensures the feed exists in the database with the correct RSS feed URL
 * 2. Removes any feeds with incorrect podcastindex.org URLs
 * 3. Verifies the feed can be parsed
 */

const https = require('https');
const http = require('http');

const RSS_FEED_URL = 'https://www.doerfelverse.com/feeds/think-ep-live.xml';
const PODCAST_INDEX_ID = '7621579';

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const req = protocol.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

async function fixFeed() {
  console.log('🔧 Fixing Think EP LIVE! feed configuration...\n');
  
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  
  try {
    // Step 1: Check current feeds
    console.log('📋 Step 1: Checking current feeds...');
    const feedsResponse = await makeRequest(`${baseUrl}/api/admin/feeds`);
    
    if (feedsResponse.status !== 200) {
      console.error('❌ Failed to fetch feeds. Make sure the server is running and you have access.');
      process.exit(1);
    }
    
    const feeds = feedsResponse.data.feeds || [];
    console.log(`   Found ${feeds.length} feeds in database\n`);
    
    // Check for the correct RSS feed
    const correctFeed = feeds.find(f => f.originalUrl === RSS_FEED_URL);
    const wrongFeed = feeds.find(f => 
      f.originalUrl.includes('podcastindex.org') && 
      f.originalUrl.includes(PODCAST_INDEX_ID)
    );
    
    if (correctFeed) {
      console.log('✅ Feed with correct RSS URL found:');
      console.log(`   ID: ${correctFeed.id}`);
      console.log(`   Title: ${correctFeed.title}`);
      console.log(`   Status: ${correctFeed.status}`);
      console.log(`   URL: ${correctFeed.originalUrl}\n`);
      
      if (correctFeed.status !== 'active') {
        console.log('⚠️  Feed exists but is inactive. Please activate it via admin panel.\n');
      }
    } else {
      console.log('❌ Feed with correct RSS URL not found in database\n');
    }
    
    if (wrongFeed) {
      console.log('⚠️  Found feed with incorrect podcastindex.org URL:');
      console.log(`   ID: ${wrongFeed.id}`);
      console.log(`   URL: ${wrongFeed.originalUrl}`);
      console.log(`   This is NOT an RSS feed URL and needs to be removed!\n`);
      console.log('   Please remove this feed via admin panel and add the correct RSS feed URL:\n');
      console.log(`   ${RSS_FEED_URL}\n`);
    }
    
    // Step 2: Ensure feed exists
    if (!correctFeed) {
      console.log('📝 Step 2: Ensuring feed exists with correct URL...');
      const ensureResponse = await makeRequest(`${baseUrl}/api/admin/ensure-feed`, {
        method: 'POST',
        body: {
          rssFeedUrl: RSS_FEED_URL,
          podcastIndexId: PODCAST_INDEX_ID
        }
      });
      
      if (ensureResponse.status === 200 && ensureResponse.data.success) {
        console.log('✅ Feed added successfully!');
        console.log(`   ${ensureResponse.data.message}\n`);
      } else {
        console.log('⚠️  Could not auto-add feed. Response:', ensureResponse.data);
        console.log('\n   Please add the feed manually via admin panel:\n');
        console.log(`   URL: ${RSS_FEED_URL}`);
        console.log(`   Type: album`);
        console.log(`   Priority: core\n`);
      }
    } else {
      console.log('✅ Step 2: Feed already exists, skipping...\n');
    }
    
    // Step 3: Test feed parsing
    console.log('🧪 Step 3: Testing feed parsing...');
    const testResponse = await makeRequest(`${baseUrl}/api/albums?refresh=1`);
    
    if (testResponse.status === 200) {
      const albums = testResponse.data.albums || [];
      const thinkEpLive = albums.find(a => 
        a.title && a.title.toLowerCase().includes('think ep live')
      );
      
      if (thinkEpLive) {
        console.log('✅ Feed parsed successfully and appears in albums!');
        console.log(`   Title: ${thinkEpLive.title}`);
        console.log(`   Tracks: ${thinkEpLive.tracks?.length || 0}`);
        console.log(`   Feed ID: ${thinkEpLive.feedId}\n`);
      } else {
        console.log('⚠️  Feed parsed but not found in albums list.');
        console.log('   This might be a cache issue. Try refreshing the page with ?refresh=1\n');
      }
    } else {
      console.log('⚠️  Could not test feed parsing. Status:', testResponse.status);
    }
    
    // Step 4: Instructions
    console.log('📋 Step 4: Next steps:');
    console.log('   1. If feed was missing, it should now be added');
    console.log('   2. Clear browser cache or use ?refresh=1 on the main page');
    console.log('   3. Check the main page to see if the feed appears');
    console.log('   4. If it still doesn\'t appear, check server logs for parsing errors\n');
    
    console.log('✅ Fix script completed!\n');
    
  } catch (error) {
    console.error('❌ Error running fix script:', error);
    console.error('\nManual steps:');
    console.log(`1. Go to admin panel: ${baseUrl}/admin/feeds`);
    console.log(`2. Remove any feed with podcastindex.org URL`);
    console.log(`3. Add feed with URL: ${RSS_FEED_URL}`);
    console.log(`4. Type: album, Priority: core`);
    console.log(`5. Clear cache by visiting: ${baseUrl}/api/albums?refresh=1`);
    process.exit(1);
  }
}

fixFeed();

