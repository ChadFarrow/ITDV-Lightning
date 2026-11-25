#!/usr/bin/env bash
# Security regression smoke test.
#
# Covers the vulnerabilities found in the August 2026 audit so they cannot come
# back unnoticed. Every check asserts an exact HTTP status; the script exits
# non-zero on the first mismatch.
#
# Usage:
#   ADMIN_PASSWORD=<pw> npm run dev          # in one shell
#   ADMIN_PASSWORD=<pw> ./scripts/security-smoke.sh [base-url]
set -uo pipefail

BASE="${1:-http://localhost:3000}"
COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

pass=0
fail=0

check() {
  local want="$1" desc="$2"; shift 2
  local got
  got="$(curl -sS -o /dev/null -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then
    printf '  ok    %-58s %s\n' "$desc" "$got"; pass=$((pass + 1))
  else
    printf '  FAIL  %-58s want %s got %s\n' "$desc" "$want" "$got"; fail=$((fail + 1))
  fi
}

# check_header <want> <desc> <header-name> <curl args...>
# Asserts one response header matches the wanted value, a bash glob (empty = header missing).
check_header() {
  local want="$1" desc="$2" name="$3"; shift 3
  local got
  got="$(curl -sS -o /dev/null -D - "$@" | tr -d '\r' | grep -i "^$name:" | head -1 | cut -d' ' -f2-)"
  # shellcheck disable=SC2053 # unquoted right side on purpose: it is a glob
  if [ -n "$got" ] && [[ "$got" == $want ]]; then
    printf '  ok    %-58s %s\n' "$desc" "$got"; pass=$((pass + 1))
  else
    printf '  FAIL  %-58s want %s got %s\n' "$desc" "$want" "${got:-<missing>}"; fail=$((fail + 1))
  fi
}

# check_any <wanted codes, space-separated> <desc> <curl args...>
check_any() {
  local want="$1" desc="$2"; shift 2
  local got
  got="$(curl -sS -o /dev/null -w '%{http_code}' "$@")"
  if [[ " $want " == *" $got "* ]]; then
    printf '  ok    %-58s %s\n' "$desc" "$got"; pass=$((pass + 1))
  else
    printf '  FAIL  %-58s want one of %s got %s\n' "$desc" "$want" "$got"; fail=$((fail + 1))
  fi
}

# check_value <want> <desc> <got>: a value the script computed must equal <want>.
check_value() {
  local want="$1" desc="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %-58s %s\n' "$desc" "$got"; pass=$((pass + 1))
  else
    printf '  FAIL  %-58s want %s got %s\n' "$desc" "$want" "${got:-<empty>}"; fail=$((fail + 1))
  fi
}

# check_body_lacks <text> <desc> <curl args...>: the response body must not contain <text>.
check_body_lacks() {
  local text="$1" desc="$2"; shift 2
  if curl -sS "$@" | grep -qF -- "$text"; then
    printf '  FAIL  %-58s body contains %s\n' "$desc" "$text"; fail=$((fail + 1))
  else
    printf '  ok    %-58s\n' "$desc"; pass=$((pass + 1))
  fi
}

echo "== path traversal (/api/optimized-images) must not escape the directory"
for p in '..%2F..%2Fpackage.json' '..%2f..%2f.env.local' '..%2F..%2Fdata%2Ffeeds.json' \
         '..%2F..%2F..%2F..%2F..%2F..%2Fetc%2Fhosts' '..%5C..%5Cpackage.json' '.env.local'; do
  check 404 "traversal $p" "$BASE/api/optimized-images/$p"
done

echo "== admin API is fail-closed without a session"
for e in all-feeds cdn-status monitoring feeds manage-feeds pinned-albums \
         clear-cache extract-colors discover-podroll ensure-feed; do
  check 401 "unauthenticated GET /api/admin/$e" "$BASE/api/admin/$e"
