/**
 * POST /api/save
 * Body: { type, data }
 * Writes a row to Google Sheets by COLUMN NAME (resilient to header reordering).
 */
const { google } = require('googleapis');

// v14.63 — Safe imageUrls serializer: ALWAYS produces a single-encoded JSON array string
// Prevents the "\"[]\"" double-stringify bug when input is already a JSON string.
function _safeImageUrlsJson(v) {
  if (!v) return '[]';
  if (Array.isArray(v)) return JSON.stringify(v.filter(x => typeof x === 'string' && x.trim()));
  if (typeof v === 'string') {
    let s = v.trim();
    // Peel up to 3 layers of quote-wrapping
    for (let i = 0; i < 3; i++) {
      if (s.startsWith('"') && s.endsWith('"')) {
        try { const p = JSON.parse(s); if (typeof p === 'string') { s = p.trim(); continue; } } catch {}
      }
      break;
    }
    if (!s || s === '[]') return '[]';
    if (s.startsWith('[')) {
      try { const arr = JSON.parse(s); if (Array.isArray(arr)) return JSON.stringify(arr.filter(x => typeof x === 'string' && x.trim())); } catch {}
    }
    // Fallback: comma-separated
    const list = s.split(/[,;\n]/).map(x => x.trim()).filter(x => /^(https?:\/\/|data:image\/)/i.test(x));
    return JSON.stringify(list);
  }
  return '[]';
}

// v15.26 — Column that renders the uploaded image as a clickable thumbnail in the sheet.
const IMG_COL = '🖼 รูปภาพ';
// Build a Google-Sheets formula that shows the first image + links to full size.
// v15.27 — Google =IMAGE() does NOT render lh3.googleusercontent.com/d/ URLs reliably.
// Extract the Drive file ID and use drive.google.com/thumbnail?id=… which =IMAGE() supports.
function _imagePreviewFormula(imageUrls) {
  let arr = [];
  try {
    if (Array.isArray(imageUrls)) arr = imageUrls;
    else if (typeof imageUrls === 'string' && imageUrls.trim().startsWith('[')) arr = JSON.parse(imageUrls);
  } catch {}
  const first = (Array.isArray(arr) ? arr : []).find(u => typeof u === 'string' && /^https?:\/\//.test(u));
  if (!first) return '';
  // Extract Drive file ID from lh3 (/d/ID) or drive (/file/d/ID or ?id=ID) URLs
  const m = String(first).match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(first).match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) {
    const id    = m[1];
    const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
    const view  = `https://drive.google.com/file/d/${id}/view`;
    return `=HYPERLINK("${view}", IMAGE("${thumb}", 4, 96, 130))`;
  }
  // Non-Drive direct image URL (e.g. ImgBB) — use as-is
  return `=HYPERLINK("${first}", IMAGE("${first}", 4, 96, 130))`;
}

