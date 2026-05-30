'use strict';
/**
 * GET /api/line-diag
 *   Diagnoses the LINE bot configuration end-to-end so we can see WHY
 *   messages aren't getting through. Checks, via the Messaging API:
 *     1. env vars present (token, sheet, service account)
 *     2. bot info (GET /v2/bot/info) — proves the token is valid
 *     3. webhook endpoint registered + active (GET .../webhook/endpoint)
 *     4. webhook delivery test (POST .../webhook/test) — LINE pings our URL
 *     5. message quota (GET /v2/bot/message/quota) — is the bot rate-limited
 *
 * GET /api/line-diag?fix=webhook&url=https://...  → sets the webhook URL
 *   (PUT .../webhook/endpoint). Use to (re)register the webhook from here.
 */

const LINE = 'https://api.line.me/v2/bot';

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

  const [info, endpoint, quota] = await Promise.all([
    lineGET('/info', token),
    lineGET('/channel/webhook/endpoint', token),
    lineGET('/message/quota', token)
  ]);

  // Test delivery to whatever endpoint is registered
  const webhookTest = await linePOST('/channel/webhook/test', token, null);

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

  return res.status(200).json({
    ok: true,
    env,
    verdict,
    expectedWebhookUrl: 'https://superwealth.vercel.app/api/line-webhook',
    botInfo: info.data,
    webhookEndpoint: endpoint.data,
    webhookTest: webhookTest.data,
    messageQuota: quota.data
  });
};
