#!/usr/bin/env node

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./public/data/albums-with-colors.json', 'utf8'));

console.log('📋 Analyzing missing colors...\n');

let albumsProcessed = 0;
let tracksMissingColors = [];

data.albums.forEach(album => {
  const tracks = album.tracks || [];
  tracks.forEach(track => {
    if (track.image && !track.colors) {
      tracksMissingColors.push({
        album: album.title,
        track: track.title,
        image: track.image,
        sameAsAlbum: track.image === album.coverArt
      });
    }
  });
  albumsProcessed++;
});

console.log('Albums processed:', albumsProcessed);
console.log('Tracks missing colors:', tracksMissingColors.length);
console.log('\nSample of tracks missing colors:');
tracksMissingColors.slice(0, 10).forEach(t => {
  console.log('-', t.track, 'from', t.album, '(same as album:', t.sameAsAlbum + ')');
});

const sameAsAlbum = tracksMissingColors.filter(t => t.sameAsAlbum).length;
console.log('\n📊 Tracks using album artwork (should inherit colors):', sameAsAlbum);
console.log('📊 Tracks with unique artwork (need extraction):', tracksMissingColors.length - sameAsAlbum);
