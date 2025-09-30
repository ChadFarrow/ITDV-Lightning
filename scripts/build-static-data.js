#!/usr/bin/env node

/**
 * Build static album data by fetching from the slow RSS parsing endpoint once
 * This runs during build time to pre-generate fast-loading album data
 */

const fs = require('fs');
const path = require('path');

// Handle different working directories in different environments
function findProjectRoot() {
  let currentDir = __dirname;
  
  // Try to find package.json going up the directory tree
  while (currentDir !== path.dirname(currentDir)) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  // Fallback to assuming we're in the scripts directory
  return path.join(__dirname, '..');
}

async function buildStaticData() {
  console.log('🚀 Building static album data...');
  
  try {
    // Skip during Vercel build if we can't fetch (circular dependency)
    if (process.env.VERCEL) {
      console.log('⚠️ Skipping static data generation during Vercel build');
      console.log('📋 Static data will be generated post-deployment');
      return;
    }
    
    // Import fetch for Node.js
    let fetch;
    try {
      fetch = (await import('node-fetch')).default;
    } catch (error) {
      console.log('⚠️ node-fetch not available, skipping static data generation');
      return;
    }
    
    // Determine the base URL
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL 
      ? process.env.NEXT_PUBLIC_SITE_URL
      : 'https://itdv-site.vercel.app';
    
    console.log(`📡 Fetching album data from: ${baseUrl}/api/albums`);
    
    // Fetch from the slow but complete RSS parsing endpoint
    const response = await fetch(`${baseUrl}/api/albums`, {
      headers: {
        'User-Agent': 'HPM-StaticBuilder/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Add static generation metadata
    const staticData = {
      ...data,
      generated: true,
      generatedAt: new Date().toISOString(),
      source: 'build-time-rss-parse'
    };
    
    // Write to public directory
    const projectRoot = findProjectRoot();
    const outputPath = path.join(projectRoot, 'public/static-albums.json');
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(staticData, null, 2));
    
    console.log(`✅ Built static album data: ${data.albums?.length || 0} albums`);
    console.log(`📁 Saved to: ${outputPath}`);
    console.log(`⚡ Site will now load instantly!`);
    
  } catch (error) {
    console.error('❌ Failed to build static album data:', error);
    console.log('⚠️  Site will fall back to slow RSS parsing');
    // Don't fail the build, just warn
  }
}

// Run if called directly
if (require.main === module) {
  buildStaticData().catch(console.error);
}

module.exports = { buildStaticData };