done
check 401 "unauthenticated DELETE /api/admin/monitoring" -X DELETE "$BASE/api/admin/monitoring"
# Clears every stored Helipad boost, and it lives outside /api/admin, so middleware does not cover it.
# Never add an authenticated DELETE here: on a server with POSTGRES_URL it wipes the store.
check 401 "unauthenticated DELETE /api/helipad-boosts" -X DELETE "$BASE/api/helipad-boosts"
check 401 "forged admin token" -b 'admin-token=9999999999999.deadbeef' "$BASE/api/admin/all-feeds"
check 401 "malformed admin token" -b 'admin-token=notatoken' "$BASE/api/admin/all-feeds"
check 401 "empty signature" -b 'admin-token=1.' "$BASE/api/admin/all-feeds"

echo "== Helipad webhook needs a sender token; streams and boosts never answer 500"
check 401 "webhook POST without a token" -X POST -H 'content-type: application/json' -d '{"value_msat":1}' \
  "$BASE/api/helipad-webhook"
check 401 "webhook POST with a wrong token" -X POST -H 'Authorization: Bearer wrong' \
  -H 'content-type: application/json' -d '{"value_msat":1}' "$BASE/api/helipad-webhook"
check_any "200 503" "GET /api/streams with a huge limit" "$BASE/api/streams?limit=100000"
check_any "200 503" "GET /api/helipad-boosts" "$BASE/api/helipad-boosts"
# The boost list once answered a `debug` block that told anyone whether POSTGRES_URL was set.
check_body_lacks '"debug"' "GET /api/helipad-boosts has no debug field" "$BASE/api/helipad-boosts"

echo "== login"
check 401 "wrong password rejected" -X POST "$BASE/api/admin/simple-auth" \
  -H 'Content-Type: application/json' -d '{"password":"definitely-not-it"}'
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  check 200 "correct password accepted" -c "$COOKIES" -X POST "$BASE/api/admin/simple-auth" \
    -H 'Content-Type: application/json' -d "{\"password\":\"$ADMIN_PASSWORD\"}"
  check 200 "authenticated admin request" -b "$COOKIES" "$BASE/api/admin/all-feeds"
else
  echo "  skip  ADMIN_PASSWORD not set, skipping positive login checks"
fi

echo "== media proxies refuse active content and private destinations"
check 415 "proxy-image refuses text/html" "$BASE/api/proxy-image?url=https://example.com/"
check 403 "proxy-image refuses localhost" "$BASE/api/proxy-image?url=https://localhost/x.png"
check 403 "proxy-image refuses 127.0.0.1" "$BASE/api/proxy-image?url=https://127.0.0.1/x.png"
check 403 "proxy-image refuses link-local metadata" "$BASE/api/proxy-image?url=https://169.254.169.254/"
check 403 "proxy-image refuses RFC1918" "$BASE/api/proxy-image?url=https://10.0.0.5/x.png"
check 400 "proxy-image refuses http://" "$BASE/api/proxy-image?url=http://example.com/x.png"
check 403 "proxy-audio refuses localhost" "$BASE/api/proxy-audio?url=https://localhost/x.mp3"
check 403 "proxy-image refuses IPv4-mapped loopback (hex)" "$BASE/api/proxy-image?url=https://%5B::ffff:7f00:1%5D/x.png"
check 403 "proxy-audio refuses NAT64 loopback" "$BASE/api/proxy-audio?url=https://%5B64:ff9b::7f00:1%5D/x.mp3"
check 403 "proxy-image refuses a name that resolves to loopback" "$BASE/api/proxy-image?url=https://127.0.0.1.nip.io/x.png"
check 403 "proxy-video refuses loopback" "$BASE/api/proxy-video?url=https://127.0.0.1/x.m3u8"

echo "== legitimate media still flows"
check 200 "real album art proxies" "$BASE/api/proxy-image?url=https://www.doerfelverse.com/art/them.png"
check 206 "real audio streams with Range" -r 0-1024 \
  "$BASE/api/proxy-audio?url=https://www.doerfelverse.com/tracks/disco-swag.mp3"

