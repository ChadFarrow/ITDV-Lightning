#!/usr/bin/env node

/**
 * Script to extract colors for all album artwork via the admin API
 */

const http = require('http');

// Admin password from environment or default
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'doerfel';
const BASE_URL = 'http://localhost:3000';

async function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        // Get cookies from response
        const cookies = res.headers['set-cookie'];

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null,
          cookies: cookies,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

async function main() {
  console.log('🔐 Authenticating to admin panel...');

  // Step 1: Authenticate
  const authResponse = await makeRequest('/api/admin/simple-auth', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });

  if (authResponse.statusCode !== 200) {
    console.error('❌ Authentication failed:', authResponse.body);
    process.exit(1);
  }

  console.log('✅ Authenticated successfully!');

  // Extract cookie from response
  const cookieHeader = authResponse.cookies?.[0]?.split(';')[0];

  if (!cookieHeader) {
    console.error('❌ No session cookie received');
    process.exit(1);
  }

  console.log('🍪 Session cookie:', cookieHeader);

  console.log('🎨 Starting color extraction for all albums...');
  console.log('⏳ This may take a few minutes...\n');

  // Step 2: Trigger color extraction
  const extractResponse = await makeRequest('/api/admin/extract-colors', {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
    },
  });

  if (extractResponse.statusCode !== 200) {
    console.error('❌ Color extraction failed:', extractResponse.body);
    process.exit(1);
  }

  console.log('\n✅ Color extraction complete!');
  console.log(`📊 Results:`, extractResponse.body);
  console.log(`\n✨ Successfully processed ${extractResponse.body.processed} albums`);

  if (extractResponse.body.errors > 0) {
    console.log(`⚠️  ${extractResponse.body.errors} errors occurred`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
