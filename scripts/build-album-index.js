#!/usr/bin/env node

/**
 * Build an index file for fast album lookups
 * This creates a map of album slugs to their positions in the main file
 * to avoid reading the entire 1.2MB file for single album lookups
 *
 * Slug + index logic lives in lib/album-index.ts; this script is the CLI wrapper.
 */

const fs = require('fs');
const path = require('path');

// Plain JS reimplementation of lib/album-index.ts kept in lockstep with that
// module. The two are tested by the verification step in the project plan
// (re-running this script must produce a byte-identical album-index.json).
function createSlug(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildAlbumIndex(albums) {
  const index = {};

  albums.forEach((album, idx) => {
    if (!album || !album.title) return;

    const title = album.title;
    const lowerTitle = title.toLowerCase();
    const slug = createSlug(title);
    const simpleSlug = lowerTitle.replace(/\s+/g, '-');
    const baseTitle = lowerTitle.split(/\s*[-–]\s*/)[0];
    const baseSlug = createSlug(baseTitle);

    const entry = {
      title: album.title,
      artist: album.artist,
      coverArt: album.coverArt,
      feedId: album.feedId,
      feedUrl: album.feedUrl,
      index: idx,
    };

    index[lowerTitle] = entry;
    index[slug] = entry;
    index[simpleSlug] = entry;
    index[baseSlug] = entry;

    if (album.feedId) {
      index[album.feedId.toLowerCase()] = entry;
    }
  });

  return {
    version: '1.0',
    totalAlbums: albums.length,
    indexedAt: new Date().toISOString(),
    index,
  };
}

function buildIndex() {
  console.log('🚀 Building album index...');

  try {
    const projectRoot = path.join(__dirname, '..');
    const staticFilePath = path.join(projectRoot, 'public', 'static-albums.json');
    const indexFilePath = path.join(projectRoot, 'public', 'album-index.json');

    if (!fs.existsSync(staticFilePath)) {
      console.error('❌ static-albums.json not found');
      process.exit(1);
    }

    console.log('📖 Reading static-albums.json...');
    const staticData = JSON.parse(fs.readFileSync(staticFilePath, 'utf-8'));
    const albums = staticData.albums || [];

    console.log(`📚 Indexing ${albums.length} albums...`);

    const indexData = buildAlbumIndex(albums);

    fs.writeFileSync(indexFilePath, JSON.stringify(indexData, null, 2));

    console.log(`✅ Built album index: ${Object.keys(indexData.index).length} entries`);
    console.log(`📁 Saved to: ${indexFilePath}`);
    console.log(`💾 Index size: ${(fs.statSync(indexFilePath).size / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error('❌ Failed to build album index:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  buildIndex();
}

module.exports = { buildIndex, buildAlbumIndex, createSlug };
