const fs = require('fs');
const path = require('path');

async function regenerate() {
  console.log('🔄 Regenerating static cache...');

  try {
    const response = await fetch('http://localhost:3000/api/albums-static?regenerate=true');
    const data = await response.json();

    if (data.albums && Array.isArray(data.albums)) {
      const outputPath = path.join(__dirname, '..', 'public', 'albums-static-cached.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
      console.log(`✅ Wrote ${data.albums.length} albums to ${outputPath}`);

      // Check for Satellite Spotlight
      const satAlbums = data.albums.filter(a => a.title.toLowerCase().includes('satellite'));
      console.log(`\n📡 Satellite Spotlight albums: ${satAlbums.length}`);
      satAlbums.forEach(a => console.log(`   - ${a.title}`));
    } else {
      console.error('❌ Invalid response:', data);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

regenerate();
