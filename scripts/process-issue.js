'use strict';

// Builds artworks/<publisher>/<appId>/ for one request.
//
// Usage: node scripts/process-issue.js <request.json> <result.json>
//   request.json - output of parseRequest() from scripts/lib/request.js
//   result.json  - { ok: true, request, meta, dir, replaced } or { ok: false, request, problems }
//
// Problems with the request itself (wrong image style, unknown App ID, ...) end with
// ok: false and exit code 0. Unexpected errors (API down, bugs) exit with code 1.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Mustache = require('mustache');
const { checkRequest } = require('./lib/checks');
const { problem } = require('./lib/request');

const ARTWORKS = 'artworks';
const TEMPLATES = 'templates';

class RequestProblems extends Error {
  constructor(problems) {
    super(problems.map(p => p.message).join(' '));
    this.problems = problems;
  }
}

// Keeps the existing ASCII folder names; publishers written only in non-latin
// scripts (e.g. Chinese) keep their characters instead of becoming "____".
function folderName(publisher) {
  const ascii = publisher.replace(/[^a-zA-Z0-9]/g, '_');
  if (/[a-zA-Z0-9]/.test(ascii)) return ascii;
  const unicode = publisher.replace(/[^\p{L}\p{N}]/gu, '_');
  return /[\p{L}\p{N}]/u.test(unicode) ? unicode : 'Unknown';
}

function findExistingDirs(appId) {
  return fs.readdirSync(ARTWORKS, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(ARTWORKS, entry.name, appId))
    .filter(dir => fs.existsSync(dir));
}

async function downloadAsWebp(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Image download failed with HTTP ${res.status}: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  try {
    return await sharp(buffer).webp({ quality: 90 }).toBuffer();
  } catch (err) {
    throw new RequestProblems([problem('Image URL', `The image file could not be read (${err.message}).`, 'Please pick a different image on SteamGridDB and update the link.')]);
  }
}

async function build(request) {
  const { meta, hero, problems, warnings } = await checkRequest(request, {
    steamGridDbKey: process.env.STEAMGRIDDB_API_KEY,
    strict: true,
  });
  warnings.forEach(w => console.warn(`Warning: ${w}`));
  if (problems.length) throw new RequestProblems(problems);

  const image = await downloadAsWebp(hero.url);
  const publisher = meta.publisher.value;
  const dir = path.join(ARTWORKS, folderName(publisher), request.appId);

  // A replacement may come with a different publisher - remove the old folder
  // so the app doesn't end up twice in artworks/.
  const replaced = findExistingDirs(request.appId);
  for (const old of replaced) fs.rmSync(old, { recursive: true, force: true });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'imageSource.webp'), image);
  fs.copyFileSync(path.join(TEMPLATES, 'index.css'), path.join(dir, 'index.css'));

  const template = fs.readFileSync(path.join(TEMPLATES, 'index.html.mustache'), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'), Mustache.render(template, {
    APP_NAME: meta.name.value,
    APP_PUBLISHER: publisher,
    APP_RELEASE: meta.release.value || 'Unknown',
    IMAGE_NAME: 'imageSource.webp',
  }));

  console.log(`Saved artwork for ${meta.name.value} (${request.appId}) to ${dir}`);
  console.log('Metadata:', JSON.stringify(meta, null, 2));
  return { meta, dir, replaced: replaced.filter(old => old !== dir) };
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const [requestFile = 'request.json', resultFile = 'result.json'] = process.argv.slice(2);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));

  let result;
  try {
    result = { ok: true, request, ...(await build(request)) };
  } catch (err) {
    if (!(err instanceof RequestProblems)) throw err;
    console.log('Request has problems:', err.message);
    result = { ok: false, request, problems: err.problems };
  }

  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  setOutput('ok', result.ok);
  setOutput('app_id', request.appId || '');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
