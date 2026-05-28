/**
 * POST /api/upload-images
 * Body: { images: [{ base64, mimeType, filename }] }
 * → { success, urls: [{ filename, url, viewUrl, id }] }
 *
 * ใช้ ImgBB API (ฟรี ไม่จำกัด)
 * Env: IMGBB_API_KEY
 */

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey)
    return res.status(500).json({ success: false, error: 'Missing IMGBB_API_KEY' });

  const { images } = req.body || {};
  if (!Array.isArray(images) || images.length === 0)
    return res.json({ success: true, urls: [] });

  const results = [];

  for (const img of images) {
    if (!ALLOWED.includes(img.mimeType)) {
      results.push({ filename: img.filename, url: '', error: 'ประเภทไฟล์ไม่รองรับ: ' + img.mimeType });
      continue;
    }

    try {
      const params = new URLSearchParams({
        key:   apiKey,
        image: img.base64,
        name:  (img.filename || 'image').replace(/\.[^.]+$/, '') // ตัด extension ออก
      });

      const resp = await fetch('https://api.imgbb.com/1/upload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString()
      });

      let json;
      try { json = await resp.json(); }
      catch { json = { success:false, error:{ message:`HTTP ${resp.status} (ImgBB)` } }; }

      if (!json.success) {
        const errMsg = json.error?.message || json.error || `อัปโหลดไม่สำเร็จ (HTTP ${resp.status})`;
        console.error('ImgBB upload failed:', errMsg, 'status:', resp.status);
        results.push({ filename: img.filename, url: '', error: errMsg });
        continue;
      }

      results.push({
        filename:  img.filename,
        url:       json.data.url,          // URL แสดงรูปโดยตรง
        viewUrl:   json.data.url_viewer,   // หน้า viewer ของ ImgBB
        deleteUrl: json.data.delete_url,   // ลิงก์ลบรูป (เก็บไว้เผื่อ)
        id:        json.data.id
      });

    } catch (e) {
      results.push({ filename: img.filename, url: '', error: e.message });
    }
  }

  return res.json({ success: true, urls: results });
};
