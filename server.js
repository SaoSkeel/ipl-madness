// server.js
'use strict';
require('dotenv').config();

// ─── Startup env validation ───────────────────────────────────────────────────
const REQUIRED_ENV = ['FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','ADMIN_PASSWORD'];
const _missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (_missing.length) { console.error('❌ Missing required env vars:', _missing.join(', ')); process.exit(1); }

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const cors       = require('cors');
const cron       = require('node-cron');
const path       = require('path');
const crypto     = require('crypto');
const admin      = require('firebase-admin');

const { MATCHES, scoreBracket, maxPossible, rankLeaderboard } = require('./src/matches');
const { syncResults } = require('./api/sync-results');

// ─── Firebase (singleton) ────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n'),
  })});
}
const db = admin.firestore();

// ─── Cached results (avoids repeated Firestore reads on every request) ────────
let _resultsCache = null;
let _resultsCacheTime = 0;
let _resultsCachePromise = null; // prevents concurrent reads on cache miss
const RESULTS_TTL_MS = 60_000; // re-fetch at most once per minute

async function getResults() {
  const now = Date.now();
  if (_resultsCache && now - _resultsCacheTime < RESULTS_TTL_MS) return _resultsCache;
  if (_resultsCachePromise) return _resultsCachePromise; // coalesce concurrent misses
  _resultsCachePromise = db.collection('ipl2026').doc('results').get()
    .then(snap => {
      _resultsCache = snap.exists ? snap.data() : { matches:{}, semis:[], champion:null };
      _resultsCacheTime = Date.now();
      _resultsCachePromise = null;
      return _resultsCache;
    })
    .catch(e => { _resultsCachePromise = null; throw e; });
  return _resultsCachePromise;
}

function invalidateResultsCache() { _resultsCache = null; _resultsCacheTime = 0; }

// ─── Leaderboard recompute (batched write, one read per group) ────────────────
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
      champion: p.champion,
      correctLeague: breakdown.league.filter(l => l.status === 'correct').length,
      breakdown,
    };
  });

  const ranked = rankLeaderboard(entries);
  // Store lean leaderboard (no full breakdown to save Firestore bytes)
  const lean = ranked.map(({ breakdown: _bd, ...rest }) => rest);
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

