/**
 * api/_logger.js — Append-only Activity Log
 * Records every create/update/delete to a dedicated "ActivityLog" sheet.
 * These rows are NEVER deleted (delete.js has no mapping for ActivityLog),
 * so even if a record is removed in the web UI, its history survives here.
 *
 * Usage (from save/update/delete handlers, after the main op succeeds):
 *   const { appendActivityLog } = require('./_logger');
 *   await appendActivityLog({ action:'create', type, rowId, data, req });
 *
 * Logging must NEVER break the main operation → everything is wrapped in try/catch.
 */
const { google } = require('googleapis');

const LOG_SHEET   = 'ActivityLog';
const LOG_HEADERS = ['timestamp', 'action', 'type', 'rowId', 'summary', 'detail', 'userAgent'];

// Thai labels for actions (human-friendly in the sheet)
const ACTION_TH = { create: '🟢 สร้าง', update: '🟡 แก้ไข', delete: '🔴 ลบ' };

function _sheetsClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// Short human-readable summary from the record's key fields
function _summary(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = [];
  if (data.plateNumber)            parts.push(String(data.plateNumber));
  if (data.tripRound)              parts.push('รอบ ' + data.tripRound);
  if (data.accountName)            parts.push(data.accountName);
  if (data.category)               parts.push(data.category);
  if (data.incomeItem)             parts.push(data.incomeItem);
  if (data.maintenanceType)        parts.push(data.maintenanceType);
  if (data.invoiceNumber)          parts.push(data.invoiceNumber);
  if (data.customerName)           parts.push(data.customerName);
  if (data.driverName && !data.plateNumber) parts.push(data.driverName);
  if (data.docNumber)              parts.push(data.docNumber);
  if (data.amount)                 parts.push('฿' + data.amount);
  if (data.currentBalance)         parts.push('฿' + data.currentBalance);
  return parts.filter(Boolean).slice(0, 5).join(' · ');
}

// Compact detail JSON (drop bulky/noisy fields so the cell stays small)
function _detail(data) {
  if (!data || typeof data !== 'object') return '';
  const clean = {};
  for (const k of Object.keys(data)) {
    if (k === 'imageUrls' || k === 'ocrText' || k === 'userAgent') continue;
    const v = data[k];
    if (v === '' || v === null || v === undefined) continue;
    clean[k] = v;
  }
  let s = '';
  try { s = JSON.stringify(clean); } catch { s = ''; }
  if (s.length > 40000) s = s.slice(0, 40000) + '…';
  return s;
}

async function _ensureLogSheet(sheets, sheetId) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  if (ss.data.sheets.some(s => s.properties.title === LOG_SHEET)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: LOG_SHEET } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${LOG_SHEET}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [LOG_HEADERS] }
  });
}

async function appendActivityLog({ action, type, rowId, data, req }) {
  try {
    const sheetId = process.env.SHEET_ID;
    if (!sheetId) return;
    const sheets = _sheetsClient();

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const ua = (req && req.headers && req.headers['user-agent']) || '';
    const row = [[
      ts,
      ACTION_TH[action] || action || '',
      type || '',
      rowId || '',
      _summary(data),
      _detail(data),
      String(ua).slice(0, 300)
    ]];

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${LOG_SHEET}!A:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: row }
      });
    } catch (e) {
      // Sheet likely missing → create with header, then retry once
      await _ensureLogSheet(sheets, sheetId);
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${LOG_SHEET}!A:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: row }
      });
    }
  } catch (e) {
    try { console.warn('[activity-log] append failed:', e.message); } catch {}
  }
}

module.exports = { appendActivityLog };