// ─── Sheet configs ──────────────────────────────────────────
// Each config returns a data OBJECT (key = column name). The save handler
// maps it to a row aligned with the sheet's ACTUAL header order.
const CONFIGS = {
  truck: {
    name: 'TruckJobs', color: '#1565C0', prefix: 'TRUCK',
    // v14.91 — added originCustomer (customer at pickup point); existing customerName = destination customer
    headers: ['timestamp','jobDate','jobTime','plateNumber','driverName','driverPhone',
      'origin','destination','originCustomer','customerName','cargoList','cargoWeight','tripCount',
      'freightCost','jobStatus','remark','imageUrls','ocrText','userAgent','rowId',
      'pickupDate','deliveryDate','tripRound','paymentStatus','🖼 รูปภาพ'],
    data: (d, now, id) => ({
      timestamp: now,
      jobDate: d.jobDate||'', jobTime: d.jobTime||'',
      plateNumber: d.plateNumber||'', driverName: d.driverName||'', driverPhone: d.driverPhone||'',
      origin: d.origin||'', destination: d.destination||'',
      originCustomer: d.originCustomer||'',  // v14.91
      customerName: d.customerName||'', cargoList: d.cargoList||'',
      cargoWeight: +d.cargoWeight||0, tripCount: +d.tripCount||1, freightCost: +d.freightCost||0,
      jobStatus: d.jobStatus||'รอโหลด', remark: d.remark||'',
      imageUrls: _safeImageUrlsJson(d.imageUrls), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      pickupDate: d.pickupDate||'', deliveryDate: d.deliveryDate||'',
      tripRound: +d.tripRound||0, paymentStatus: d.paymentStatus||'ค้างจ่าย'
    })
  },
  income: {
    name: 'Income', color: '#2E7D32', prefix: 'INC',
    headers: ['timestamp','incomeDate','incomeTime','docNumber','customerName',
      'incomeItem','amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId',
      'linkedTripRowId','linkedTripRound','🖼 รูปภาพ'],
    data: (d, now, id) => ({
      timestamp: now,
      incomeDate: d.incomeDate||'', incomeTime: d.incomeTime||'',
      docNumber: d.docNumber||'', customerName: d.customerName||'',
      incomeItem: d.incomeItem||'', amount: +d.amount||0,
      paymentMethod: d.paymentMethod||'เงินสด', remark: d.remark||'',
      imageUrls: _safeImageUrlsJson(d.imageUrls), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      linkedTripRowId: d.linkedTripRowId||'', linkedTripRound: +d.linkedTripRound||0
    })
  },
  expense: {
    name: 'Expense', color: '#B71C1C', prefix: 'EXP',
    headers: ['timestamp','expenseDate','expenseTime','docNumber','category','plateNumber',
      'vendor','expenseDetail','amount','paymentMethod','remark',
      'imageUrls','ocrText','userAgent','rowId',
      'linkedTripRowId','linkedTripRound','🖼 รูปภาพ'],
    data: (d, now, id) => ({
      timestamp: now,
      expenseDate: d.expenseDate||'', expenseTime: d.expenseTime||'',
      docNumber: d.docNumber||'',
      category: d.category||'', plateNumber: d.plateNumber||'',
      vendor: d.vendor||'', expenseDetail: d.expenseDetail||'',
      amount: +d.amount||0, paymentMethod: d.paymentMethod||'เงินสด',
      remark: d.remark||'',
      imageUrls: _safeImageUrlsJson(d.imageUrls), ocrText: d.ocrText||'', userAgent: d.userAgent||'',
      rowId: id,
      linkedTripRowId: d.linkedTripRowId||'', linkedTripRound: +d.linkedTripRound||0
    })
  },
  vehicle: {
    name: 'Vehicles', color: '#0D47A1', prefix: 'VEH',
    // v15.21 — added cargoInsuranceExpiry (ประกันภัยสินค้า)
    headers: ['timestamp','plateNumber','vehicleType','brand','model','year',
      'loadCapacity','color','chassisNo','regExpiry','prbExpiry',
      'insuranceExpiry','inspectionExpiry','notes','rowId',
      'assignedDriver','assignedDriverPhone',
      'vehicleValue','purchaseDate','cargoInsuranceExpiry'],
    data: (d, now, id) => ({
      timestamp: now,
      plateNumber: d.plateNumber||'', vehicleType: d.vehicleType||'',
      brand: d.brand||'', model: d.model||'',
      year: d.year||'', loadCapacity: d.loadCapacity||'',
      color: d.color||'', chassisNo: d.chassisNo||'',
      regExpiry: d.regExpiry||'', prbExpiry: d.prbExpiry||'',
      insuranceExpiry: d.insuranceExpiry||'', inspectionExpiry: d.inspectionExpiry||'',
      cargoInsuranceExpiry: d.cargoInsuranceExpiry||'',  // v15.21
      notes: d.notes||'', rowId: id,
      assignedDriver: d.assignedDriver||'', assignedDriverPhone: d.assignedDriverPhone||'',
      vehicleValue: +d.vehicleValue||0,
      purchaseDate: d.purchaseDate||''
    })
  },
  driver: {
    name: 'Drivers', color: '#1B5E20', prefix: 'DRV',
    headers: ['timestamp','driverName','driverPhone','idCard','licenseType',
      'licenseNumber','licenseExpiry','address','emergencyContact',
      'emergencyPhone','status','notes','rowId'],
    data: (d, now, id) => ({
      timestamp: now,
      driverName: d.driverName||'', driverPhone: d.driverPhone||'',
      idCard: d.idCard||'', licenseType: d.licenseType||'',
      licenseNumber: d.licenseNumber||'', licenseExpiry: d.licenseExpiry||'',
      address: d.address||'', emergencyContact: d.emergencyContact||'',
      emergencyPhone: d.emergencyPhone||'',
      status: d.status||'ทำงาน', notes: d.notes||'', rowId: id
    })
  },
  customer: {
    name: 'Customers', color: '#4A148C', prefix: 'CUST',
    // v14.92 — added province (used to auto-fill จังหวัดต้นทาง/ปลายทาง in truck form)
    headers: ['timestamp','customerName','contactName','phone','email',
      'address','taxId','paymentTerms','notes','rowId','cargoItems','province'],
    data: (d, now, id) => ({
      timestamp: now,
      customerName: d.customerName||'', contactName: d.contactName||'',
      phone: d.phone||'', email: d.email||'',
      address: d.address||'', taxId: d.taxId||'',
      paymentTerms: d.paymentTerms||'เงินสด', notes: d.notes||'',
      rowId: id, cargoItems: d.cargoItems||'',
      province: d.province||''  // v14.92
    })
  },
  maintenance: {
    name: 'Maintenance', color: '#E65100', prefix: 'MNT',
    headers: ['timestamp','maintenanceDate','plateNumber','maintenanceType',
      'description','cost','vendor','odometerKm','nextDueDate',
      'notes','imageUrls','userAgent','rowId','🖼 รูปภาพ'],
    data: (d, now, id) => ({
      timestamp: now,
      maintenanceDate: d.maintenanceDate||'', plateNumber: d.plateNumber||'',
      maintenanceType: d.maintenanceType||'', description: d.description||'',
      cost: +d.cost||0, vendor: d.vendor||'',
      odometerKm: d.odometerKm||'', nextDueDate: d.nextDueDate||'',
      notes: d.notes||'',
      imageUrls: _safeImageUrlsJson(d.imageUrls), userAgent: d.userAgent||'',
      rowId: id
    })
  },
  fuel: {
    name: 'FuelLog', color: '#F57F17', prefix: 'FUEL',
    headers: ['timestamp','fuelDate','fuelTime','plateNumber','liters',
      'pricePerLiter','totalCost','odometerKm','fuelStation',
      'paymentMethod','notes','rowId'],
    data: (d, now, id) => ({
      timestamp: now,
      fuelDate: d.fuelDate||'', fuelTime: d.fuelTime||'',
      plateNumber: d.plateNumber||'',
      liters: +d.liters||0, pricePerLiter: +d.pricePerLiter||0, totalCost: +d.totalCost||0,
      odometerKm: d.odometerKm||'', fuelStation: d.fuelStation||'',
      paymentMethod: d.paymentMethod||'เงินสด',
      notes: d.notes||'', rowId: id
    })
  },
  invoice: {
    name: 'Invoices', color: '#006064', prefix: 'INV',
    // v15.13 — v14.20 payment-receipt fields ถูก drop เงียบๆ ทั้ง 6 ตัว
    headers: ['timestamp','invoiceDate','invoiceNumber','customerName',
      'items','subtotal','vatAmount','total','dueDate',
      'status','notes','rowId',
      'paymentDate','payeeName','payeePlate','payeePosition','paymentMethod','bankAccount'],
    data: (d, now, id) => ({
      timestamp: now,
      invoiceDate: d.invoiceDate||'', invoiceNumber: d.invoiceNumber||'',
      customerName: d.customerName||'',
      items: typeof d.items==='string' ? d.items : JSON.stringify(d.items||[]),
      subtotal: +d.subtotal||0, vatAmount: +d.vatAmount||0, total: +d.total||0,
      dueDate: d.dueDate||'', status: d.status||'รอชำระ',
      notes: d.notes||'', rowId: id,
      paymentDate:   d.paymentDate   || '',
      payeeName:     d.payeeName     || '',
      payeePlate:    d.payeePlate    || '',
      payeePosition: d.payeePosition || '',
      paymentMethod: d.paymentMethod || '',
      bankAccount:   d.bankAccount   || ''
    })
  },
  capital: {
    name: 'Capital', color: '#7c3aed', prefix: 'CAP',
    headers: ['timestamp','accountType','accountName','bankName','accountNumber',
      'currentBalance','initialBalance','startDate','color','notes','active','rowId'],
    data: (d, now, id) => ({
      timestamp: now,
      accountType: d.accountType || 'bank',  // 'bank' | 'cash' | 'loan'
      accountName: d.accountName || '',
      bankName: d.bankName || '',
      accountNumber: d.accountNumber || '',
      currentBalance: +d.currentBalance || 0,
      initialBalance: +d.initialBalance || +d.currentBalance || 0,
      startDate: d.startDate || d.addedDate || new Date().toISOString().slice(0,10),
      color: d.color || '#3b82f6',
      notes: d.notes || '',
      active: d.active === false ? 'false' : 'true',
      rowId: id
    })
  },
  // Quick-entry defaults — one JSON blob ({truck:{...},income:{...},expense:{...}})
  // appended each save; the latest row wins (read via get-data, take the last).
  quickDefaults: {
    name: 'QuickDefaults', color: '#0EA5E9', prefix: 'QD',
    headers: ['timestamp','payload','rowId'],
    data: (d, now, id) => ({
      timestamp: now,
      payload: typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload || {}),
      rowId: id
    })
  },
  capitalMovement: {
    name: 'CapitalMovements', color: '#a855f7', prefix: 'MOV',
    headers: ['timestamp','docNumber','movementDate','accountRowId','accountName',
      'movementType','amount','note','rowId'],
    data: (d, now, id) => ({
      timestamp: now,
      docNumber: d.docNumber || '',
      movementDate: d.movementDate || new Date().toISOString().slice(0,10),
      accountRowId: d.accountRowId || '',
      accountName: d.accountName || '',
      movementType: d.movementType || 'deposit',  // deposit|withdraw|transfer|loan_in|loan_out
      amount: +d.amount || 0,
      note: d.note || '',
      rowId: id
    })
  }
};

