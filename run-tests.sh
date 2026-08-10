#!/usr/bin/env bash
# Runs lookbook/test.html in headless Chrome and prints the assertion output.
set -uo pipefail

PORT="${PORT:-8123}"
ROOT="$(cd "$(dirname "$0")" && pwd)/lookbook"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

if [ -z "$CHROME" ]; then
  echo "No Chrome/Chromium found. Open lookbook/test.html in a browser instead." >&2
  exit 1
fi

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 1

DOM=$(mktemp)
# Headless Chrome sometimes lingers after dumping the DOM, so it is capped.
timeout 60 "$CHROME" --headless=new --disable-gpu --no-sandbox \
  --user-data-dir="$(mktemp -d)" --virtual-time-budget=15000 \
  --dump-dom "http://localhost:$PORT/test.html" >"$DOM" 2>/dev/null

python3 - "$DOM" <<'PY'
import re, sys
html = open(sys.argv[1]).read()
match = re.search(r'<pre id="out">(.*?)</pre>', html, re.S)
if not match:
    print("Test page produced no output — check for a JavaScript error.")
    sys.exit(1)
output = re.sub(r'&amp;', '&', match.group(1))
print(output.strip())
sys.exit(0 if re.search(r'\b0 failed\b', output) else 1)
PY
