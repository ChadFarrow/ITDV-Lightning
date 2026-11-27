// Assertions for lib/user-agent.js, the one User-Agent of this app's server code and scripts.
//
//   npx tsx scripts/check-user-agent.ts
//
// The form is `<AppName>/<version> (+<public link>)`: the app's own name, the version from
// package.json, and a link that answers 200. No e-mail and no browser imitation. It also
// refuses any other User-Agent string literal in app/, lib/, scripts/, hooks/, utils/ and
// middleware.ts, so a call site cannot drift back to a copied name (until 2026-11-27 there
// were six: Podtards*Proxy, OGImageProxy, DoerfelVerse, RSS-Parser, re.podtards.com,
// HPM-StaticBuilder). The link check needs the internet; without it, it is skipped.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_NAME, APP_URL, APP_VERSION, USER_AGENT } from '../lib/user-agent';

let bad = 0;
let passed = 0;
const out = (m: string) => process.stdout.write(m + '\n');
const check = (cond: boolean, m: string) => {
  if (cond) { out('ok     ' + m); passed++; } else { out('FAIL   ' + m); bad++; }
};

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

async function main() {
  // --- 1. the form -----------------------------------------------------------
  check(APP_NAME === 'ITDV-Lightning', `the name is this app's own (${APP_NAME})`);
  check(APP_VERSION === pkg.version && APP_VERSION.length > 0, `the version is package.json's (${APP_VERSION} = ${pkg.version})`);
  check(APP_URL === 'https://itdv.podtards.com', `the link is the live site (${APP_URL})`);
  check(USER_AGENT === `${APP_NAME}/${APP_VERSION} (+${APP_URL})`, `USER_AGENT is <name>/<version> (+<link>): ${USER_AGENT}`);
  // RFC 9110: product = token ["/" product-version], comment in parentheses.
  check(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+ \(\+https:\/\/[^\s()]+\)$/.test(USER_AGENT),
    'USER_AGENT is a valid product token and comment');
  check(!/@|mailto:/i.test(USER_AGENT), 'USER_AGENT carries no e-mail address');
  check(!/mozilla|compatible|applewebkit|chrome|safari|gecko/i.test(USER_AGENT), 'USER_AGENT imitates no browser');
  check(!/hpm|doerfelverse|podtards[a-z]|re\.podtards/i.test(USER_AGENT.split(' ')[0]), 'USER_AGENT names no other app');

  // --- 2. the plain-node scripts get the same value -------------------------
  const req = createRequire(path.join(root, 'scripts', 'x.js'));
  check(req('../lib/user-agent').USER_AGENT === USER_AGENT, 'require() from a plain-node script gives the same value');

  // --- 3. no other User-Agent literal ---------------------------------------
  const files = execFileSync('git', ['ls-files', 'app', 'lib', 'scripts', 'hooks', 'utils', 'middleware.ts'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && f !== 'scripts/check-user-agent.ts');
  const literal = /['"]user-agent['"]\s*:\s*['"`]/i;
  const offenders: string[] = [];
  for (const f of files) {
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
      if (literal.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  check(files.length > 50 && offenders.length === 0,
    `no other User-Agent string literal in ${files.length} files (${offenders.join(', ') || 'none'})`);

  // --- 4. the link answers 200 ----------------------------------------------
  try {
    const res = await fetch(APP_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    await res.body?.cancel().catch(() => {});
    check(res.status === 200, `${APP_URL} answers 200 (got ${res.status})`);
  } catch (e) {
    out(`SKIP   ${APP_URL} not reached (${(e as Error).name}); the link is not checked`);
  }

  out(`\npassed: ${passed}  failed: ${bad}`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  out('FAIL   ' + ((e as Error).stack || String(e)));
  process.exit(1);
});