const MSG = {
  truck:'บันทึกข้อมูลรถบรรทุกสำเร็จ', income:'บันทึกรายรับสำเร็จ',
  expense:'บันทึกรายจ่ายสำเร็จ', vehicle:'บันทึกข้อมูลรถสำเร็จ',
  driver:'บันทึกข้อมูลคนขับสำเร็จ', customer:'บันทึกข้อมูลลูกค้าสำเร็จ',
  maintenance:'บันทึกการซ่อมบำรุงสำเร็จ', fuel:'บันทึกข้อมูลน้ำมันสำเร็จ',
  invoice:'บันทึกใบเสร็จสำเร็จ',
  capital:'บันทึกบัญชีเงินทุนสำเร็จ', capitalMovement:'บันทึกการเคลื่อนไหวเงินสำเร็จ',
  quickDefaults:'บันทึกค่าลงด่วนแล้ว'
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

    await ensureSheet(sheets, sheetId, cfg.name, cfg.headers, cfg.color);

    // 1) Sync headers — ensure all expected columns exist (won't reorder existing)
    const actualHeaders = await syncHeaders(sheets, sheetId, cfg.name, cfg.headers);
    // 2) Build data OBJECT (key = column name)
    const dataObj = cfg.data(data, now, rowId);
    // v15.26 — inject clickable image-thumbnail formula if this sheet has the column
    if (actualHeaders.includes(IMG_COL)) {
      dataObj[IMG_COL] = _imagePreviewFormula(data.imageUrls);
    }
    // 3) Build row aligned with ACTUAL headers in the sheet
    const row = actualHeaders.map(h => {
      const v = dataObj[h];
      return v !== undefined && v !== null ? v : '';
    });

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

// Ensure every expected column exists in the sheet's header row (appended at the end).
// Returns the actual (now-synced) headers array.
async function syncHeaders(sheets, spreadsheetId, sheetName, expectedHeaders) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${sheetName}!1:1`
    });
    let current = (resp.data.values || [[]])[0] || [];
    // Find missing expected headers
    const missing = expectedHeaders.filter(h => !current.includes(h));
    if (missing.length > 0) {
      current = [...current, ...missing];
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [current] }
      });
    }
    return current;
  } catch (e) {
    return expectedHeaders; // fallback
  }
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