// ─── Stable pickId: groupId__name_slug (1 bracket per name per group) ────────
function makePickId(name, gid) {
  return `${gid}__${name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_')}`;
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // required for rate-limit + HTTPS detection behind Render/Railway

// HTTPS redirect in production (Render/Railway terminate SSL at proxy)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limiting (picks submission only) ───────────────────────────────────
const picksLimiter = rateLimit({
  windowMs: 60_000, max: 15,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

function adminAuth(req, res, next) {
  const pw       = req.headers['x-admin-password'] || req.body?.adminPassword || '';
  const expected = process.env.ADMIN_PASSWORD;
  // Use constant-time comparison to prevent timing attacks
  const valid = pw.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(expected));
  if (!valid) return res.status(401).json({ error:'Unauthorized' });
  next();
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_, res) => res.json({ ok:true, time:new Date().toISOString() }));

// Current results (cached)
app.get('/api/results', async (req, res) => {
  try { res.json(await getResults()); }
  catch (e) { res.status(500).json({ error:e.message }); }
});

// Group leaderboard — hides picks detail if group is not locked (fairness)
app.get('/api/group/:groupId', async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const doc = await db.collection('groups').doc(gid).get();
    if (!doc.exists) return res.status(404).json({ error:'Group not found' });
    const data = doc.data();

    // If not locked, strip all pick details from leaderboard — only expose rank+pts+name
    const lb = (data.leaderboard || []).map(e => {
      if (!data.locked) {
        // Pre-lock: players can only see their own rank & pts, not others' picks
        return { rank:e.rank, name:e.name, pts:e.pts, maxPts:e.maxPts };
      }
      return e; // locked: full data visible
    });

    res.json({ id:gid, name:data.name, locked:data.locked||false, leaderboard:lb, lastScored:data.lastScored||null });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Check existing bracket (for edit detection)
app.get('/api/picks/check', async (req, res) => {
  try {
    const { name, groupId } = req.query;
    if (!name || !groupId) return res.status(400).json({ error:'name and groupId required' });
    const gid    = groupId.trim().toUpperCase();
    const pickId = makePickId(name, gid);
    const [pickSnap, groupSnap] = await Promise.all([
      db.collection('groups').doc(gid).collection('picks').doc(pickId).get(),
      db.collection('groups').doc(gid).get(),
    ]);
    const locked = groupSnap.exists ? groupSnap.data().locked : false;
    if (!pickSnap.exists) return res.json({ exists:false, pickId, locked });
    res.json({ exists:true, pickId, locked, picks:pickSnap.data() });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Submit (POST=new, PUT=edit) — multiple brackets per group allowed (by different names)
async function handlePicksSubmit(req, res, forceEdit) {
  try {
    const { name, groupId, matches, semis, champion } = req.body;

    if (!name?.trim())   return res.status(400).json({ error:'Name required' });
    if (!groupId?.trim()) return res.status(400).json({ error:'Group ID required' });
    if (!matches || Object.keys(matches).length !== MATCHES.length)
      return res.status(400).json({ error:`Pick all ${MATCHES.length} matches` });
    const validMatchIds = new Set(MATCHES.map(m => String(m.id)));
    const validTeams    = new Set(MATCHES.flatMap(m => [m.t1, m.t2]));
    for (const [id, winner] of Object.entries(matches)) {
      if (!validMatchIds.has(id)) return res.status(400).json({ error:`Invalid match id: ${id}` });
      if (!validTeams.has(winner)) return res.status(400).json({ error:`Invalid winner for match ${id}: ${winner}` });
    }
    if (!semis || semis.length !== 4) return res.status(400).json({ error:'Pick exactly 4 semifinalists' });
    if (semis.some(t => !validTeams.has(t))) return res.status(400).json({ error:'Invalid semifinalist team name' });
    if (!champion || !validTeams.has(champion)) return res.status(400).json({ error:'Invalid champion' });

    const gid      = groupId.trim().toUpperCase();
    const groupRef = db.collection('groups').doc(gid);
    const groupDoc = await groupRef.get();
    if (!groupDoc.exists) return res.status(404).json({ error:'Group not found' });
    if (groupDoc.data().locked) return res.status(403).json({ error:'Group is locked' });

    const pickId    = makePickId(name, gid);
    const picksRef  = groupRef.collection('picks').doc(pickId);
    const existDoc  = await picksRef.get();

    if (!forceEdit && existDoc.exists) {
      return res.status(409).json({ error:'Bracket already exists for this name in this group.', pickId, canEdit:true });
    }

    const now = new Date().toISOString();
    const payload = {
      name: name.trim(), groupId: gid, matches, semis, champion,
      submittedAt: existDoc.exists ? existDoc.data().submittedAt : now,
      updatedAt: now,
    };
    const isNew = !existDoc.exists;
    await picksRef.set(payload);
    // Keep memberCount in sync without an extra reads — recomputeGroup also sets it,
    // but incrementing here ensures the admin dashboard stays accurate immediately.
    if (isNew) await groupRef.update({ memberCount: admin.firestore.FieldValue.increment(1) });

    const results = await getResults();
    const { pts, breakdown } = scoreBracket(payload, results);
    const mx = maxPossible(payload, results);

    // Recompute only this group
    await recomputeGroup(gid, results);

    res.json({ ok:true, pickId, pts, maxPts:mx, breakdown });
  } catch (e) { console.error(e); res.status(500).json({ error:e.message }); }
}

app.post('/api/picks', picksLimiter, (req,res) => handlePicksSubmit(req,res,false));
app.put ('/api/picks', picksLimiter, (req,res) => handlePicksSubmit(req,res,true));

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

// Dashboard: groups + results in one payload (2 reads total)
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const [resultsSnap, groupsSnap] = await Promise.all([
      db.collection('ipl2026').doc('results').get(),
      db.collection('groups').get(),
    ]);
    const results = resultsSnap.exists ? resultsSnap.data() : {};
    // memberCount stored on group doc to avoid subcollection reads
    const groups = groupsSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    res.json({ results, groups });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Create group
app.post('/api/admin/group', adminAuth, async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ error:'name and code required' });
    const id = code.toUpperCase().replace(/\s/g,'').slice(0,8);
    await db.collection('groups').doc(id).set({
      name, id, locked:false, leaderboard:[], memberCount:0,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok:true, id });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Delete entire group + all picks (batched)
app.delete('/api/admin/group/:groupId', adminAuth, async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const groupRef = db.collection('groups').doc(gid);
    // Delete all picks first
    const picksSnap = await groupRef.collection('picks').get();
    const batch = db.batch();
    picksSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(groupRef);
    await batch.commit();
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Lock / unlock
app.post('/api/admin/group/:groupId/lock', adminAuth, async (req, res) => {
  try {
    const locked = req.body.locked !== false;
    await db.collection('groups').doc(req.params.groupId.toUpperCase()).update({ locked });
    res.json({ ok:true, locked });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// List picks in a group
app.get('/api/admin/group/:groupId/picks', adminAuth, async (req, res) => {
  try {
    const gid  = req.params.groupId.toUpperCase();
    const snap = await db.collection('groups').doc(gid).collection('picks').get();
    res.json({ ok:true, picks: snap.docs.map(d => ({ pickId:d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Delete one bracket
app.delete('/api/admin/group/:groupId/picks/:pickId', adminAuth, async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const ref = db.collection('groups').doc(gid).collection('picks').doc(req.params.pickId);
    await ref.delete();
    // Decrement atomically — no need to re-fetch all picks just to count
    await db.collection('groups').doc(gid).update({ memberCount: admin.firestore.FieldValue.increment(-1) });
    const results = await getResults();
    await recomputeGroup(gid, results);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Manual score/result override — also accepts pointOverrides:{pickId: pts} for direct corrections
app.post('/api/admin/result', adminAuth, async (req, res) => {
  try {
    const { matchId, winner, semis, champion, pointOverrides } = req.body;
    const ref  = db.collection('ipl2026').doc('results');
    const snap = await ref.get();
    const cur  = snap.exists ? snap.data() : { matches:{} };

    const update = { matches:{ ...cur.matches } };
    if (matchId && winner) update.matches[String(matchId)] = winner;
    if (semis)    update.semis    = semis;
    if (champion) update.champion = champion;
    update.lastSynced    = new Date().toISOString();
    update.manualOverride = true;

    await ref.set(update, { merge:true });
    invalidateResultsCache();
    const results = await getResults();

    // Optional: directly set pts on specific picks (admin override)
    if (pointOverrides && typeof pointOverrides === 'object') {
      const batch = db.batch();
      for (const [pickId, pts] of Object.entries(pointOverrides)) {
        // pickId format: GROUPID__slug
        const gid = pickId.split('__')[0];
        const pRef = db.collection('groups').doc(gid).collection('picks').doc(pickId);
        batch.update(pRef, { adminPtsOverride: Number(pts) });
      }
      await batch.commit();
    }

    await recomputeAllGroups(results);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Force sync
app.post('/api/admin/sync', adminAuth, async (req, res) => {
  try {
    invalidateResultsCache();
    const result = await syncResults();
    res.json(result);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ─── CRON ────────────────────────────────────────────────────────────────────
const mins = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30');
if (process.env.NODE_ENV !== 'test') {
  cron.schedule(`*/${mins} * * * *`, async () => {
    try { invalidateResultsCache(); await syncResults(); }
    catch (e) { console.error('Cron sync failed:', e.message); }
  });
}

app.listen(PORT, () => {
  console.log(`\n🏏 IPL Madness 2K26 → http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'test') setTimeout(() => { invalidateResultsCache(); syncResults(); }, 3000);
});