const fs = require('fs');
const path = require('path');
const https = require('https');
const { Octokit } = require('@octokit/core');
const Mustache = require('mustache');
const fetch = require('node-fetch');

// GitHub context
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const octokit = new Octokit({ auth: token });

async function fetchSteamAppDetails(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const game = data[appId]?.data;

    if (!game) return { name: 'UnknownGame', publisher: 'UnknownPublisher', releaseDate: 'Unknown' };

    const name = game.name || 'UnknownGame';
    const publisher = (game.publishers?.[0] || 'UnknownPublisher').replace(/\s+/g, '_');
    const releaseDate = game.release_date?.date || 'Unknown';

    return { name, publisher, releaseDate };
  } catch (err) {
    console.error('❌ Failed to fetch Steam API:', err.message);
    return { name: 'UnknownGame', publisher: 'UnknownPublisher', releaseDate: 'Unknown' };
  }
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Image request failed: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function run() {
  const comment = event.comment?.body;
  const issueNumber = event.issue?.number;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split('/');

  // Fetch issue
  const { data: issue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo: repoName,
    issue_number: issueNumber,
  });

  const body = issue.body;

  const appIdMatch = body.match(/app_id.+?(\d+)/i);
  const imageUrlMatch = body.match(/https:\/\/steamgriddb\.com[^\s)"]+/);
  const typeMatch = body.match(/artwork_type.+?(Game|Software)/i);

  if (!appIdMatch || !imageUrlMatch || !typeMatch) {
    console.error('❌ Missing required fields');
    return;
  }

  const appId = appIdMatch[1];
  const imageUrl = imageUrlMatch[0];
  const type = typeMatch[1];

  const { name, publisher, releaseDate } = await fetchSteamAppDetails(appId);

  const folderPath = path.join('artworks', publisher, appId);
  fs.mkdirSync(folderPath, { recursive: true });

  const imagePath = path.join(folderPath, 'imageSource.png');
  try {
    await downloadImage(imageUrl, imagePath);
    console.log(`🖼️ Image saved to ${imagePath}`);
  } catch (err) {
    console.error('❌ Failed to download image:', err.message);
    return;
  }

  try {
    const template = fs.readFileSync('templates/index.html.mustache', 'utf8');
    const html = Mustache.render(template, {
      gameID: appId,
      publisher,
      name,
      releaseDate,
    });

    fs.writeFileSync(path.join(folderPath, 'index.html'), html);
    console.log(`✅ Done! Created artwork for ${name} at ${folderPath}`);
  } catch (err) {
    console.error('❌ Failed to write index.html:', err.message);
  }
}

run();