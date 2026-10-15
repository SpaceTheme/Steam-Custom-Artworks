'use strict';

// Writes artworks/manifest.json, the list the Millennium plugin renders the artworks from.
//
//   node scripts/build-manifest.js
//
// {
//   "schema": 2,
//   "template": "<hash of templates/index.css + index.html.mustache>",
//   "apps": {
//     "570": { "name": "Dota 2", "publisher": "Valve", "release": "Jul 9, 2013", "image": "Valve/570/imageSource.webp", "rev": "<hash>" },
//     ...
//   }
// }
//
// Everything is read from artworks/<publisher>/<appId>/ (index.html + imageSource.*), so the file
// can always be rebuilt and never needs a manual merge. "rev" changes when the name, publisher,
// release date or image of an artwork changes; "template" when the design changes.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARTWORKS = 'artworks';
const MANIFEST = path.join(ARTWORKS, 'manifest.json');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .trim();
}

function sha1(...parts) {
  const hash = crypto.createHash('sha1');
  for (const part of parts) hash.update(part);
  return hash.digest('hex').slice(0, 12);
}

// Values as rendered into index.html by scripts/process-issue.js (templates/index.html.mustache)
function readArtwork(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const name = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const publisher = html.match(/<b>([\s\S]*?)<\/b>/);
  const release = [...html.matchAll(/id="release">(?:<br>)?([^<]*)<\/p>/g)].map(m => m[1]).find(value => value.trim());
  const image = fs.readdirSync(dir).find(file => /^imageSource\.(webp|png|jpe?g)$/i.test(file));
  if (!name || !publisher || !image) return null;
  return {
    name: decodeHtml(name[1]),
    publisher: decodeHtml(publisher[1]),
    release: decodeHtml(release || 'Unknown'),
    image,
  };
}

function buildManifest() {
  const apps = new Map();
  const skipped = [];
  const folders = new Map(); // appId → every folder, to report duplicates
  // Sorted for a stable result: if an app exists twice, the alphabetically last folder wins (warned below).
  for (const file of fs.readdirSync(ARTWORKS, { recursive: true }).sort()) {
    if (!file.endsWith('index.html')) continue;
    const dir = path.join(ARTWORKS, path.dirname(file));
    const appId = path.basename(dir);
    folders.set(appId, [...(folders.get(appId) || []), dir]);
    const artwork = readArtwork(dir);
    if (!artwork) {
      skipped.push(dir);
      continue;
    }
    const relative = path.relative(ARTWORKS, dir).split(path.sep).join('/');
    const imageData = fs.readFileSync(path.join(dir, artwork.image));
    apps.set(appId, {
      name: artwork.name,
      publisher: artwork.publisher,
      release: artwork.release,
      image: `${relative}/${artwork.image}`,
      rev: sha1(artwork.name, '\0', artwork.publisher, '\0', artwork.release, '\0', imageData),
    });
  }

  const template = sha1(fs.readFileSync('templates/index.css'), fs.readFileSync('templates/index.html.mustache'));
  // One app per line keeps diffs small and readable
  const lines = [...apps.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([appId, entry]) => `    ${JSON.stringify(appId)}: ${JSON.stringify(entry)}`);
  fs.writeFileSync(MANIFEST, `{\n  "schema": 2,\n  "template": ${JSON.stringify(template)},\n  "apps": {\n${lines.join(',\n')}\n  }\n}\n`);

  console.log(`Manifest: ${lines.length} apps, template ${template}`);
  if (skipped.length) console.warn(`Skipped (missing name, publisher or image): ${skipped.join(', ')}`);
  for (const [appId, dirs] of folders) {
    if (dirs.length > 1) console.warn(`::warning::App ${appId} exists in ${dirs.length} folders (${dirs.join(', ')}), using ${dirs.at(-1)}. Delete the outdated one.`);
  }
}

buildManifest();
