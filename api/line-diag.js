'use strict';
/**
 * GET /api/line-diag
 *   Diagnoses the LINE bot configuration end-to-end.
 *
 * GET /api/line-diag?fix=webhook&url=https://...  → set the webhook URL.
 * GET /api/line-diag?push=USERID                  → push a test message to
 *   a specific LINE userId (proves the reply/messaging path works).
 */

const { google } = require('googleapis');
const LINE = 'https://api.line.me/v2/bot';

// Read the LineStates sheet to learn whether real users have ever reached
// the webhook (the bot writes a row per user it has processed).
async function readLineStates() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID, range: 'LineStates!A:D'
    });
    const rows = r.data.values || [];
    if (rows.length < 2) return { users: 0, lastSeen: null, sampleUserId: null };
    const h = rows[0];
    const ui = h.indexOf('userId'), ti = h.indexOf('updatedAt');
    const body = rows.slice(1).filter(x => x[ui]);
    const last = body.map(x => x[ti]).filter(Boolean).sort().pop() || null;
    return { users: body.length, lastSeen: last, sampleUserId: body.length ? body[body.length-1][ui] : null };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function lineGET(path, token) {
  try {
    const r = await fetch(`${LINE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  } catch (e) { return { status: 0, data: String(e.message || e) }; }
}
async function linePOST(path, token, body) {
  try {
    const r = await fetch(`${LINE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  } catch (e) { return { status: 0, data: String(e.message || e) }; }
}
async function linePUT(path, token, body) {
  try {
    const r = await fetch(`${LINE}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  } catch (e) { return { status: 0, data: String(e.message || e) }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  // env presence (don't leak values)
  const env = {
    LINE_CHANNEL_ACCESS_TOKEN: token ? `set (${token.length} chars)` : '❌ MISSING',
    LINE_CHANNEL_SECRET:       process.env.LINE_CHANNEL_SECRET ? 'set' : '❌ MISSING (ok — signature check is skipped)',
    SHEET_ID:                  process.env.SHEET_ID ? 'set' : '❌ MISSING',
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'set' : '❌ MISSING'
  };

  if (!token) return res.status(200).json({ ok: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN missing', env });

  // Optional fix: (re)register the webhook URL
  if (req.query.fix === 'webhook' && req.query.url) {
    const put = await linePUT('/channel/webhook/endpoint', token, { endpoint: req.query.url });
    const test = await linePOST('/channel/webhook/test', token, { endpoint: req.query.url });
    return res.status(200).json({ action: 'set-webhook', url: req.query.url, put, test });
  }

  // Optional: push a test message to a userId (proves the reply path works).
  if (req.query.push) {
    const push = await linePOST('/message/push', token, {
      to: String(req.query.push),
      messages: [{ type: 'text', text: '✅ ทดสอบจาก SuperWealth — ถ้าเห็นข้อความนี้ แปลว่าบอทส่งข้อความได้ปกติ' }]
    });
    return res.status(200).json({ action: 'push-test', to: req.query.push, push });
  }

  const [info, endpoint, quota] = await Promise.all([
    lineGET('/info', token),
    lineGET('/channel/webhook/endpoint', token),
    lineGET('/message/quota', token)
  ]);

  // Test delivery to whatever endpoint is registered
  const webhookTest = await linePOST('/channel/webhook/test', token, null);

  // Have any real users ever reached the webhook?
  const lineStates = await readLineStates();

  // Build a plain-language verdict
  const verdict = [];
  if (info.status !== 200) verdict.push('❌ token ใช้ไม่ได้ (GET /info ' + info.status + ')');
  else verdict.push('✅ token ใช้ได้');

  const ep = endpoint.data || {};
  if (endpoint.status !== 200) verdict.push('❌ อ่าน webhook endpoint ไม่ได้ (' + endpoint.status + ')');
  else if (!ep.endpoint) verdict.push('❌ ยังไม่ได้ตั้ง webhook URL ใน LINE — นี่คือสาเหตุที่บอทไม่ตอบ!');
  else {
    verdict.push('ℹ️ webhook URL = ' + ep.endpoint);
    verdict.push(ep.active ? '✅ webhook active = true' : '❌ webhook active = false (เปิด "Use webhook" ใน LINE Console)');
  }
  if (webhookTest.status === 200 && webhookTest.data) {
    const d = webhookTest.data;
    verdict.push('🔔 ทดสอบส่ง webhook: ' + (d.success ? '✅ สำเร็จ' : '❌ ล้มเหลว') +
      (d.statusCode ? ' (HTTP ' + d.statusCode + ')' : '') +
      (d.reason ? ' — ' + d.reason : ''));
  } else {
    verdict.push('⚠️ webhook test เรียกไม่ได้ (' + webhookTest.status + ')');
  }

  // Interpret LineStates: have real user messages ever arrived?
  if (lineStates.error) {
    verdict.push('⚠️ อ่าน LineStates ไม่ได้: ' + lineStates.error);
  } else if (lineStates.users > 0) {
    verdict.push('✅ มี user เคยคุยกับบอท ' + lineStates.users + ' คน (ล่าสุด ' + (lineStates.lastSeen || '?') + ') → webhook รับข้อความจริงได้ → ปัญหาอยู่ที่ "การตอบกลับ" ไม่ใช่การรับ');
  } else {
    verdict.push('❌ ไม่มี user เคยถูกบันทึกใน LineStates เลย → ข้อความจริงไม่เคยมาถึง webhook → ต้องเช็ค "โหมดการตอบกลับ/Auto-reply" ใน LINE OA Manager (manager.line.biz)');
  }

  return res.status(200).json({
    ok: true,
    env,
    verdict,
    expectedWebhookUrl: 'https://superwealth.vercel.app/api/line-webhook',
    botInfo: info.data,
    webhookEndpoint: endpoint.data,
    webhookTest: webhookTest.data,
    messageQuota: quota.data,
    lineStates,
    howToTestReply: 'เพิ่ม ?push=<LINE userId> เพื่อส่งข้อความทดสอบไปหา user นั้น'
  });
};
