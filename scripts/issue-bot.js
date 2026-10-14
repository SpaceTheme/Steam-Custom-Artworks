'use strict';

// Issue automation, called from actions/github-script in the workflows:
//   await require('./scripts/issue-bot.js').triage({ github, context, core })
//
// Only uses Node built-ins, so the workflows don't need `npm ci` to run it.

const fs = require('fs');
const { parseRequest } = require('./lib/request');
const { checkRequest } = require('./lib/checks');
const comments = require('./lib/comments');

const NEEDS_CHANGES = 'needs changes';
const PROCESS_EVENT = 'process-issue';

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
  };
}

function requestTitle(request, meta) {
  const prefix = request.type === 'replace' ? '[Replace]' : '[Request]';
  if (!request.appId) return `${prefix} App ID missing`;
  return meta && meta.name.value ? `${prefix} ${request.appId} – ${meta.name.value}` : `${prefix} ${request.appId}`;
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
  // Edits are only re-checked when we asked for a fix, so normal edits don't cause comment spam.
  if (action === 'edited' && !(changes && changes.body && labels.includes(NEEDS_CHANGES))) {
    return core.info('Edit without pending fix request, skipping.');
  }

  const api = issueApi(github, context, issue.number);
  const request = parseRequest(issue.body);
  const { meta, problems, warnings } = await checkRequest(request, {
    steamGridDbKey: process.env.STEAMGRIDDB_API_KEY,
  });
  warnings.forEach(w => core.warning(w));

  const title = requestTitle(request, meta);
  if (title !== issue.title) await api.update({ title });

  if (problems.length) {
    await api.addLabel(NEEDS_CHANGES);
    await api.comment(comments.needsChanges(problems, warnings));
    return core.notice(`Request #${issue.number} needs changes: ${problems.map(p => p.message).join(' | ')}`);
  }

  if (labels.includes(NEEDS_CHANGES)) await api.removeLabel(NEEDS_CHANGES);
  const autoProcess = isIn('TRUSTED_REQUESTERS', issue.user.login);
  await api.comment(comments.accepted(request, meta, warnings, { autoProcess }));
  if (autoProcess) await dispatchProcessing(github, context, issue.number);
}

// issue_comment: created, comment starting with /process
async function processCommand({ github, context, core }) {
  const { comment, issue } = context.payload;
  if (!/^\/process\b/i.test(comment.body.trim())) return core.info('Not a /process command.');

  if (!isIn('MAINTAINERS', comment.user.login)) {
    await github.rest.reactions.createForIssueComment({ ...context.repo, comment_id: comment.id, content: '-1' });
    return core.notice(`${comment.user.login} is not allowed to run /process.`);
  }

  await github.rest.reactions.createForIssueComment({ ...context.repo, comment_id: comment.id, content: 'rocket' });
  await dispatchProcessing(github, context, issue.number);
}

// process-issue workflow: write request.json for scripts/process-issue.js
async function readRequest({ github, context }) {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  const { data: issue } = await github.rest.issues.get({ ...context.repo, issue_number: issueNumber });
  fs.writeFileSync('request.json', JSON.stringify(parseRequest(issue.body), null, 2));
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
