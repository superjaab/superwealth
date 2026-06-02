/**
 * POST /api/delete
 * Body: { type, rowId }
 * Finds the row matching rowId and deletes it.
 * → { success, message }
 */
const { google } = require('googleapis');

const SHEET_NAMES = {
  truck:'TruckJobs', income:'Income', expense:'Expense',
  vehicle:'Vehicles', driver:'Drivers', customer:'Customers',
  maintenance:'Maintenance', fuel:'FuelLog', invoice:'Invoices',
  capital:'Capital', capitalMovement:'CapitalMovements'  // v14.80 — was missing
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success:false, error:'Method not allowed' });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return res.status(500).json({ success:false, error:'Missing SHEET_ID' });

  const { type, rowId } = req.body || {};
  const sheetName = SHEET_NAMES[type];
  if (!sheetName) return res.status(400).json({ success:false, error:'Invalid type: ' + type });
  if (!rowId)     return res.status(400).json({ success:false, error:'Missing rowId' });

  try {
    const auth   = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version:'v4', auth });

    // Get sheet metadata (for numeric sheetId) and all rows in parallel
    const [ssResp, valsResp] = await Promise.all([
      sheets.spreadsheets.get({ spreadsheetId: sheetId }),
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!A:Z` })
    ]);

    const sheetInfo = ssResp.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheetInfo) return res.status(404).json({ success:false, error:'Sheet not found: ' + sheetName });
    const sid = sheetInfo.properties.sheetId;

    const rows = valsResp.data.values || [];
    if (rows.length < 2) return res.status(404).json({ success:false, error:'No data in sheet' });

    const headers  = rows[0];
    const rowIdIdx = headers.indexOf('rowId');
    if (rowIdIdx < 0) return res.status(400).json({ success:false, error:'Sheet has no rowId column' });

    const target = String(rowId || '').trim();
    // v15.14 — Strict lookup only by rowId column.
    // Previous fallback scanned ALL cells → could match same string in remark/notes
    // and delete the wrong row (e.g. user typed rowId-like text in remark).
    let foundIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][rowIdIdx] || '').trim() === target) { foundIdx = i; break; }
    }
    if (foundIdx < 0) return res.status(404).json({ success:false, error:'rowId not found: ' + target });

    // Delete the row (0-based; row 0 = header)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sid,
              dimension: 'ROWS',
              startIndex: foundIdx,
              endIndex: foundIdx + 1
            }
          }
        }]
      }
    });

    return res.json({ success:true, message:'ลบข้อมูลสำเร็จ' });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
};

function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials:JSON.parse(json), scopes });
}
