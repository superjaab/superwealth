/**
 * POST /api/auth
 * Body: { action, ...params }
 *
 * Actions:
 *   login        { code, device }              → { success, sessionId, label }
 *   verify       { sessionId }                 → { valid }
 *   logout       { sessionId }                 → { success }
 *   listCodes    { sessionId }                 → { codes:[...] }
 *   addCode      { sessionId, code, label }    → { success, code }
 *   deleteCode   { sessionId, rowId }          → { success }
 *   listSessions { sessionId }                 → { sessions:[...] }
 *   revokeSession{ sessionId, target }         → { success }
 */
const { google } = require('googleapis');
const crypto = require('crypto');

// v14.23 — Admin code now comes from env var (with fallback for backward compat)
// To change: set ADMIN_CODE in Vercel/Netlify environment variables, then redeploy
const HARDCODED_ADMIN_CODE = process.env.ADMIN_CODE || '787898';
const CODES_SHEET     = 'AuthCodes';
const SESSIONS_SHEET  = 'AuthSessions';
const FAB_SHEET       = 'FabMenu';
const FAILURES_SHEET  = 'AuthFailures';  // v14.23 — track failed logins

// v14.23 — Rate limiting (in-memory per Vercel function instance)
const RATE_LIMIT_MAX_ATTEMPTS = 5;          // 5 failed attempts...
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // ...within 5 minutes
const RATE_LIMIT_BLOCK_MS  = 15 * 60 * 1000; // → block for 15 min
const FAIL_DELAY_MS = 1500;                 // Always delay 1.5s on failed login
const _failureLog = new Map(); // ip → { attempts: [timestamps], blockedUntil }

