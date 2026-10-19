const $ = (id) => document.getElementById(id);

const PRESETS = [
  ['Reports (RAW_REPORT)', 'GET', '/api/reports?limit=20'],
  ['Reports since id', 'GET', '/api/reports?sinceId=0&limit=100'],
  ['Messages', 'GET', '/api/messages?limit=20'],
  ['Messages (search)', 'GET', '/api/messages?q=text&limit=20'],
  ['Message by id', 'GET', '/api/messages/1'],
  ['Channels', 'GET', '/api/channels'],
  ['Add channel', 'POST', '/api/channels', '{"username":"durov"}'],
  ['Pause channel', 'PATCH', '/api/channels/durov', '{"active":false}'],
  ['Backfill channel', 'POST', '/api/channels/durov/backfill'],
  ['Delete channel', 'DELETE', '/api/channels/durov'],
  ['Telegram status', 'GET', '/api/telegram'],
  ['Stats', 'GET', '/api/stats'],
  ['Health', 'GET', '/api/health'],
];

$('key').value = localStorage.getItem('apiKey') ?? '';
$('key').addEventListener('change', () => localStorage.setItem('apiKey', $('key').value.trim()));

for (const [label, method, url, body] of PRESETS) {
  const b = document.createElement('button');
  b.textContent = `${method} ${label}`;
  b.addEventListener('click', () => {
    $('method').value = method;
    $('url').value = url;
    $('body').value = body ?? '';
  });
  $('presets').append(b);
}

let source = null;
let lastText = '';

function headers() {
  const h = {};
  const key = $('key').value.trim();
  if (key) h['x-api-key'] = key;
  if ($('body').value.trim() && $('method').value !== 'GET') h['content-type'] = 'application/json';
  return h;
}

function show(text, meta, ok = true) {
  lastText = text;
  $('out').textContent = text;
  $('meta').textContent = meta;
  $('meta').className = ok ? 'ok' : 'bad';
}

async function send() {
  source?.close();
  const method = $('method').value;
  const started = performance.now();
  try {
    const res = await fetch($('url').value, {
      method,
      headers: headers(),
      body: method === 'GET' || method === 'DELETE' || !$('body').value.trim() ? undefined : $('body').value,
    });
    const raw = await res.text();
    let text = raw;
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON */ }
    const ms = Math.round(performance.now() - started);
    show(text, `${res.status} ${res.statusText} · ${ms} ms · ${raw.length} bytes`, res.ok);
  } catch (err) {
    show(String(err), 'Network error', false);
  }
}

function stream() {
  source?.close();
  const url = new URL('/api/messages/stream', location.origin);
  const key = $('key').value.trim();
  if (key) url.searchParams.set('api_key', key);
  const ch = new URL($('url').value, location.origin).searchParams.get('channel');
  if (ch) url.searchParams.set('channel', ch);
  lastText = '';
  $('out').textContent = '';
  $('meta').textContent = `SSE ${url.pathname}${url.search} — listening…`;
  $('meta').className = 'ok';
  source = new EventSource(url);
  const append = (type) => (e) => {
    lastText += `event: ${type}\ndata: ${e.data}\n\n`;
    $('out').textContent = lastText;
  };
  for (const t of ['messages', 'ready']) source.addEventListener(t, append(t));
  source.onerror = () => { $('meta').textContent = 'SSE disconnected (retrying)'; $('meta').className = 'bad'; };
}

function curl() {
  const method = $('method').value;
  const parts = [`curl -X ${method}`, `"${location.origin}${$('url').value}"`];
  const key = $('key').value.trim();
  if (key) parts.push(`-H "x-api-key: ${key}"`);
  if ($('body').value.trim() && method !== 'GET') {
    parts.push('-H "content-type: application/json"', `-d '${$('body').value.trim()}'`);
  }
  return parts.join(' ');
}

$('send').addEventListener('click', send);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
$('stream').addEventListener('click', stream);
$('copy-resp').addEventListener('click', () => navigator.clipboard.writeText(lastText));
$('copy-curl').addEventListener('click', () => navigator.clipboard.writeText(curl()));
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastText], { type: 'application/json' }));
  a.download = 'response.json';
  a.click();
});
