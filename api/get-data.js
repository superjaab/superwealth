/**
 * GET /api/get-data?type=income|expense|truck|all&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Returns { success, data: { income:[...], expense:[...], truck:[...] } }
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON, SHEET_ID
 */

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return res.status(500).json({ success: false, error: 'Missing SHEET_ID' });

  const { type = 'all', dateFrom, dateTo } = req.query;

  const sheetMap = {
    income:  { name: 'Income',    dateCol: 'incomeDate'  },
    expense: { name: 'Expense',   dateCol: 'expenseDate' },
    truck:   { name: 'TruckJobs', dateCol: 'jobDate'     }
  };

  const targets = type === 'all' ? ['income', 'expense', 'truck'] : [type];
  if (targets.some(t => !sheetMap[t]))
    return res.status(400).json({ success: false, error: 'Invalid type: ' + type });

  try {
    const auth = getAuth(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const sheets = google.sheets({ version: 'v4', auth });
    const result = {};

    for (const t of targets) {
      const { name, dateCol } = sheetMap[t];
      try {
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `${name}!A:Z`
        });
        const rows = resp.data.values || [];
        if (rows.length < 2) { result[t] = []; continue; }

        const headers = rows[0];
        let data = rows.slice(1).map(row => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
          return obj;
        });

        // กรองตามช่วงวันที่
        if (dateFrom || dateTo) {
          data = data.filter(row => {
            const d = row[dateCol] || '';
            if (dateFrom && d < dateFrom) return false;
            if (dateTo   && d > dateTo)   return false;
            return true;
          });
        }

        result[t] = data;
      } catch {
        result[t] = []; // sheet ยังไม่มี หรืออ่านไม่ได้
      }
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes });
}
