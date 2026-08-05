import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import dataService from '@/lib/data-service';

interface HealthCheck {
  service: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: any;
  responseTime?: number;
}

/**
 * Origin to use when this route calls the app's own HTTP surface.
 *
 * The health check deliberately goes over HTTP rather than reading files, so it
 * exercises the same path real traffic takes. The previous fallback was a bare
 * localhost:3000, which does not resolve inside a serverless function — so on
 * Vercel, with NEXT_PUBLIC_BASE_URL unset, every downstream check reported
 * "critical" whether or not anything was actually wrong.
 */
function getSelfOrigin(request: Request): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

async function checkFileSystem(): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    const parsedFeedsPath = path.join(process.cwd(), 'data', 'parsed-feeds.json');
    
    if (!fs.existsSync(parsedFeedsPath)) {
      return {
        service: 'filesystem',
        status: 'critical',
        message: 'parsed-feeds.json not found',
        responseTime: Date.now() - startTime
      };
    }

    const stats = fs.statSync(parsedFeedsPath);
    const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);

    return {
      service: 'filesystem',
      status: ageHours > 24 ? 'warning' : 'healthy',
      message: ageHours > 24 ? 'parsed-feeds.json is over 24 hours old' : 'Files accessible',
      details: {
        lastModified: stats.mtime.toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        sizeKB: Math.round(stats.size / 1024)
      },
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'filesystem',
      status: 'critical',
      message: `Filesystem error: ${(error as Error).message}`,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkParsedFeeds(origin: string): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${origin}/api/parsed-feeds`);
    
    if (!response.ok) {
      return {
        service: 'parsed-feeds-api',
        status: 'critical',
        message: `API returned ${response.status}`,
        responseTime: Date.now() - startTime
      };
    }

    const data = await response.json();
    const feeds = data.feeds || [];
    const validation = data.validation || {};

    const successfulFeeds = feeds.filter((f: any) => f.parseStatus === 'success').length;
    const publisherFeeds = feeds.filter((f: any) => f.type === 'publisher').length;
    const albumFeeds = feeds.filter((f: any) => f.type === 'album').length;
    const warningsCount = validation.warningsCount || 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let message = 'All feeds parsed successfully';

    if (successfulFeeds < feeds.length * 0.8) {
      status = 'critical';
      message = `Only ${successfulFeeds}/${feeds.length} feeds parsed successfully`;
    } else if (warningsCount > 10) {
      status = 'warning';
      message = `${warningsCount} validation warnings found`;
    }

    return {
      service: 'parsed-feeds-api',
      status,
      message,
      details: {
        totalFeeds: feeds.length,
        successfulFeeds,
        publisherFeeds,
        albumFeeds,
        warningsCount
      },
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'parsed-feeds-api',
      status: 'critical',
      message: `Failed to fetch parsed feeds: ${(error as Error).message}`,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkAlbumsAPI(origin: string): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${origin}/api/albums`);
    
    if (!response.ok) {
      return {
        service: 'albums-api',
        status: 'critical',
        message: `API returned ${response.status}`,
        responseTime: Date.now() - startTime
      };
    }

    const data = await response.json();
    const albums = data.albums || [];

    const albumsWithTracks = albums.filter((a: any) => a.tracks && a.tracks.length > 0).length;
    const albumsWithArtwork = albums.filter((a: any) => a.coverArt).length;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let message = 'Albums API working correctly';

    if (albums.length === 0) {
      status = 'critical';
      message = 'No albums found';
    } else if (albumsWithTracks < albums.length * 0.9) {
      status = 'warning';
      message = `${albums.length - albumsWithTracks} albums missing tracks`;
    }

    return {
      service: 'albums-api',
      status,
      message,
      details: {
        totalAlbums: albums.length,
        albumsWithTracks,
        albumsWithArtwork,
        avgTracksPerAlbum: albums.length > 0 ? Math.round(albums.reduce((sum: number, a: any) => sum + (a.tracks?.length || 0), 0) / albums.length) : 0
      },
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'albums-api',
      status: 'critical',
      message: `Failed to fetch albums: ${(error as Error).message}`,
      responseTime: Date.now() - startTime
    };
  }
}

async function checkDataService(): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    // Test the data service validation report
    const report = await dataService.getValidationReport();
    
    const issueCount = report.issues?.publisherFeeds?.length || 0;
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let message = 'Data service working correctly';

    if (report.summary.totalFeeds === 0) {
      status = 'critical';
      message = 'Data service returned no feeds';
    } else if (issueCount > 5) {
      status = 'warning';
      message = `${issueCount} publisher feeds have validation issues`;
    }

    return {
      service: 'data-service',
      status,
      message,
      details: report.summary,
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'data-service',
      status: 'critical',
      message: `Data service error: ${(error as Error).message}`,
      responseTime: Date.now() - startTime
    };
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';
    const origin = getSelfOrigin(request);

    // Run all health checks in parallel
    const [filesystemCheck, parsedFeedsCheck, albumsCheck, dataServiceCheck] = await Promise.all([
      checkFileSystem(),
      checkParsedFeeds(origin),
      checkAlbumsAPI(origin),
      checkDataService()
    ]);

    const checks = [filesystemCheck, parsedFeedsCheck, albumsCheck, dataServiceCheck];
    
    // Determine overall status
    const hasCritical = checks.some(c => c.status === 'critical');
    const hasWarning = checks.some(c => c.status === 'warning');
    
    const overallStatus = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy';
    
    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'unknown',
      checks: detailed ? checks : checks.map(c => ({
        service: c.service,
        status: c.status,
        message: c.message,
        responseTime: c.responseTime
      }))
    };

    const statusCode = overallStatus === 'critical' ? 503 : overallStatus === 'warning' ? 200 : 200;
    
    return NextResponse.json(response, {
      status: statusCode,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return NextResponse.json({
      status: 'critical',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      error: `Health check failed: ${(error as Error).message}`,
      checks: []
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': 'application/json'
      }
    });
  }
}