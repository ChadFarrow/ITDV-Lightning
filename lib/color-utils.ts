// Color extraction and manipulation utilities for dynamic backgrounds

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface ExtractedColors {
  dominant: string;
  palette: ColorPalette;
  isDark: boolean;
}

// Default fallback colors for when canvas extraction fails (e.g., DuckDuckGo browser blocks canvas)
const FALLBACK_COLORS: ExtractedColors = {
  dominant: 'rgb(64, 64, 64)',
  palette: {
    primary: 'hsl(0, 0%, 25%)',
    secondary: 'hsl(0, 0%, 35%)',
    accent: 'hsl(220, 15%, 30%)',
    background: 'linear-gradient(135deg, hsl(0, 0%, 10%) 0%, hsl(0, 0%, 5%) 100%)',
    text: '#ffffff'
  },
  isDark: true
};

// Extract dominant colors from an image using Canvas API
export const extractColorsFromImage = async (imageUrl: string): Promise<ExtractedColors> => {
  return new Promise((resolve, reject) => {
    console.log('🖼️ Starting color extraction for:', imageUrl);
    const img = new Image();

    // Handle different image sources
    let finalUrl = imageUrl;

    // Always use proxy for external URLs to avoid CORS issues
    if (imageUrl.startsWith('http')) {
      // Convert HTTP to HTTPS if needed
      let secureUrl = imageUrl;
      if (imageUrl.startsWith('http://')) {
        secureUrl = imageUrl.replace('http://', 'https://');
      }
      // Use the proxy-image API to avoid CORS issues
      finalUrl = `/api/proxy-image?url=${encodeURIComponent(secureUrl)}`;
      console.log('🔄 Using proxy for image:', secureUrl, '→', finalUrl);
    }

    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          // Canvas context unavailable (privacy browsers may block this)
          console.warn('Canvas context unavailable, using fallback colors');
          resolve(FALLBACK_COLORS);
          return;
        }

        // Set canvas size (smaller for performance)
        canvas.width = 100;
        canvas.height = 100;

        // Draw image to canvas
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Get image data - DuckDuckGo and privacy browsers may throw SecurityError here
        let imageData;
        try {
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (canvasError) {
          console.warn('Canvas getImageData blocked (privacy browser detected), using fallback colors');
          resolve(FALLBACK_COLORS);
          return;
        }
        const data = imageData.data;
        
        // Collect all pixels for KMeans clustering
        const pixels: Array<[number, number, number]> = [];
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Skip very light or very dark pixels
          const brightness = (r + g + b) / 3;
          if (brightness < 20 || brightness > 235) continue;
          
          pixels.push([r, g, b]);
        }
        
        // Use KMeans to find 5 representative colors
        const kMeansColors = kMeans(pixels, 5);
        
        // Find the most vibrant color from the KMeans palette
        let bestColor = kMeansColors[0];
        let bestScore = 0;
        
        for (const color of kMeansColors) {
          const [r, g, b] = color;
          const hsl = rgbToHsl(r, g, b);
          const saturation = hsl.s / 100;
          const lightness = hsl.l / 100;
          
          // Score based on saturation and avoiding too dark/light colors
          const score = saturation * (1 - Math.abs(lightness - 0.5));
          
          if (score > bestScore) {
            bestScore = score;
            bestColor = color;
          }
        }
        
        let dominantColor = `${bestColor[0]},${bestColor[1]},${bestColor[2]}`;
        
        if (!dominantColor) {
          // Fallback to a neutral color
          dominantColor = '64,64,64';
        }
        
        const [r, g, b] = dominantColor.split(',').map(Number);
        const generatedPalette = generateColorPalette(r, g, b);
        const isDark = isColorDark(r, g, b);
        
        console.log('🎨 Extracted colors:', {
          dominant: `rgb(${r}, ${g}, ${b})`,
          kMeansPalette: kMeansColors.map(c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`),
          bestScore,
          generatedPalette,
          isDark
        });
        
        resolve({
          dominant: `rgb(${r}, ${g}, ${b})`,
          palette: generatedPalette,
          isDark
        });
      } catch (error) {
        console.warn('Color extraction failed, using fallback colors:', error);
        resolve(FALLBACK_COLORS);
      }
    };

    img.onerror = (error) => {
      console.warn('Failed to load image for color extraction:', finalUrl, error);
      // Use fallback colors instead of rejecting to prevent crashes
      resolve(FALLBACK_COLORS);
    };
    
    img.src = finalUrl;
  });
};

// Generate a color palette based on a dominant color
const generateColorPalette = (r: number, g: number, b: number): ColorPalette => {
  const hsl = rgbToHsl(r, g, b);
  
  // Create variations
  const primary = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  const secondary = `hsl(${hsl.h}, ${Math.max(0, hsl.s - 20)}%, ${Math.min(100, hsl.l + 10)}%)`;
  const accent = `hsl(${(hsl.h + 30) % 360}, ${hsl.s}%, ${hsl.l}%)`;
  
  // Create background gradient
  const background = `linear-gradient(135deg, 
    hsl(${hsl.h}, ${hsl.s}%, ${Math.max(0, hsl.l - 40)}%) 0%, 
    hsl(${hsl.h}, ${Math.max(0, hsl.s - 30)}%, ${Math.max(0, hsl.l - 60)}%) 100%)`;
  
  // Determine text color based on background brightness
  const text = hsl.l > 50 ? '#000000' : '#ffffff';
  
  return {
    primary,
    secondary,
    accent,
    background,
    text
  };
};

// Convert RGB to HSL
const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    
    h /= 6;
  }
  
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
};

// Check if a color is dark
const isColorDark = (r: number, g: number, b: number): boolean => {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
};

// Simple KMeans clustering for color extraction
const kMeans = (pixels: Array<[number, number, number]>, k: number): Array<[number, number, number]> => {
  if (pixels.length === 0) return [[64, 64, 64]];
  if (pixels.length < k) return pixels.slice(0, k);
  
  // Initialize centroids randomly
  const centroids: Array<[number, number, number]> = [];
  for (let i = 0; i < k; i++) {
    const randomIndex = Math.floor(Math.random() * pixels.length);
    centroids.push([...pixels[randomIndex]]);
  }
  
  // Run KMeans for a few iterations
  for (let iter = 0; iter < 10; iter++) {
    // Assign pixels to nearest centroid
    const clusters: Array<Array<[number, number, number]>> = Array(k).fill(null).map(() => []);
    
    for (const pixel of pixels) {
      let minDistance = Infinity;
      let bestCluster = 0;
      
      for (let c = 0; c < k; c++) {
        const distance = Math.sqrt(
          Math.pow(pixel[0] - centroids[c][0], 2) +
          Math.pow(pixel[1] - centroids[c][1], 2) +
          Math.pow(pixel[2] - centroids[c][2], 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          bestCluster = c;
        }
      }
      
      clusters[bestCluster].push(pixel);
    }
    
    // Update centroids
    for (let c = 0; c < k; c++) {
      if (clusters[c].length > 0) {
        const avgR = clusters[c].reduce((sum, p) => sum + p[0], 0) / clusters[c].length;
        const avgG = clusters[c].reduce((sum, p) => sum + p[1], 0) / clusters[c].length;
        const avgB = clusters[c].reduce((sum, p) => sum + p[2], 0) / clusters[c].length;
        
        centroids[c] = [Math.round(avgR), Math.round(avgG), Math.round(avgB)];
      }
    }
  }
  
  return centroids;
};

// Create a smooth gradient background from album art colors
export const createAlbumBackground = (colors: ExtractedColors): string => {
  const { dominant, palette } = colors;
  
  // Extract RGB values from dominant color
  const rgbMatch = dominant.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!rgbMatch) return palette.background;
  
  const [, r, g, b] = rgbMatch.map(Number);
  const hsl = rgbToHsl(r, g, b);
  
  // Smart lightness adjustment based on original color brightness
  const isLightColor = hsl.l > 60; // If lightness > 60%, it's a light color
  
  const gradient = isLightColor 
    ? // For light colors: reduce lightness to prevent blown-out whites
      `linear-gradient(135deg, 
        hsl(${hsl.h}, ${Math.min(100, hsl.s + 20)}%, ${Math.max(15, hsl.l - 25)}%) 0%, 
        hsl(${hsl.h}, ${hsl.s}%, ${Math.max(12, hsl.l - 30)}%) 25%, 
        hsl(${(hsl.h + 15) % 360}, ${Math.max(30, hsl.s - 10)}%, ${Math.max(10, hsl.l - 35)}%) 75%, 
        hsl(${(hsl.h + 30) % 360}, ${Math.max(20, hsl.s - 20)}%, ${Math.max(8, hsl.l - 40)}%) 100%)`
    : // For dark colors: boost lightness to make them visible
      `linear-gradient(135deg, 
        hsl(${hsl.h}, ${Math.min(100, hsl.s + 20)}%, ${Math.max(35, hsl.l - 5)}%) 0%, 
        hsl(${hsl.h}, ${hsl.s}%, ${Math.max(30, hsl.l - 10)}%) 25%, 
        hsl(${(hsl.h + 15) % 360}, ${Math.max(30, hsl.s - 10)}%, ${Math.max(25, hsl.l - 15)}%) 75%, 
        hsl(${(hsl.h + 30) % 360}, ${Math.max(20, hsl.s - 20)}%, ${Math.max(20, hsl.l - 20)}%) 100%)`;
  
  return gradient;
};

// Create a subtle overlay for better text readability
export const createTextOverlay = (colors: ExtractedColors): string => {
  const { isDark } = colors;
  
  if (isDark) {
    return 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.3) 100%)';
  } else {
    return 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.1) 100%)';
  }
};

// Create button styles that complement the extracted colors
export const createButtonStyles = (colors: ExtractedColors) => {
  const { dominant, palette, isDark } = colors;
  
  // Extract RGB values from dominant color
  const rgbMatch = dominant.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!rgbMatch) {
    return {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'rgba(255, 255, 255, 0.2)',
      hoverBackground: 'rgba(255, 255, 255, 0.2)',
      hoverBorder: 'rgba(255, 255, 255, 0.3)',
    };
  }
  
  const [, r, g, b] = rgbMatch.map(Number);
  
  // Create complementary button colors based on the dominant color
  if (isDark) {
    // For dark backgrounds, use lighter, semi-transparent versions
    return {
      background: `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, 0.15)`,
      border: `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)}, 0.3)`,
      hoverBackground: `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)}, 0.25)`,
      hoverBorder: `rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 80)}, 0.4)`,
    };
  } else {
    // For light backgrounds, use darker, semi-transparent versions
    return {
      background: `rgba(${Math.max(0, r - 20)}, ${Math.max(0, g - 20)}, ${Math.max(0, b - 20)}, 0.2)`,
      border: `rgba(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)}, 0.3)`,
      hoverBackground: `rgba(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)}, 0.3)`,
      hoverBorder: `rgba(${Math.max(0, r - 50)}, ${Math.max(0, g - 50)}, ${Math.max(0, b - 50)}, 0.4)`,
    };
  }
};
