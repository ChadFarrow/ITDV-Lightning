import crypto from 'crypto';

// Simple in-memory session store (for production, use Redis or database)
export const sessions = new Map<string, { created: number; admin: boolean }>();

// Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  sessions.forEach((session, token) => {
    if (now - session.created > DAY_IN_MS) {
      sessions.delete(token);
    }
  });
}, 60 * 60 * 1000);

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(token: string) {
  sessions.set(token, { created: Date.now(), admin: true });
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  return sessions.has(token);
}

export function destroySession(token: string) {
  sessions.delete(token);
}
