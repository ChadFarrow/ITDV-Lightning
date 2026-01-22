import { NextRequest, NextResponse } from 'next/server';
import { generateToken, createSession, validateSession, destroySession } from '@/lib/admin-auth';

// Rate limiting: track failed attempts by IP
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         'unknown';
}

function isRateLimited(ip: string): { limited: boolean; remainingTime?: number } {
  const record = failedAttempts.get(ip);
  if (!record) return { limited: false };

  const timeSinceLastAttempt = Date.now() - record.lastAttempt;

  // Reset if lockout has expired
  if (timeSinceLastAttempt > LOCKOUT_DURATION) {
    failedAttempts.delete(ip);
    return { limited: false };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const remainingTime = Math.ceil((LOCKOUT_DURATION - timeSinceLastAttempt) / 1000 / 60);
    return { limited: true, remainingTime };
  }

  return { limited: false };
}

function recordFailedAttempt(ip: string): void {
  const record = failedAttempts.get(ip);
  if (record) {
    record.count++;
    record.lastAttempt = Date.now();
  } else {
    failedAttempts.set(ip, { count: 1, lastAttempt: Date.now() });
  }
}

function clearFailedAttempts(ip: string): void {
  failedAttempts.delete(ip);
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);

    // Check rate limit
    const rateLimitCheck = isRateLimited(ip);
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${rateLimitCheck.remainingTime} minutes.` },
        { status: 429 }
      );
    }

    const { password } = await request.json();

    // Validate password
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('ADMIN_PASSWORD environment variable not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (password !== adminPassword) {
      recordFailedAttempt(ip);
      const record = failedAttempts.get(ip);
      const attemptsLeft = MAX_ATTEMPTS - (record?.count || 0);

      return NextResponse.json(
        { error: attemptsLeft > 0 ? `Invalid password. ${attemptsLeft} attempts remaining.` : 'Invalid password' },
        { status: 401 }
      );
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(ip);

    // Create session token
    const token = generateToken();
    createSession(token);

    // Set httpOnly cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set('admin-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin-token')?.value;

    if (!validateSession(token)) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true });
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get('admin-token')?.value;

  if (token) {
    destroySession(token);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete('admin-token');
  return response;
}