# Next 15.5.29 (GHSA-pc58-hwjq-p385 fix) strips Content-Length from every route-handler
# response, so the proxied 206 went out chunked with no length. Production on 15.4.8 sent it.
# Next 15.5.28 keeps it. Bump past 15.5.28 only once these two checks pass on the new version.
echo "== proxied range responses keep their framing headers"
check_header "1025" "audio 206 carries Content-Length" content-length -r 0-1024 \
  "$BASE/api/proxy-audio?url=https://www.doerfelverse.com/tracks/disco-swag.mp3"
check_header "bytes 0-1024/*" "audio 206 carries Content-Range" content-range -r 0-1024 \
  "$BASE/api/proxy-audio?url=https://www.doerfelverse.com/tracks/disco-swag.mp3"

# op3.dev tracks answer with a redirect to their host; the proxy follows it by hand.
OP3_TRACK="https%3A%2F%2Fop3.dev%2Fe%2Cpg%3D57203632-2003-55d2-b710-c699db963f18%2Fhttps%3A%2F%2Fd12wklypp119aj.cloudfront.net%2Ftrack%2F1fea31e7-73db-4b29-8d90-3b32ae47d2b9.mp3"
check 206 "op3.dev audio streams through its redirect" -r 0-1024 "$BASE/api/proxy-audio?url=$OP3_TRACK"
check_header "1025" "op3.dev audio 206 carries Content-Length" content-length -r 0-1024 \
  "$BASE/api/proxy-audio?url=$OP3_TRACK"
check_header "bytes 0-1024/*" "op3.dev audio 206 carries Content-Range" content-range -r 0-1024 \
  "$BASE/api/proxy-audio?url=$OP3_TRACK"

# Cloudflare Stream: the master names its variant playlists, and a variant names its init
# segment and its segments as ../../<id>/video/<n>/seg_N.mp4?p=…. Until 2026-11-25 those segment
# lines stayed relative and no Cloudflare video played. Every link must be a root-relative proxy
# link, and the init segment and the first segment must arrive through it.
echo "== Cloudflare Stream video: every playlist link goes through the proxy"
CF_MASTER="https%3A%2F%2Fcustomer-dlnbepb8zpz7h846.cloudflarestream.com%2Faef771f15a451d680860b185bde17de6%2Fmanifest%2Fvideo.m3u8"
cf_variant="$(curl -sS "$BASE/api/proxy-video?url=$CF_MASTER" | tr -d '\r' | grep -v '^#' | grep -m1 .)"
check_value "/api/proxy-video?url=" "Cloudflare master: variant link is a proxy link" "${cf_variant:0:21}"
cf_media="$(curl -sS "$BASE${cf_variant:-/api/proxy-video}" | tr -d '\r')"
cf_loose="$(grep -v '^#' <<<"$cf_media" | grep . | grep -vc '^/api/proxy-video?url=')"
cf_count="$(grep -c '^/api/proxy-video?url=' <<<"$cf_media")"
check_value "yes" "Cloudflare media playlist names its segments" "$([ "${cf_count:-0}" -gt 100 ] && echo yes || echo "no ($cf_count)")"
check_value "0" "Cloudflare media playlist: no link left unproxied" "$cf_loose"
cf_init="$(grep -m1 '^#EXT-X-MAP' <<<"$cf_media" | sed 's/.*URI="\([^"]*\)".*/\1/')"
cf_seg="$(grep -v '^#' <<<"$cf_media" | grep -m1 .)"
# An empty link falls back to the bare route (400), not to the home page (200).
check 200 "Cloudflare init segment arrives through the proxy" "$BASE${cf_init:-/api/proxy-video}"
check 200 "Cloudflare ../../ segment arrives through the proxy" "$BASE${cf_seg:-/api/proxy-video}"
check_header "video/mp4*" "Cloudflare segment is video/mp4" content-type "$BASE${cf_seg:-/api/proxy-video}"

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
