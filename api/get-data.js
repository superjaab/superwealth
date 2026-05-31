/**
 * GET /api/get-data?type=income|expense|truck|vehicle|driver|customer|maintenance|fuel|invoice|all
 *                   &dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Returns { success, data: { [type]: [...rows] } }
 */
const { google } = require('googleapis');

const SHEET_MAP = {
  income:          { name:'Income',           dateCol:'incomeDate'      },
  expense:         { name:'Expense',          dateCol:'expenseDate'     },
  truck:           { name:'TruckJobs',        dateCol:'jobDate'         },
  vehicle:         { name:'Vehicles',         dateCol:null              },
  driver:          { name:'Drivers',          dateCol:null              },
  customer:        { name:'Customers',        dateCol:null              },
  maintenance:     { name:'Maintenance',      dateCol:'maintenanceDate' },
  fuel:            { name:'FuelLog',          dateCol:'fuelDate'        },
  invoice:         { name:'Invoices',         dateCol:'invoiceDate'     },
  capital:         { name:'Capital',          dateCol:null              },
  capitalMovement: { name:'CapitalMovements', dateCol:'movementDate'    },
  quickDefaults:   { name:'QuickDefaults',    dateCol:null              }
};

// 'all' = the three main transaction sheets (used by summary tab)
const ALL_TYPES = ['income','expense','truck'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ success:false, error:'Method not allowed' });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return res.status(500).json({ success:false, error:'Missing SHEET_ID' });

  const { type='all', dateFrom, dateTo } = req.query;
  const targets = type === 'all' ? ALL_TYPES : [type];

  if (targets.some(t => !SHEET_MAP[t]))
    return res.status(400).json({ success:false, error:'Invalid type: '+type });

  try {
    const auth = getAuth(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const sheets = google.sheets({ version:'v4', auth });

    // ─── Single batchGet — ดึงทุก range พร้อมกันใน 1 API call (เร็วกว่า 3x) ───
    const ranges = targets.map(t => `${SHEET_MAP[t].name}!A:Z`);
    const resp = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId, ranges
    });
    const valueRanges = resp.data.valueRanges || [];

    const result = {};
    targets.forEach((t, i) => {
      const { dateCol } = SHEET_MAP[t];
      const rows = (valueRanges[i] && valueRanges[i].values) || [];
      if (rows.length < 2) { result[t] = []; return; }
      const headers = rows[0];
      let data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, j) => { obj[h] = row[j] !== undefined ? row[j] : ''; });
        return obj;
      });
      if (dateCol && (dateFrom || dateTo)) {
        data = data.filter(r => {
          const d = r[dateCol] || '';
          if (dateFrom && d < dateFrom) return false;
          if (dateTo   && d > dateTo)   return false;
          return true;
        });
      }
      result[t] = data;
    });

    // Cache headers so browser/CDN won't re-fetch ทุกครั้ง (5s freshness)
    res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30');
    return res.json({ success:true, data:result });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
};

function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials:JSON.parse(json), scopes });
}
