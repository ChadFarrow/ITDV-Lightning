// TEMPORARY diagnostic for the Streams design (2026-11-24). Removed in the next commit.
// Answers whether POSTGRES_URL reaches a database, without exposing the URL or the host.
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

function describe(error: unknown): Record<string, string> {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const message = String(e?.message ?? '')
    .replace(/postgres(ql)?:\/\/\S+/gi, '<url>')
    .replace(/[a-z0-9.-]+\.(neon\.tech|vercel-storage\.com|supabase\.co|railway\.app|rlwy\.net)\S*/gi, '<host>')
    .slice(0, 160);
  return { name: String(e?.name ?? ''), code: String(e?.code ?? ''), message };
}

export async function GET() {
  const out: Record<string, unknown> = { env: process.env.VERCEL_ENV ?? 'local' };
  try {
    await sql`SELECT 1`;
    out.db = 'ok';
    try {
      const result = await sql`SELECT count(*)::int AS n, max(stored_at)::text AS newest FROM helipad_boosts`;
      out.helipadRows = result.rows[0]?.n;
      out.helipadNewest = result.rows[0]?.newest;
    } catch (error) {
      out.helipadTable = describe(error);
    }
  } catch (error) {
    out.db = 'error';
    out.dbError = describe(error);
  }
  try {
    await fs.access(path.join(process.cwd(), 'data', 'feeds.json'));
    out.feedsFile = 'ok';
  } catch (error) {
    out.feedsFile = describe(error).code;
  }
  return NextResponse.json(out);
}
