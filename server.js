// server.js — local dev entry point (not used on Vercel)
'use strict';
require('dotenv').config();

const REQUIRED_ENV = ['FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','ADMIN_PASSWORD'];
const _missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (_missing.length) { console.error('❌ Missing required env vars:', _missing.join(', ')); process.exit(1); }

const express   = require('express');
const rateLimit = require('express-rate-limit');
const cors      = require('cors');
const cron      = require('node-cron');
const path      = require('path');
const crypto    = require('crypto');

const { admin, db }                       = require('./api/_lib/firebase');
const { getResults, invalidateResultsCache } = require('./api/_lib/results-cache');

// ─── Group cache (30s TTL, per-group key) ────────────────────────────────────
const _groupCache = new Map();
const GROUP_CACHE_TTL = 30_000;
function getCachedGroup(gid) {
  const entry = _groupCache.get(gid);
  if (entry && Date.now() - entry.time < GROUP_CACHE_TTL) return entry.data;
  return null;
}
function setCachedGroup(gid, data) { _groupCache.set(gid, { data, time: Date.now() }); }
function invalidateGroupCache(gid) { if (gid) _groupCache.delete(gid); else _groupCache.clear(); }
const { recomputeGroup, recomputeAllGroups } = require('./api/_lib/scoring');
const { makePickId }                         = require('./api/_lib/utils');
const { syncResults }                        = require('./api/_lib/sync');
const { MATCHES, scoreBracket, maxPossible } = require('./src/matches');

