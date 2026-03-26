// ─── api/sync-results.js ─────────────────────────────────────────────────────
// Fetches IPL 2026 match results from CricketData.org API
// and writes them to Firebase Firestore.
// Called by cron job every SYNC_INTERVAL_MINUTES minutes.

require('dotenv').config();
const fetch = require('node-fetch');
const { MATCHES, normalizeTeamName } = require('../src/matches');

const API_KEY = process.env.CRICKETDATA_API_KEY;
const SERIES_ID = process.env.IPL_SERIES_ID;
const BASE = 'https://api.cricapi.com/v1';

// ─── Firebase setup ──────────────────────────────────────────────────────────
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchSeriesMatches() {
  const url = `${BASE}/series_info?apikey=${API_KEY}&id=${SERIES_ID}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'success') throw new Error(`API error: ${JSON.stringify(json)}`);
  return json.data?.matchList || [];
}

async function fetchMatchScore(matchId) {
  const url = `${BASE}/match_scorecard?apikey=${API_KEY}&id=${matchId}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'success') return null;
  return json.data;
}

/**
 * Extract the winner team name from a completed match scorecard.
 * CricketData returns matchWinner field directly in match info.
 */
function extractWinner(matchData) {
  if (!matchData) return null;
  // Check matchWinner field (most reliable)
  if (matchData.matchWinner) return normalizeTeamName(matchData.matchWinner);
  // Fallback: parse status string "Team X won by Y"
  const status = matchData.status || '';
  const wonMatch = status.match(/^(.+?)\s+won\s+by/i);
  if (wonMatch) return normalizeTeamName(wonMatch[1].trim());
  return null;
}

/**
 * Extract total runs from a Final match for tiebreaker.
 * Sums first innings + second innings scores.
 */
function extractTotalRuns(scorecard) {
  if (!scorecard?.score) return null;
  let total = 0;
  for (const inning of scorecard.score) {
    const runs = parseInt(inning.r || inning.runs || 0);
    total += runs;
  }
  return total > 0 ? total : null;
}

/**
 * Match an API match entry to our local MATCHES list by date + team names.
 */
function matchToLocal(apiMatch) {
  const apiDate = apiMatch.date?.slice(0, 10); // "2026-03-28"
  const t1 = normalizeTeamName(apiMatch.teams?.[0]);
  const t2 = normalizeTeamName(apiMatch.teams?.[1]);

  return MATCHES.find(m => {
    const sameDate = m.date === apiDate;
    const sameTeams = (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1);
    return sameDate && sameTeams;
  });
}

// ─── Main sync ────────────────────────────────────────────────────────────────

