/**
 * GET /api/gps-onetrack
 * Server-side proxy for OneTrack Smart (Onelink Technology) GPS data.
 *
 * The user never logs in from the browser — this endpoint holds the
 * credentials in env vars, logs in to OneTrack each call (no shared
 * session because Vercel serverless is stateless), then scrapes the
 * vehicle list and returns a clean JSON payload.
 *
 * Required env vars (set in Vercel dashboard → Settings → Environment):
 *   GPS_ONETRACK_USER  — login name (e.g. "hc0877717776")
 *   GPS_ONETRACK_PASS  — password
 *
 * Response: { success, configured, fetchedAt, vehicles: [
 *   { plate, driverName, lat, lng, speed, heading, status, lastUpdate, address }
 * ] }
 *
 * Cache: s-maxage=30, stale-while-revalidate=60 — one upstream login
 * per 30s no matter how many users view the page.
 */

const BASE = 'https://onetracksmart.onelink.co.th/onetrack.smart.new';

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function login(user, pass) {
  // Send the full form payload (lang + name + pass + memUser) exactly as
  // login.jsp does. Do NOT add forceLogin=true — it triggers the
  // manyConnection guard. Verified empirically against the live server.
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
  // OneTrack returns 302. Location header tells success/fail:
  //   ../login.jsp?r   → bad credentials (retry)
  //   ../main.jsp      → success
  //   ../login.jsp?status=manyConnection → too many sessions
  const location = r.headers.get('location') || '';
  if (location.includes('login.jsp')) {
    if (location.includes('manyConnection')) {
      throw new Error('OneTrack: too many active sessions — try forceLogin');
    }
    throw new Error('OneTrack: login rejected — check credentials');
  }
  // Collect both cookies (JSESSIONID + SRVGROUP)
  const cookies = [];
  // Node fetch exposes set-cookie via getSetCookie() (Node 18+) or raw header.
  if (r.headers.getSetCookie) {
    for (const c of r.headers.getSetCookie()) {
      const first = c.split(';')[0];
      if (first) cookies.push(first);
    }
  } else {
    const raw = r.headers.get('set-cookie') || '';
    for (const c of raw.split(/,(?=\s*\w+=)/)) {
      const first = c.split(';')[0].trim();
      if (first) cookies.push(first);
    }
  }
  if (!cookies.length) throw new Error('OneTrack: no session cookie returned');
  return cookies.join('; ');
}

/**
 * Try a handful of likely vehicle-list endpoints. OneTrack's app is a
 * JSP UI driven by AJAX servlets — names vary by deployment. We probe
 * the common ones and return the first that yields parseable data.
 */
async function fetchVehicles(cookie) {
  const candidates = [
    '/GetVehicleListDJ',
    '/GetVehicleAllDJ',
    '/GetVehicleStatusDJ',
    '/GetVehiclePositionDJ',
    '/CarStatusDJ',
    '/GetCarListDJ'
  ];
  const headers = {
    'Cookie': cookie,
    'Referer': `${BASE}/main.jsp`,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 SuperWealth GPS Proxy'
  };
  for (const path of candidates) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers });
      if (!r.ok) continue;
      const text = await r.text();
      // Skip HTML responses (means we got redirected to login or error page)
      if (text.trim().startsWith('<')) continue;
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      const list = Array.isArray(data) ? data : (data.rows || data.data || data.list);
      if (Array.isArray(list) && list.length) return { endpoint: path, raw: list };
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Normalize OneTrack's heterogeneous field names to a stable shape.
 * Different OneTrack deployments use different keys — try multiple.
 */
function normalize(raw) {
  return raw.map(v => {
    const pick = (...keys) => { for (const k of keys) if (v[k] != null && v[k] !== '') return v[k]; return null; };
    return {
      plate:      pick('plate', 'license', 'licensePlate', 'carNo', 'CarNo', 'vehicleNo', 'reg'),
      driverName: pick('driver', 'driverName', 'DriverName', 'driver_name'),
      lat:        Number(pick('lat', 'Lat', 'latitude', 'Latitude')) || null,
      lng:        Number(pick('lng', 'Lng', 'lon', 'Lon', 'longitude', 'Longitude')) || null,
      speed:      Number(pick('speed', 'Speed', 'velocity')) || 0,
      heading:    Number(pick('heading', 'direction', 'course', 'angle')) || 0,
      status:     pick('status', 'Status', 'state'),
      lastUpdate: pick('lastUpdate', 'lastTime', 'gpsTime', 'gps_time', 'updateTime', 'time'),
      address:    pick('address', 'Address', 'location', 'place')
    };
  });
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
      fetchedAt: new Date().toISOString(),
      vehicles: [],
      setupHelp: {
        message: 'GPS proxy not configured. Add env vars in Vercel dashboard.',
        vars: ['GPS_ONETRACK_USER', 'GPS_ONETRACK_PASS'],
        docs: 'https://vercel.com/docs/projects/environment-variables'
      }
    });
  }

  try {
    const cookie = await login(user, pass);
    const result = await fetchVehicles(cookie);
    if (!result) {
      return res.status(502).json({
        success: false,
        configured: true,
        error: 'No working vehicle endpoint found. OneTrack changed their API — endpoint names need updating.',
        triedEndpoints: 6
      });
    }
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      success: true,
      configured: true,
      fetchedAt: new Date().toISOString(),
      endpoint: result.endpoint,
      vehicles: normalize(result.raw)
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      configured: true,
      error: String(e.message || e)
    });
  }
};
