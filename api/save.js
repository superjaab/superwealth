/**
 * POST /api/save
 * Body: { type: 'truck' | 'income' | 'expense',  data: { ...fields } }
 * → { success, rowId, message }
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON, SHEET_ID
 *
 * หมายเหตุ: Service Account ต้อง share Spreadsheet ด้วย permission "Editor"
 */

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId)
    return res.status(500).json({ success: false, error: 'Missing SHEET_ID' });

  const { type, data } = req.body || {};
  if (!type || !data)
    return res.status(400).json({ success: false, error: 'Missing type or data' });

  try {
    const auth   = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version: 'v4', auth });

    const rowId = genId(type === 'truck' ? 'TRUCK' : type === 'income' ? 'INC' : 'EXP');
    const now   = new Date().toISOString();

    let sheetName, headers, row, color;

    if (type === 'truck') {
      sheetName = 'TruckJobs';
      color     = '#1565C0';
      headers   = [
        'timestamp','jobDate','jobTime','plateNumber','driverName','driverPhone',
        'origin','destination','customerName','cargoList','cargoWeight','tripCount',
        'freightCost','jobStatus','remark','imageUrls','ocrText','userAgent','rowId'
      ];
      row = [
        now,
        data.jobDate    || '', data.jobTime     || '',
        data.plateNumber|| '', data.driverName  || '', data.driverPhone || '',
        data.origin     || '', data.destination || '', data.customerName|| '',
        data.cargoList  || '',
        Number(data.cargoWeight)  || 0,
        Number(data.tripCount)    || 1,
        Number(data.freightCost)  || 0,
        data.jobStatus  || 'รอโหลด',
        data.remark     || '',
        JSON.stringify(data.imageUrls || []),
        data.ocrText    || '', data.userAgent || '', rowId
      ];

    } else if (type === 'income') {
      sheetName = 'Income';
      color     = '#2E7D32';
      headers   = [
        'timestamp','incomeDate','incomeTime','docNumber','customerName','incomeItem',
        'amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId'
      ];
      row = [
        now,
        data.incomeDate    || '', data.incomeTime   || '', data.docNumber    || '',
        data.customerName  || '', data.incomeItem   || '',
        Number(data.amount)|| 0,
        data.paymentMethod || 'เงินสด',
        data.remark        || '',
        JSON.stringify(data.imageUrls || []),
        data.ocrText || '', data.userAgent || '', rowId
      ];

    } else if (type === 'expense') {
      sheetName = 'Expense';
      color     = '#B71C1C';
      headers   = [
        'timestamp','expenseDate','expenseTime','category','plateNumber','vendor',
        'expenseDetail','amount','paymentMethod','remark',
        'imageUrls','ocrText','userAgent','rowId'
      ];
      row = [
        now,
        data.expenseDate   || '', data.expenseTime   || '', data.category      || '',
        data.plateNumber   || '', data.vendor         || '',
        data.expenseDetail || '',
        Number(data.amount)|| 0,
        data.paymentMethod || 'เงินสด',
        data.remark        || '',
        JSON.stringify(data.imageUrls || []),
        data.ocrText || '', data.userAgent || '', rowId
      ];

    } else {
      return res.status(400).json({ success: false, error: 'Invalid type: ' + type });
    }

    // สร้าง sheet + header ถ้ายังไม่มี
    await ensureSheet(sheets, sheetId, sheetName, headers, color);

    // Append แถวข้อมูล
    await sheets.spreadsheets.values.append({
      spreadsheetId:    sheetId,
      range:            `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [row] }
    });

    const msgMap = {
      truck:   'บันทึกข้อมูลรถบรรทุกสำเร็จ',
      income:  'บันทึกรายรับสำเร็จ',
      expense: 'บันทึกรายจ่ายสำเร็จ'
    };
    return res.json({ success: true, rowId, message: msgMap[type] });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

// ─── helpers ────────────────────────────────────────────────

function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes });
}

function genId(prefix) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const d   = now.getFullYear() +
              String(now.getMonth() + 1).padStart(2, '0') +
              String(now.getDate()).padStart(2, '0');
  const r   = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}-${d}-${r}`;
}

async function ensureSheet(sheets, spreadsheetId, sheetName, headers, hexColor) {
  const ss     = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = ss.data.sheets.some(s => s.properties.title === sheetName);
  if (exists) return;

  // สร้าง sheet ใหม่
  const resp  = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  });
  const sid = resp.data.replies[0].addSheet.properties.sheetId;

  // ใส่ header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:            `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody:      { values: [headers] }
  });

  // จัดรูปแบบ header (background color + bold + freeze)
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: r, green: g, blue: b },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: 'CENTER'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        }
      ]
    }
  });
}
