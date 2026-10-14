'use strict';

const { problem } = require('./request');
const { fetchAppInfo, applyOverrides } = require('./steam');
const { fetchHero, heroProblems } = require('./steamgriddb');

// Validates a parsed request against Steam and SteamGridDB.
//
// strict = false (issue triage): unreachable services are reported as warnings,
//   so a Steam outage doesn't block a request.
// strict = true (processing): unreachable services throw.
async function checkRequest(request, { steamGridDbKey, strict = false } = {}) {
  const problems = [...request.errors];
  const warnings = [];
  const canCheckApp = Boolean(request.appId);
  const canCheckHero = Boolean(request.heroId);

  if (strict && canCheckHero && !steamGridDbKey) throw new Error('STEAMGRIDDB_API_KEY is not set');

  const soft = async (service, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (strict) throw err;
      warnings.push(`${service} could not be checked right now (${err.message}).`);
      return undefined;
    }
  };

  // undefined = not checked, null = does not exist
  const [info, hero] = await Promise.all([
    canCheckApp ? soft('Steam', () => fetchAppInfo(request.appId)) : undefined,
    canCheckHero && steamGridDbKey ? soft('SteamGridDB', () => fetchHero(request.heroId, steamGridDbKey)) : undefined,
  ]);

  if (info === null) {
    problems.push(problem('App ID', `Neither Steam nor SteamDB know an app with the ID \`${request.appId}\`.`, 'Double-check the number. It is the number in the Steam store link, e.g. store.steampowered.com/app/**570**/Dota_2.'));
  }
  if (hero === null) {
    problems.push(problem('Image URL', `The image [hero/${request.heroId}](${request.imageUrl}) doesn't exist on SteamGridDB (anymore).`, 'Open the link to check it, or pick another image and update the link.'));
  } else if (hero) {
    problems.push(...heroProblems(hero));
  }

  const meta = info ? applyOverrides(info, request.overrides) : null;
  if (meta && !meta.publisher.value) {
    problems.push(problem('Publisher', 'Neither the Steam Store nor SteamDB list a publisher or developer for this game. This usually happens when a game was removed from Steam.', `Look up the publisher (e.g. on [SteamDB](https://steamdb.info/app/${request.appId}/info/), Wikipedia or the game's website) and enter it in the **Publisher (optional)** field.`));
  }
  if (meta && !meta.release.value) {
    warnings.push('No release date found, so the artwork will show "Unknown". You can add it in the **Release date (optional)** field.');
  }
  if (info && info.warnings.length) {
    warnings.push(...info.warnings.map(w => `Partial Steam data: ${w}.`));
  }

  return { meta, hero, problems, warnings };
}

module.exports = { checkRequest };
