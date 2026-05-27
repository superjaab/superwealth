/**
 * POST /api/save
 * Body: { type, data }
 * Supports: truck | income | expense | vehicle | driver | customer | maintenance | fuel | invoice
 * → { success, rowId, message }
 */
const { google } = require('googleapis');

// ─── Sheet configs ──────────────────────────────────────────
const CONFIGS = {
  truck: {
    name: 'TruckJobs', color: '#1565C0', prefix: 'TRUCK',
    headers: ['timestamp','jobDate','jobTime','plateNumber','driverName','driverPhone',
      'origin','destination','customerName','cargoList','cargoWeight','tripCount',
      'freightCost','jobStatus','remark','imageUrls','ocrText','userAgent','rowId',
      'pickupDate','deliveryDate'],
    row: (d, now, id) => [
      now, d.jobDate||'', d.jobTime||'', d.plateNumber||'', d.driverName||'', d.driverPhone||'',
      d.origin||'', d.destination||'', d.customerName||'', d.cargoList||'',
      +d.cargoWeight||0, +d.tripCount||1, +d.freightCost||0,
      d.jobStatus||'รอโหลด', d.remark||'',
      JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id,
      d.pickupDate||'', d.deliveryDate||''
    ]
  },
  income: {
    name: 'Income', color: '#2E7D32', prefix: 'INC',
    headers: ['timestamp','incomeDate','incomeTime','docNumber','customerName',
      'incomeItem','amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId'],
    row: (d, now, id) => [
      now, d.incomeDate||'', d.incomeTime||'', d.docNumber||'', d.customerName||'',
      d.incomeItem||'', +d.amount||0, d.paymentMethod||'เงินสด',
      d.remark||'', JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id
    ]
  },
  expense: {
    name: 'Expense', color: '#B71C1C', prefix: 'EXP',
    headers: ['timestamp','expenseDate','expenseTime','category','plateNumber',
      'vendor','expenseDetail','amount','paymentMethod','remark',
      'imageUrls','ocrText','userAgent','rowId'],
    row: (d, now, id) => [
      now, d.expenseDate||'', d.expenseTime||'', d.category||'', d.plateNumber||'',
      d.vendor||'', d.expenseDetail||'', +d.amount||0, d.paymentMethod||'เงินสด',
      d.remark||'', JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id
    ]
  },
  vehicle: {
    name: 'Vehicles', color: '#0D47A1', prefix: 'VEH',
    headers: ['timestamp','plateNumber','vehicleType','brand','model','year',
      'loadCapacity','color','chassisNo','regExpiry','prbExpiry',
      'insuranceExpiry','inspectionExpiry','notes','rowId',
      'assignedDriver','assignedDriverPhone'],
    row: (d, now, id) => [
      now, d.plateNumber||'', d.vehicleType||'', d.brand||'', d.model||'',
      d.year||'', d.loadCapacity||'', d.color||'', d.chassisNo||'',
      d.regExpiry||'', d.prbExpiry||'', d.insuranceExpiry||'', d.inspectionExpiry||'',
      d.notes||'', id,
      d.assignedDriver||'', d.assignedDriverPhone||''
    ]
  },
  driver: {
    name: 'Drivers', color: '#1B5E20', prefix: 'DRV',
    headers: ['timestamp','driverName','driverPhone','idCard','licenseType',
      'licenseNumber','licenseExpiry','address','emergencyContact',
      'emergencyPhone','status','notes','rowId'],
    row: (d, now, id) => [
      now, d.driverName||'', d.driverPhone||'', d.idCard||'',
      d.licenseType||'', d.licenseNumber||'', d.licenseExpiry||'',
      d.address||'', d.emergencyContact||'', d.emergencyPhone||'',
      d.status||'ทำงาน', d.notes||'', id
    ]
  },
  customer: {
    name: 'Customers', color: '#4A148C', prefix: 'CUST',
    headers: ['timestamp','customerName','contactName','phone','email',
      'address','taxId','paymentTerms','notes','rowId','cargoItems'],
    row: (d, now, id) => [
      now, d.customerName||'', d.contactName||'', d.phone||'',
      d.email||'', d.address||'', d.taxId||'',
      d.paymentTerms||'เงินสด', d.notes||'', id, d.cargoItems||''
    ]
  },
  maintenance: {
    name: 'Maintenance', color: '#E65100', prefix: 'MNT',
    headers: ['timestamp','maintenanceDate','plateNumber','maintenanceType',
      'description','cost','vendor','odometerKm','nextDueDate',
      'notes','imageUrls','userAgent','rowId'],
    row: (d, now, id) => [
      now, d.maintenanceDate||'', d.plateNumber||'', d.maintenanceType||'',
      d.description||'', +d.cost||0, d.vendor||'', d.odometerKm||'',
      d.nextDueDate||'', d.notes||'',
      JSON.stringify(d.imageUrls||[]), d.userAgent||'', id
    ]
  },
  fuel: {
    name: 'FuelLog', color: '#F57F17', prefix: 'FUEL',
    headers: ['timestamp','fuelDate','fuelTime','plateNumber','liters',
      'pricePerLiter','totalCost','odometerKm','fuelStation',
      'paymentMethod','notes','rowId'],
    row: (d, now, id) => [
      now, d.fuelDate||'', d.fuelTime||'', d.plateNumber||'',
      +d.liters||0, +d.pricePerLiter||0, +d.totalCost||0,
      d.odometerKm||'', d.fuelStation||'', d.paymentMethod||'เงินสด',
      d.notes||'', id
    ]
  },
  invoice: {
    name: 'Invoices', color: '#006064', prefix: 'INV',
    headers: ['timestamp','invoiceDate','invoiceNumber','customerName',
      'items','subtotal','vatAmount','total','dueDate',
      'status','notes','rowId'],
    row: (d, now, id) => [
      now, d.invoiceDate||'', d.invoiceNumber||'', d.customerName||'',
      typeof d.items==='string' ? d.items : JSON.stringify(d.items||[]),
      +d.subtotal||0, +d.vatAmount||0, +d.total||0,
      d.dueDate||'', d.status||'รอชำระ', d.notes||'', id
    ]
  }
};

