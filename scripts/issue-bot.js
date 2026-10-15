'use strict';

// Issue automation, called from actions/github-script in the workflows:
//   await require('./scripts/issue-bot.js').triage({ github, context, core })
//
// Only uses Node built-ins, so the workflows don't need `npm ci` to run it.

const fs = require('fs');
const path = require('path');
const { parseRequest } = require('./lib/request');
const { checkRequest } = require('./lib/checks');
const comments = require('./lib/comments');

const NEEDS_CHANGES = 'needs changes';
const PROCESS_EVENT = 'process-issue';
// Marks the bot's triage comment, so re-checks after an edit update it instead of adding a new one.
const TRIAGE_MARKER = '<!-- steam-custom-artworks:triage -->';

function userList(name) {
  return (process.env[name] || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
}

function isIn(listName, login) {
  return userList(listName).includes(String(login).toLowerCase());
}

function issueApi(github, context, issueNumber) {
  const base = { ...context.repo, issue_number: issueNumber };
  return {
    comment: body => github.rest.issues.createComment({ ...base, body }),
    update: fields => github.rest.issues.update({ ...base, ...fields }),
    addLabel: name => github.rest.issues.addLabels({ ...base, labels: [name] }).catch(err => {
      console.warn(`Could not add label "${name}": ${err.message}`);
    }),
    removeLabel: name => github.rest.issues.removeLabel({ ...base, name }).catch(err => {
      if (err.status !== 404) throw err;
    }),
    // Updates the triage comment if it is still the latest bot comment, otherwise posts a new one.
    async triageComment(text) {
      const body = `${text}\n\n${TRIAGE_MARKER}`;
      const all = await github.paginate(github.rest.issues.listComments, { ...base, per_page: 100 });
      const lastBot = all.filter(c => c.user && c.user.type === 'Bot').pop();
      if (lastBot && lastBot.body.includes(TRIAGE_MARKER)) {
        return github.rest.issues.updateComment({ ...context.repo, comment_id: lastBot.id, body });
      }
      return github.rest.issues.createComment({ ...base, body });
    },
  };
}

function requestTitle(request, meta) {
  const prefix = request.type === 'replace' ? '[Replace]' : '[Request]';
  if (!request.appId) return `${prefix} App ID missing`;
  return meta && meta.name.value ? `${prefix} ${request.appId} – ${meta.name.value}` : `${prefix} ${request.appId}`;
}

// Folder of an existing artwork for the App ID (e.g. "artworks/Valve/570"), or null.
// Uses the checkout when there is one (process workflow), otherwise GitHub's tree API,
// because the triage job doesn't check out the large artworks folder.
async function findExistingArtwork(github, context, appId) {
  if (!appId) return null;
  if (fs.existsSync('artworks')) {
    const publisher = fs.readdirSync('artworks').find(dir => fs.existsSync(path.join('artworks', dir, appId)));
    return publisher ? `artworks/${publisher}/${appId}` : null;
  }
  const branch = (context.payload.repository && context.payload.repository.default_branch) || 'main';
  const { data: root } = await github.rest.git.getTree({ ...context.repo, tree_sha: branch });
  const artworks = root.tree.find(entry => entry.path === 'artworks' && entry.type === 'tree');
  if (!artworks) return null;
  const { data } = await github.rest.git.getTree({ ...context.repo, tree_sha: artworks.sha, recursive: 'true' });
  const match = data.tree.find(entry => entry.type === 'tree' && entry.path.split('/')[1] === appId && entry.path.split('/').length === 2);
  return match ? `artworks/${match.path}` : null;
}

// Adds type ("new" / "replace") and the existing folder to a parsed request.
async function withRequestType(github, context, request) {
  const existing = await findExistingArtwork(github, context, request.appId);
  return { ...request, type: existing ? 'replace' : 'new', existing };
}

// Numbers of other open request issues for the same App ID.
async function findOtherOpenRequests(github, context, appId, issueNumber) {
  if (!appId) return [];
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...context.repo, state: 'open', labels: 'request', per_page: 100,
  });
  return issues
    .filter(other => other.number !== issueNumber && !other.pull_request)
    .filter(other => parseRequest(other.body).appId === appId)
    .map(other => other.number);
}

function dispatchProcessing(github, context, issueNumber) {
  return github.rest.repos.createDispatchEvent({
    ...context.repo,
    event_type: PROCESS_EVENT,
    client_payload: { issue_number: issueNumber },
  });
}

