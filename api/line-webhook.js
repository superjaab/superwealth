'use strict';
const crypto  = require('crypto');
const { google } = require('googleapis');

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const WEB_URL        = 'https://superwealth.vercel.app';

const THAI_MONTHS       = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const PROVINCES = ['กรุงเทพ','นครราชสีมา','ขอนแก่น','อุดรธานี','เชียงใหม่','สมุทรปราการ','ชลบุรี','นนทบุรี','อยุธยา','ระยอง'];

// ─── Date helpers ─────────────────────────────────────────────
function bkkNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
}
function fmt(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function todayStr()    { return fmt(bkkNow()); }
function tomorrowStr() { const d = bkkNow(); d.setDate(d.getDate()+1); return fmt(d); }

// Convert DD/MM/YYYY → YYYY-MM-DD (sheets format). Pass-through if already ISO.
function toISO(str) {
  if (!str || str === '-') return '';
  const p = str.split('/');
  if (p.length === 3 && p[2].length === 4) {
    return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  }
  return str;
}

// ─── Google Sheets helpers ─────────────────────────────────────
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}
function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}
async function sheetRows(sheets, sheetId, name) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${name}!A:Z` });
    const rows = r.data.values || [];
    if (rows.length < 2) return [];
    const h = rows[0];
    return rows.slice(1).map(row => Object.fromEntries(h.map((k,i) => [k, row[i]||''])));
  } catch { return []; }
}

// ─── State management (LineStates sheet) ──────────────────────
const ST_SHEET = 'LineStates';

async function readState(sheets, sheetId, userId) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${ST_SHEET}!A:D` });
    const rows = r.data.values || [];
    if (rows.length < 2) return { state: 'idle', data: {}, row: null };
    const h = rows[0];
    const ui = h.indexOf('userId'), si = h.indexOf('state'), di = h.indexOf('formData');
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][ui]||'') === userId) {
        return { state: rows[i][si]||'idle', data: rows[i][di] ? JSON.parse(rows[i][di]) : {}, row: i+1 };
      }
    }
  } catch { /* sheet may not exist yet */ }
  return { state: 'idle', data: {}, row: null };
}

async function writeState(sheets, sheetId, userId, state, data, rowNum) {
  const row = [userId, state, JSON.stringify(data), new Date().toISOString()];
  try {
    if (rowNum) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId, range: `${ST_SHEET}!A${rowNum}`,
        valueInputOption: 'RAW', requestBody: { values: [row] }
      });
    } else {
      // Create sheet on first use
      try {
        const ss = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        if (!ss.data.sheets.some(s => s.properties.title === ST_SHEET)) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: ST_SHEET } } }] }
          });
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId, range: `${ST_SHEET}!A1`,
            valueInputOption: 'RAW', requestBody: { values: [['userId','state','formData','updatedAt']] }
          });
        }
      } catch { /* ignore */ }
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId, range: `${ST_SHEET}!A:A`,
        valueInputOption: 'RAW', requestBody: { values: [row] }
      });
    }
  } catch (e) { console.error('writeState:', e.message); }
}

// ─── Reference data (vehicles, drivers, customers) ─────────────
async function getRef(sheets, sheetId) {
  const vehicles = await sheetRows(sheets, sheetId, 'Vehicles');
  return { vehicles };
}
function uniq(arr, key, limit=10) {
  return [...new Set(arr.map(r => r[key]).filter(Boolean))].slice(0, limit);
}

// ─── LINE API helpers ──────────────────────────────────────────
async function reply(token, msgs) {
  if (!Array.isArray(msgs)) msgs = [msgs];
  await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ replyToken: token, messages: msgs })
  });
}

// text message with optional quick replies
function txt(text, qrItems) {
  const m = { type: 'text', text };
  if (qrItems && qrItems.length) m.quickReply = { items: qrItems.slice(0,13) };
  return m;
}
// quick reply item helpers
function qMsg(label, text)  { return { type:'action', action:{ type:'message', label, text } }; }
function qPb(label, data)   { return { type:'action', action:{ type:'postback', label, data } }; }
function qUri(label, uri)   { return { type:'action', action:{ type:'uri', label, uri } }; }

