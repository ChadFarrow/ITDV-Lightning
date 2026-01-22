import crypto from 'crypto';

// Use ADMIN_PASSWORD for signing tokens
const getSecret = () => {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD environment variable not set');
  }
  return secret;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Generate a signed token that contains timestamp (stateless - works in serverless)
export function generateToken(): string {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(timestamp)
    .digest('hex');
  return `${timestamp}.${signature}`;
}

// Validate a signed token (stateless - works in serverless)
export function validateSession(token: string | undefined): boolean {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;
  const timestampNum = parseInt(timestamp, 10);

  // Check if token is expired (24 hours)
  if (Date.now() - timestampNum > DAY_IN_MS) {
    return false;
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', getSecret())
    .update(timestamp)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Legacy functions kept for API compatibility (now no-ops since auth is stateless)
export function createSession(_token: string) {
  // No-op - token is self-contained
}

export function destroySession(_token: string) {
  // No-op - token expiration is time-based
  // Client should delete the cookie
}