const MSG = {
  truck:'บันทึกข้อมูลรถบรรทุกสำเร็จ', income:'บันทึกรายรับสำเร็จ',
  expense:'บันทึกรายจ่ายสำเร็จ', vehicle:'บันทึกข้อมูลรถสำเร็จ',
  driver:'บันทึกข้อมูลคนขับสำเร็จ', customer:'บันทึกข้อมูลลูกค้าสำเร็จ',
  maintenance:'บันทึกการซ่อมบำรุงสำเร็จ', fuel:'บันทึกข้อมูลน้ำมันสำเร็จ',
  invoice:'บันทึกใบแจ้งหนี้สำเร็จ'
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

  const { type, data } = req.body || {};
  const cfg = CONFIGS[type];
  if (!type || !data || !cfg)
    return res.status(400).json({ success:false, error:'Invalid type: ' + type });

  try {
    const auth   = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version:'v4', auth });
    const rowId  = genId(cfg.prefix);
    const now    = new Date().toISOString();
    const row    = cfg.row(data, now, rowId);

    await ensureSheet(sheets, sheetId, cfg.name, cfg.headers, cfg.color);
    await syncHeaders(sheets, sheetId, cfg.name, cfg.headers);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${cfg.name}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });

    return res.json({ success:true, rowId, message: MSG[type] || 'บันทึกสำเร็จ' });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
};

// ─── helpers ─────────────────────────────────────────────────
function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials:JSON.parse(json), scopes });
}

function genId(prefix) {
  const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
  const d = now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  return `${prefix}-${d}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
}

// If current header row is missing newly-added columns, extend it.
async function syncHeaders(sheets, spreadsheetId, sheetName, expectedHeaders) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${sheetName}!1:1`
    });
    const current = (resp.data.values || [[]])[0];
    if (current.length >= expectedHeaders.length) return;
    // Extend (preserve existing headers, append missing)
    const merged = [...current];
    for (let i = current.length; i < expectedHeaders.length; i++) {
      merged.push(expectedHeaders[i]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [merged] }
    });
  } catch (e) { /* non-fatal */ }
}

async function ensureSheet(sheets, spreadsheetId, sheetName, headers, hexColor) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId });
  if (ss.data.sheets.some(s => s.properties.title === sheetName)) return;

  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody:{ requests:[{ addSheet:{ properties:{ title:sheetName } } }] }
  });
  const sid = resp.data.replies[0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId, range:`${sheetName}!A1`,
    valueInputOption:'RAW', requestBody:{ values:[headers] }
  });

  const r=parseInt(hexColor.slice(1,3),16)/255, g=parseInt(hexColor.slice(3,5),16)/255, b=parseInt(hexColor.slice(5,7),16)/255;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody:{ requests:[
      { repeatCell:{ range:{ sheetId:sid, startRowIndex:0, endRowIndex:1 },
        cell:{ userEnteredFormat:{
          backgroundColor:{red:r,green:g,blue:b},
          textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},
          horizontalAlignment:'CENTER'
        }},
        fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
      { updateSheetProperties:{ properties:{ sheetId:sid, gridProperties:{ frozenRowCount:1 } },
        fields:'gridProperties.frozenRowCount' }}
    ]}
  });
}
