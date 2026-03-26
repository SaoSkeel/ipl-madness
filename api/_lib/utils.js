'use strict';

function makePickId(name, gid) {
  return `${gid}__${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-password');
}

module.exports = { makePickId, setCors };