async function syncResults() {
  console.log(`[${new Date().toISOString()}] Starting IPL results sync...`);

  let apiMatches;
  try {
    apiMatches = await fetchSeriesMatches();
    console.log(`  Fetched ${apiMatches.length} matches from API`);
  } catch (err) {
    console.error('  Failed to fetch series:', err.message);
    return { ok: false, error: err.message };
  }

  const resultsRef = db.collection('ipl2026').doc('results');
  const currentSnap = await resultsRef.get();
  const current = currentSnap.exists ? currentSnap.data() : { matches:{}, semis:[], champion:null, finalRuns:null };

  const updatedMatches = { ...current.matches };
  let changed = false;
  let isFinalDetected = false;

  for (const apiMatch of apiMatches) {
    // Skip if not completed
    if (!apiMatch.matchEnded && apiMatch.status?.toLowerCase() !== 'match over') continue;

    const local = matchToLocal(apiMatch);
    if (!local) {
      // Could be a playoff match — handle below
      continue;
    }

    const winner = apiMatch.matchWinner
      ? normalizeTeamName(apiMatch.matchWinner)
      : null;

    if (winner && updatedMatches[local.id] !== winner) {
      console.log(`  Match ${local.id} (${local.label}): ${winner} wins`);
      updatedMatches[local.id] = winner;
      changed = true;
    }
  }

  // ── Detect semis / champion from playoff matches ──
  // Playoff matches won't be in our MATCHES list (they're post-league).
  // CricketData series_info includes them in matchList with round info.
  const playoffMatches = apiMatches.filter(m => {
    const name = (m.name || m.matchType || '').toLowerCase();
    return name.includes('qualifier') || name.includes('eliminator') ||
           name.includes('final') || name.includes('semi');
  });

  let semis = [...(current.semis || [])];
  let champion = current.champion;
  let finalRuns = current.finalRuns;

  for (const pm of playoffMatches) {
    if (!pm.matchEnded) continue;
    const winner = pm.matchWinner ? normalizeTeamName(pm.matchWinner) : null;
    const loser = pm.teams?.map(normalizeTeamName).find(t => t !== winner);
    const name = (pm.name || '').toLowerCase();

    // Qualifier 1 & Eliminator → top 4 confirmed (both teams in)
    if (name.includes('qualifier 1') || name.includes('eliminator')) {
      [winner, loser].forEach(t => {
        if (t && !semis.includes(t)) { semis.push(t); changed = true; }
      });
    }
    // Qualifier 2 → top 4 confirmed (winner advances to final)
    if (name.includes('qualifier 2')) {
      [winner, loser].forEach(t => {
        if (t && !semis.includes(t)) { semis.push(t); changed = true; }
      });
    }
    // Final → champion
    if (name.includes('final') && !name.includes('qualifier') && !name.includes('semi')) {
      if (winner && champion !== winner) {
        champion = winner;
        changed = true;
        isFinalDetected = true;
        console.log(`  🏆 IPL Champion: ${champion}`);
      }
      // Try to get total runs for tiebreaker
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
    const payload = {
      matches: updatedMatches,
      semis,
      champion,
      finalRuns,
      lastSynced: new Date().toISOString(),
    };
    await resultsRef.set(payload, { merge: true });
    console.log(`  ✅ Results updated in Firestore`);

    // Recompute all leaderboards
    await recomputeLeaderboards(payload);
  } else {
    console.log('  No changes detected.');
    await resultsRef.set(
      { lastSynced: new Date().toISOString() },
      { merge: true }
    );
  }

  return { ok: true, changed, matchesKnown: Object.keys(updatedMatches).length };
}

// ─── Leaderboard recompute ────────────────────────────────────────────────────

const { scoreBracket, sortLeaderboard } = require('../src/matches');

async function recomputeLeaderboards(results) {
  console.log('  Recomputing leaderboards...');

  // Get all groups
  const groupsSnap = await db.collection('groups').get();
  for (const groupDoc of groupsSnap.docs) {
    const groupId = groupDoc.id;

    // Get all picks for this group
    const picksSnap = await db.collection('groups').doc(groupId)
      .collection('picks').get();

    const entries = [];
    for (const pickDoc of picksSnap.docs) {
      const picks = pickDoc.data();
      const scored = scoreBracket(picks, results);
      entries.push({
        uid: pickDoc.id,
        name: picks.name,
        pts: scored.pts,
        maxPts: scored.maxPts,
        tbDiff: scored.tbDiff,
        tiebreaker: scored.tiebreaker,
        champion: picks.champion,
        correctLeague: scored.breakdown.league.filter(l=>l.status==='correct').length,
        breakdown: scored.breakdown,
      });
    }

    const sorted = sortLeaderboard(entries).map((e, i) => ({ ...e, rank: i+1 }));

    await db.collection('groups').doc(groupId).update({
      leaderboard: sorted,
      lastScored: new Date().toISOString(),
    });
    console.log(`    Group ${groupId}: ${entries.length} entries re-scored`);
  }
}

// ── Run if called directly ──
if (require.main === module) {
  syncResults()
    .then(r => { console.log('Done:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { syncResults, recomputeLeaderboards };
