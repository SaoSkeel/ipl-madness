'use strict';
const { db } = require('./firebase');

let _cache = null, _cacheTime = 0, _cachePromise = null;
const TTL = 300_000; // 5 min — safe since cron syncs every 30 min; admin overrides invalidate immediately

async function getResults() {
  const now = Date.now();
  if (_cache && now - _cacheTime < TTL) return _cache;
  if (_cachePromise) return _cachePromise;
  _cachePromise = db.collection('ipl2026').doc('results').get()
    .then(snap => {
      _cache = snap.exists ? snap.data() : { matches: {}, semis: [], champion: null };
      _cacheTime = Date.now();
      _cachePromise = null;
      return _cache;
    })
    .catch(e => { _cachePromise = null; throw e; });
  return _cachePromise;
}

function invalidateResultsCache() { _cache = null; _cacheTime = 0; }

module.exports = { getResults, invalidateResultsCache };
