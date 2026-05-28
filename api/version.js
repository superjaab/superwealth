/**
 * GET /api/version
 * Returns the current deployed app version (read from index.html APP_VERSION constant).
 * Ultra-lightweight endpoint for auto-update detection.
 * Response: { version: "v12.6", deployedAt: "2026-05-28T13:00:00Z" }
 */
const fs = require('fs');
const path = require('path');

let _cached = null;
let _cachedAt = 0;
const TTL_MS = 5_000; // re-read file every 5s

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  const now = Date.now();
  if (_cached && (now - _cachedAt) < TTL_MS) {
    return res.json(_cached);
  }

  try {
    const htmlPath = path.join(process.cwd(), 'index.html');
    const content = fs.readFileSync(htmlPath, 'utf8');
    const match = content.match(/APP_VERSION\s*=\s*['"]([\w.-]+)['"]/);
    const version = match ? match[1] : 'unknown';
    _cached = { version, deployedAt: new Date().toISOString() };
    _cachedAt = now;
    return res.json(_cached);
  } catch (e) {
    return res.status(500).json({ version: 'error', error: e.message });
  }
};
