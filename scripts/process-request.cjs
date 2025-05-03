const fs = require('fs');
const path = require('path');
const https = require('https');
const { Octokit } = require('@octokit/core');
const Mustache = require('mustache');
const fetch = require('node-fetch');

// --- GitHub Setup ---
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const octokit = new Octokit({ auth: token });

// --- Helper: Parse Markdown fields from issue body ---
function extractField(body, label) {
  const regex = new RegExp(`### ${label}\\s*\\n(.+?)\\s*(?:\\n|$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

async function run() {
  const comment = event.comment?.body || '';
  const issueNumber = event.issue?.number;
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  // Fetch the issue
  const { data: issue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo,
    issue_number: issueNumber,
  });

  const body = issue.body;

  const appId = extractField(body, 'App ID');
  const imageUrl = extractField(body, 'Image URL');
  const artworkType = extractField(body, 'Artwork Type');

  if (!appId || !imageUrl || !artworkType) {
    console.error('❌ Missing required fields: App ID, Image URL, or Artwork Type');
    return;
  }

  // --- Optional: Fetch metadata from Steam API ---
  const steamKey = process.env.STEAM_API_KEY; // set in your GitHub repo secrets
  let name = 'UnknownGame';
  let publisher = 'UnknownPublisher';
  let releaseDate = 'Unknown';

  if (steamKey) {
    try {
      const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
      const data = await res.json();
      const appData = data[appId]?.data;
      if (appData) {
        name = appData.name || name;
        publisher = (appData.publishers?.[0] || publisher).replace(/\s+/g, '_');
        releaseDate = appData.release_date?.date || releaseDate;
      }
    } catch (e) {
      console.warn('⚠️ Failed to fetch Steam metadata:', e.message);
    }
  }

  const folderPath = path.join('artworks', publisher, appId);
  fs.mkdirSync(folderPath, { recursive: true });

  // --- Download image ---
  const imagePath = path.join(folderPath, 'imageSource.png');
  const file = fs.createWriteStream(imagePath);
  https.get(imageUrl, response => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();

      // --- Create index.html ---
      const template = fs.readFileSync('templates/index.html.mustache', 'utf8');
      const html = Mustache.render(template, {
        gameID: appId,
        publisher,
        name,
        releaseDate,
      });

      fs.writeFileSync(path.join(folderPath, 'index.html'), html);
      console.log(`✅ Done! Created artwork for ${name} at ${folderPath}`);
    });
  });
}

run();