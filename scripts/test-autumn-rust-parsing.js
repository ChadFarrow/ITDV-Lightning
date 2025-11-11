const { RSSParser } = require('../lib/rss-parser.ts');

async function testAutumnRust() {
  const feedUrl = 'https://music.behindthesch3m3s.com/wp-content/uploads/Sat_Skirmish/autumnrust/mp3s/album_feed/feed.xml';
  const trackFilter = 'The Doerfels';
  
  console.log('🔍 Testing Autumn Rust RSS parsing...');
  console.log('Feed URL:', feedUrl);
  console.log('Track Filter:', trackFilter);
  console.log('');
  
  try {
    const album = await RSSParser.parseAlbumFeed(feedUrl, trackFilter);
    
    if (album) {
      console.log('✅ Album parsed successfully!');
      console.log('Album Title:', album.title);
      console.log('Total tracks:', album.tracks.length);
      console.log('');
      
      const audioTracks = album.tracks.filter(t => t.url && !t.videoUrl);
      const videoTracks = album.tracks.filter(t => t.videoUrl);
      const chapterTracks = album.tracks.filter(t => t.videoUrl && t.startTime && t.endTime);
      
      console.log('📊 Track Breakdown:');
      console.log('  Audio tracks (url, no videoUrl):', audioTracks.length);
      console.log('  Video tracks (videoUrl):', videoTracks.length);
      console.log('  Chapter tracks (videoUrl + startTime/endTime):', chapterTracks.length);
      console.log('');
      
      if (audioTracks.length > 0) {
        console.log('✅ Audio tracks found!');
        console.log('Sample audio tracks:');
        audioTracks.slice(0, 3).forEach(t => {
          console.log(`  - ${t.title}`);
        });
      }
      
      if (chapterTracks.length > 0) {
        console.log('✅ Chapter tracks found!');
        chapterTracks.forEach(t => {
          const startMin = Math.floor(t.startTime/60);
          const startSec = (t.startTime%60).toString().padStart(2,'0');
          const endMin = Math.floor(t.endTime/60);
          const endSec = (t.endTime%60).toString().padStart(2,'0');
          console.log(`  - ${t.title}: ${startMin}:${startSec} - ${endMin}:${endSec}`);
        });
      }
      
      if (audioTracks.length === 0 && videoTracks.length > 0) {
        console.log('');
        console.log('⚠️ PROBLEM: All tracks have videoUrl!');
        console.log('First 3 tracks:');
        album.tracks.slice(0, 3).forEach(t => {
          console.log(`  - ${t.title}: url=${!!t.url}, videoUrl=${t.videoUrl || 'none'}`);
        });
      }
    } else {
      console.log('❌ Album parsing returned null');
    }
  } catch (error) {
    console.error('❌ Error parsing album:', error);
  }
}

testAutumnRust();

