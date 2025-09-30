const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// Create HPM logo programmatically based on the uploaded design
function createHPMLogo(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  
  // White text
  ctx.fillStyle = '#FFFFFF';
  
  // Calculate font size relative to canvas size
  const fontSize = size * 0.2;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw HPM text
  ctx.fillText('HPM', size / 2, size / 2);
  
  return canvas;
}

// PWA icon sizes
const iconSizes = [
  { size: 192, name: 'icon-192x192.png' },
  { size: 512, name: 'icon-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 152, name: 'apple-touch-icon-152x152.png' },
  { size: 144, name: 'apple-touch-icon-144x144.png' },
  { size: 120, name: 'apple-touch-icon-120x120.png' },
  { size: 76, name: 'apple-touch-icon-76x76.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 16, name: 'favicon-16x16.png' }
];

async function generatePWAIcons() {
  const publicDir = path.join(__dirname, '..', 'public');
  
  console.log('Generating PWA icons...');
  
  for (const icon of iconSizes) {
    console.log(`Creating ${icon.name} (${icon.size}x${icon.size})`);
    
    const canvas = createHPMLogo(icon.size);
    const buffer = canvas.toBuffer('image/png');
    
    const filepath = path.join(publicDir, icon.name);
    fs.writeFileSync(filepath, buffer);
    
    console.log(`✅ Created ${icon.name}`);
  }
  
  console.log('🎉 All PWA icons generated successfully!');
}

// Generate favicon.ico using the 32x32 version
function generateFavicon() {
  const canvas = createHPMLogo(32);
  const buffer = canvas.toBuffer('image/png');
  
  // Save as PNG (modern browsers support PNG favicons)
  const faviconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
  fs.writeFileSync(faviconPath, buffer);
  
  console.log('✅ Created favicon.ico');
}

if (require.main === module) {
  generatePWAIcons()
    .then(() => {
      generateFavicon();
      console.log('🚀 PWA logo setup complete!');
    })
    .catch(console.error);
}

module.exports = { generatePWAIcons, generateFavicon };