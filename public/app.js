import { translations } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const state = { channel: '', q: '', cursor: null, seen: new Set() };

let lang = localStorage.getItem('lang') === 'he' ? 'he' : 'en';
const t = () => translations[lang];

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  $('#lang').value = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t()[node.dataset.i18n];
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t()[node.dataset.i18nPlaceholder];
  }
}

async function api(path, options = {}, retried = false) {
  const key = localStorage.getItem('apiKey');
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && !retried) {
    const entered = prompt('API key');
    if (entered) {
      localStorage.setItem('apiKey', entered);
      return api(path, options, true);
    }
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const fmt = (d) => (d ? new Date(d).toLocaleString(t().locale) : '—');

// ---------- channels ----------
async function loadChannels() {
  const channels = await api('/api/channels');
  const list = $('#channels');
  list.replaceChildren(
    ...channels.map((c) => {
      const toggle = el('button', { className: 'secondary', textContent: c.active ? t().pause : t().resume });
      toggle.onclick = () => api(`/api/channels/${c.id}`, { method: 'PATCH', body: { active: !c.active } }).then(loadChannels);
      const refill = el('button', { className: 'secondary', textContent: t().backfill });
      refill.onclick = () => api(`/api/channels/${c.id}/backfill`, { method: 'POST', body: {} }).then(loadChannels).catch((e) => alert(e.message));
      const del = el('button', { className: 'secondary',       textContent: t().delete });
            del.onclick = () => confirm(t().confirmDelete(c.username)) && api(`/api/channels/${c.id}`, { method: 'DELETE' }).then(refreshAll);
      const status = c.busy ? t().collecting : c.lastError ? t().error(c.lastError) : t().polled(fmt(c.lastPolledAt));
      return el('li', { className: c.active ? '' : 'inactive' },
        el('div', { className: 'name', textContent: c.title ? `${c.title} (@${c.username})` : `@${c.username}` }),
        el('div', { className: 'meta', textContent: status }),
        el('div', { className: 'actions' }, toggle, refill, del));
    }),
  );

  const select = $('#filter-channel');
  const current = select.value;
  select.replaceChildren(
    el('option', { value: '', textContent: t().allChannels }),
    ...channels.map((c) => el('option', { value: c.username, textContent: `@${c.username}` })),
  );
  select.value = current;
}

$('#add-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#add-error').textContent = '';
  const input = $('#add-input');
  try {
    await api('/api/channels', { method: 'POST', body: { username: input.value } });
    input.value = '';
    await loadChannels();
  } catch (err) {
    $('#add-error').textContent = err.message;
  }
};

// ---------- feed ----------
function renderMessage(m, isNew) {
  const key = localStorage.getItem('apiKey');
  const withKey = (u) => (key && u.startsWith('/api/') ? `${u}?api_key=${encodeURIComponent(key)}` : u);
  const media = m.media.map((x) =>
    x.type === 'photo'
      ? el('a', { href: withKey(x.url), target: '_blank' }, el('img', { src: withKey(x.url), loading: 'lazy' }))
      : el('a', { href: withKey(x.url), target: '_blank', textContent: `[${x.type}]` }));
  const links = m.links.length
    ? el('div', { className: 'links' }, ...m.links.flatMap((l) => [el('a', { href: l, target: '_blank', textContent: l }), ' ']))
    : null;
  return el('div', { className: `msg${isNew ? ' new' : ''}` },
    el('div', { className: 'head' },
      el('a', { href: m.url, target: '_blank', dir: 'ltr', textContent: `@${m.channel} #${m.messageId}` }),
      el('span', { textContent: `${fmt(m.postedAt)}${m.edited ? ` · ${t().edited}` : ''} · 👁 ${m.views ?? '—'}` })),
    m.forwardedFrom ? el('div', { className: 'fwd', textContent: t().forwardedFrom(m.forwardedFrom) }) : null,
    m.text ? el('div', { className: 'text', dir: 'auto', textContent: m.text }) : null,
    media.length ? el('div', { className: 'media' }, ...media) : null,
    links);
}

function query(extra = {}) {
  const p = new URLSearchParams({ limit: '50', ...extra });
  if (state.channel) p.set('channel', state.channel);
  if (state.q) p.set('q', state.q);
  return `/api/messages?${p}`;
}

async function loadFeed({ append = false, highlightNew = false } = {}) {
  const data = await api(query(append && state.cursor ? { cursor: state.cursor } : {}));
  const feed = $('#feed');
  const nodes = data.items.map((m) => renderMessage(m, highlightNew && !state.seen.has(m.id)));
  if (!append) state.seen.clear();
  data.items.forEach((m) => state.seen.add(m.id));
  append ? feed.append(...nodes) : feed.replaceChildren(...nodes);
  state.cursor = data.nextCursor;
  $('#more').hidden = !state.cursor;
}

$('#more').onclick = () => loadFeed({ append: true });
$('#filter-channel').onchange = (e) => { state.channel = e.target.value; loadFeed(); };
let searchTimer;
$('#search').oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadFeed(); }, 300);
};

// ---------- live updates (SSE) ----------
let refreshTimer;
function connectStream() {
  const key = localStorage.getItem('apiKey');
  const es = new EventSource(`/api/messages/stream${key ? `?api_key=${encodeURIComponent(key)}` : ''}`);
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
  es.addEventListener('messages', () => {
    clearTimeout(refreshTimer);
    // Only auto-refresh when looking at the top of the feed, to not disrupt paging.
    refreshTimer = setTimeout(() => {
      if ($('#feed').scrollTop < 50) loadFeed({ highlightNew: true });
      loadChannels();
    }, 500);
  });
}

// ---------- telegram account (status only; login is headless via TG_SESSION_STRING) ----------
async function loadTelegram() {
  const s = await api('/api/telegram').catch(() => null);
  const box = $('#tg');
  if (!s || !s.enabled) return void (box.hidden = true);
  box.hidden = false;
  $('#tg-status').textContent = s.state === 'ready' ? t().tgReady(s.user?.name ?? '') : s.state === 'error' ? t().tgFailed : t().tgConnecting;
  $('#tg-error').textContent = s.error ?? '';
}

async function refreshAll() {
  await loadChannels();
  await loadFeed();
}

$('#lang').onchange = (e) => {
  lang = e.target.value === 'he' ? 'he' : 'en';
  localStorage.setItem('lang', lang);
  applyLanguage();
  refreshAll();
};

applyLanguage();
refreshAll();
loadTelegram();
connectStream();
setInterval(loadChannels, 10_000);
setInterval(loadTelegram, 3_000);
