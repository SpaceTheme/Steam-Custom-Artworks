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
  rows.push(['Type', request.type === 'replace' ? `Replace existing artwork <sub>(\`${request.existing}\`)</sub>` : 'New artwork']);
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

function issueLinks(numbers) {
  return numbers.map(n => `#${n}`).join(', ');
}

function duplicateNote(duplicates) {
  if (!duplicates.length) return [];
  return [
    '',
    '> [!WARNING]',
    `> There ${duplicates.length === 1 ? 'is another open request' : 'are other open requests'} for this game: ${issueLinks(duplicates)}. A maintainer decides which one is processed.`,
  ];
}

function needsChanges(problems, warnings = [], { duplicates = [] } = {}) {
  return [
    '### ⚠️ Your request needs a small fix',
    '',
    problemList(problems),
    ...warningList(warnings),
    ...duplicateNote(duplicates),
    '',
    EDIT_HINT,
  ].join('\n');
}

function accepted(request, meta, warnings, { canProcess = false, duplicates = [] } = {}) {
  return [
    '### ✅ Thanks for your request!',
    '',
    'This is what we found:',
    '',
    detailsTable(request, meta),
    ...warningList(warnings),
    ...duplicateNote(duplicates),
    '',
    '**What happens next?**',
    '1. Check the details above. Something wrong or missing? **Edit your issue** and fill in the optional fields. They override the data from Steam, and this summary updates automatically.',
    canProcess
      ? '2. Everything correct? Comment **`/process`** to start.'
      : '2. A maintainer reviews your request and starts it.',
    '3. The artwork is added to the repository and this issue gets closed.',
    '4. It is included in the next weekly release (every Sunday): download `grid.zip` from [Releases](https://github.com/SpaceTheme/Steam-Custom-Artworks/releases) or use the Millennium plugin.',
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

function duplicateBlocked(duplicates, maintainers) {
  return [
    `There ${duplicates.length === 1 ? 'is another open request' : 'are other open requests'} for this game: ${issueLinks(duplicates)}.`,
    `Only a maintainer (${maintainers.map(m => `@${m}`).join(' or ')}) can start this one.`,
  ].join(' ');
}

module.exports = { needsChanges, accepted, processed, internalError, duplicateBlocked };
