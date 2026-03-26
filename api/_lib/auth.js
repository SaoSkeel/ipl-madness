'use strict';
const crypto = require('crypto');

function adminAuth(req, res) {
  const pw       = req.headers['x-admin-password'] || req.body?.adminPassword || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!pw || pw.length !== expected.length) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  const valid = crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(expected));
  if (!valid) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

module.exports = { adminAuth };