const FAB_DEFAULTS = [
  { icon: '🚚', label: 'บันทึกเที่ยวรถ', tab: 'truck',       sortOrder: 1 },
  { icon: '💰', label: 'เพิ่มรายรับ',     tab: 'income',      sortOrder: 2 },
  { icon: '💸', label: 'เพิ่มรายจ่าย',    tab: 'expense',     sortOrder: 3 },
  { icon: '🔧', label: 'ซ่อมบำรุง',       tab: 'maintenance', sortOrder: 4 },
  { icon: '⛽', label: 'เติมน้ำมัน',      tab: 'fuel',        sortOrder: 5 }
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return res.status(500).json({ success: false, error: 'Missing SHEET_ID' });

  const { action, ...params } = req.body || {};
  if (!action) return res.status(400).json({ success: false, error: 'Missing action' });

  try {
    const auth = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version: 'v4', auth });

    await ensureSheet(sheets, sheetId, CODES_SHEET,
      ['timestamp','code','label','active','rowId'], '#1d4ed8');
    await ensureSheet(sheets, sheetId, SESSIONS_SHEET,
      ['timestamp','sessionId','code','label','device','loginAt','lastSeenAt','revoked','rowId','ip'], '#7c3aed');
    await ensureSheet(sheets, sheetId, FAB_SHEET,
      ['timestamp','icon','label','tab','sortOrder','active','rowId'], '#059669');
    // Backfill missing columns (e.g. ip) for existing sheets
    await syncHeaders(sheets, sheetId, SESSIONS_SHEET,
      ['timestamp','sessionId','code','label','device','loginAt','lastSeenAt','revoked','rowId','ip']);
    // Seed FAB defaults if sheet is empty
    await seedFabDefaults(sheets, sheetId);

    // Capture IP (prefer x-forwarded-for, fallback x-real-ip / req.socket)
    const ip = getClientIp(req);

    switch (action) {
      case 'login':        return await doLogin(sheets, sheetId, params, res, ip);
      case 'verify':       return await doVerify(sheets, sheetId, params, res);
      case 'logout':       return await doLogout(sheets, sheetId, params, res);
      case 'listCodes':    return await doListCodes(sheets, sheetId, params, res);
      case 'addCode':      return await doAddCode(sheets, sheetId, params, res);
      case 'deleteCode':   return await doDeleteCode(sheets, sheetId, params, res);
      case 'listSessions': return await doListSessions(sheets, sheetId, params, res);
      case 'revokeSession':return await doRevokeSession(sheets, sheetId, params, res);
      case 'listFabItems': return await doListFabItems(sheets, sheetId, params, res);
      case 'addFabItem':   return await doAddFabItem(sheets, sheetId, params, res);
      case 'deleteFabItem':return await doDeleteFabItem(sheets, sheetId, params, res);
      case 'updateFabItem':return await doUpdateFabItem(sheets, sheetId, params, res);
      default:
        return res.status(400).json({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

// ───────── ACTIONS ─────────
async function doLogin(sheets, sheetId, { code, device, honeypot }, res, ip) {
  // v14.23 — Honeypot: a hidden form field that humans never fill but bots do
  if (honeypot) {
    await sleep(FAIL_DELAY_MS * 2);
    return res.status(429).json({ success: false, error: 'rejected' });
  }
  if (!code) return res.status(400).json({ success: false, error: 'Missing code' });

  // v14.23 — Rate limit check (per IP)
  const rl = _checkRateLimit(ip);
  if (rl.blocked) {
    const remainSec = Math.ceil((rl.blockedUntil - Date.now()) / 1000);
    return res.status(429).json({
      success: false,
      error: `ลองมากเกินไป — กรุณารอ ${remainSec} วินาที`,
      blockedUntil: rl.blockedUntil
    });
  }

  const trimmed = String(code).trim();
  let label = '';
  let valid = false;
  let isAdmin = false;
  // v14.23 — constant-time comparison for admin code to prevent timing attacks
  if (constantTimeEqual(trimmed, HARDCODED_ADMIN_CODE)) {
    valid = true;
    isAdmin = true;
    label = 'ผู้ดูแลระบบ (Built-in)';
  } else {
    const codes = await readSheet(sheets, sheetId, CODES_SHEET);
    const matched = codes.find(r => constantTimeEqual(String(r.code).trim(), trimmed) && r.active !== 'false');
    if (matched) { valid = true; label = matched.label || ''; }
  }

  if (!valid) {
    // v14.23 — Track failure + delay
    _recordFailure(ip);
    await _logFailureToSheet(sheets, sheetId, ip, String(device||''));
    await sleep(FAIL_DELAY_MS);
    return res.json({ success: false, error: 'รหัสไม่ถูกต้อง' });
  }

  // Success → clear rate limit for this IP
  _clearFailures(ip);

  const sessionId = genUuid();
  const now = new Date().toISOString();
  await appendRow(sheets, sheetId, SESSIONS_SHEET,
    [now, sessionId, trimmed, label, String(device||''), now, now, 'false', genId('SES'), String(ip||'')]);
  return res.json({ success: true, sessionId, label, isAdmin });
}

// v14.23 — Rate limiting helpers
function _checkRateLimit(ip) {
  if (!ip) return { blocked: false };
  const entry = _failureLog.get(ip);
  if (!entry) return { blocked: false };
  // Still in block window?
  if (entry.blockedUntil && entry.blockedUntil > Date.now()) {
    return { blocked: true, blockedUntil: entry.blockedUntil };
  }
  return { blocked: false };
}
function _recordFailure(ip) {
  if (!ip) return;
  const now = Date.now();
  let entry = _failureLog.get(ip);
  if (!entry) entry = { attempts: [], blockedUntil: 0 };
  // Drop old attempts outside window
  entry.attempts = entry.attempts.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  entry.attempts.push(now);
  if (entry.attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
    entry.attempts = []; // reset
  }
  _failureLog.set(ip, entry);
}
function _clearFailures(ip) {
  if (ip) _failureLog.delete(ip);
}
async function _logFailureToSheet(sheets, sheetId, ip, device) {
  try {
    await ensureSheet(sheets, sheetId, FAILURES_SHEET,
      ['timestamp','ip','device','rowId'], '#dc2626');
    const now = new Date().toISOString();
    await appendRow(sheets, sheetId, FAILURES_SHEET,
      [now, String(ip||''), String(device||''), genId('FAIL')]);
  } catch (_) { /* best-effort */ }
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still hash to prevent length leak
    crypto.createHash('sha256').update(b).digest();
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (_) { return false; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function doVerify(sheets, sheetId, { sessionId }, res) {
  if (!sessionId) return res.json({ valid: false });
  const sessions = await readSheet(sheets, sheetId, SESSIONS_SHEET);
  const s = sessions.find(r => r.sessionId === sessionId);
  if (!s) return res.json({ valid: false });
  if (String(s.revoked) === 'true') return res.json({ valid: false, revoked: true });
  const isAdmin = String(s.code).trim() === HARDCODED_ADMIN_CODE;
  // Update lastSeenAt (best-effort, ignore errors)
  try {
    const rowIdx = sessions.indexOf(s) + 2; // +1 for header, +1 for 1-based
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SESSIONS_SHEET}!G${rowIdx}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[new Date().toISOString()]] }
    });
  } catch {}
  return res.json({ valid: true, isAdmin });
}

