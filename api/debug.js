/**
 * GET /api/debug
 * ใช้ตรวจสอบว่า env vars ถูกต้องและ Google Sheets API ทำงานได้ไหม
 */

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const result = {
    env: {
      SHEET_ID:         process.env.SHEET_ID        ? '✅ มี (' + process.env.SHEET_ID + ')' : '❌ ไม่มี',
      DRIVE_FOLDER_ID:  process.env.DRIVE_FOLDER_ID ? '✅ มี (' + process.env.DRIVE_FOLDER_ID + ')' : '❌ ไม่มี',
      OCRSPACE_API_KEY: process.env.OCRSPACE_API_KEY ? '✅ มี' : '❌ ไม่มี',
      GOOGLE_SA_JSON:   '❓',
    },
    auth:   '❓',
    sheets: '❓',
  };

  // ตรวจ JSON
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    result.env.GOOGLE_SA_JSON = '❌ ไม่มี';
    return res.json(result);
  }

  let creds;
  try {
    creds = JSON.parse(saJson);
    result.env.GOOGLE_SA_JSON = '✅ parse JSON ได้ (client_email: ' + creds.client_email + ')';
  } catch (e) {
    result.env.GOOGLE_SA_JSON = '❌ JSON ผิดรูปแบบ: ' + e.message;
    return res.json(result);
  }

  // ทดสอบ Auth
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const client = await auth.getClient();
    const token  = await client.getAccessToken();
    result.auth  = token.token ? '✅ ได้ Access Token แล้ว' : '❌ ไม่ได้ token';
  } catch (e) {
    result.auth = '❌ Auth error: ' + e.message;
    return res.json(result);
  }

  // ทดสอบ Sheets
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) { result.sheets = '❌ ไม่มี SHEET_ID'; return res.json(result); }

  try {
    const auth   = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const resp   = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'spreadsheetId,properties.title' });
    result.sheets = '✅ เข้าถึงได้: "' + resp.data.properties.title + '"';
  } catch (e) {
    result.sheets = '❌ Sheets error: ' + e.message;
  }

  return res.json(result);
};
