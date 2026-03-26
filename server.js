// ─── server.js ───────────────────────────────────────────────────────────────
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const path       = require('path');
const admin      = require('firebase-admin');

const { MATCHES, TEAMS, scoreBracket, sortLeaderboard } = require('./src/matches');
const { syncResults, recomputeLeaderboards }             = require('./api/sync-results');

// ─── Firebase ────────────────────────────────────────────────────────────────
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

// ─── App ─────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware (admin only) ─────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error:'Unauthorized' });
  next();
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_, res) => res.json({ ok:true, time: new Date().toISOString() }));

// Get current results + last sync time
app.get('/api/results', async (req, res) => {
  try {
    const snap = await db.collection('ipl2026').doc('results').get();
    if (!snap.exists) return res.json({ matches:{}, semis:[], champion:null, finalRuns:null, lastSynced:null });
    res.json(snap.data());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Helper: stable pickId from name + groupId (1 bracket per player per group) ──
function makePickId(name, groupId) {
  return groupId.toUpperCase() + '__' + name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// Submit OR edit bracket picks
// POST creates; PUT updates (only if group not locked)
// Body: { name, groupId, matches:{1:'Team',...}, semis:['A','B','C','D'], champion:'X', tiebreaker:340 }
async function handlePicksSubmit(req, res, isEdit = false) {
  try {
    const { name, groupId, matches, semis, champion, tiebreaker } = req.body;

    // ── Validation ──
    if (!name?.trim()) return res.status(400).json({ error:'Name required' });
    if (!groupId?.trim()) return res.status(400).json({ error:'Group ID required' });
    if (!matches || Object.keys(matches).length !== MATCHES.length)
      return res.status(400).json({ error:`Must pick all ${MATCHES.length} league matches` });
    if (!semis || semis.length !== 4)
      return res.status(400).json({ error:'Must pick exactly 4 semifinalists' });
    if (!champion) return res.status(400).json({ error:'Must pick a champion' });
    if (!tiebreaker || tiebreaker < 100 || tiebreaker > 600)
      return res.status(400).json({ error:'Tiebreaker must be between 100–600' });

    // ── Check group exists ──
    const gid = groupId.trim().toUpperCase();
    const groupRef = db.collection('groups').doc(gid);
    const groupDoc = await groupRef.get();
    if (!groupDoc.exists) return res.status(404).json({ error:'Group not found. Ask your group admin for the code.' });

    const groupData = groupDoc.data();
    if (groupData.locked) return res.status(403).json({ error:'Bracket submissions are closed for this group.' });

    // ── Stable pickId: one per player per group ──
    const pickId = makePickId(name, gid);
    const picksRef = groupRef.collection('picks').doc(pickId);
    const existingDoc = await picksRef.get();

    if (!isEdit && existingDoc.exists) {
      // POST on existing bracket → block and tell client to use PUT (edit)
      return res.status(409).json({
        error: 'You already have a bracket in this group.',
        pickId,
        canEdit: true,
      });
    }

    const now = new Date().toISOString();
    const payload = {
      name: name.trim(),
      groupId: gid,
      matches,
      semis,
      champion,
      tiebreaker: parseInt(tiebreaker),
      submittedAt: existingDoc.exists ? existingDoc.data().submittedAt : now,
      updatedAt: now,
    };

    await picksRef.set(payload);

    // ── Score immediately ──
    const resultsSnap = await db.collection('ipl2026').doc('results').get();
    const results = resultsSnap.exists ? resultsSnap.data() : {};
    const scored = scoreBracket(payload, results);

    // ── Recompute group leaderboard ──
    await recomputeLeaderboards(results);

    res.json({ ok:true, pickId, isEdit: isEdit || existingDoc.exists, scored });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

app.post('/api/picks', (req, res) => handlePicksSubmit(req, res, false));
app.put('/api/picks', (req, res) => handlePicksSubmit(req, res, true));

// Check if a bracket already exists for name+group (used by frontend before rendering form)
app.get('/api/picks/check', async (req, res) => {
  try {
    const { name, groupId } = req.query;
    if (!name || !groupId) return res.status(400).json({ error:'name and groupId required' });
    const gid = groupId.trim().toUpperCase();
    const pickId = makePickId(name, gid);
    const snap = await db.collection('groups').doc(gid).collection('picks').doc(pickId).get();

    // Also check if group is locked
    const groupDoc = await db.collection('groups').doc(gid).get();
    const locked = groupDoc.exists ? groupDoc.data().locked : false;

    if (!snap.exists) return res.json({ exists: false, pickId, locked });
    const data = snap.data();
    res.json({ exists: true, pickId, locked, picks: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get group leaderboard
app.get('/api/group/:groupId', async (req, res) => {
  try {
    const groupRef = db.collection('groups').doc(req.params.groupId.toUpperCase());
    const groupDoc = await groupRef.get();
    if (!groupDoc.exists) return res.status(404).json({ error:'Group not found' });

    const data = groupDoc.data();
    res.json({
      id: req.params.groupId.toUpperCase(),
      name: data.name,
      locked: data.locked || false,
      leaderboard: data.leaderboard || [],
      lastScored: data.lastScored || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get my picks (by pickId)
app.get('/api/picks/:pickId', async (req, res) => {
  try {
    // pickId format: groupId/uid — we search across groups
    const [groupId, ...rest] = req.params.pickId.split('_');
    // Actually just search by stored pickId
    const snap = await db.collectionGroup('picks')
      .where(admin.firestore.FieldPath.documentId(), '==', req.params.pickId)
      .get();
    if (snap.empty) return res.status(404).json({ error:'Picks not found' });

    const picks = snap.docs[0].data();
    const resultsSnap = await db.collection('ipl2026').doc('results').get();
    const results = resultsSnap.exists ? resultsSnap.data() : {};
    const scored = scoreBracket(picks, results);

    res.json({ picks, scored, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// Create a group
app.post('/api/admin/group', adminAuth, async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ error:'name and code required' });
    const id = code.toUpperCase().replace(/\s/g,'').slice(0,8);
    await db.collection('groups').doc(id).set({
      name, id, locked:false, leaderboard:[],
      createdAt: new Date().toISOString(),
    });
    res.json({ ok:true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lock/unlock group submissions
app.post('/api/admin/group/:groupId/lock', adminAuth, async (req, res) => {
  try {
    const locked = req.body.locked !== false;
    await db.collection('groups').doc(req.params.groupId.toUpperCase()).update({ locked });
    res.json({ ok:true, locked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a bracket from a group (admin only)
app.delete('/api/admin/group/:groupId/picks/:pickId', adminAuth, async (req, res) => {
  try {
    const gid    = req.params.groupId.toUpperCase();
    const pickId = req.params.pickId;
    await db.collection('groups').doc(gid).collection('picks').doc(pickId).delete();

    // Recompute leaderboard after deletion
    const resultsSnap = await db.collection('ipl2026').doc('results').get();
    const results = resultsSnap.exists ? resultsSnap.data() : {};
    await recomputeLeaderboards(results);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manually override a match result (admin)
app.post('/api/admin/result', adminAuth, async (req, res) => {
  try {
    const { matchId, winner, semis, champion, finalRuns } = req.body;
    const ref = db.collection('ipl2026').doc('results');
    const snap = await ref.get();
    const current = snap.exists ? snap.data() : { matches:{} };

    const update = { matches: { ...current.matches } };
    if (matchId && winner) update.matches[matchId] = winner;
    if (semis)      update.semis = semis;
    if (champion)   update.champion = champion;
    if (finalRuns != null) update.finalRuns = finalRuns;
    update.lastSynced = new Date().toISOString();
    update.manualOverride = true;

    await ref.set(update, { merge:true });
    await recomputeLeaderboards(update);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force sync now
app.post('/api/admin/sync', adminAuth, async (req, res) => {
  try {
    const result = await syncResults();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List all picks in a group (admin)
app.get('/api/admin/group/:groupId/picks', adminAuth, async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const snap = await db.collection('groups').doc(gid).collection('picks').get();
    const picks = snap.docs.map(d => ({ pickId: d.id, ...d.data() }));
    res.json({ ok: true, picks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get admin dashboard data
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const [resultsSnap, groupsSnap] = await Promise.all([
      db.collection('ipl2026').doc('results').get(),
      db.collection('groups').get(),
    ]);
    const results = resultsSnap.exists ? resultsSnap.data() : {};
    const groups = [];
    for (const g of groupsSnap.docs) {
      const picksSnap = await db.collection('groups').doc(g.id).collection('picks').get();
      groups.push({ ...g.data(), id:g.id, memberCount: picksSnap.size });
    }
    res.json({ results, groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve SPA for all non-API routes
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── CRON: Auto-sync results ──────────────────────────────────────────────────
const intervalMins = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30');
const cronExpr = `*/${intervalMins} * * * *`;
console.log(`Setting up auto-sync every ${intervalMins} minutes (${cronExpr})`);

cron.schedule(cronExpr, async () => {
  try { await syncResults(); }
  catch (e) { console.error('Cron sync failed:', e.message); }
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏏 IPL Madness 2K26 running on http://localhost:${PORT}`);
  console.log(`   Auto-sync every ${intervalMins} min | Admin panel: /admin.html`);
  // Sync on startup
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(syncResults, 3000);
  }
});