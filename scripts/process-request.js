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

  // Parse simple key:value from body
  const steamIDMatch = body.match(/SteamID:\s*(\d+)/i);
  const imageUrlMatch = body.match(/https:\/\/steamgriddb\.com[^\s)]+/);
  const typeMatch = body.match(/Type:\s*(Game|Software)/i);
  const publisherMatch = body.match(/Publisher:\s*(.+)/i);
  const nameMatch = body.match(/Name:\s*(.+)/i);
  const releaseDateMatch = body.match(/Release Date:\s*(.+)/i);

  if (!steamIDMatch || !imageUrlMatch || !typeMatch) {
    console.error('Missing required fields');
    return;
  }

  const steamID = steamIDMatch[1];
  const imageUrl = imageUrlMatch[0];
  const type = typeMatch[1];
  const publisher = (publisherMatch?.[1] || 'UnknownPublisher').replace(/\s+/g, '_');
  const name = nameMatch?.[1] || 'UnknownGame';
  const releaseDate = releaseDateMatch?.[1] || 'Unknown';

  const folderPath = path.join('artworks', publisher, steamID);
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