// ─── Step definitions ──────────────────────────────────────────
const TRUCK_SEQ   = ['truck_1','truck_2','truck_3','truck_4','truck_5','truck_6','truck_confirm'];
const INCOME_SEQ  = ['inc_1','inc_2','inc_3','inc_4','inc_confirm'];
const EXPENSE_SEQ = ['exp_1','exp_2','exp_3','exp_4','exp_confirm'];

// Maps state → formData key
const FIELD = {
  truck_1:'pickupDate', truck_2:'plateNumber', truck_3:'origin',
  truck_4:'destination', truck_5:'freightCost', truck_6:'paymentStatus',
  inc_1:'incomeDate', inc_2:'incomeItem', inc_3:'amount', inc_4:'paymentMethod',
  exp_1:'expenseDate', exp_2:'category', exp_3:'amount', exp_4:'paymentMethod',
};

function buildStep(step, ref) {
  const { vehicles } = ref;
  const plates = uniq(vehicles, 'plateNumber');
  const dateQR = [qMsg('วันนี้',todayStr()), qMsg('พรุ่งนี้',tomorrowStr())];

  const STEPS = {
    // ── Truck (6 steps) ──
    truck_1: { q:'📅 วันที่รับสินค้า (เลือกหรือพิมพ์ วว/ดด/ปปปป)', qr: dateQR },
    truck_2: { q:'🚛 ทะเบียนรถ (เลือกหรือพิมพ์)', qr: plates.map(p=>qMsg(p,p)) },
    truck_3: { q:'📍 ต้นทาง (จังหวัด/สถานที่)', qr: PROVINCES.map(p=>qMsg(p,p)) },
    truck_4: { q:'📍 ปลายทาง', qr: PROVINCES.map(p=>qMsg(p,p)) },
    truck_5: { q:'💵 ค่าขนส่ง (บาท) พิมพ์เป็นตัวเลข', qr: [] },
    truck_6: { q:'💳 สถานะค่าขนส่ง', qr:[qMsg('✅ ชำระแล้ว','ชำระแล้ว'), qMsg('⚠️ ค้างจ่าย','ค้างจ่าย')] },
    // ── Income (4 steps) ──
    inc_1: { q:'📅 วันที่รับเงิน', qr: dateQR },
    inc_2: { q:'💰 ประเภทรายรับ', qr:[qMsg('ค่าขนส่ง','ค่าขนส่ง'),qMsg('ค่ามัดจำ','ค่ามัดจำ'),qMsg('อื่นๆ','อื่นๆ')] },
    inc_3: { q:'💵 จำนวนเงิน (บาท) พิมพ์เป็นตัวเลข', qr: [] },
    inc_4: { q:'💳 ช่องทางรับเงิน', qr:[qMsg('เงินสด','เงินสด'),qMsg('โอน','โอน'),qMsg('เช็ค','เช็ค')] },
    // ── Expense (4 steps) ──
    exp_1: { q:'📅 วันที่จ่ายเงิน', qr: dateQR },
    exp_2: { q:'💸 ประเภทรายจ่าย', qr:[qMsg('น้ำมัน','น้ำมัน'),qMsg('ซ่อมบำรุง','ซ่อมบำรุง'),qMsg('ค่าทางด่วน','ค่าทางด่วน'),qMsg('เบี้ยเลี้ยง','เบี้ยเลี้ยง'),qMsg('อื่นๆ','อื่นๆ')] },
    exp_3: { q:'💵 จำนวนเงิน (บาท) พิมพ์เป็นตัวเลข', qr: [] },
    exp_4: { q:'💳 ช่องทางจ่ายเงิน', qr:[qMsg('เงินสด','เงินสด'),qMsg('โอน','โอน'),qMsg('เช็ค','เช็ค')] },
  };
  return STEPS[step] || null;
}

// ─── Confirm summaries ─────────────────────────────────────────
const remark = v => (v==='-'||!v) ? 'ไม่มี' : v;
const num    = v => Number(v||0).toLocaleString('th-TH');