// issues: opened / edited
async function triage({ github, context, core }) {
  const { issue, action, changes } = context.payload;
  const labels = issue.labels.map(l => l.name);

  if (issue.state !== 'open') return core.info('Issue is closed, skipping.');
  // Every edit of the request is checked again; title-only edits are ignored.
  if (action === 'edited' && !(changes && changes.body)) return core.info('Body unchanged, skipping.');

  const api = issueApi(github, context, issue.number);
  const request = await withRequestType(github, context, parseRequest(issue.body));
  const [{ meta, problems, warnings }, duplicates] = await Promise.all([
    checkRequest(request, { steamGridDbKey: process.env.STEAMGRIDDB_API_KEY }),
    findOtherOpenRequests(github, context, request.appId, issue.number),
  ]);
  warnings.forEach(w => core.warning(w));

  const title = requestTitle(request, meta);
  if (title !== issue.title) await api.update({ title });

  if (problems.length) {
    await api.addLabel(NEEDS_CHANGES);
    await api.triageComment(comments.needsChanges(problems, warnings, { duplicates }));
    return core.notice(`Request #${issue.number} needs changes: ${problems.map(p => p.message).join(' | ')}`);
  }

  // Nothing is processed automatically: the request waits for /process, so it can still be edited.
  if (labels.includes(NEEDS_CHANGES)) await api.removeLabel(NEEDS_CHANGES);
  // With other open requests for the same game, only a maintainer decides which one is processed.
  const canProcess = isIn('TRUSTED_REQUESTERS', issue.user.login) && !duplicates.length;
  await api.triageComment(comments.accepted(request, meta, warnings, { canProcess, duplicates }));
}

// issue_comment: created, comment starting with /process
// Allowed for maintainers on any issue, and for trusted requesters on their own open issue
// as long as no other request for the same game is open.
async function processCommand({ github, context, core }) {
  const { comment, issue } = context.payload;
  if (!/^\/process\b/i.test(comment.body.trim())) return core.info('Not a /process command.');

  const react = content => github.rest.reactions.createForIssueComment({ ...context.repo, comment_id: comment.id, content });
  if (!isIn('MAINTAINERS', comment.user.login)) {
    const isTrustedAuthor = comment.user.login === issue.user.login && issue.state === 'open' && isIn('TRUSTED_REQUESTERS', comment.user.login);
    if (!isTrustedAuthor) {
      await react('-1');
      return core.notice(`${comment.user.login} is not allowed to run /process.`);
    }
    const duplicates = await findOtherOpenRequests(github, context, parseRequest(issue.body).appId, issue.number);
    if (duplicates.length) {
      await react('-1');
      await issueApi(github, context, issue.number).comment(comments.duplicateBlocked(duplicates, (process.env.MAINTAINERS || '').split(',').map(u => u.trim()).filter(Boolean)));
      return core.notice(`Other open requests for this game (${duplicates.join(', ')}), only a maintainer can run /process.`);
    }
  }

  await github.rest.reactions.createForIssueComment({ ...context.repo, comment_id: comment.id, content: 'rocket' });
  await dispatchProcessing(github, context, issue.number);
}

// process-issue workflow: write request.json for scripts/process-issue.js
async function readRequest({ github, context }) {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  const { data: issue } = await github.rest.issues.get({ ...context.repo, issue_number: issueNumber });
  const request = await withRequestType(github, context, parseRequest(issue.body));
  fs.writeFileSync('request.json', JSON.stringify(request, null, 2));
}

// process-issue workflow: comment the outcome of scripts/process-issue.js
async function report({ github, context, core }) {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  const api = issueApi(github, context, issueNumber);
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;

  let result = null;
  try {
    result = JSON.parse(fs.readFileSync('result.json', 'utf8'));
  } catch {
    // build step crashed before writing a result
  }

  if (result && result.ok && process.env.PUSH_OUTCOME === 'success') {
    await api.removeLabel(NEEDS_CHANGES);
    await api.comment(comments.processed(result.request, result));
    await api.update({ title: requestTitle(result.request, result.meta), state: 'closed', state_reason: 'completed' });
  } else if (result && !result.ok) {
    await api.addLabel(NEEDS_CHANGES);
    await api.comment(comments.needsChanges(result.problems));
    core.notice('Request has problems, asked the requester for changes.');
  } else {
    await api.comment(comments.internalError(runUrl));
    core.setFailed('Processing failed, see the previous steps.');
  }
}

module.exports = { triage, processCommand, readRequest, report };
