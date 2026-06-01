/**
 * POST /api/upload-images  (v14.66 — Google Apps Script bridge)
 * Body: { images: [{ base64, mimeType, filename }] }
 * → { success, urls: [{ filename, url, viewUrl, id, source }] }
 *
 * STRATEGY:
 *   1. POST to Google Apps Script Web App (GAS_WEB_APP_URL env)
 *      - Script runs as the SHEET OWNER (uses their Drive quota — no SA limit!)
 *      - Code.gs::uploadImages() creates files in DRIVE_FOLDER_ID
 *      - Files are permanent + publicly viewable
 *   2. Fallback to ImgBB if GAS fails (fast CDN, may delete eventually)
 *
 * SETUP (one-time):
 *   1. Open Code.gs in Apps Script editor (attached to your Sheet)
 *   2. Deploy → New deployment → type "Web app"
 *      - Execute as: ME (your user account)
 *      - Who has access: Anyone (so Vercel can POST)
 *   3. Copy the Web App URL
 *   4. Set Vercel env: GAS_WEB_APP_URL = <that URL>
 *   5. Redeploy Vercel
 */

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif'];

async function uploadToGAS(images) {
  const url = process.env.GAS_WEB_APP_URL;
  if (!url) throw new Error('Missing GAS_WEB_APP_URL env');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'uploadImages', images }),
    redirect: 'follow'   // GAS uses 302 → final destination on first call
  });
  let json;
  try { json = await r.json(); }
  catch { throw new Error(`GAS returned non-JSON (HTTP ${r.status})`); }
  if (!json.success) throw new Error(json.error || `GAS error (HTTP ${r.status})`);
  return json.urls || [];
}

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
  return { filename: img.filename, url: json.data.url, viewUrl: json.data.url_viewer, id: json.data.id };
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

  // Filter out unsupported types first
  const validImages = [];
  const earlyResults = [];
  for (const img of images) {
    if (!ALLOWED.includes(img.mimeType)) {
      earlyResults.push({ filename: img.filename, url: '', error: 'ประเภทไฟล์ไม่รองรับ: ' + img.mimeType });
    } else {
      validImages.push(img);
    }
  }
  if (validImages.length === 0) return res.json({ success: true, urls: earlyResults });

  // 1) Try Google Apps Script (permanent — uses user's Drive)
  try {
    const urls = await uploadToGAS(validImages);
    const annotated = urls.map(u => ({ ...u, source: 'drive' }));
    return res.json({ success: true, urls: [...earlyResults, ...annotated] });
  } catch (gasErr) {
    console.warn('[upload-images] GAS failed, falling back to ImgBB:', gasErr.message);

    // 2) Fallback to ImgBB per-image
    const results = [...earlyResults];
    for (const img of validImages) {
      try {
        const r = await uploadOneToImgBB(img);
        results.push({ ...r, source: 'imgbb', gasError: gasErr.message });
      } catch (e) {
        results.push({ filename: img.filename, url: '', error: `GAS: ${gasErr.message} | ImgBB: ${e.message}` });
      }
    }
    return res.json({ success: true, urls: results });
  }
};
