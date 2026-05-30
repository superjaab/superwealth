/**
 * GET /api/gps-auth-url?page=fsmap_realtime.htm
 *
 * Server-side OneTrack login. Returns an authenticated URL with the
 * JSESSIONID embedded — the browser can drop it into an <iframe src>
 * and see the real OneTrack page without the user ever logging in.
 *
 * Tomcat/J2EE accepts session via path-parameter form:
 *   /onetrack.smart.new/PAGE;jsessionid=ABC123
 *
 * Required env vars (Vercel → Settings → Environment Variables):
 *   GPS_ONETRACK_USER
 *   GPS_ONETRACK_PASS
 *
 * Optional ?page= query — which OneTrack page to open. Defaults to
 * the real-time fleet map. Whitelisted to prevent open redirect.
 *
 * Cache: s-maxage=600 — JSESSIONIDs typically live 30+ min, so we
 * reuse one for 10 min across all viewers. Adjust if upstream is
 * stricter (login limit / "manyConnection" guard).
 */

const BASE = 'https://onetracksmart.onelink.co.th/onetrack.smart.new';

const ALLOWED_PAGES = new Set([
  'fsmap_realtime.htm',  // real-time map (what the user wants)
  'main.jsp',            // dashboard
  'index.jsp',           // home
  'fsmap_history.htm',   // history map
  'fs_report.htm'        // reports
]);

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function login(user, pass) {
  // IMPORTANT: send the FULL form payload exactly as login.jsp does
  // (lang + name + pass + memUser). Adding forceLogin=true paradoxically
  // TRIGGERS the manyConnection guard — verified empirically. The plain
  // form payload logs in cleanly and reuses/replaces the session slot.
  const body = new URLSearchParams({ lang: 'th', name: user, pass: pass, memUser: '1' }).toString();
  const r = await fetch(`${BASE}/CheckUserPassDJ`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/login.jsp`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) SuperWealth'
    },
    body,
    redirect: 'manual'
  });
  const loc = r.headers.get('location') || '';
  if (loc.includes('login.jsp')) {
    if (loc.includes('manyConnection')) {
      throw new Error('OneTrack: มี session ค้างอยู่ (manyConnection) — ลองอีกครั้งใน 1 นาที');
    }
    throw new Error('OneTrack: login ไม่ผ่าน — เช็ค user/pass');
  }
  // Pull JSESSIONID from set-cookie header
  let jsessionid = null;
  let srvgroup = '';
  const getCookies = r.headers.getSetCookie
    ? r.headers.getSetCookie()
    : (r.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/);
  for (const c of getCookies) {
    const m = String(c).match(/JSESSIONID=([^;]+)/i);
    if (m && !jsessionid) jsessionid = m[1];
    const s = String(c).match(/SRVGROUP=([^;]+)/i);
    if (s && s[1]) srvgroup = s[1];
  }
  if (!jsessionid) throw new Error('OneTrack: ไม่ได้ JSESSIONID จากการ login');
  return { jsessionid, srvgroup };
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });

  const user = process.env.GPS_ONETRACK_USER;
  const pass = process.env.GPS_ONETRACK_PASS;
  if (!user || !pass) {
    return res.status(200).json({
      success: true,
      configured: false,
      setupHelp: {
        message: 'ตั้งค่า GPS_ONETRACK_USER + GPS_ONETRACK_PASS ใน Vercel ก่อน',
        vars: ['GPS_ONETRACK_USER', 'GPS_ONETRACK_PASS'],
        dashboard: 'https://vercel.com/superjaabs-projects/superwealth/settings/environment-variables'
      }
    });
  }

  // Lightweight config probe — report readiness WITHOUT logging in.
  // Used when the GPS tab opens so we don't burn a OneTrack session
  // (single-session account) just to decide launch-vs-setup.
  if (req.query?.check === '1') {
    return res.status(200).json({ success: true, configured: true, ready: true });
  }

  const requested = String(req.query?.page || 'fsmap_realtime.htm').trim();
  const page = ALLOWED_PAGES.has(requested) ? requested : 'fsmap_realtime.htm';

  try {
    const { jsessionid } = await login(user, pass);
    // Tomcat reads session via ;jsessionid=XYZ path parameter
    const url = `${BASE}/${page};jsessionid=${jsessionid}`;
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=30');
    return res.status(200).json({
      success: true,
      configured: true,
      url,
      page,
      jsessionidPreview: jsessionid.slice(0, 6) + '…',
      validForSeconds: 600
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      configured: true,
      error: String(e.message || e)
    });
  }
};
