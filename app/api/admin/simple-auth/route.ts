import { NextRequest, NextResponse } from 'next/server';
import { generateToken, validateSession, verifyPassword, ADMIN_COOKIE_NAME } from '@/lib/admin-auth';

/**
 * Rate limiting: track failed attempts by IP.
 *
 * Best-effort only. This map lives in one serverless instance's memory, so a
 * distributed attacker gets MAX_ATTEMPTS per instance, not per origin. It
 * raises the cost of online guessing; it is not a hard lockout. A durable limit
 * would need a shared store (Vercel KV / Upstash) keyed by IP.
 */
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
/** Bound the map so a spray of unique source IPs can't grow it without limit. */
const MAX_TRACKED_IPS = 10_000;

/**
 * Drop entries whose lockout has already expired; they can never limit anyone.
 * Uses forEach rather than for..of because tsconfig targets es5, where
 * iterating a Map needs downlevelIteration.
 */
function pruneExpiredAttempts(now: number): void {
  const expired: string[] = [];
  failedAttempts.forEach((record, ip) => {
    if (now - record.lastAttempt > LOCKOUT_DURATION) expired.push(ip);
  });
  expired.forEach((ip) => failedAttempts.delete(ip));
}

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
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (record) {
    record.count++;
    record.lastAttempt = now;
    return;
  }

  if (failedAttempts.size >= MAX_TRACKED_IPS) {
    pruneExpiredAttempts(now);
  }
  // Still full after pruning means every tracked IP is actively locked out;
  // drop this record rather than grow without bound.
  if (failedAttempts.size < MAX_TRACKED_IPS) {
    failedAttempts.set(ip, { count: 1, lastAttempt: now });
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

    if (!process.env.ADMIN_PASSWORD) {
      console.error('ADMIN_PASSWORD environment variable not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const { password } = await request.json();

    // Constant-time comparison — a plain `!==` leaks how much of the password
    // matched, and how long it is, through response timing.
    if (!(await verifyPassword(password))) {
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
    const token = await generateToken();

    // Set httpOnly cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_COOKIE_NAME, token, {
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
    const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (!(await validateSession(token))) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true });
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}

export async function DELETE() {
  // Tokens are stateless and self-expiring, so logging out is just dropping
  // the cookie — there is no server-side session to destroy.
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}