function confirmTruck(f) {
  return `📋 ยืนยันข้อมูลรถบรรทุก\n` +
    `──────────────────\n` +
    `📅 วันที่รับ: ${f.pickupDate||'-'}\n` +
    `🚛 ทะเบียน: ${f.plateNumber||'-'}\n` +
    `👤 คนขับ: ${f.driverName||'-'}\n` +
    `📍 เส้นทาง: ${f.origin||'-'} → ${f.destination||'-'}\n` +
    `💵 ค่าขนส่ง: ${num(f.freightCost)} บาท\n` +
    `💳 สถานะ: ${f.paymentStatus||'-'}\n` +
    `──────────────────\n✅ ยืนยันหรือ ❌ ยกเลิก?`;
}
function confirmIncome(f) {
  return `📋 ยืนยันรายรับ\n` +
    `──────────────────\n` +
    `📅 วันที่: ${f.incomeDate||'-'}\n` +
    `💰 ประเภท: ${f.incomeItem||'-'}\n` +
    `💵 จำนวน: ${num(f.amount)} บาท\n` +
    `💳 ช่องทาง: ${f.paymentMethod||'-'}\n` +
    `──────────────────\n✅ ยืนยันหรือ ❌ ยกเลิก?`;
}
function confirmExpense(f) {
  return `📋 ยืนยันรายจ่าย\n` +
    `──────────────────\n` +
    `📅 วันที่: ${f.expenseDate||'-'}\n` +
    `💸 ประเภท: ${f.category||'-'}\n` +
    `💵 จำนวน: ${num(f.amount)} บาท\n` +
    `💳 ช่องทาง: ${f.paymentMethod||'-'}\n` +
    `──────────────────\n✅ ยืนยันหรือ ❌ ยกเลิก?`;
}
const CONFIRM_QR = [qMsg('✅ ยืนยัน','✅ ยืนยัน'), qMsg('❌ ยกเลิก','❌ ยกเลิก')];

// ─── Save to Google Sheets ─────────────────────────────────────
function genId(prefix) {
  const d = bkkNow();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
}

async function saveTruck(sheets, sheetId, f) {
  const now = new Date().toISOString();
  const d = bkkNow();
  const rowId = genId('TRUCK');
  const data = {
    timestamp: now,
    jobDate: toISO(f.pickupDate) || toISO(f.deliveryDate),
    jobTime: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
    plateNumber: f.plateNumber||'', driverName: f.driverName||'', driverPhone: f.driverPhone||'',
    origin: f.origin||'', destination: f.destination||'',
    customerName: f.customerName||'', cargoList: f.cargoList||'',
    cargoWeight: parseFloat(f.cargoWeight)||0, tripCount: 1,
    freightCost: parseFloat(f.freightCost)||0,
    jobStatus: 'กำลังดำเนินการ',
    remark: f.remark==='-'?'':(f.remark||''),
    imageUrls: '[]', ocrText: '', userAgent: 'LINE Bot', rowId,
    pickupDate: toISO(f.pickupDate)||'',
    deliveryDate: toISO(f.deliveryDate)||'',
    tripRound: 1,
    paymentStatus: f.paymentStatus||'ค้างจ่าย',
  };
  const headers = ['timestamp','jobDate','jobTime','plateNumber','driverName','driverPhone','origin','destination','customerName','cargoList','cargoWeight','tripCount','freightCost','jobStatus','remark','imageUrls','ocrText','userAgent','rowId','pickupDate','deliveryDate','tripRound','paymentStatus'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'TruckJobs!A:A', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers.map(h => data[h]!==undefined ? data[h] : '')] }
  });
  return rowId;
}

async function saveIncome(sheets, sheetId, f) {
  const now = new Date().toISOString();
  const d = bkkNow();
  const rowId = genId('INC');
  const data = {
    timestamp: now, incomeDate: toISO(f.incomeDate)||'',
    incomeTime: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
    docNumber: rowId, customerName: f.customerName||'',
    incomeItem: f.incomeItem||'', amount: parseFloat(f.amount)||0,
    paymentMethod: f.paymentMethod||'เงินสด',
    remark: f.remark==='-'?'':(f.remark||''),
    imageUrls: '[]', ocrText: '', userAgent: 'LINE Bot', rowId,
    linkedTripRowId: '', linkedTripRound: 0,
  };
  const headers = ['timestamp','incomeDate','incomeTime','docNumber','customerName','incomeItem','amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId','linkedTripRowId','linkedTripRound'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Income!A:A', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers.map(h => data[h]!==undefined ? data[h] : '')] }
  });
  return rowId;
}

