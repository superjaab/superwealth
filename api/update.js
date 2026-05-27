/**
 * POST /api/update
 * Body: { type, rowId, data }
 * Writes by COLUMN NAME (resilient to header reordering).
 */
const { google } = require('googleapis');

// Same as save.js — each type has a `data` function returning {column: value} object.
const CONFIGS = {
  truck: {
    name: 'TruckJobs',
    data: (d, ts, id) => ({
      timestamp: ts,
      jobDate: d.jobDate||'', jobTime: d.jobTime||'',
      plateNumber: d.plateNumber||'', driverName: d.driverName||'', driverPhone: d.driverPhone||'',
      origin: d.origin||'', destination: d.destination||'',
      customerName: d.customerName||'', cargoList: d.cargoList||'',
      cargoWeight: +d.cargoWeight||0, tripCount: +d.tripCount||1, freightCost: +d.freightCost||0,
      jobStatus: d.jobStatus||'รอโหลด', remark: d.remark||'',
      imageUrls: JSON.stringify(d.imageUrls||[]), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      pickupDate: d.pickupDate||'', deliveryDate: d.deliveryDate||'',
      tripRound: +d.tripRound||0, paymentStatus: d.paymentStatus||'ค้างจ่าย'
    })
  },
  income: {
    name: 'Income',
    data: (d, ts, id) => ({
      timestamp: ts,
      incomeDate: d.incomeDate||'', incomeTime: d.incomeTime||'',
      docNumber: d.docNumber||'', customerName: d.customerName||'',
      incomeItem: d.incomeItem||'', amount: +d.amount||0,
      paymentMethod: d.paymentMethod||'เงินสด', remark: d.remark||'',
      imageUrls: JSON.stringify(d.imageUrls||[]), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      linkedTripRowId: d.linkedTripRowId||'', linkedTripRound: +d.linkedTripRound||0
    })
  },
  expense: {
    name: 'Expense',
    data: (d, ts, id) => ({
      timestamp: ts,
      expenseDate: d.expenseDate||'', expenseTime: d.expenseTime||'',
      category: d.category||'', plateNumber: d.plateNumber||'',
      vendor: d.vendor||'', expenseDetail: d.expenseDetail||'',
      amount: +d.amount||0, paymentMethod: d.paymentMethod||'เงินสด',
      remark: d.remark||'',
      imageUrls: JSON.stringify(d.imageUrls||[]), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      linkedTripRowId: d.linkedTripRowId||'', linkedTripRound: +d.linkedTripRound||0
    })
  },
  vehicle: {
    name: 'Vehicles',
    data: (d, ts, id) => ({
      timestamp: ts,
      plateNumber: d.plateNumber||'', vehicleType: d.vehicleType||'',
      brand: d.brand||'', model: d.model||'',
      year: d.year||'', loadCapacity: d.loadCapacity||'',
      color: d.color||'', chassisNo: d.chassisNo||'',
      regExpiry: d.regExpiry||'', prbExpiry: d.prbExpiry||'',
      insuranceExpiry: d.insuranceExpiry||'', inspectionExpiry: d.inspectionExpiry||'',
      notes: d.notes||'', rowId: id,
      assignedDriver: d.assignedDriver||'', assignedDriverPhone: d.assignedDriverPhone||''
    })
  },
  driver: {
    name: 'Drivers',
    data: (d, ts, id) => ({
      timestamp: ts,
      driverName: d.driverName||'', driverPhone: d.driverPhone||'',
      idCard: d.idCard||'', licenseType: d.licenseType||'',
      licenseNumber: d.licenseNumber||'', licenseExpiry: d.licenseExpiry||'',
      address: d.address||'', emergencyContact: d.emergencyContact||'',
      emergencyPhone: d.emergencyPhone||'',
      status: d.status||'ทำงาน', notes: d.notes||'', rowId: id
    })
  },
  customer: {
    name: 'Customers',
    data: (d, ts, id) => ({
      timestamp: ts,
      customerName: d.customerName||'', contactName: d.contactName||'',
      phone: d.phone||'', email: d.email||'',
      address: d.address||'', taxId: d.taxId||'',
      paymentTerms: d.paymentTerms||'เงินสด', notes: d.notes||'',
      rowId: id, cargoItems: d.cargoItems||''
    })
  },
  maintenance: {
    name: 'Maintenance',
    data: (d, ts, id) => ({
      timestamp: ts,
      maintenanceDate: d.maintenanceDate||'', plateNumber: d.plateNumber||'',
      maintenanceType: d.maintenanceType||'', description: d.description||'',
      cost: +d.cost||0, vendor: d.vendor||'',
      odometerKm: d.odometerKm||'', nextDueDate: d.nextDueDate||'',
      notes: d.notes||'',
      imageUrls: JSON.stringify(d.imageUrls||[]), userAgent: d.userAgent||'',
      rowId: id
    })
  },
  fuel: {
    name: 'FuelLog',
    data: (d, ts, id) => ({
      timestamp: ts,
      fuelDate: d.fuelDate||'', fuelTime: d.fuelTime||'',
      plateNumber: d.plateNumber||'',
      liters: +d.liters||0, pricePerLiter: +d.pricePerLiter||0, totalCost: +d.totalCost||0,
      odometerKm: d.odometerKm||'', fuelStation: d.fuelStation||'',
      paymentMethod: d.paymentMethod||'เงินสด',
      notes: d.notes||'', rowId: id
    })
  },
  invoice: {
    name: 'Invoices',
    data: (d, ts, id) => ({
      timestamp: ts,
      invoiceDate: d.invoiceDate||'', invoiceNumber: d.invoiceNumber||'',
      customerName: d.customerName||'',
      items: typeof d.items==='string' ? d.items : JSON.stringify(d.items||[]),
      subtotal: +d.subtotal||0, vatAmount: +d.vatAmount||0, total: +d.total||0,
      dueDate: d.dueDate||'', status: d.status||'รอชำระ',
      notes: d.notes||'', rowId: id
    })
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

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${cfg.name}!A:Z`
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return res.status(404).json({ success:false, error:'No data in sheet' });

    const headers  = rows[0];
    const rowIdIdx = headers.indexOf('rowId');
    if (rowIdIdx < 0) return res.status(400).json({ success:false, error:'Sheet has no rowId column' });

    const target = String(rowId || '').trim();
    let foundIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][rowIdIdx] || '').trim() === target) { foundIdx = i; break; }
    }
    if (foundIdx < 0) {
      for (let i = 1; i < rows.length; i++) {
        if ((rows[i] || []).some(v => String(v||'').trim() === target)) { foundIdx = i; break; }
      }
    }
    if (foundIdx < 0) return res.status(404).json({ success:false, error:'rowId not found: ' + target });

    // Preserve original timestamp (look up by header name, not position 0)
    const tsIdx = headers.indexOf('timestamp');
    const origTimestamp = (tsIdx >= 0 ? rows[foundIdx][tsIdx] : rows[foundIdx][0]) || new Date().toISOString();

    // Build new row by HEADER NAME (so any column order works)
    const dataObj = cfg.data(data, origTimestamp, rowId);
    const newRow = headers.map(h => {
      const v = dataObj[h];
      // If field is missing from dataObj, preserve original value to avoid wiping
      if (v === undefined) return rows[foundIdx][headers.indexOf(h)] || '';
      return v !== null ? v : '';
    });

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
