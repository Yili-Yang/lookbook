#!/usr/bin/env bash
# Runs lookbook/test.html in headless Chrome and prints the assertion output.
set -uo pipefail

PORT="${PORT:-8123}"
DEBUG_PORT="${DEBUG_PORT:-9444}"
ROOT="$(cd "$(dirname "$0")" && pwd)/lookbook"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

if [ -z "$CHROME" ]; then
  echo "No Chrome/Chromium found. Open lookbook/test.html in a browser instead." >&2
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "Node is needed to drive the browser. Open lookbook/test.html in a browser instead." >&2
  exit 1
fi

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
"$CHROME" --headless=new --disable-gpu --no-sandbox --user-data-dir="$(mktemp -d)" \
  --remote-debugging-port="$DEBUG_PORT" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
trap 'kill "$SERVER_PID" "$CHROME_PID" 2>/dev/null' EXIT
sleep 3

# Driven over the DevTools protocol rather than with --virtual-time-budget: the
# asynchronous tests decode images, which the virtual clock never completes.
PAGE_URL="http://localhost:$PORT/test.html" DEBUG_PORT="$DEBUG_PORT" node - <<'JS'
// Wrapped because node reads stdin as a script, where top-level await is not
// allowed.
void (async () => {
const port = process.env.DEBUG_PORT;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find(target => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve));

let id = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => {
  const messageId = ++id;
  socket.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise(resolve => pending.set(messageId, resolve));
};
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true });
  return response.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: process.env.PAGE_URL });

const deadline = Date.now() + 60000;
let title = '';
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 500));
  title = await evaluate('document.title');
  if (title === 'ALL PASS' || title === 'FAILED') break;
}

const output = (await evaluate("document.getElementById('out').textContent") || '').trim();
console.log(output || 'The test page produced no output — check for a JavaScript error.');
if (title !== 'ALL PASS') {
  if (title !== 'FAILED') console.log('\nTimed out before the tests finished.');
  process.exitCode = 1;
}
socket.close();
})();
JS
