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
check 401 "forged admin token" -b 'admin-token=9999999999999.deadbeef' "$BASE/api/admin/all-feeds"
check 401 "malformed admin token" -b 'admin-token=notatoken' "$BASE/api/admin/all-feeds"
check 401 "empty signature" -b 'admin-token=1.' "$BASE/api/admin/all-feeds"

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

echo "== legitimate media still flows"
check 200 "real album art proxies" "$BASE/api/proxy-image?url=https://www.doerfelverse.com/art/them.png"
check 206 "real audio streams with Range" -r 0-1024 \
  "$BASE/api/proxy-audio?url=https://www.doerfelverse.com/tracks/disco-swag.mp3"

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
