/**
 * POST /api/login-onetrack
 * Body: { user: string, pass: string }
 * → { success, sessionId, url }  |  { success: false, error }
 *
 * ทำหน้าที่เป็น server-side proxy → POST ไปที่ OneTrack → ดึง JSESSIONID
 * แล้วฝัง ;jsessionid= ใน URL ก่อนส่งกลับ browser (ไม่ต้องใช้ cookie)
 */

const ONETRACK_BASE = 'https://onetracksmart.onelink.co.th/onetrack.smart.new';

module.exports = async function handler(req, res) {
  // ─── CORS ───
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { user, pass } = req.body || {};
  if (!user || !pass)
    return res.status(400).json({ success: false, error: 'กรุณากรอก user และ pass' });

  try {
    const response = await fetch(`${ONETRACK_BASE}/CheckUserPassDJ`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${ONETRACK_BASE}/login.jsp`
      },
      body: `name=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`,
      redirect: 'manual'
    });

    const location  = response.headers.get('location')   || '';
    const setCookie = response.headers.get('set-cookie') || '';

    if (!location)
      return res.json({ success: false, error: 'ไม่ได้รับ response จากเซิร์ฟเวอร์' });
    if (location.includes('manyConnection'))
      return res.json({ success: false, error: 'MANY_CONNECTION' });
    if (location.includes('login.jsp'))
      return res.json({ success: false, error: 'username หรือ password ไม่ถูกต้อง' });

    const sessionMatch = setCookie.match(/JSESSIONID=([^;]+)/i);
    if (!sessionMatch)
      return res.json({ success: false, error: 'ไม่ได้รับ session จากเซิร์ฟเวอร์' });

    const sessionId = sessionMatch[1];
    let dashUrl = location.replace(/^http:\/\//i, 'https://');
    if (!dashUrl.includes(';jsessionid=')) {
      const qIdx = dashUrl.indexOf('?');
      dashUrl = qIdx >= 0
        ? dashUrl.slice(0, qIdx) + ';jsessionid=' + sessionId + dashUrl.slice(qIdx)
        : dashUrl + ';jsessionid=' + sessionId;
    }

    return res.json({ success: true, sessionId, url: dashUrl });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
