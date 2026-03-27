'use strict';
require('dotenv').config();
const fetch = require('node-fetch');
const { MATCHES, normalizeTeamName } = require('../../src/matches');
const { db } = require('./firebase');
const { recomputeAllGroups } = require('./scoring');

const API_KEY  = process.env.CRICKETDATA_API_KEY;
const SERIES_ID = process.env.IPL_SERIES_ID;
const BASE     = 'https://api.cricapi.com/v1';
const PAGE_SIZE = 50;

// Returns true only if there's actual work to do (avoids burning API quota on idle days)
function hasWorkToDo(current) {
  const today      = new Date().toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const lastLeagueDate = MATCHES[MATCHES.length - 1].date;

  const matchToday      = MATCHES.some(m => m.date === today);
  const recentUnresolved = MATCHES.some(m => m.date >= twoDaysAgo && m.date < today && !current.matches?.[m.id]);
  const playoffsPending  = today > lastLeagueDate && !current.champion;

  return matchToday || recentUnresolved || playoffsPending;
}

async function fetchSeriesMatches() {
  const allMatches = [];
  let offset = 0;
  while (true) {
    const url = `${BASE}/series_info?apikey=${API_KEY}&id=${SERIES_ID}&offset=${offset}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (json.status !== 'success') throw new Error(`API error: ${JSON.stringify(json)}`);
    const page = json.data?.matchList || [];
    allMatches.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allMatches;
}

async function fetchMatchScore(matchId) {
  const url  = `${BASE}/match_scorecard?apikey=${API_KEY}&id=${matchId}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.status !== 'success') return null;
  return json.data;
}

function extractWinner(matchData) {
  if (!matchData) return null;
  if (matchData.matchWinner) return normalizeTeamName(matchData.matchWinner);
  const status   = matchData.status || '';
  const wonMatch = status.match(/^(.+?)\s+won\s+by/i);
  if (wonMatch) return normalizeTeamName(wonMatch[1].trim());
  return null;
}

function extractTotalRuns(scorecard) {
  if (!scorecard?.score) return null;
  let total = 0;
  for (const inning of scorecard.score) {
    total += parseInt(inning.r || inning.runs || 0);
  }
  return total > 0 ? total : null;
}

function matchToLocal(apiMatch) {
  const apiDate = apiMatch.date?.slice(0, 10);
  const t1 = normalizeTeamName(apiMatch.teams?.[0]);
  const t2 = normalizeTeamName(apiMatch.teams?.[1]);
  return MATCHES.find(m => {
    const sameDate  = m.date === apiDate;
    const sameTeams = (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1);
    return sameDate && sameTeams;
  });
}

async function syncResults({ force = false } = {}) {
  console.log(`[${new Date().toISOString()}] Starting IPL results sync...`);

  const resultsRef  = db.collection('ipl2026').doc('results');
  const currentSnap = await resultsRef.get();
  const current     = currentSnap.exists
    ? currentSnap.data()
    : { matches: {}, semis: [], champion: null, finalRuns: null };

  if (!force && !hasWorkToDo(current)) {
    console.log('  Skipping API call — no matches today, no recent unresolved matches, no pending playoffs.');
    return { ok: true, changed: false, skipped: true };
  }

  let apiMatches;
  try {
    apiMatches = await fetchSeriesMatches();
    console.log(`  Fetched ${apiMatches.length} matches from API`);
  } catch (err) {
    console.error('  Failed to fetch series:', err.message);
    return { ok: false, error: err.message };
  }

  const updatedMatches = { ...current.matches };
  let changed = false;

  for (const apiMatch of apiMatches) {
    if (!apiMatch.matchEnded && apiMatch.status?.toLowerCase() !== 'match over') continue;
    const local = matchToLocal(apiMatch);
    if (!local) continue;
    const winner = apiMatch.matchWinner ? normalizeTeamName(apiMatch.matchWinner) : null;
    if (winner && updatedMatches[local.id] !== winner) {
      console.log(`  Match ${local.id} (${local.label}): ${winner} wins`);
      updatedMatches[local.id] = winner;
      changed = true;
    }
  }

  const playoffMatches = apiMatches.filter(m => {
    const name = (m.name || m.matchType || '').toLowerCase();
    return name.includes('qualifier') || name.includes('eliminator') ||
           name.includes('final')     || name.includes('semi');
  });

  let semis     = [...(current.semis || [])];
  let champion  = current.champion;
  let finalRuns = current.finalRuns;

  for (const pm of playoffMatches) {
    if (!pm.matchEnded) continue;
    const winner = pm.matchWinner ? normalizeTeamName(pm.matchWinner) : null;
    const loser  = pm.teams?.map(normalizeTeamName).find(t => t !== winner);
    const name   = (pm.name || '').toLowerCase();

    if (name.includes('qualifier 1') || name.includes('eliminator') || name.includes('qualifier 2')) {
      [winner, loser].forEach(t => {
        if (t && !semis.includes(t)) { semis.push(t); changed = true; }
      });
    }
    if (name.includes('final') && !name.includes('qualifier') && !name.includes('semi')) {
      if (winner && champion !== winner) {
        champion = winner; changed = true;
        console.log(`  🏆 IPL Champion: ${champion}`);
      }
      if (finalRuns == null) {
        try {
          const scorecard = await fetchMatchScore(pm.id);
          const runs = extractTotalRuns(scorecard);
          if (runs) { finalRuns = runs; changed = true; console.log(`  Final total runs: ${finalRuns}`); }
        } catch (e) { console.warn('  Could not fetch final scorecard:', e.message); }
      }
    }
  }

  if (semis.length > 4) semis = [...new Set(semis)].slice(0, 4);

  if (changed) {
    const payload = { matches: updatedMatches, semis, champion, finalRuns, lastSynced: new Date().toISOString() };
    await resultsRef.set(payload, { merge: true });
    console.log('  ✅ Results updated in Firestore');
    await recomputeAllGroups(payload);
  } else {
    console.log('  No changes detected.');
    await resultsRef.update({ lastSynced: new Date().toISOString() });
  }

  return { ok: true, changed, matchesKnown: Object.keys(updatedMatches).length };
}

if (require.main === module) {
  syncResults()
    .then(r => { console.log('Done:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { syncResults };
