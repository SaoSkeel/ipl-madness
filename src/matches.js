// src/matches.js — scoring engine + match data
'use strict';

const MATCHES = [
  { id:1,  date:'2026-03-28', label:'03/28', t1:'Royal Challengers Bengaluru', t2:'Sunrisers Hyderabad'          },
  { id:2,  date:'2026-03-29', label:'03/29', t1:'Mumbai Indians',              t2:'Kolkata Knight Riders'        },
  { id:3,  date:'2026-03-30', label:'03/30', t1:'Rajasthan Royals',            t2:'Chennai Super Kings'          },
  { id:4,  date:'2026-03-31', label:'03/31', t1:'Punjab Kings',                t2:'Gujarat Titans'               },
  { id:5,  date:'2026-04-01', label:'04/01', t1:'Lucknow Super Giants',        t2:'Delhi Capitals'               },
  { id:6,  date:'2026-04-02', label:'04/02', t1:'Kolkata Knight Riders',       t2:'Sunrisers Hyderabad'          },
  { id:7,  date:'2026-04-03', label:'04/03', t1:'Chennai Super Kings',         t2:'Punjab Kings'                 },
  { id:8,  date:'2026-04-04', label:'04/04', t1:'Delhi Capitals',              t2:'Mumbai Indians'               },
  { id:9,  date:'2026-04-04', label:'04/04', t1:'Gujarat Titans',              t2:'Rajasthan Royals'             },
  { id:10, date:'2026-04-05', label:'04/05', t1:'Sunrisers Hyderabad',         t2:'Lucknow Super Giants'         },
  { id:11, date:'2026-04-05', label:'04/05', t1:'Royal Challengers Bengaluru', t2:'Chennai Super Kings'          },
  { id:12, date:'2026-04-06', label:'04/06', t1:'Kolkata Knight Riders',       t2:'Punjab Kings'                 },
  { id:13, date:'2026-04-07', label:'04/07', t1:'Rajasthan Royals',            t2:'Mumbai Indians'               },
  { id:14, date:'2026-04-08', label:'04/08', t1:'Delhi Capitals',              t2:'Gujarat Titans'               },
  { id:15, date:'2026-04-09', label:'04/09', t1:'Kolkata Knight Riders',       t2:'Lucknow Super Giants'         },
  { id:16, date:'2026-04-10', label:'04/10', t1:'Rajasthan Royals',            t2:'Royal Challengers Bengaluru'  },
  { id:17, date:'2026-04-11', label:'04/11', t1:'Punjab Kings',                t2:'Sunrisers Hyderabad'          },
  { id:18, date:'2026-04-11', label:'04/11', t1:'Chennai Super Kings',         t2:'Delhi Capitals'               },
  { id:19, date:'2026-04-12', label:'04/12', t1:'Lucknow Super Giants',        t2:'Gujarat Titans'               },
  { id:20, date:'2026-04-12', label:'04/12', t1:'Mumbai Indians',              t2:'Royal Challengers Bengaluru'  },
];

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
    const pick = picks.matches?.[m.id];
    const res  = r.matches?.[m.id];
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
    const res  = r.matches?.[m.id];
    const pick = picks.matches?.[m.id];
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
 */
function rankLeaderboard(entries) {
  const sorted = [...entries].sort((a,b) => b.pts - a.pts || a.name.localeCompare(b.name));
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].pts !== sorted[i-1].pts) rank++;
    sorted[i].rank = rank;
  }
  return sorted;
}

function normalizeTeamName(raw) {
  if (!raw) return null;
  return TEAM_NAME_MAP[raw.toLowerCase().trim()] || raw.trim();
}

module.exports = { MATCHES, TEAMS, POINTS, scoreBracket, maxPossible, rankLeaderboard, normalizeTeamName };