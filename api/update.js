/**
 * POST /api/update
 * Body: { type, rowId, data }
 * Finds the row in the sheet where 'rowId' matches and rewrites it.
 * → { success, message }
 */
const { google } = require('googleapis');

// Re-use the same CONFIGS structure as save.js
const CONFIGS = {
  truck: {
    name: 'TruckJobs',
    row: (d, ts, id) => [
      ts, d.jobDate||'', d.jobTime||'', d.plateNumber||'', d.driverName||'', d.driverPhone||'',
      d.origin||'', d.destination||'', d.customerName||'', d.cargoList||'',
      +d.cargoWeight||0, +d.tripCount||1, +d.freightCost||0,
      d.jobStatus||'รอโหลด', d.remark||'',
      JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id,
      d.pickupDate||'', d.deliveryDate||'', +d.tripRound||0, d.paymentStatus||'ค้างจ่าย'
    ]
  },
  income: {
    name: 'Income',
    row: (d, ts, id) => [
      ts, d.incomeDate||'', d.incomeTime||'', d.docNumber||'', d.customerName||'',
      d.incomeItem||'', +d.amount||0, d.paymentMethod||'เงินสด',
      d.remark||'', JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id,
      d.linkedTripRowId||'', +d.linkedTripRound||0
    ]
  },
  expense: {
    name: 'Expense',
    row: (d, ts, id) => [
      ts, d.expenseDate||'', d.expenseTime||'', d.category||'', d.plateNumber||'',
      d.vendor||'', d.expenseDetail||'', +d.amount||0, d.paymentMethod||'เงินสด',
      d.remark||'', JSON.stringify(d.imageUrls||[]), d.ocrText||'', d.userAgent||'', id
    ]
  },
  vehicle: {
    name: 'Vehicles',
    row: (d, ts, id) => [
      ts, d.plateNumber||'', d.vehicleType||'', d.brand||'', d.model||'',
      d.year||'', d.loadCapacity||'', d.color||'', d.chassisNo||'',
      d.regExpiry||'', d.prbExpiry||'', d.insuranceExpiry||'', d.inspectionExpiry||'',
      d.notes||'', id,
      d.assignedDriver||'', d.assignedDriverPhone||''
    ]
  },
  driver: {
    name: 'Drivers',
    row: (d, ts, id) => [
      ts, d.driverName||'', d.driverPhone||'', d.idCard||'',
      d.licenseType||'', d.licenseNumber||'', d.licenseExpiry||'',
      d.address||'', d.emergencyContact||'', d.emergencyPhone||'',
      d.status||'ทำงาน', d.notes||'', id
    ]
  },
  customer: {
    name: 'Customers',
    row: (d, ts, id) => [
      ts, d.customerName||'', d.contactName||'', d.phone||'',
      d.email||'', d.address||'', d.taxId||'',
      d.paymentTerms||'เงินสด', d.notes||'', id, d.cargoItems||''
    ]
  },
  maintenance: {
    name: 'Maintenance',
    row: (d, ts, id) => [
      ts, d.maintenanceDate||'', d.plateNumber||'', d.maintenanceType||'',
      d.description||'', +d.cost||0, d.vendor||'', d.odometerKm||'',
      d.nextDueDate||'', d.notes||'',
      JSON.stringify(d.imageUrls||[]), d.userAgent||'', id
    ]
  },
  fuel: {
    name: 'FuelLog',
    row: (d, ts, id) => [
      ts, d.fuelDate||'', d.fuelTime||'', d.plateNumber||'',
      +d.liters||0, +d.pricePerLiter||0, +d.totalCost||0,
      d.odometerKm||'', d.fuelStation||'', d.paymentMethod||'เงินสด',
      d.notes||'', id
    ]
  },
  invoice: {
    name: 'Invoices',
    row: (d, ts, id) => [
      ts, d.invoiceDate||'', d.invoiceNumber||'', d.customerName||'',
      typeof d.items==='string' ? d.items : JSON.stringify(d.items||[]),
      +d.subtotal||0, +d.vatAmount||0, +d.total||0,
      d.dueDate||'', d.status||'รอชำระ', d.notes||'', id
    ]
  }
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

  const { type, rowId, data } = req.body || {};
  const cfg = CONFIGS[type];
  if (!cfg)   return res.status(400).json({ success:false, error:'Invalid type: ' + type });
  if (!rowId) return res.status(400).json({ success:false, error:'Missing rowId' });
  if (!data)  return res.status(400).json({ success:false, error:'Missing data' });

  try {
    const auth   = getAuth(['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version:'v4', auth });

    // Read all rows to find the matching rowId
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${cfg.name}!A:Z`
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return res.status(404).json({ success:false, error:'No data in sheet' });

    const headers  = rows[0];
    const rowIdIdx = headers.indexOf('rowId');
    if (rowIdIdx < 0) return res.status(400).json({ success:false, error:'Sheet has no rowId column' });

    let foundIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][rowIdIdx] || '') === rowId) { foundIdx = i; break; }
    }
    if (foundIdx < 0) return res.status(404).json({ success:false, error:'rowId not found: ' + rowId });

    // Preserve original timestamp (column 0)
    const origTimestamp = rows[foundIdx][0] || new Date().toISOString();
    const newRow = cfg.row(data, origTimestamp, rowId);

    // Update — sheet is 1-based, foundIdx is 0-based (where 0 = header row)
    const sheetRowNum = foundIdx + 1;
    const lastCol = colLetter(newRow.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${cfg.name}!A${sheetRowNum}:${lastCol}${sheetRowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] }
    });

    return res.json({ success:true, message:'อัปเดตข้อมูลสำเร็จ' });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
};

function getAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({ credentials:JSON.parse(json), scopes });
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
