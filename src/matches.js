// src/matches.js — scoring engine + match data
'use strict';

const { FIXTURES } = require('./fixtures');
const MATCHES = FIXTURES;

const TEAMS = [
  'Royal Challengers Bengaluru','Mumbai Indians','Delhi Capitals','Chennai Super Kings',
  'Sunrisers Hyderabad','Punjab Kings','Rajasthan Royals','Gujarat Titans',
  'Kolkata Knight Riders','Lucknow Super Giants',
];

// New point values
const POINTS = { match:2, semi:5, winner:10 };

const TEAM_NAME_MAP = {
  'royal challengers bengaluru':'Royal Challengers Bengaluru',
  'royal challengers bangalore':'Royal Challengers Bengaluru','rcb':'Royal Challengers Bengaluru',
  'mumbai indians':'Mumbai Indians','mi':'Mumbai Indians',
  'delhi capitals':'Delhi Capitals','dc':'Delhi Capitals',
  'chennai super kings':'Chennai Super Kings','csk':'Chennai Super Kings',
  'sunrisers hyderabad':'Sunrisers Hyderabad','srh':'Sunrisers Hyderabad',
  'punjab kings':'Punjab Kings','pbks':'Punjab Kings','kings xi punjab':'Punjab Kings',
  'rajasthan royals':'Rajasthan Royals','rr':'Rajasthan Royals',
  'gujarat titans':'Gujarat Titans','gt':'Gujarat Titans',
  'kolkata knight riders':'Kolkata Knight Riders','kkr':'Kolkata Knight Riders',
  'lucknow super giants':'Lucknow Super Giants','lsg':'Lucknow Super Giants',
};

/**
 * Score one bracket. Returns { pts, breakdown }
 * breakdown.league  = [{matchId, pick, result, status, pts}]
 * breakdown.semis   = [{team, status, pts}]
 * breakdown.champion= {team, status, pts}
 */
function scoreBracket(picks, results) {
  let pts = 0;
  const r = results || {};
  const breakdown = { league:[], semis:[], champion:null };

  for (const m of MATCHES) {
    const pick = picks.matches?.[String(m.id)];
    const res  = r.matches?.[String(m.id)];
    if (!pick) continue;
    if (!res) {
      breakdown.league.push({ matchId:m.id, pick, result:null, status:'pending', pts:0 });
    } else if (pick === res) {
      pts += POINTS.match;
      breakdown.league.push({ matchId:m.id, pick, result:res, status:'correct', pts:POINTS.match });
    } else {
      breakdown.league.push({ matchId:m.id, pick, result:res, status:'incorrect', pts:0 });
    }
  }

  const semisKnown = !!(r.semis && r.semis.length);
  for (const team of (picks.semis || [])) {
    if (!semisKnown) {
      breakdown.semis.push({ team, status:'pending', pts:0 });
    } else if (r.semis.includes(team)) {
      pts += POINTS.semi;
      breakdown.semis.push({ team, status:'correct', pts:POINTS.semi });
    } else {
      breakdown.semis.push({ team, status:'incorrect', pts:0 });
    }
  }

  if (!r.champion) {
    breakdown.champion = { team:picks.champion, status:'pending', pts:0 };
  } else if (picks.champion === r.champion) {
    pts += POINTS.winner;
    breakdown.champion = { team:picks.champion, status:'correct', pts:POINTS.winner };
  } else {
    breakdown.champion = { team:picks.champion, status:'incorrect', pts:0 };
  }

  return { pts, breakdown };
}

/** Max achievable points remaining (for display). */
function maxPossible(picks, results) {
  const r = results || {};
  let max = 0;
  for (const m of MATCHES) {
    const res  = r.matches?.[String(m.id)];
    const pick = picks.matches?.[String(m.id)];
    if (!res || pick === res) max += POINTS.match;
  }
  const semisKnown = !!(r.semis && r.semis.length);
  for (const team of (picks.semis || [])) {
    if (!semisKnown || r.semis.includes(team)) max += POINTS.semi;
  }
  if (!r.champion || picks.champion === r.champion) max += POINTS.winner;
  return max;
}

/**
 * Dense-rank: same pts → same rank, next rank is consecutive (no gap).
 * e.g. [30,30,20] → ranks [1,1,2] not [1,1,3].
 * finalRuns tiebreaker only activates at end of tournament (when actualFinalRuns is set).
 * During the season, tied players share the same rank.
 */
function rankLeaderboard(entries, actualFinalRuns) {
  const sorted = [...entries].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    // Tiebreaker: only at end of tournament (Final has been played)
    if (actualFinalRuns) {
      const diffA = Math.abs((a.finalRuns || 0) - actualFinalRuns);
      const diffB = Math.abs((b.finalRuns || 0) - actualFinalRuns);
      if (diffA !== diffB) return diffA - diffB;
    }
    return a.name.localeCompare(b.name);
  });
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1], curr = sorted[i];
      const ptsDiffer = curr.pts !== prev.pts;
      const tbDiffer  = actualFinalRuns &&
        Math.abs((curr.finalRuns || 0) - actualFinalRuns) !==
        Math.abs((prev.finalRuns || 0) - actualFinalRuns);
      if (ptsDiffer || tbDiffer) rank++;
    }
    sorted[i].rank = rank;
  }
  return sorted;
}

function normalizeTeamName(raw) {
  if (!raw) return null;
  return TEAM_NAME_MAP[raw.toLowerCase().trim()] || raw.trim();
}

module.exports = { MATCHES, TEAMS, POINTS, scoreBracket, maxPossible, rankLeaderboard, normalizeTeamName };