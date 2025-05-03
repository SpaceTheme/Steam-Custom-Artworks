const fs = require('fs');
const path = require('path');
const https = require('https');
const { Octokit } = require('@octokit/core');
const Mustache = require('mustache');

// GitHub Context
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const octokit = new Octokit({ auth: token });

// GitHub-Organisation und berechtigter Benutzer
const orgName = 'SpaceTheme'; // Name deiner GitHub-Organisation
const allowedUser = 'SpaceEnergy';  // GitHub-Benutzername des berechtigten Benutzers

async function isUserInOrg(user) {
    try {
        // GitHub API-Aufruf, um zu prüfen, ob der Benutzer Mitglied der Organisation ist
        const response = await octokit.request('GET /orgs/{org}/memberships/{username}', {
            org: orgName,
            username: user
        });
        return response.status === 200; // Benutzer ist Mitglied
    } catch (error) {
        console.log('User is not a member of the organization or API error:', error);
        return false;
    }
}

// Funktion, um eine Sektion aus dem Markdown-Body zu extrahieren
function extractMarkdownSection(label, body) {
  const regex = new RegExp(`### ${label}\\s+([\\s\\S]*?)(?=\\n###|$)`, 'i');
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

// Steam-App-Daten abfragen
function fetchSteamAppDetails(appId) {
  return new Promise((resolve) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const appData = parsed[appId]?.data;
          if (appData) {
            resolve({
              name: appData.name || 'UnknownGame',
              publisher: (appData.publishers?.[0] || 'UnknownPublisher').replace(/\s+/g, '_'),
              releaseDate: appData.release_date?.date || 'Unknown'
            });
          } else {
            resolve({ name: 'UnknownGame', publisher: 'UnknownPublisher', releaseDate: 'Unknown' });
          }
        } catch {
          resolve({ name: 'UnknownGame', publisher: 'UnknownPublisher', releaseDate: 'Unknown' });
        }
      });
    }).on('error', () => {
      resolve({ name: 'UnknownGame', publisher: 'UnknownPublisher', releaseDate: 'Unknown' });
    });
  });
}

// Bild herunterladen
function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode !== 200) return reject(new Error('Image download failed'));
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function run() {
  const comment = event.comment.body;
  const issueNumber = event.issue.number;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split('/');

  // Prüfen, ob der Kommentar mit /process beginnt und der Benutzer der Repository-Owner ist
  if (!comment.trim().startsWith('/process') || event.comment.user.login !== owner) {
    console.log('⚠️ Not an authorized command or user.');
    return;
  }

  // Prüfen, ob der Benutzer Mitglied der Organisation ist
  const userIsInOrg = await isUserInOrg(event.comment.user.login);
  if (!userIsInOrg) {
    console.log('⚠️ User is not a member of the organization.');
    return;
  }

  // Abrufen der Issue-Daten
  const { data: issue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo: repoName,
    issue_number: issueNumber,
  });

  const body = issue.body;

  // Extrahieren der erforderlichen Felder
  const appId = extractMarkdownSection('App ID', body);
  const imageUrl = extractMarkdownSection('Image URL', body);
  const type = extractMarkdownSection('Artwork Type', body);

  if (!appId || !imageUrl || !type) {
    console.error('❌ Missing required fields');
    return;
  }

  // Abrufen der Steam-Daten basierend auf der App ID
  const { name, publisher, releaseDate } = await fetchSteamAppDetails(appId);

  // Erstelle den Ordner für die Artworks
  const folderPath = path.join('artworks', publisher, appId);
  fs.mkdirSync(folderPath, { recursive: true });

  // Bild herunterladen
  const imagePath = path.join(folderPath, 'imageSource.png');
  try {
    await downloadImage(imageUrl, imagePath);
  } catch (err) {
    console.error(`❌ Failed to download image: ${err.message}`);
    return;
  }

  // Mustache-Template für index.html laden
  const templatePath = path.join('templates', 'index.html.mustache');
  if (!fs.existsSync(templatePath)) {
    console.error('❌ Template not found.');
    return;
  }

  const template = fs.readFileSync(templatePath, 'utf8');
  const html = Mustache.render(template, {
    gameID: appId,
    publisher,
    name,
    releaseDate,
  });

  // index.html schreiben
  fs.writeFileSync(path.join(folderPath, 'index.html'), html);
  console.log(`✅ Done! Created artwork for ${name} at ${folderPath}`);

  // Git-Befehle ausführen, um Änderungen zu committen und zu pushen
  const execSync = require('child_process').execSync;
  execSync('git config user.name "github-actions"');
  execSync('git config user.email "github-actions@github.com"');
  execSync(`git add "${folderPath}"`);
  execSync(`git commit -m "Add artwork for ${name} (${appId})"`);
  execSync('git push');
  console.log('📦 Changes committed and pushed.');
}

run();