'use strict';

// Parses the issue body produced by .github/ISSUE_TEMPLATE/ARTWORK.yml.
// The labels below must match the field labels in that template exactly.
const LABELS = {
  appId: 'App ID',
  imageUrl: 'Image URL',
  name: 'Game name (optional)',
  publisher: 'Publisher (optional)',
  release: 'Release date (optional)',
};

const HERO_EXAMPLE = 'https://www.steamgriddb.com/hero/11836';

function parseIssueForm(body) {
  const sections = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const label = (newline === -1 ? part : part.slice(0, newline)).trim();
    let value = newline === -1 ? '' : part.slice(newline + 1).trim();
    if (value === '_No response_') value = '';
    sections[label] = value;
  }
  return sections;
}

function stripFormatting(value) {
  return String(value || '').trim().replace(/^[<`"']+|[>`"']+$/g, '').trim();
}

// Accepts "570" or any link containing "/app/570" (Steam Store, SteamDB, Steam Community).
function extractAppId(raw) {
  const value = stripFormatting(raw);
  if (!value) {
    return { error: problem('App ID', 'The App ID is empty.', 'Enter the number from the Steam store link, e.g. `570` for store.steampowered.com/app/**570**/Dota_2.') };
  }
  const match = value.match(/^(\d+)$/) || value.match(/\/app\/(\d+)/i);
  if (!match) {
    return { error: problem('App ID', `\`${truncate(value)}\` is not a valid App ID.`, 'The App ID is only a number, e.g. `570`. You find it in the Steam store link: store.steampowered.com/app/**570**/Dota_2.') };
  }
  return { value: match[1] };
}

// Accepts only links to a single SteamGridDB hero, e.g. https://www.steamgriddb.com/hero/11836
function extractHeroId(raw) {
  const value = stripFormatting(raw);
  const howTo = `Open the image on SteamGridDB and copy the link from your browser's address bar. It must look like \`${HERO_EXAMPLE}\`.`;
  if (!value) {
    return { error: problem('Image URL', 'The image link is empty.', howTo) };
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { error: problem('Image URL', `\`${truncate(value)}\` is not a valid link.`, howTo) };
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'steamgriddb.com' && !host.endsWith('.steamgriddb.com')) {
    return { error: problem('Image URL', `Links from \`${host}\` are not allowed — only SteamGridDB links are accepted.`, howTo) };
  }
  if (host.startsWith('cdn')) {
    return { error: problem('Image URL', 'This is a direct link to the image file, but we need the link to the image page.', howTo) };
  }

  const hero = url.pathname.match(/^\/hero\/(\d+)/i);
  if (hero) return { value: hero[1], url: `https://www.steamgriddb.com/hero/${hero[1]}` };

  const other = url.pathname.match(/^\/(game|grid|logo|icon)s?\//i);
  if (other && other[1].toLowerCase() === 'game') {
    return { error: problem('Image URL', 'This is the link to the whole game page, not to a single image.', `On the game page, open the **Heroes** tab, click the image you want and copy that link. ${howTo}`) };
  }
  if (other) {
    return { error: problem('Image URL', `This is a **${other[1].toLowerCase()}** image, but we need a **hero** (the wide banner image).`, `On the game page, open the **Heroes** tab instead. ${howTo}`) };
  }
  return { error: problem('Image URL', `\`${truncate(value)}\` is not a link to a SteamGridDB hero image.`, howTo) };
}

function parseOverride(sections, key) {
  const value = (sections[LABELS[key]] || '').replace(/\s+/g, ' ').trim();
  return value.slice(0, 100);
}

function parseRequest(body) {
  const sections = parseIssueForm(body);
  const errors = [];

  const appId = extractAppId(sections[LABELS.appId]);
  if (appId.error) errors.push(appId.error);

  const hero = extractHeroId(sections[LABELS.imageUrl]);
  if (hero.error) errors.push(hero.error);

  return {
    appId: appId.value || null,
    heroId: hero.value || null,
    imageUrl: hero.url || null,
    overrides: {
      name: parseOverride(sections, 'name'),
      publisher: parseOverride(sections, 'publisher'),
      release: parseOverride(sections, 'release'),
    },
    errors,
  };
}

function problem(field, message, fix) {
  return { field, message, fix };
}

function truncate(value, max = 80) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

module.exports = { LABELS, parseIssueForm, parseRequest, extractAppId, extractHeroId, problem };