async function doLogout(sheets, sheetId, { sessionId }, res) {
  if (!sessionId) return res.json({ success: false });
  await markSessionRevoked(sheets, sheetId, sessionId);
  return res.json({ success: true });
}

async function doListCodes(sheets, sheetId, { sessionId }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  const codes = await readSheet(sheets, sheetId, CODES_SHEET);
  // Hide actual code value — only show preview (first 2 + ••• + last 2)
  const safe = codes.map(c => ({
    rowId: c.rowId,
    label: c.label,
    codePreview: maskCode(c.code),
    code: c.code,         // full code (since admin can manage; could mask if sharing)
    active: c.active !== 'false',
    createdAt: c.timestamp
  }));
  return res.json({ success: true, codes: safe });
}

async function doAddCode(sheets, sheetId, { sessionId, code, label }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!code) return res.json({ success: false, error: 'Missing code' });
  const trimmed = String(code).trim();
  if (trimmed.length < 4) return res.json({ success: false, error: 'รหัสต้องยาวอย่างน้อย 4 หลัก' });

  // Check duplicate
  const codes = await readSheet(sheets, sheetId, CODES_SHEET);
  if (codes.some(c => String(c.code).trim() === trimmed))
    return res.json({ success: false, error: 'รหัสนี้มีอยู่แล้ว' });
  if (trimmed === HARDCODED_ADMIN_CODE)
    return res.json({ success: false, error: 'รหัสนี้สงวนไว้' });

  const now = new Date().toISOString();
  await appendRow(sheets, sheetId, CODES_SHEET,
    [now, trimmed, label || 'รหัสใหม่', 'true', genId('CODE')]);
  return res.json({ success: true, code: trimmed });
}