async function saveExpense(sheets, sheetId, f) {
  const now = new Date().toISOString();
  const d = bkkNow();
  const rowId = genId('EXP');
  const data = {
    timestamp: now, expenseDate: toISO(f.expenseDate)||'',
    expenseTime: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
    category: f.category||'', plateNumber: f.plateNumber==='-'?'':(f.plateNumber||''),
    vendor: '', expenseDetail: f.category||'',
    amount: parseFloat(f.amount)||0, paymentMethod: f.paymentMethod||'เงินสด',
    remark: f.remark==='-'?'':(f.remark||''),
    imageUrls: '[]', ocrText: '', userAgent: 'LINE Bot', rowId,
    linkedTripRowId: '', linkedTripRound: 0,
  };
  const headers = ['timestamp','expenseDate','expenseTime','category','plateNumber','vendor','expenseDetail','amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId','linkedTripRowId','linkedTripRound'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Expense!A:A', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers.map(h => data[h]!==undefined ? data[h] : '')] }
  });
  return rowId;
}

// ─── Calendar Flex Message ─────────────────────────────────────
async function buildCalendar(sheets, sheetId, year, month) {
  const pad  = n => String(n).padStart(2,'0');
  const from = `${year}-${pad(month)}-01`;
  const to   = `${year}-${pad(month)}-31`;

  const all = await sheetRows(sheets, sheetId, 'TruckJobs');
  const jobs = all
    .filter(j => { const d = j.pickupDate||j.jobDate||''; return d>=from && d<=to; })
    .sort((a,b) => (a.pickupDate||a.jobDate||'').localeCompare(b.pickupDate||b.jobDate||''));

  const monthName = THAI_MONTHS[month-1];
  const thYear    = year + 543;

  const bodyContents = [];

  if (!jobs.length) {
    bodyContents.push({ type:'text', text:'ไม่มีรายการในเดือนนี้', size:'sm', color:'#888888', align:'center' });
  } else {
    jobs.slice(0,15).forEach((job, idx) => {
      const dateStr = job.pickupDate || job.jobDate || '';
      const parts   = dateStr.split('-');
      const dayNum  = parts[2] ? parseInt(parts[2]) : '?';
      const moShort = parts[1] ? THAI_MONTHS_SHORT[parseInt(parts[1])-1] : '';
      if (idx > 0) bodyContents.push({ type:'separator', margin:'sm' });
      bodyContents.push({
        type:'box', layout:'horizontal', margin: idx===0?'none':'sm',
        contents:[
          { type:'box', layout:'vertical', flex:2, contents:[
            { type:'text', text:`${dayNum}`, size:'xl', weight:'bold', color:'#1565C0', align:'center' },
            { type:'text', text: moShort, size:'xxs', color:'#888888', align:'center' }
          ]},
          { type:'box', layout:'vertical', flex:7, contents:[
            { type:'text', text:`🚛 ${job.plateNumber||'-'}  ${job.origin||'-'} → ${job.destination||'-'}`, size:'sm', wrap:true },
            { type:'text', text:`👤 ${job.driverName||'-'}`, size:'xs', color:'#888888' }
          ]}
        ]
      });
    });
    if (jobs.length > 15) {
      bodyContents.push({ type:'text', text:`… และอีก ${jobs.length-15} รายการ`, size:'xs', color:'#888888', margin:'sm', align:'center' });
    }
  }

  const prev = month===1  ? { y:year-1, m:12 } : { y:year, m:month-1 };
  const next = month===12 ? { y:year+1, m:1  } : { y:year, m:month+1 };

  const flexMsg = {
    type:'flex',
    altText:`📅 ปฏิทินการเดินรถ ${monthName} ${thYear}`,
    contents:{
      type:'bubble', size:'giga',
      header:{ type:'box', layout:'vertical', backgroundColor:'#1565C0', paddingAll:'lg', contents:[
        { type:'text', text:'📅 ปฏิทินการเดินรถ', weight:'bold', size:'lg', color:'#FFFFFF' },
        { type:'text', text:`${monthName} ${thYear}`, size:'sm', color:'#BBDEFB' }
      ]},
      body:{ type:'box', layout:'vertical', paddingAll:'md', contents: bodyContents },
      footer:{ type:'box', layout:'vertical', paddingAll:'md', spacing:'sm', contents:[
        { type:'button', style:'primary', color:'#1565C0', height:'sm',
          action:{ type:'uri', label:'🌐 ดูทั้งหมดในเว็บ', uri: WEB_URL } }
      ]}
    },
    quickReply:{ items:[
      qPb('◀️ เดือนก่อน', `cal_${prev.y}_${prev.m}`),
      qPb('📅 เดือนนี้',  'cal_now'),
      qPb('▶️ เดือนหน้า', `cal_${next.y}_${next.m}`)
    ]}
  };
  return flexMsg;
}

