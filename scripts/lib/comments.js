'use strict';

// Markdown for the comments the bot posts on request issues.

const EDIT_HINT = 'Please **edit your issue** (click **···** at the top right of your post → **Edit**), fix the fields above and save. The request is checked again automatically.';

function sourceNote(field) {
  return field && field.source ? ` <sub>(${field.source})</sub>` : '';
}

function detailsTable(request, meta) {
  const id = request.appId;
  const rows = [['App ID', id ? `[\`${id}\`](https://store.steampowered.com/app/${id}) · [SteamDB](https://steamdb.info/app/${id}/info/)` : '—']];
  if (meta) {
    rows.push(['Game', `${meta.name.value || '—'}${sourceNote(meta.name)}`]);
    rows.push(['Publisher', `${meta.publisher.value || '⚠️ not found'}${sourceNote(meta.publisher)}`]);
    rows.push(['Release date', `${meta.release.value || 'Unknown'}${sourceNote(meta.release)}`]);
  }
  rows.push(['Image', request.imageUrl ? `[hero/${request.heroId}](${request.imageUrl})` : '—']);
  rows.push(['Type', request.type === 'replace' ? 'Replace existing artwork' : 'New artwork']);
  return ['| | |', '|---|---|', ...rows.map(([k, v]) => `| **${k}** | ${v} |`)].join('\n');
}

// Several problems can share the same fix (e.g. wrong style and tags) - show it once, after the last one.
function problemList(problems) {
  return problems.map((p, i) => {
    const fixFollows = problems.slice(i + 1).some(next => next.fix === p.fix);
    return `- **${p.field}:** ${p.message}${fixFollows ? '' : `\n  👉 ${p.fix}`}`;
  }).join('\n');
}

function warningList(warnings) {
  if (!warnings.length) return [];
  return ['', '> [!NOTE]', ...warnings.map(w => `> - ${w}`)];
}

function needsChanges(problems, warnings = []) {
  return [
    '### ⚠️ Your request needs a small fix',
    '',
    problemList(problems),
    ...warningList(warnings),
    '',
    EDIT_HINT,
  ].join('\n');
}

function accepted(request, meta, warnings, { autoProcess }) {
  return [
    '### ✅ Thanks for your request!',
    '',
    'This is what we found:',
    '',
    detailsTable(request, meta),
    ...warningList(warnings),
    '',
    'If anything above is wrong, edit your issue and fill in the optional fields — they override the data from Steam.',
    '',
    '**What happens next?**',
    autoProcess
      ? '1. ⚙️ Processing has started automatically.'
      : '1. A maintainer reviews your request and starts the processing.',
    '2. The artwork is added to the repository and this issue gets closed.',
    '3. It is included in the next weekly release (every Sunday) — download `grid.zip` from [Releases](https://github.com/SpaceTheme/Steam-Custom-Artworks/releases).',
  ].join('\n');
}

function processed(request, result) {
  const lines = [
    '### 🎉 Artwork added!',
    '',
    detailsTable(request, result.meta),
  ];
  if (result.replaced.length) {
    lines.push('', `Replaced the previous artwork: ${result.replaced.map(d => `\`${d}\``).join(', ')}`);
  }
  lines.push('', 'It will be included in the next weekly release (every Sunday). Thanks for contributing! 💜');
  return lines.join('\n');
}

function internalError(runUrl) {
  return [
    '### ❌ Processing failed',
    '',
    'Something went wrong on our side while processing this request — this is **not** a problem with your request.',
    `A maintainer will check the [workflow logs](${runUrl}) and try again.`,
  ].join('\n');
}

module.exports = { needsChanges, accepted, processed, internalError };