async function doDeleteCode(sheets, sheetId, { sessionId, rowId }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!rowId) return res.json({ success: false, error: 'Missing rowId' });

  const sheetInfo = await getSheetMeta(sheets, sheetId, CODES_SHEET);
  const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${CODES_SHEET}!A:Z`
  })).data.values || [];
  if (rows.length < 2) return res.json({ success: false, error: 'No data' });
  const headers = rows[0];
  const rowIdIdx = headers.indexOf('rowId');
  if (rowIdIdx < 0) return res.json({ success: false, error: 'No rowId column' });
  let foundIdx = -1;
  for (let i = 1; i < rows.length; i++) if (rows[i][rowIdIdx] === rowId) { foundIdx = i; break; }
  if (foundIdx < 0) return res.json({ success: false, error: 'Not found' });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      deleteDimension: {
        range: { sheetId: sheetInfo.sheetId, dimension: 'ROWS', startIndex: foundIdx, endIndex: foundIdx + 1 }
      }
    }]}
  });
  return res.json({ success: true });
}

async function doListSessions(sheets, sheetId, { sessionId }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  const sessions = await readSheet(sheets, sheetId, SESSIONS_SHEET);
  // Sort by lastSeen desc
  sessions.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  const safe = sessions.map(s => ({
    sessionId: s.sessionId,
    rowId: s.rowId,
    codePreview: maskCode(s.code),
    label: s.label,
    device: s.device,
    ip: s.ip || '',
    loginAt: s.loginAt,
    lastSeenAt: s.lastSeenAt,
    revoked: String(s.revoked) === 'true',
    isCurrent: s.sessionId === sessionId,
    isAdmin: String(s.code).trim() === HARDCODED_ADMIN_CODE
  }));
  return res.json({ success: true, sessions: safe });
}

async function doRevokeSession(sheets, sheetId, { sessionId, target }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!target) return res.json({ success: false, error: 'Missing target sessionId' });
  await markSessionRevoked(sheets, sheetId, target);
  return res.json({ success: true });
}

// ───────── FAB MENU ─────────
// Public — no auth required (everyone needs to see the FAB)
async function doListFabItems(sheets, sheetId, _params, res) {
  const items = await readSheet(sheets, sheetId, FAB_SHEET);
  const safe = items
    .filter(i => i.active !== 'false')
    .map(i => ({
      rowId: i.rowId, icon: i.icon || '➕', label: i.label || '(ไม่ระบุ)',
      tab: i.tab || 'truck',
      sortOrder: parseInt(i.sortOrder) || 0,
      active: i.active !== 'false',
      createdAt: i.timestamp
    }))
    .sort((a,b) => (a.sortOrder - b.sortOrder) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return res.json({ success: true, items: safe });
}

async function doAddFabItem(sheets, sheetId, { sessionId, icon, label, tab, sortOrder }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!label || !tab)
    return res.json({ success: false, error: 'ต้องระบุ label และ tab' });
  const now = new Date().toISOString();
  await appendRow(sheets, sheetId, FAB_SHEET,
    [now, String(icon||'➕'), String(label).trim(), String(tab).trim(),
     String(sortOrder || 99), 'true', genId('FAB')]);
  return res.json({ success: true });
}

async function doDeleteFabItem(sheets, sheetId, { sessionId, rowId }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!rowId) return res.json({ success: false, error: 'Missing rowId' });

  const sheetInfo = await getSheetMeta(sheets, sheetId, FAB_SHEET);
  const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${FAB_SHEET}!A:Z`
  })).data.values || [];
  if (rows.length < 2) return res.json({ success: false, error: 'No data' });
  const headers = rows[0];
  const rowIdIdx = headers.indexOf('rowId');
  if (rowIdIdx < 0) return res.json({ success: false, error: 'No rowId column' });
  let foundIdx = -1;
  for (let i = 1; i < rows.length; i++) if (rows[i][rowIdIdx] === rowId) { foundIdx = i; break; }
  if (foundIdx < 0) return res.json({ success: false, error: 'Not found' });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      deleteDimension: { range: { sheetId: sheetInfo.sheetId, dimension:'ROWS', startIndex: foundIdx, endIndex: foundIdx+1 } }
    }]}
  });
  return res.json({ success: true });
}

async function doUpdateFabItem(sheets, sheetId, { sessionId, rowId, icon, label, tab, sortOrder, active }, res) {
  if (!await verifyAdmin(sheets, sheetId, sessionId))
    return res.status(403).json({ success: false, error: 'Forbidden — admin only' });
  if (!rowId) return res.json({ success: false, error: 'Missing rowId' });

  const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${FAB_SHEET}!A:Z`
  })).data.values || [];
  if (rows.length < 2) return res.json({ success: false, error: 'No data' });
  const headers = rows[0];
  const rowIdIdx = headers.indexOf('rowId');
  let foundIdx = -1;
  for (let i = 1; i < rows.length; i++) if (rows[i][rowIdIdx] === rowId) { foundIdx = i; break; }
  if (foundIdx < 0) return res.json({ success: false, error: 'Not found' });

  const oldRow = rows[foundIdx];
  const newRow = headers.map((h, ci) => {
    if (h === 'icon'      && icon      !== undefined) return String(icon);
    if (h === 'label'     && label     !== undefined) return String(label);
    if (h === 'tab'       && tab       !== undefined) return String(tab);
    if (h === 'sortOrder' && sortOrder !== undefined) return String(sortOrder);
    if (h === 'active'    && active    !== undefined) return active ? 'true' : 'false';
    return oldRow[ci] || '';
  });
  const lastCol = String.fromCharCode(65 + headers.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${FAB_SHEET}!A${foundIdx+1}:${lastCol}${foundIdx+1}`,
    valueInputOption: 'RAW', requestBody: { values: [newRow] }
  });
  return res.json({ success: true });
}

