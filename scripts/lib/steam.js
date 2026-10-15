'use strict';

// Looks up name, publisher and release date of a Steam app.
//
// 1. Steam Store API     - the normal source, but empty for apps that were removed
//    from the store (no publisher, no release date, or no data at all).
// 2. Steam store browse  - IStoreBrowseService, often still knows the publisher of
//    removed apps.
// 3. SteamDB / PICS      - the raw app info from Steam's backend, which is what
//    steamdb.info/app/<id>/info shows. SteamDB itself blocks automated requests
//    (Cloudflare), so the same data is read from api.steamcmd.net.
//
// SteamDB's "First seen on SteamDB" date is SteamDB's own record and not part of any
// API, so when no source has a release date the bot asks for it (see checks.js).
//
// Usage for testing: node scripts/lib/steam.js 3970

const STORE_API = 'https://store.steampowered.com/api/appdetails';
const BROWSE_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const PICS_API = 'https://api.steamcmd.net/v1/info/';
const USER_AGENT = 'Steam-Custom-Artworks (+https://github.com/SpaceTheme/Steam-Custom-Artworks)';

const SOURCE = {
  store: 'Steam Store',
  steamdb: 'SteamDB',
  issue: 'your issue',
};

async function getJson(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function firstName(list) {
  return (Array.isArray(list) ? list : []).map(clean).find(Boolean) || '';
}

function formatTimestamp(seconds) {
  return new Date(seconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// Brings dates typed into the issue into the artwork format "Nov 16, 2018", e.g. SteamDB's
// "16 November 2018 – 18:40:58 UTC" or "2018-11-16". Anything without a day ("Nov 2018",
// "2018", "Q1 2027") is kept as typed.
function normalizeDate(value) {
  const date = clean(value).split(/\s[–—-]\s/)[0].replace(/\bUTC\b/i, '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const full = /[a-z]{3,}/i.test(date) && /\b\d{1,2}(st|nd|rd|th)?\b/i.test(date) && /\b\d{4}\b/.test(date);
  if (!iso && !full) return clean(value);
  const ms = Date.parse(`${date.replace(/(\d)(st|nd|rd|th)\b/i, '$1')} UTC`);
  return Number.isNaN(ms) ? clean(value) : formatTimestamp(ms / 1000);
}

async function fetchStore(appId) {
  const json = await getJson(`${STORE_API}?appids=${appId}&l=english&cc=us`);
  const entry = json && json[appId];
  if (!entry || !entry.success || !entry.data) return null;
  const data = entry.data;
  return {
    name: clean(data.name),
    publisher: firstName(data.publishers),
    developer: firstName(data.developers),
    release: clean(data.release_date && data.release_date.date),
  };
}

async function fetchStoreBrowse(appId) {
  const input = {
    ids: [{ appid: Number(appId) }],
    context: { language: 'english', country_code: 'US' },
    data_request: { include_release: true, include_basic_info: true },
  };
  const json = await getJson(`${BROWSE_API}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  const item = json && json.response && json.response.store_items && json.response.store_items[0];
  if (!item || item.success !== 1 || !clean(item.name)) return null;
  const names = list => firstName((Array.isArray(list) ? list : []).map(entry => entry && entry.name));
  const basic = item.basic_info || {};
  const release = item.release || {};
  const timestamp = Number(release.original_release_date || release.steam_release_date);
  return {
    name: clean(item.name),
    publisher: names(basic.publishers),
    developer: names(basic.developers),
    release: timestamp > 0 ? formatTimestamp(timestamp) : '',
  };
}

async function fetchPics(appId) {
  const json = await getJson(PICS_API + appId);
  const common = json && json.data && json.data[appId] && json.data[appId].common;
  if (!common || !common.name) return null;
  const associations = Object.values(common.associations || {});
  const byType = type => clean((associations.find(a => a.type === type) || {}).name);
  const timestamp = Number(common.original_release_date || common.steam_release_date);
  return {
    name: clean(common.name),
    publisher: byType('publisher'),
    developer: byType('developer'),
    release: timestamp > 0 ? formatTimestamp(timestamp) : '',
  };
}

function pick(...candidates) {
  return candidates.find(c => c.value) || { value: '', source: null };
}

// Returns null if the app doesn't exist, throws if neither source could be reached.
async function fetchAppInfo(appId) {
  const results = await Promise.allSettled([fetchStore(appId), fetchStoreBrowse(appId), fetchPics(appId)]);
  const [store, browse, pics] = results.map(r => (r.status === 'fulfilled' ? r.value : null));
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason.message);

  if (!store && !browse && !pics) {
    if (failures.length) throw new Error(`Could not reach Steam (${failures.join('; ')})`);
    return null;
  }

  const s = store || {};
  const b = browse || {};
  const p = pics || {};
  return {
    appId: String(appId),
    name: pick(
      { value: s.name, source: SOURCE.store },
      { value: b.name, source: SOURCE.store },
      { value: p.name, source: SOURCE.steamdb },
    ),
    // Self-published games often only list a developer.
    publisher: pick(
      { value: s.publisher, source: SOURCE.store },
      { value: b.publisher, source: SOURCE.store },
      { value: p.publisher, source: SOURCE.steamdb },
      { value: s.developer, source: `${SOURCE.store}, developer` },
      { value: b.developer, source: `${SOURCE.store}, developer` },
      { value: p.developer, source: `${SOURCE.steamdb}, developer` },
    ),
    release: pick(
      { value: s.release, source: SOURCE.store },
      { value: b.release, source: SOURCE.store },
      { value: p.release, source: SOURCE.steamdb },
    ),
    warnings: failures,
  };
}

function applyOverrides(info, overrides = {}) {
  const result = { ...info };
  for (const key of ['name', 'publisher', 'release']) {
    if (!overrides[key]) continue;
    const value = key === 'release' ? normalizeDate(overrides[key]) : overrides[key];
    result[key] = { value, source: SOURCE.issue };
  }
  return result;
}

function steamDbUrl(appId) {
  return `https://steamdb.info/app/${appId}/`;
}

module.exports = { fetchAppInfo, applyOverrides, normalizeDate, steamDbUrl, SOURCE };

if (require.main === module) {
  const appId = process.argv[2];
  if (!/^\d+$/.test(appId || '')) {
    console.error('Usage: node scripts/lib/steam.js <appId>');
    process.exit(1);
  }
  fetchAppInfo(appId)
    .then(info => console.log(JSON.stringify(info, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
