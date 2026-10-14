'use strict';

// Looks up name, publisher and release date of a Steam app.
//
// 1. Steam Store API  - the normal source, but empty for apps that were removed
//    from the store (no publisher, no release date, or no data at all).
// 2. SteamDB / PICS   - the raw app info from Steam's backend, which is what
//    steamdb.info/app/<id>/info shows. SteamDB itself blocks automated requests
//    (Cloudflare), so the same data is read from api.steamcmd.net.
//
// Usage for testing: node scripts/lib/steam.js 3970

const STORE_API = 'https://store.steampowered.com/api/appdetails';
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
  const [storeResult, picsResult] = await Promise.allSettled([fetchStore(appId), fetchPics(appId)]);
  const store = storeResult.status === 'fulfilled' ? storeResult.value : null;
  const pics = picsResult.status === 'fulfilled' ? picsResult.value : null;
  const failures = [storeResult, picsResult].filter(r => r.status === 'rejected').map(r => r.reason.message);

  if (!store && !pics) {
    if (failures.length) throw new Error(`Could not reach Steam (${failures.join('; ')})`);
    return null;
  }

  const s = store || {};
  const p = pics || {};
  return {
    appId: String(appId),
    name: pick({ value: s.name, source: SOURCE.store }, { value: p.name, source: SOURCE.steamdb }),
    // Self-published games often only list a developer.
    publisher: pick(
      { value: s.publisher, source: SOURCE.store },
      { value: p.publisher, source: SOURCE.steamdb },
      { value: s.developer, source: `${SOURCE.store}, developer` },
      { value: p.developer, source: `${SOURCE.steamdb}, developer` },
    ),
    release: pick({ value: s.release, source: SOURCE.store }, { value: p.release, source: SOURCE.steamdb }),
    warnings: failures,
  };
}

function applyOverrides(info, overrides = {}) {
  const result = { ...info };
  for (const key of ['name', 'publisher', 'release']) {
    if (overrides[key]) result[key] = { value: overrides[key], source: SOURCE.issue };
  }
  return result;
}

module.exports = { fetchAppInfo, applyOverrides, SOURCE };

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