async function seedFabDefaults(sheets, sheetId) {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${FAB_SHEET}!A:Z`
    });
    const rows = r.data.values || [];
    if (rows.length >= 2) return; // already has data
    const now = new Date().toISOString();
    const values = FAB_DEFAULTS.map(d => [
      now, d.icon, d.label, d.tab, String(d.sortOrder), 'true', genId('FAB')
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${FAB_SHEET}!A:A`,
      valueInputOption: 'RAW',
      requestBody: { values }
    });
  } catch (e) { console.warn('seedFabDefaults failed:', e.message); }
}

// ───────── HELPERS ─────────
async function verifyValid(sheets, sheetId, sessionId) {
  if (!sessionId) return false;
  const sessions = await readSheet(sheets, sheetId, SESSIONS_SHEET);
  const s = sessions.find(r => r.sessionId === sessionId);
  return s && String(s.revoked) !== 'true';
}
async function verifyAdmin(sheets, sheetId, sessionId) {
  if (!sessionId) return false;
  const sessions = await readSheet(sheets, sheetId, SESSIONS_SHEET);
  const s = sessions.find(r => r.sessionId === sessionId);
  if (!s || String(s.revoked) === 'true') return false;
  return String(s.code).trim() === HARDCODED_ADMIN_CODE;
}
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] ||
         req.headers['cf-connecting-ip'] ||
         (req.socket && req.socket.remoteAddress) || '';
}
async function syncHeaders(sheets, spreadsheetId, sheetName, requiredHeaders) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${sheetName}!A1:Z1`
  });
  const current = (r.data.values && r.data.values[0]) || [];
  const missing = requiredHeaders.filter(h => !current.includes(h));
  if (!missing.length) return;
  const newHeaders = [...current, ...missing];
  const lastCol = String.fromCharCode(65 + newHeaders.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${sheetName}!A1:${lastCol}1`,
    valueInputOption: 'RAW', requestBody: { values: [newHeaders] }
  });
}
async function markSessionRevoked(sheets, sheetId, sessionId) {
  const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${SESSIONS_SHEET}!A:Z`
  })).data.values || [];
  if (rows.length < 2) return;
  const headers = rows[0];
  const sidIdx = headers.indexOf('sessionId');
  const revIdx = headers.indexOf('revoked');
  if (sidIdx < 0 || revIdx < 0) return;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][sidIdx] === sessionId) {
      const colLetter = String.fromCharCode(65 + revIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId, range: `${SESSIONS_SHEET}!${colLetter}${i+1}`,
        valueInputOption: 'RAW', requestBody: { values: [['true']] }
      });
      return;
    }
  }
}
async function readSheet(sheets, sheetId, sheetName) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${sheetName}!A:Z`
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}
async function appendRow(sheets, sheetId, sheetName, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] }
  });
}
async function getSheetMeta(sheets, spreadsheetId, sheetName) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId });
  const found = ss.data.sheets.find(s => s.properties.title === sheetName);
  if (!found) throw new Error('Sheet not found: ' + sheetName);
  return { sheetId: found.properties.sheetId };
}
function maskCode(c) {
  c = String(c || '');
  if (c.length <= 2) return '••';
  if (c.length <= 4) return c.slice(0,1) + '•••';
  return c.slice(0,1) + '••••' + c.slice(-1);
}
function genUuid() {
  return 'SES-' + Date.now().toString(36) + '-' +
         Math.random().toString(36).substr(2,8) +
         Math.random().toString(36).substr(2,8);
}
function genId(prefix) {
  const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
  const d = now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  return `${prefix}-${d}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
}
function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes });
}
async function ensureSheet(sheets, spreadsheetId, sheetName, headers, hexColor) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId });
  if (ss.data.sheets.some(s => s.properties.title === sheetName)) return;
  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  });
  const sid = resp.data.replies[0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${sheetName}!A1`,
    valueInputOption: 'RAW', requestBody: { values: [headers] }
  });
  const r = parseInt(hexColor.slice(1,3),16)/255, g = parseInt(hexColor.slice(3,5),16)/255, b = parseInt(hexColor.slice(5,7),16)/255;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [
      { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: {
          backgroundColor:{red:r,green:g,blue:b},
          textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},
          horizontalAlignment:'CENTER'
        }},
        fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
      { updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount' }}
    ]}
  });
}
