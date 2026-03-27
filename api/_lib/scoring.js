'use strict';
const { db } = require('./firebase');
const { scoreBracket, maxPossible, rankLeaderboard } = require('../../src/matches');

async function recomputeGroup(groupId, results) {
  const picksSnap = await db.collection('groups').doc(groupId).collection('picks').get();
  const entries = picksSnap.docs.map(d => {
    const p = d.data();
    const { pts, breakdown } = scoreBracket(p, results);
    const mx = maxPossible(p, results);
    return {
      uid: d.id,
      name: p.name,
      pts,
      maxPts: mx,
      finalRuns: p.finalRuns || null,
      champion: p.champion,
      semis: p.semis || [],
      correctLeague: breakdown.league.filter(l => l.status === 'correct').length,
      matchPicks: breakdown.league.map(l => ({ matchId: l.matchId, pick: l.pick, status: l.status })),
    };
  });
  const ranked = rankLeaderboard(entries, results?.finalRuns || null);
  const lean = ranked.map(({ uid: _uid, ...rest }) => rest);
  await db.collection('groups').doc(groupId).update({
    leaderboard: lean,
    memberCount: lean.length,
    lastScored: new Date().toISOString(),
  });
  return lean;
}

async function recomputeAllGroups(results) {
  const snap = await db.collection('groups').get();
  await Promise.all(snap.docs.map(d => recomputeGroup(d.id, results)));
}

module.exports = { recomputeGroup, recomputeAllGroups };
