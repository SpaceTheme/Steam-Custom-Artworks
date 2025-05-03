const fs = require('fs');
const path = require('path');
const https = require('https');
const { Octokit } = require('@octokit/core');
const Mustache = require('mustache');

// Basic GitHub context from ENV
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

const octokit = new Octokit({ auth: token });

async function run() {
  const comment = event.comment.body;
  const issueNumber = event.issue.number;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split('/');

  // Fetch issue data
  const { data: issue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo: repoName,
    issue_number: issueNumber,
  });

  const body = issue.body;

  // Extract the fields from the structured body based on IDs
  const artworkType = body.match(/artwork_type.*"value": "(Game|Software)"/i)?.[1];
  const steamID = body.match(/app_id.*"value": "(\d+)"/i)?.[1];
  const imageUrl = body.match(/image.*"value": "(https:\/\/steamgriddb\.com[^\s)]+)"/)?.[1];

  // Optional fields (Publisher, Name, Release Date)
  const publisher = body.match(/publisher.*"value": "(.*?)"/i)?.[1] || 'UnknownPublisher';
  const name = body.match(/name.*"value": "(.*?)"/i)?.[1] || 'UnknownGame';
  const releaseDate = body.match(/release_date.*"value": "(.*?)"/i)?.[1] || 'Unknown';

  if (!steamID || !imageUrl || !artworkType) {
    console.error('Missing required fields');
    return;
  }

  const folderPath = path.join('artworks', publisher.replace(/\s+/g, '_'), steamID);
  fs.mkdirSync(folderPath, { recursive: true });

  // Download the image
  const imagePath = path.join(folderPath, 'imageSource.png');
  const file = fs.createWriteStream(imagePath);
  https.get(imageUrl, response => response.pipe(file));

  // Create index.html from template
  const template = fs.readFileSync('templates/index.html.mustache', 'utf8');
  const output = Mustache.render(template, {
    gameID: steamID,
    publisher,
    name,
    releaseDate,
  });

  fs.writeFileSync(path.join(folderPath, 'index.html'), output);
  console.log(`✅ Done: ${folderPath}`);
}

run();