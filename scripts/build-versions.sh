#!/bin/bash

echo "🚀 Building HPM versions..."

# Build Lightning version
echo "⚡ Building Lightning version..."
cp .env.lightning .env.local
npm run build
mv .next .next-lightning

# Build Basic version  
echo "🎵 Building Basic version..."
cp .env.basic .env.local
npm run build
mv .next .next-basic

# Restore Lightning as default
mv .next-lightning .next
cp .env.lightning .env.local

echo "✅ Built both versions successfully!"
echo "⚡ Lightning version: .next"
echo "🎵 Basic version: .next-basic"