// ─── App ─────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https')
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  next();
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const picksLimiter = rateLimit({
  windowMs: 60_000, max: 15,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

function adminAuth(req, res, next) {
  const pw       = req.headers['x-admin-password'] || req.body?.adminPassword || '';
  const expected = process.env.ADMIN_PASSWORD;
  const valid    = pw.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(expected));
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/results', async (req, res) => {
  try { res.json(await getResults()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/group/:groupId/picks', async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const doc = await db.collection('groups').doc(gid).get();
    if (!doc.exists)        return res.status(404).json({ error: 'Group not found' });
    if (!doc.data().locked) return res.status(403).json({ error: 'Group is not locked' });
    const snap  = await db.collection('groups').doc(gid).collection('picks').get();
    const picks = snap.docs.map(d => {
      const { pin: _pin, ...safe } = d.data();
      return { name: safe.name, matches: safe.matches, semis: safe.semis, champion: safe.champion, finalRuns: safe.finalRuns };
    });
    res.json({ ok: true, picks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/group/:groupId', async (req, res) => {
  try {
    const gid    = req.params.groupId.toUpperCase();
    const cached = getCachedGroup(gid);
    if (cached) return res.json(cached);
    const doc  = await db.collection('groups').doc(gid).get();
    if (!doc.exists) return res.status(404).json({ error: 'Group not found' });
    const data = doc.data();
    const lb   = (data.leaderboard || []).map(e =>
      data.locked ? e : { rank: e.rank, name: e.name, pts: e.pts, maxPts: e.maxPts }
    );
    const response = { id: gid, name: data.name, locked: data.locked || false, leaderboard: lb, lastScored: data.lastScored || null };
    setCachedGroup(gid, response);
    res.json(response);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/check', async (req, res) => {
  try {
    const { name, groupId, pin } = req.query;
    if (!name || !groupId) return res.status(400).json({ error: 'name and groupId required' });
    const gid    = groupId.trim().toUpperCase();
    const pickId = makePickId(name, gid);
    const [pickSnap, groupSnap] = await Promise.all([
      db.collection('groups').doc(gid).collection('picks').doc(pickId).get(),
      db.collection('groups').doc(gid).get(),
    ]);
    const locked = groupSnap.exists ? groupSnap.data().locked : false;
    if (!pickSnap.exists) return res.json({ exists: false, pickId, locked });
    const pickData = pickSnap.data();
    if (pickData.pin) {
      if (!pin || !pin.trim())
        return res.status(401).json({ error: 'PIN required to load this bracket', pinRequired: true });
      const hashed = crypto.createHash('sha256').update(pin.trim()).digest('hex');
      if (hashed !== pickData.pin)
        return res.status(401).json({ error: 'Incorrect PIN', pinRequired: true });
    }
    const { pin: _pin, ...safeData } = pickData;
    res.json({ exists: true, pickId, locked, picks: safeData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function handlePicksSubmit(req, res, forceEdit) {
  try {
    const { name, groupId, matches, semis, champion, pin, finalRuns } = req.body;
    if (!name?.trim())    return res.status(400).json({ error: 'Name required' });
    if (!groupId?.trim()) return res.status(400).json({ error: 'Group ID required' });
    if (!matches || Object.keys(matches).length !== MATCHES.length)
      return res.status(400).json({ error: `Pick all ${MATCHES.length} matches` });
    const validMatchIds = new Set(MATCHES.map(m => String(m.id)));
    const validTeams    = new Set(MATCHES.flatMap(m => [m.t1, m.t2]));
    for (const [id, winner] of Object.entries(matches)) {
      if (!validMatchIds.has(id))   return res.status(400).json({ error: `Invalid match id: ${id}` });
      if (!validTeams.has(winner))  return res.status(400).json({ error: `Invalid winner for match ${id}: ${winner}` });
    }
    if (!semis || semis.length !== 4)         return res.status(400).json({ error: 'Pick exactly 4 semifinalists' });
    if (semis.some(t => !validTeams.has(t)))  return res.status(400).json({ error: 'Invalid semifinalist team name' });
    if (!champion || !validTeams.has(champion)) return res.status(400).json({ error: 'Invalid champion' });

    const gid      = groupId.trim().toUpperCase();
    const groupRef = db.collection('groups').doc(gid);
    const groupDoc = await groupRef.get();
    if (!groupDoc.exists)       return res.status(404).json({ error: 'Group not found' });
    if (groupDoc.data().locked) return res.status(403).json({ error: 'Group is locked' });

    const pickId   = makePickId(name, gid);
    const picksRef = groupRef.collection('picks').doc(pickId);
    const existDoc = await picksRef.get();
    if (!forceEdit && existDoc.exists)
      return res.status(409).json({ error: 'Bracket already exists for this name in this group.', pickId, canEdit: true });

    const now             = new Date().toISOString();
    const parsedFinalRuns = finalRuns != null ? parseInt(finalRuns) : null;
    if (!parsedFinalRuns || parsedFinalRuns < 1)
      return res.status(400).json({ error: 'Tiebreaker required: enter total runs in the Final' });

    const payload = {
      name: name.trim(), groupId: gid, matches, semis, champion, finalRuns: parsedFinalRuns,
      submittedAt: existDoc.exists ? existDoc.data().submittedAt : now,
      updatedAt: now,
    };
    if (pin && pin.trim()) {
      payload.pin = crypto.createHash('sha256').update(pin.trim()).digest('hex');
    } else if (existDoc.exists && existDoc.data().pin) {
      payload.pin = existDoc.data().pin;
    } else {
      return res.status(400).json({ error: 'PIN required' });
    }

    const isNew = !existDoc.exists;
    await picksRef.set(payload);
    if (isNew) await groupRef.update({ memberCount: admin.firestore.FieldValue.increment(1) });

    const results           = await getResults();
    const { pts, breakdown } = scoreBracket(payload, results);
    const mx                 = maxPossible(payload, results);
    await recomputeGroup(gid, results);
    invalidateGroupCache(gid);
    res.json({ ok: true, pickId, pts, maxPts: mx, breakdown });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
}

app.post('/api/picks', picksLimiter, (req, res) => handlePicksSubmit(req, res, false));
app.put ('/api/picks', picksLimiter, (req, res) => handlePicksSubmit(req, res, true));

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const [resultsSnap, groupsSnap] = await Promise.all([
      db.collection('ipl2026').doc('results').get(),
      db.collection('groups').get(),
    ]);
    res.json({
      results: resultsSnap.exists ? resultsSnap.data() : {},
      groups:  groupsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/group', adminAuth, async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name and code required' });
    const id = code.toUpperCase().replace(/\s/g, '').slice(0, 8);
    await db.collection('groups').doc(id).set({
      name, id, locked: false, leaderboard: [], memberCount: 0,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/group/:groupId', adminAuth, async (req, res) => {
  try {
    const gid      = req.params.groupId.toUpperCase();
    const groupRef = db.collection('groups').doc(gid);
    const picksSnap = await groupRef.collection('picks').get();
    const batch = db.batch();
    picksSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(groupRef);
    await batch.commit();
    invalidateGroupCache(gid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/group/:groupId/lock', adminAuth, async (req, res) => {
  try {
    const gid    = req.params.groupId.toUpperCase();
    const locked = req.body.locked !== false;
    await db.collection('groups').doc(gid).update({ locked });
    invalidateGroupCache(gid);
    res.json({ ok: true, locked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/group/:groupId/picks/:pickId/rename', adminAuth, async (req, res) => {
  try {
    const gid       = req.params.groupId.toUpperCase();
    const oldPickId = req.params.pickId;
    const newName   = req.body.newName?.trim();
    if (!newName) return res.status(400).json({ error: 'newName required' });

    const newPickId   = makePickId(newName, gid);
    if (newPickId === oldPickId) return res.status(400).json({ error: 'Name is the same' });

    const groupRef    = db.collection('groups').doc(gid);
    const oldRef      = groupRef.collection('picks').doc(oldPickId);
    const newRef      = groupRef.collection('picks').doc(newPickId);

    const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);
    if (!oldSnap.exists) return res.status(404).json({ error: 'Pick not found' });
    if (newSnap.exists)  return res.status(409).json({ error: `A pick already exists for "${newName}"` });

    const payload = { ...oldSnap.data(), name: newName, groupId: gid };
    await newRef.set(payload);
    await oldRef.delete();

    const results = await getResults();
    await recomputeGroup(gid, results);
    invalidateGroupCache(gid);
    res.json({ ok: true, oldPickId, newPickId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/group/:groupId/picks/:pickId/reset-pin', adminAuth, async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const ref = db.collection('groups').doc(gid).collection('picks').doc(req.params.pickId);
    await ref.update({ pin: admin.firestore.FieldValue.delete() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/group/:groupId/picks', adminAuth, async (req, res) => {
  try {
    const gid  = req.params.groupId.toUpperCase();
    const snap = await db.collection('groups').doc(gid).collection('picks').get();
    res.json({ ok: true, picks: snap.docs.map(d => ({ pickId: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/group/:groupId/picks/:pickId', adminAuth, async (req, res) => {
  try {
    const gid = req.params.groupId.toUpperCase();
    const ref = db.collection('groups').doc(gid).collection('picks').doc(req.params.pickId);
    await ref.delete();
    await db.collection('groups').doc(gid).update({ memberCount: admin.firestore.FieldValue.increment(-1) });
    const results = await getResults();
    await recomputeGroup(gid, results);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/result', adminAuth, async (req, res) => {
  try {
    const { matchId, winner, semis, champion, pointOverrides } = req.body;
    const ref  = db.collection('ipl2026').doc('results');
    const snap = await ref.get();
    const cur  = snap.exists ? snap.data() : { matches: {} };
    const update = { matches: { ...cur.matches } };
    if (matchId && winner) update.matches[String(matchId)] = winner;
    if (semis)    update.semis    = semis;
    if (champion) update.champion = champion;
    update.lastSynced = new Date().toISOString();
    update.manualOverride = true;
    await ref.set(update, { merge: true });
    invalidateResultsCache();
    const results = await getResults();
    if (pointOverrides && typeof pointOverrides === 'object') {
      const batch = db.batch();
      for (const [pickId, pts] of Object.entries(pointOverrides)) {
        const gid  = pickId.split('__')[0];
        const pRef = db.collection('groups').doc(gid).collection('picks').doc(pickId);
        batch.update(pRef, { adminPtsOverride: Number(pts) });
      }
      await batch.commit();
    }
    await recomputeAllGroups(results);
    invalidateGroupCache();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/sync', adminAuth, async (req, res) => {
  try {
    invalidateResultsCache();
    invalidateGroupCache();
    res.json(await syncResults());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
