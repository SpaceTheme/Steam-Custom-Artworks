'use strict';

const { problem } = require('./request');

const API = 'https://www.steamgriddb.com/api/v2/heroes/';

// Returns null if the hero doesn't exist (anymore).
async function fetchHero(heroId, apiKey) {
  const res = await fetch(API + heroId, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SteamGridDB API returned HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success || !json.data || !json.data.url) return null;
  return json.data;
}

function heroProblems(hero) {
  const problems = [];
  const pickAnother = 'Please pick a different image on SteamGridDB (use the filters **Style: Alternate**, **Type: Static** and **Tags: Untagged**) and update the link.';

  if (hero.style !== 'alternate') {
    problems.push(problem('Image URL', `The image style is **${hero.style || 'unknown'}**, but only **Alternate** is allowed.`, pickAnother));
  }
  const tags = [
    ...(Array.isArray(hero.tags) ? hero.tags : []),
    hero.nsfw && 'NSFW',
    hero.humor && 'Humor',
    hero.epilepsy && 'Epilepsy',
  ].filter(Boolean);
  if (tags.length) {
    problems.push(problem('Image URL', `The image is tagged as **${[...new Set(tags)].join(', ')}**, but only untagged images are allowed.`, pickAnother));
  }
  if (hero.animated) {
    problems.push(problem('Image URL', 'The image is **animated**, but only static images are allowed.', pickAnother));
  }
  return problems;
}

module.exports = { fetchHero, heroProblems };
