/**
 * Admin session tokens.
 *
 * Stateless by design: the token is `<timestamp>.<hmac(timestamp)>`, so it
 * validates identically on any serverless instance with no shared store.
 *
 * Built on Web Crypto rather than node:crypto so the exact same code runs in
 * both the Node runtime (route handlers) and the Edge runtime (middleware).
 * That matters — middleware is the fail-closed guard in front of every
 * /api/admin route, and a second, separately-written implementation of the
 * check would be free to drift away from this one.
 */

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Use ADMIN_PASSWORD for signing tokens
function getSecret(): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD environment variable not set');
  }
  return secret;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * Constant-time string comparison.
 *
 * Deliberately not node's `timingSafeEqual`, which throws a RangeError when the
 * two buffers differ in length — and one side here is always attacker-supplied.
 * Comparing every character of the longer string keeps the work independent of
 * where the first difference falls.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/** Generate a signed token containing its own issue time. */
export async function generateToken(): Promise<string> {
  const timestamp = Date.now().toString();
  const signature = await hmacHex(timestamp, getSecret());
  return `${timestamp}.${signature}`;
}

/** Validate a signed token. Returns false for anything malformed — never throws. */
export async function validateSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;

  // Reject non-numeric timestamps before the arithmetic below, so a token like
  // "abc.<sig>" can't produce a NaN comparison that quietly passes the age check.
  if (!/^\d+$/.test(timestamp)) return false;

  const issuedAt = parseInt(timestamp, 10);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(age) || age < 0 || age > DAY_IN_MS) return false;

  let expectedSignature: string;
  try {
    expectedSignature = await hmacHex(timestamp, getSecret());
  } catch {
    // ADMIN_PASSWORD missing — fail closed rather than surfacing a 500.
    return false;
  }

  return constantTimeEquals(signature, expectedSignature);
}

/**
 * Compare a submitted password against ADMIN_PASSWORD in constant time.
 *
 * Compares HMACs rather than the raw strings so neither the password's content
 * nor its length leaks through timing.
 */
export async function verifyPassword(submitted: unknown): Promise<boolean> {
  if (typeof submitted !== 'string') return false;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return false;
  }

  const [a, b] = await Promise.all([hmacHex(submitted, secret), hmacHex(secret, secret)]);
  return constantTimeEquals(a, b);
}

/**
 * The single admin gate for route handlers. Reads the cookie itself so no
 * caller has to remember the cookie name, and so there is exactly one copy of
 * this logic instead of the five near-identical `verifyAuth` helpers this
 * replaced.
 */
export async function isAuthenticatedRequest(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<boolean> {
  return validateSession(request.cookies.get('admin-token')?.value);
}

export const ADMIN_COOKIE_NAME = 'admin-token';
