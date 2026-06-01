/**
 * POST /api/upload-images  (v14.67 — Direct Drive API via OAuth user delegation)
 * Body: { images: [{ base64, mimeType, filename }] }
 * → { success, urls: [{ filename, url, viewUrl, id, source }] }
 *
 * STRATEGY:
 *   1. Use user's OAuth refresh_token → get fresh access_token
 *   2. Call Drive API directly to upload file (file owned by user, in user's folder)
 *   3. Set public-read permission
 *   4. Fallback to ImgBB if anything fails
 *
 * Required env vars:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN
 *   DRIVE_FOLDER_ID
 *   IMGBB_API_KEY (fallback)
 */

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif'];

// ─── OAuth token refresh (cache token in memory across invocations) ───
let _accessToken = null;
let _tokenExpiresAt = 0;
async function getAccessToken() {
  if (_accessToken && _tokenExpiresAt > Date.now() + 30_000) return _accessToken;
  const cid = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const csec = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!cid || !csec || !refresh) throw new Error('Missing GOOGLE_OAUTH_* env vars');

  const params = new URLSearchParams({
    client_id: cid,
    client_secret: csec,
    refresh_token: refresh,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const json = await r.json();
  if (!json.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(json));
  _accessToken = json.access_token;
  _tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return _accessToken;
}

// ─── Upload one image directly to user's Drive folder ───
async function uploadToDriveAPI(img) {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('Missing DRIVE_FOLDER_ID env');

  const token = await getAccessToken();
  const b64 = String(img.base64 || '').replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('empty buffer');

  // Build a unique filename
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = String(img.filename || 'image').replace(/[^\w\-. ก-๙]/g, '_').slice(0, 60);
  const ext = (img.mimeType || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg');
  const fileName = `${stamp}_${safe}.${ext}`;

  // Multipart upload — metadata + media in one request
  const boundary = '-------SWBOUNDARY' + Date.now();
  const metadata = { name: fileName, parents: [folderId], mimeType: img.mimeType };
  const parts = [
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + '\r\n',
    `--${boundary}\r\n` +
    `Content-Type: ${img.mimeType}\r\n\r\n`
  ];
  const body = Buffer.concat([
    Buffer.from(parts[0], 'utf8'),
    Buffer.from(parts[1], 'utf8'),
    buf,
    Buffer.from(`\r\n--${boundary}--`, 'utf8')
  ]);

  const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + boundary,
      'Content-Length': String(body.length)
    },
    body
  });
  const upJson = await upRes.json();
  if (!upRes.ok || !upJson.id) {
    throw new Error('Drive upload: ' + (upJson.error?.message || JSON.stringify(upJson)));
  }
  const fileId = upJson.id;

  // Make it public-read so <img src> can load it
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  } catch (e) { /* ignore — file still uploaded */ }

  return {
    filename: img.filename,
    url:          `https://lh3.googleusercontent.com/d/${fileId}`,
    thumbnailUrl: `https://lh3.googleusercontent.com/d/${fileId}=w800`,
    viewUrl:      `https://drive.google.com/file/d/${fileId}/view`,
    id: fileId,
    source: 'drive'
  };
}

// ─── Fallback: ImgBB ───
async function uploadOneToImgBB(img) {
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
  return { filename: img.filename, url: json.data.url, viewUrl: json.data.url_viewer, id: json.data.id, source: 'imgbb' };
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

    let driveErr = '';
    try {
      const r = await uploadToDriveAPI(img);
      results.push(r);
      continue;
    } catch (e) {
      driveErr = e.message;
      console.warn('[upload-images] Drive failed:', driveErr);
    }
    // Fallback to ImgBB
    try {
      const r = await uploadOneToImgBB(img);
      r.driveError = driveErr;
      results.push(r);
    } catch (e) {
      results.push({ filename: img.filename, url: '', error: `Drive: ${driveErr} | ImgBB: ${e.message}` });
    }
  }

  return res.json({ success: true, urls: results });
};
