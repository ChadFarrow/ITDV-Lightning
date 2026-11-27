/**
 * The one User-Agent for every request that this app's server code and scripts
 * send to another host (Chad, 2026-11-27: "I wanna make sure all of my apps are
 * sending proper user agents"):
 *
 *   ITDV-Lightning/<package.json version> (+https://itdv.podtards.com)
 *
 * The app's own name, its version and a public link to it. No e-mail, and no
 * browser imitation: until 2026-11-27 the proxies sent `Mozilla/5.0
 * (compatible; Podtards…Proxy/1.0)` or `DoerfelVerse/1.0`, names copied with the
 * code from other apps, and some server fetches sent Node's bare `node` (or, for
 * `https.get`, no User-Agent at all). Each host that a call site reaches was
 * probed with the old and the new name on 2026-11-27; none answered differently.
 *
 * Use it in every server-side request: route handlers, `lib/` server code,
 * WebSocket upgrades and scripts. `fetchProxyTarget` (lib/proxy-guard.ts) sets
 * it by default. Browser code cannot set this header, so client fetches keep
 * the browser's own. `scripts/check-user-agent.ts` asserts the form and refuses
 * any other User-Agent literal in `app/`, `lib/` and `scripts/`.
 *
 * CommonJS on purpose: the Next server build and the `tsx` checks import it,
 * and the plain-`node` scripts in `scripts/` require it. Server and scripts
 * only: it reads package.json, so nothing in a browser bundle may import it.
 */
const { version } = require('../package.json');

const APP_NAME = 'ITDV-Lightning';
const APP_URL = 'https://itdv.podtards.com';
const APP_VERSION = version;
const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${APP_URL})`;

module.exports = { APP_NAME, APP_URL, APP_VERSION, USER_AGENT };
