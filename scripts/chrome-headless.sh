#!/usr/bin/env bash
# Headless Chrome for scripts/e2e.mjs.
#
# --use-fake-device-for-media-stream gives getUserMedia a synthetic camera, so
# the whole capture path runs with no hardware and no permission prompt. The
# profile is throwaway; it never touches your real Chrome profile.
set -euo pipefail

PORT="${PORT:-9222}"
PROFILE="${PROFILE:-$(mktemp -d)}"

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "$(command -v google-chrome || true)" \
           "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "$CHROME" ] || { echo "No Chrome found. Set CHROME=/path/to/chrome" >&2; exit 1; }

echo "Chrome:  $CHROME"
echo "CDP:     http://127.0.0.1:$PORT"

exec "$CHROME" \
  --headless=new \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --disable-gpu \
  --use-fake-device-for-media-stream \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  about:blank
