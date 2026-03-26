// ─── src/matches.js ──────────────────────────────────────────────────────────
// Ground truth for all IPL 2026 matches and scoring logic

const MATCHES = [
  { id:1,  date:'2026-03-28', label:'03/28', t1:'Royal Challengers Bengaluru', t2:'Sunrisers Hyderabad',   round:'league' },
  { id:2,  date:'2026-03-29', label:'03/29', t1:'Mumbai Indians',              t2:'Kolkata Knight Riders', round:'league' },
  { id:3,  date:'2026-03-30', label:'03/30', t1:'Rajasthan Royals',            t2:'Chennai Super Kings',   round:'league' },
  { id:4,  date:'2026-03-31', label:'03/31', t1:'Punjab Kings',                t2:'Gujarat Titans',        round:'league' },
  { id:5,  date:'2026-04-01', label:'04/01', t1:'Lucknow Super Giants',        t2:'Delhi Capitals',        round:'league' },
  { id:6,  date:'2026-04-02', label:'04/02', t1:'Kolkata Knight Riders',       t2:'Sunrisers Hyderabad',   round:'league' },
  { id:7,  date:'2026-04-03', label:'04/03', t1:'Chennai Super Kings',         t2:'Punjab Kings',          round:'league' },
  { id:8,  date:'2026-04-04', label:'04/04', t1:'Delhi Capitals',              t2:'Mumbai Indians',        round:'league' },
  { id:9,  date:'2026-04-04', label:'04/04', t1:'Gujarat Titans',              t2:'Rajasthan Royals',      round:'league' },
  { id:10, date:'2026-04-05', label:'04/05', t1:'Sunrisers Hyderabad',         t2:'Lucknow Super Giants',  round:'league' },
  { id:11, date:'2026-04-05', label:'04/05', t1:'Royal Challengers Bengaluru', t2:'Chennai Super Kings',   round:'league' },
  { id:12, date:'2026-04-06', label:'04/06', t1:'Kolkata Knight Riders',       t2:'Punjab Kings',          round:'league' },
  { id:13, date:'2026-04-07', label:'04/07', t1:'Rajasthan Royals',            t2:'Mumbai Indians',        round:'league' },
  { id:14, date:'2026-04-08', label:'04/08', t1:'Delhi Capitals',              t2:'Gujarat Titans',        round:'league' },
  { id:15, date:'2026-04-09', label:'04/09', t1:'Kolkata Knight Riders',       t2:'Lucknow Super Giants',  round:'league' },
  { id:16, date:'2026-04-10', label:'04/10', t1:'Rajasthan Royals',            t2:'Royal Challengers Bengaluru', round:'league' },
  { id:17, date:'2026-04-11', label:'04/11', t1:'Punjab Kings',                t2:'Sunrisers Hyderabad',   round:'league' },
  { id:18, date:'2026-04-11', label:'04/11', t1:'Chennai Super Kings',         t2:'Delhi Capitals',        round:'league' },
  { id:19, date:'2026-04-12', label:'04/12', t1:'Lucknow Super Giants',        t2:'Gujarat Titans',        round:'league' },
  { id:20, date:'2026-04-12', label:'04/12', t1:'Mumbai Indians',              t2:'Royal Challengers Bengaluru', round:'league' },
];

const TEAMS = [
  'Royal Challengers Bengaluru','Mumbai Indians','Delhi Capitals','Chennai Super Kings',
  'Sunrisers Hyderabad','Punjab Kings','Rajasthan Royals','Gujarat Titans',
  'Kolkata Knight Riders','Lucknow Super Giants'
];

// CricketData.org team name → our canonical name mapping
// (API may return short names / variations)
const TEAM_NAME_MAP = {
  'royal challengers bengaluru': 'Royal Challengers Bengaluru',
  'royal challengers bangalore': 'Royal Challengers Bengaluru',
  'rcb': 'Royal Challengers Bengaluru',
  'mumbai indians': 'Mumbai Indians',
  'mi': 'Mumbai Indians',
  'delhi capitals': 'Delhi Capitals',
  'dc': 'Delhi Capitals',
  'chennai super kings': 'Chennai Super Kings',
  'csk': 'Chennai Super Kings',
  'sunrisers hyderabad': 'Sunrisers Hyderabad',
  'srh': 'Sunrisers Hyderabad',
  'punjab kings': 'Punjab Kings',
  'pbks': 'Punjab Kings',
  'kings xi punjab': 'Punjab Kings',
  'rajasthan royals': 'Rajasthan Royals',
  'rr': 'Rajasthan Royals',
  'gujarat titans': 'Gujarat Titans',
  'gt': 'Gujarat Titans',
  'kolkata knight riders': 'Kolkata Knight Riders',
  'kkr': 'Kolkata Knight Riders',
  'lucknow super giants': 'Lucknow Super Giants',
  'lsg': 'Lucknow Super Giants',
};

