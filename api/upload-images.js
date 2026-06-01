/**
 * POST /api/upload-images  (v14.64 — Google Drive backup)
 * Body: { images: [{ base64, mimeType, filename }] }
 * → { success, urls: [{ filename, url, thumbnailUrl, driveFileId, error? }] }
 *
 * Upload strategy (in order):
 *   1. Try Google Drive (PERMANENT — files stay forever in user's Drive folder)
 *   2. Fallback to ImgBB if Drive fails (fast CDN, but may delete images later)
 *
 * Required env vars:
 *   - GOOGLE_SERVICE_ACCOUNT_JSON  (already used for Sheets)
 *   - DRIVE_FOLDER_ID              (target folder)
 *   - IMGBB_API_KEY                (optional fallback)
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif'];

let _driveClient = null;
function getDrive() {
  if (_driveClient) return _driveClient;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(json),
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    _driveClient = google.drive({ version: 'v3', auth });
    return _driveClient;
  } catch (e) {
    console.error('[upload-images] Drive auth failed:', e.message);
    return null;
  }
}

/**
 * Upload one image to Google Drive, make it publicly viewable.
 * Returns { url, thumbnailUrl, driveFileId }.
 */
async function uploadToDrive(img) {
  const drive = getDrive();
  if (!drive) throw new Error('Drive not configured (missing GOOGLE_SERVICE_ACCOUNT_JSON)');
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('Missing DRIVE_FOLDER_ID env');

  // Decode base64 → Buffer
  const b64 = String(img.base64 || '').replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('empty image buffer');

  // Build a unique filename
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const ext = (img.mimeType || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg');
  const safeName = String(img.filename || 'image').replace(/[^\w\-. ก-๙]/g, '_').slice(0, 60);
  const fileName = `${stamp}_${safeName}.${ext}`;

  // Create file
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId], mimeType: img.mimeType },
    media: { mimeType: img.mimeType, body: Readable.from(buf) },
    fields: 'id, name, webViewLink, webContentLink, thumbnailLink'
  });
  const fileId = file.data.id;

  // Make publicly readable so <img src> can load it
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' }
  });

  // CDN-fast direct image URL (Google's image CDN)
  const directUrl    = `https://lh3.googleusercontent.com/d/${fileId}`;
  const thumbnailUrl = `https://lh3.googleusercontent.com/d/${fileId}=w800`;

  return { url: directUrl, thumbnailUrl, driveFileId: fileId };
}

/**
 * Fallback: ImgBB upload (kept for resilience, but Drive is primary).
 */
async function uploadToImgBB(img) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error('Missing IMGBB_API_KEY');
  const params = new URLSearchParams({
    key:   apiKey,
    image: img.base64,
    name:  (img.filename || 'image').replace(/\.[^.]+$/, '')
  });
  const resp = await fetch('https://api.imgbb.com/1/upload', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString()
  });
  let json;
  try { json = await resp.json(); }
  catch { throw new Error(`ImgBB HTTP ${resp.status} (non-JSON)`); }
  if (!json.success) throw new Error(json.error?.message || `ImgBB error (HTTP ${resp.status})`);
  return { url: json.data.url, thumbnailUrl: json.data.url, driveFileId: null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { images } = req.body || {};
  if (!Array.isArray(images) || images.length === 0)
    return res.json({ success: true, urls: [] });

  const results = [];

  for (const img of images) {
    if (!ALLOWED.includes(img.mimeType)) {
      results.push({ filename: img.filename, url: '', error: 'ประเภทไฟล์ไม่รองรับ: ' + img.mimeType });
      continue;
    }

    let stored = null;
    let lastErr = '';

    // 1) Try Drive first (permanent)
    try {
      stored = await uploadToDrive(img);
      stored.source = 'drive';
    } catch (e) {
      lastErr = '[Drive] ' + e.message;
      console.warn('[upload-images] Drive failed, trying ImgBB:', e.message);
    }

    // 2) Fallback to ImgBB
    if (!stored) {
      try {
        stored = await uploadToImgBB(img);
        stored.source = 'imgbb';
      } catch (e) {
        lastErr += ' | [ImgBB] ' + e.message;
      }
    }

    if (stored) {
      results.push({
        filename:     img.filename,
        url:          stored.url,
        thumbnailUrl: stored.thumbnailUrl || stored.url,
        driveFileId:  stored.driveFileId || null,
        source:       stored.source
      });
    } else {
      results.push({ filename: img.filename, url: '', error: lastErr });
    }
  }

  return res.json({ success: true, urls: results });
};