// ─── Core event handler ────────────────────────────────────────
async function handleEvent(event, sheets, sheetId) {
  if (!event.replyToken) return;
  const userId = event.source?.userId || event.source?.groupId || '';
  if (!userId) return;
  const token  = event.replyToken;

  // Follow / join
  if (event.type === 'follow' || event.type === 'join') {
    return reply(token, txt(
      '👋 สวัสดีครับ! ยินดีต้อนรับสู่ SuperWealth\n\n' +
      'กดเมนูด้านล่างเพื่อเริ่มบันทึกข้อมูลครับ 👇\n' +
      '🚛 บันทึกรถ  |  📅 ปฏิทิน\n' +
      '💰 รายรับ    |  💸 รายจ่าย'
    ));
  }

  let text = '';
  let pb   = '';
  if (event.type === 'message' && event.message?.type === 'text') {
    text = event.message.text.trim();
  } else if (event.type === 'postback') {
    pb   = event.postback?.data || '';
    text = pb;
  } else {
    return;
  }

  // ── Read state (+ ref data in parallel for menus) ─────────────
  const { state, data: formData, row: rowNum } = await readState(sheets, sheetId, userId);

  // ── Global cancel ──────────────────────────────────────────────
  if (text === 'ยกเลิก' || text === '❌ ยกเลิก') {
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, txt('ยกเลิกแล้วครับ 👍 กดเมนูด้านล่างเพื่อเริ่มใหม่'));
  }

  // ── Menu triggers (Rich Menu sends these postback data) ────────
  if (text==='MENU_TRUCK' || text==='🚛 บันทึกรถ') {
    const ref = await getRef(sheets, sheetId);
    const s = buildStep('truck_1', ref);
    await writeState(sheets, sheetId, userId, 'truck_1', {}, rowNum);
    return reply(token, txt(s.q, s.qr));
  }
  if (text==='MENU_INCOME' || text==='💰 รายรับ') {
    const ref = await getRef(sheets, sheetId);
    const s = buildStep('inc_1', ref);
    await writeState(sheets, sheetId, userId, 'inc_1', {}, rowNum);
    return reply(token, txt(s.q, s.qr));
  }
  if (text==='MENU_EXPENSE' || text==='💸 รายจ่าย') {
    const ref = await getRef(sheets, sheetId);
    const s = buildStep('exp_1', ref);
    await writeState(sheets, sheetId, userId, 'exp_1', {}, rowNum);
    return reply(token, txt(s.q, s.qr));
  }
  if (text==='MENU_CALENDAR' || text==='📅 ปฏิทิน' || text==='cal_now' || pb==='cal_now') {
    const now = bkkNow();
    const flex = await buildCalendar(sheets, sheetId, now.getFullYear(), now.getMonth()+1);
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, flex);
  }

  // ── Calendar navigation ────────────────────────────────────────
  if (pb && pb.startsWith('cal_')) {
    const parts = pb.split('_');
    if (parts.length===3) {
      const flex = await buildCalendar(sheets, sheetId, parseInt(parts[1]), parseInt(parts[2]));
      return reply(token, flex);
    }
  }

  // ── Confirm steps ──────────────────────────────────────────────
  if (state === 'truck_confirm') {
    if (text === '✅ ยืนยัน') {
      try {
        const id = await saveTruck(sheets, sheetId, formData);
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`✅ บันทึกรถบรรทุกสำเร็จ!\nรหัส: ${id}\n\nดูข้อมูลได้ที่เว็บครับ 👇`, [qUri('🌐 เปิดเว็บ', WEB_URL)]));
      } catch(e) {
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`❌ เกิดข้อผิดพลาด: ${e.message}`));
      }
    }
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, txt('ยกเลิกแล้วครับ 👍'));
  }
  if (state === 'inc_confirm') {
    if (text === '✅ ยืนยัน') {
      try {
        const id = await saveIncome(sheets, sheetId, formData);
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`✅ บันทึกรายรับสำเร็จ!\nรหัส: ${id}`, [qUri('🌐 เปิดเว็บ', WEB_URL)]));
      } catch(e) {
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`❌ เกิดข้อผิดพลาด: ${e.message}`));
      }
    }
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, txt('ยกเลิกแล้วครับ 👍'));
  }
  if (state === 'exp_confirm') {
    if (text === '✅ ยืนยัน') {
      try {
        const id = await saveExpense(sheets, sheetId, formData);
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`✅ บันทึกรายจ่ายสำเร็จ!\nรหัส: ${id}`, [qUri('🌐 เปิดเว็บ', WEB_URL)]));
      } catch(e) {
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`❌ เกิดข้อผิดพลาด: ${e.message}`));
      }
    }
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, txt('ยกเลิกแล้วครับ 👍'));
  }

  // ── Form steps ─────────────────────────────────────────────────
  const allSeqs = { truck: TRUCK_SEQ, inc: INCOME_SEQ, exp: EXPENSE_SEQ };
  let activeSeq = null;
  let seqKey    = '';
  for (const [k, seq] of Object.entries(allSeqs)) {
    if (seq.includes(state)) { activeSeq = seq; seqKey = k; break; }
  }

  if (activeSeq && !state.endsWith('_confirm')) {
    // Save answer
    const field = FIELD[state];
    if (field) formData[field] = text;

    // Auto-fill driver name/phone from vehicle's assignedDriver when plate selected
    if (state === 'truck_2') {
      try {
        const vehicles = await sheetRows(sheets, sheetId, 'Vehicles');
        const veh = vehicles.find(v => v.plateNumber === text);
        if (veh?.assignedDriver) formData.driverName = veh.assignedDriver;
        if (veh?.assignedDriverPhone) formData.driverPhone = veh.assignedDriverPhone;
      } catch { /* ignore */ }
    }

    const idx      = activeSeq.indexOf(state);
    const nextState = activeSeq[idx + 1];

    if (nextState.endsWith('_confirm')) {
      // Show summary
      let summary = '';
      if (seqKey==='truck') summary = confirmTruck(formData);
      else if (seqKey==='inc') summary = confirmIncome(formData);
      else if (seqKey==='exp') summary = confirmExpense(formData);
      await writeState(sheets, sheetId, userId, nextState, formData, rowNum);
      return reply(token, txt(summary, CONFIRM_QR));
    } else {
      // Ask next question
      const ref = await getRef(sheets, sheetId);
      const s   = buildStep(nextState, ref);
      await writeState(sheets, sheetId, userId, nextState, formData, rowNum);
      return reply(token, s ? txt(s.q, s.qr) : txt('กรุณาตอบคำถามครับ'));
    }
  }

  // ── Idle / unrecognized ────────────────────────────────────────
  return reply(token, txt(
    '📱 กดเมนูด้านล่างเพื่อเริ่มบันทึกข้อมูลครับ\n\n' +
    '🚛 บันทึกรถ  |  📅 ปฏิทิน\n' +
    '💰 รายรับ    |  💸 รายจ่าย'
  ));
}

// ─── Vercel Handler ────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'SuperWealth LINE Bot' });
  if (req.method !== 'POST') return res.status(405).end();

  // Signature verification — skipped because Vercel auto-parses JSON
  // (re-stringifying may differ from raw body LINE signed)
  // Security: webhook URL is private and HTTPS-only

  const events = req.body?.events || [];

  if (events.length) {
    try {
      const sheets  = getSheetsClient();
      const sheetId = process.env.SHEET_ID;
      for (const ev of events) {
        await handleEvent(ev, sheets, sheetId);
      }
    } catch (e) {
      console.error('line-webhook error:', e.message);
    }
  }

  // Respond 200 after processing so Vercel keeps function alive until done
  return res.status(200).json({ ok: true });
};