const POINTS = {
  league: 10,
  qualifier1: 20,
  eliminator: 20,
  qualifier2: 40,
  semi: 40,      // per correct top-4 pick
  final: 160,
};

// ─── SCORING ENGINE ──────────────────────────────────────────────────────────

/**
 * Score a single bracket submission against known results.
 * @param {object} picks - { matches:{1:'Team A',...}, semis:['A','B','C','D'], champion:'A', tiebreaker:340 }
 * @param {object} results - { matches:{1:'Team A',...}, semis:['A','B','C','D'], champion:'A', finalRuns:320 }
 * @returns {object} scoring result
 */
function scoreBracket(picks, results) {
  let pts = 0;
  let maxPts = 0;
  const breakdown = { league:[], semis:[], champion:null };

  // ── League Stage ──
  const maxLeague = MATCHES.length * POINTS.league;
  maxPts += maxLeague;
  for (const m of MATCHES) {
    const pick = picks.matches?.[m.id];
    const result = results.matches?.[m.id];
    if (!pick) continue;
    if (!result) {
      // Match not yet played — still counts toward max
      breakdown.league.push({ matchId:m.id, pick, result:null, status:'pending', pts:0 });
    } else if (pick === result) {
      pts += POINTS.league;
      breakdown.league.push({ matchId:m.id, pick, result, status:'correct', pts:POINTS.league });
    } else {
      // Incorrect: subtract from max
      maxPts -= POINTS.league;
      breakdown.league.push({ matchId:m.id, pick, result, status:'incorrect', pts:0 });
    }
  }

  // ── Top 4 / Semis (40 pts each) ──
  const maxSemis = 4 * POINTS.semi;
  maxPts += maxSemis;
  if (results.semis && results.semis.length > 0) {
    for (const team of (picks.semis || [])) {
      if (results.semis.includes(team)) {
        pts += POINTS.semi;
        breakdown.semis.push({ team, status:'correct', pts:POINTS.semi });
      } else {
        maxPts -= POINTS.semi;
        breakdown.semis.push({ team, status:'incorrect', pts:0 });
      }
    }
    // teams the user didn't pick that qualified — no pts, no deduction
  } else {
    // Semis unknown yet — show pending
    for (const team of (picks.semis || [])) {
      breakdown.semis.push({ team, status:'pending', pts:0 });
    }
  }

  // ── Champion (160 pts) ──
  maxPts += POINTS.final;
  if (results.champion) {
    if (picks.champion === results.champion) {
      pts += POINTS.final;
      breakdown.champion = { team:picks.champion, status:'correct', pts:POINTS.final };
    } else {
      maxPts -= POINTS.final;
      breakdown.champion = { team:picks.champion, status:'incorrect', pts:0 };
    }
  } else {
    breakdown.champion = { team:picks.champion, status:'pending', pts:0 };
  }

  // ── Tiebreaker ──
  let tbDiff = null;
  if (results.finalRuns != null && picks.tiebreaker != null) {
    tbDiff = Math.abs(picks.tiebreaker - results.finalRuns);
  }

  return { pts, maxPts, breakdown, tbDiff, tiebreaker: picks.tiebreaker };
}

/**
 * Sort leaderboard: pts desc → maxPts desc → tbDiff asc
 */
function sortLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.maxPts !== a.maxPts) return b.maxPts - a.maxPts;
    // Tiebreaker: closer to actual wins
    if (a.tbDiff == null && b.tbDiff == null) return 0;
    if (a.tbDiff == null) return 1;
    if (b.tbDiff == null) return -1;
    return a.tbDiff - b.tbDiff;
  });
}

function normalizeTeamName(raw) {
  if (!raw) return null;
  return TEAM_NAME_MAP[raw.toLowerCase().trim()] || raw.trim();
}

module.exports = { MATCHES, TEAMS, POINTS, scoreBracket, sortLeaderboard, normalizeTeamName };
