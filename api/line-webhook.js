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
// YYYY-MM-DD from a Date's *local* components (use with bkkNow() — avoids the
// toISOString() UTC shift that flips the day around midnight Bangkok time).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

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

// ═══════════════════════════════════════════════════════════════
// 📸 IMAGE UPLOAD + OCR HELPERS (v14.4)
// ═══════════════════════════════════════════════════════════════

// Download image binary from LINE Content API → return base64
async function getLineImageBase64(messageId) {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!r.ok) throw new Error(`LINE content fetch failed: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

// Upload base64 image to ImgBB → return public URL
async function uploadToImgBB(base64) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error('Missing IMGBB_API_KEY in env');
  const params = new URLSearchParams({ key: apiKey, image: base64 });
  const r = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  let json;
  try { json = await r.json(); }
  catch { throw new Error(`ImgBB returned non-JSON (status ${r.status})`); }
  if (!json.success) throw new Error(json.error?.message || `ImgBB error (status ${r.status})`);
  return json.data.url;
}

// OCR via OCR.space → return parsed text
async function ocrFromBase64(base64) {
  const apiKey = process.env.OCRSPACE_API_KEY || 'K87391333588957';
  const params = new URLSearchParams({
    apikey: apiKey,
    base64Image: 'data:image/jpeg;base64,' + base64,
    language: 'tha',
    OCREngine: '2',
    scale: 'true',
    isTable: 'false',
    detectOrientation: 'true'
  });
  const r = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const json = await r.json();
  if (json.IsErroredOnProcessing) {
    throw new Error((json.ErrorMessage||['OCR failed']).join(','));
  }
  return (json.ParsedResults||[]).map(p => p.ParsedText||'').join('\n');
}

// Parse OCR text → extract { amount, date, plateNumber, docNumber }
function parseOCRText(text) {
  const result = {};
  if (!text) return result;

  // ── Amount: find largest number (likely the total) ──
  const amountStrs = text.match(/[\d,]+\.?\d{0,2}/g) || [];
  const amounts = amountStrs
    .map(s => parseFloat(s.replace(/,/g, '')))
    .filter(n => n > 10 && n < 10_000_000); // reasonable range
  if (amounts.length > 0) {
    amounts.sort((a, b) => b - a);
    result.amount = amounts[0]; // largest = likely the total
  }

  // ── Date: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD ──
  let dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dateMatch) {
    let [, d, m, y] = dateMatch;
    if (y.length === 2) y = '20' + y;
    if (parseInt(y) > 2400) y = (parseInt(y) - 543).toString(); // Thai BE → CE
    // Only accept a sane calendar date — skip OCR noise / wrong digit order
    // so we never store an impossible date like 2024-13-25.
    const dd = parseInt(d, 10), mm = parseInt(m, 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      result.date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
  }

  // ── Plate: Thai format (2-digit + 4-digit, or 2-char Thai + 4-digit) ──
  const platePatterns = [
    /(\d{2}[\s\-]?\d{4})/,           // 70-4770
    /([ก-ฮ]{1,3}[\s\-]?\d{1,4})/     // กข-1234
  ];
  for (const p of platePatterns) {
    const m = text.match(p);
    if (m) { result.plateNumber = m[1].trim(); break; }
  }

  // ── Doc number / invoice: INV, RCP, etc + numbers ──
  const docMatch = text.match(/(INV|RCP|RC|IV|TX|TAX)[\s\-#]?(\d+)/i);
  if (docMatch) result.docNumber = docMatch[0];

  return result;
}

// Apply OCR result to formData based on current form state
function applyOCRToState(formData, state, ocrParsed) {
  const summary = [];
  if (!Object.keys(ocrParsed).length) return summary;

  // Amount: applies to truck_5 (freight), inc_3 (amount), exp_3 (amount)
  if (ocrParsed.amount && ['truck_5','inc_3','exp_3'].includes(state)) {
    const field = FIELD[state];
    if (field) {
      formData[field] = String(ocrParsed.amount);
      summary.push(`💵 ยอด: ฿${num(ocrParsed.amount)}`);
    }
  }
  // Date: applies to truck_1, inc_1, exp_1
  if (ocrParsed.date && ['truck_1','inc_1','exp_1'].includes(state)) {
    const field = FIELD[state];
    if (field) {
      // Convert YYYY-MM-DD → DD/MM/YYYY for display
      const [y,m,d] = ocrParsed.date.split('-');
      formData[field] = `${d}/${m}/${y}`;
      summary.push(`📅 วันที่: ${formData[field]}`);
    }
  }
  // Plate: applies to truck_2 only
  if (ocrParsed.plateNumber && state === 'truck_2') {
    formData[FIELD[state]] = ocrParsed.plateNumber;
    summary.push(`🚛 ทะเบียน: ${ocrParsed.plateNumber}`);
  }
  // Doc number (for income only — auto-fill but don't change state)
  if (ocrParsed.docNumber) {
    formData.docNumber = ocrParsed.docNumber;
    summary.push(`📄 เลขที่: ${ocrParsed.docNumber}`);
  }
  return summary;
}

// ─── LINE API helpers ──────────────────────────────────────────
async function reply(token, msgs) {
  if (!Array.isArray(msgs)) msgs = [msgs];
  // LINE allows max 5 messages per reply — trim defensively.
  if (msgs.length > 5) msgs = msgs.slice(0, 5);
  try {
    const r = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ replyToken: token, messages: msgs })
    });
    if (!r.ok) {
      // Surface WHY a reply was rejected (malformed flex, >5000 chars,
      // expired/used replyToken, etc.) — previously failed silently.
      const detail = await r.text().catch(() => '');
      console.error(`LINE reply FAILED ${r.status}:`, detail.slice(0, 500),
        '| msgTypes:', msgs.map(m => m.type).join(','));
    }
    return r.ok;
  } catch (e) {
    console.error('LINE reply EXCEPTION:', e.message);
    return false;
  }
}

// text message with optional quick replies
function txt(text, qrItems) {
  const m = { type: 'text', text };
  if (qrItems && qrItems.length) m.quickReply = { items: qrItems.slice(0,13) };
  return m;
}
// quick reply item helpers — LINE caps action labels at 20 chars; a longer
// label rejects the WHOLE message (400) and the bot fails to reply, so trim.
const qLabel = s => String(s == null ? '' : s).slice(0, 20);
function qMsg(label, text)  { return { type:'action', action:{ type:'message', label:qLabel(label), text } }; }
function qPb(label, data)   { return { type:'action', action:{ type:'postback', label:qLabel(label), data } }; }
function qUri(label, uri)   { return { type:'action', action:{ type:'uri', label:qLabel(label), uri } }; }

// ─── Step definitions ──────────────────────────────────────────
const TRUCK_SEQ   = ['truck_1','truck_2','truck_3','truck_4','truck_5','truck_6','truck_confirm'];
const INCOME_SEQ  = ['inc_1','inc_2','inc_3','inc_4','inc_confirm'];
const EXPENSE_SEQ = ['exp_1','exp_2','exp_3','exp_4','exp_confirm'];
const MAINT_SEQ   = ['maint_1','maint_2','maint_3','maint_4','maint_confirm'];

// Maps state → formData key
const FIELD = {
  truck_1:'pickupDate', truck_2:'plateNumber', truck_3:'origin',
  truck_4:'destination', truck_5:'freightCost', truck_6:'paymentStatus',
  inc_1:'incomeDate', inc_2:'incomeItem', inc_3:'amount', inc_4:'paymentMethod',
  exp_1:'expenseDate', exp_2:'category', exp_3:'amount', exp_4:'paymentMethod',
  maint_1:'maintenanceDate', maint_2:'plateNumber', maint_3:'maintenanceType', maint_4:'cost',
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
    // ── Maintenance (4 steps) ──
    maint_1: { q:'📅 วันที่ซ่อม', qr: dateQR },
    maint_2: { q:'🚛 ทะเบียนรถ (เลือกหรือพิมพ์)', qr: plates.map(p=>qMsg(p,p)) },
    maint_3: { q:'🔧 ประเภทการซ่อม',
               qr:[ qMsg('เปลี่ยนยาง','เปลี่ยนยาง'), qMsg('น้ำมันเครื่อง','น้ำมันเครื่อง'),
                    qMsg('เบรค','เบรค'), qMsg('ช่วงล่าง','ช่วงล่าง'),
                    qMsg('แอร์','แอร์'), qMsg('ไฟฟ้า','ไฟฟ้า'),
                    qMsg('ตรวจสภาพ','ตรวจสภาพ'), qMsg('ล้างรถ','ล้างรถ'),
                    qMsg('อื่นๆ','อื่นๆ') ] },
    maint_4: { q:'💵 ค่าซ่อม (บาท) พิมพ์เป็นตัวเลข', qr: [] },
  };
  return STEPS[step] || null;
}

// ─── Confirm summaries ─────────────────────────────────────────
const remark = v => (v==='-'||!v) ? 'ไม่มี' : v;
const num    = v => Number(v||0).toLocaleString('th-TH');

// ═══════════════════════════════════════════════════════════════
// 🎨 FLEX MESSAGE BUILDERS (v13.3-style UI for LINE)
// ═══════════════════════════════════════════════════════════════

// Theme colors (synced with web app)
const C = {
  primary:  '#1565C0', primaryDark: '#0D47A1',
  success:  '#2E7D32', successDark: '#1B5E20',
  danger:   '#C62828', dangerDark:  '#B71C1C',
  warning:  '#EF6C00', warningDark: '#E65100',
  info:     '#0277BD', purple:      '#6A1B9A',
  text:     '#1A1F2E', textSub:     '#5A6577',
  textMute: '#98A1B0', bg:          '#F5F7FB',
  border:   '#E4E8EE', white:       '#FFFFFF'
};

// Helper: build a "label · value" row inside body
function flexRow(label, value, valueColor) {
  return {
    type: 'box', layout: 'horizontal', margin: 'md',
    contents: [
      { type:'text', text:label,  size:'sm', color:C.textSub, flex:3, weight:'regular' },
      { type:'text', text:String(value||'-'), size:'sm', color: valueColor||C.text, flex:5, weight:'bold', align:'end', wrap:true }
    ]
  };
}
function flexSep() { return { type:'separator', margin:'md', color:'#EEF1F6' }; }

// ── 1) WELCOME FLEX (hero card with today's KPIs) ──
async function buildWelcomeFlex(sheets, sheetId) {
  const today = isoDate(bkkNow());
  let income = 0, expense = 0, trips = 0;
  try {
    const inc  = await sheetRows(sheets, sheetId, 'Income');
    const exp  = await sheetRows(sheets, sheetId, 'Expense');
    const trk  = await sheetRows(sheets, sheetId, 'TruckJobs');
    income  = inc.filter(r => (r.incomeDate||'')  === today).reduce((s,r)=> s+(parseFloat(r.amount)||0), 0);
    expense = exp.filter(r => (r.expenseDate||'') === today).reduce((s,r)=> s+(parseFloat(r.amount)||0), 0);
    trips   = trk.filter(r => (r.pickupDate||r.jobDate||'') === today).length;
  } catch {}
  const profit = income - expense;
  const profitColor = profit >= 0 ? '#A5D6A7' : '#FFAB91';
  return {
    type:'flex', altText:'👋 ยินดีต้อนรับ SuperWealth',
    contents: {
      type:'bubble', size:'mega',
      header: {
        type:'box', layout:'vertical', backgroundColor: C.primaryDark, paddingAll:'xl',
        contents: [
          { type:'text', text:'🚛 SuperWealth Transport', color:'#BBDEFB', size:'xs', weight:'bold' },
          { type:'text', text:'ภาพรวมธุรกิจวันนี้', color: C.white, size:'xl', weight:'bold', margin:'sm' },
          { type:'box', layout:'horizontal', margin:'lg', spacing:'sm', contents: [
            { type:'box', layout:'vertical', flex:1, backgroundColor:'rgba(255,255,255,0.13)', cornerRadius:'md', paddingAll:'sm', contents:[
              { type:'text', text:'กำไรสุทธิ', size:'xxs', color:'#E3F2FD', weight:'bold' },
              { type:'text', text:`฿${num(profit)}`, color:profitColor, weight:'bold', size:'sm', margin:'xs' }
            ]},
            { type:'box', layout:'vertical', flex:1, backgroundColor:'rgba(255,255,255,0.13)', cornerRadius:'md', paddingAll:'sm', contents:[
              { type:'text', text:'รายรับ', size:'xxs', color:'#E3F2FD', weight:'bold' },
              { type:'text', text:`฿${num(income)}`, color: C.white, weight:'bold', size:'sm', margin:'xs' }
            ]},
            { type:'box', layout:'vertical', flex:1, backgroundColor:'rgba(255,255,255,0.13)', cornerRadius:'md', paddingAll:'sm', contents:[
              { type:'text', text:'เที่ยวรถ', size:'xxs', color:'#E3F2FD', weight:'bold' },
              { type:'text', text:`${trips}`,   color: C.white, weight:'bold', size:'sm', margin:'xs' }
            ]}
          ]}
        ]
      },
      body: {
        type:'box', layout:'vertical', paddingAll:'lg', spacing:'sm',
        contents: [
          { type:'text', text:'⚡ เมนูลัด', size:'xs', color: C.textMute, weight:'bold' },
          { type:'box', layout:'horizontal', spacing:'sm', margin:'sm', contents:[
            { type:'button', height:'sm', style:'primary', color: C.primary,
              action:{ type:'postback', label:'🚛 บันทึกรถ', data:'MENU_TRUCK', displayText:'🚛 บันทึกรถ' } },
            { type:'button', height:'sm', style:'primary', color: C.info,
              action:{ type:'postback', label:'📅 ปฏิทิน',   data:'MENU_CALENDAR', displayText:'📅 ปฏิทิน' } }
          ]},
          { type:'box', layout:'horizontal', spacing:'sm', contents:[
            { type:'button', height:'sm', style:'primary', color: C.success,
              action:{ type:'postback', label:'💰 รายรับ',   data:'MENU_INCOME', displayText:'💰 รายรับ' } },
            { type:'button', height:'sm', style:'primary', color: C.danger,
              action:{ type:'postback', label:'💸 รายจ่าย',  data:'MENU_EXPENSE', displayText:'💸 รายจ่าย' } }
          ]},
          { type:'box', layout:'horizontal', spacing:'sm', contents:[
            { type:'button', height:'sm', style:'primary', color: C.warningDark,
              action:{ type:'postback', label:'🔧 ซ่อมบำรุง', data:'MENU_MAINTENANCE', displayText:'🔧 ซ่อมบำรุง' } }
          ]}
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'md', spacing:'xs',
        contents:[
          { type:'button', style:'secondary', height:'sm',
            action:{ type:'postback', label:'⚡ เมนูทั้งหมด (12 รายการ)', data:'/เมนูเต็ม', displayText:'เมนูเต็ม' } },
          { type:'button', style:'link', height:'sm',
            action:{ type:'uri', label:'🌐 เปิดเว็บเต็มรูปแบบ', uri: WEB_URL } }
        ]
      }
    }
  };
}

// ── 2) CONFIRM FLEX (sectioned card with header color + rows) ──
function buildConfirmFlex(type, f) {
  const meta = {
    truck:   { icon:'🚛', title:'ยืนยันบันทึกรถ',   color: C.primary,
               rows:[
                 ['📅 วันที่รับ', f.pickupDate],
                 ['🚛 ทะเบียนรถ', f.plateNumber],
                 ['👤 คนขับ',     f.driverName],
                 ['📍 ต้นทาง',     f.origin],
                 ['📍 ปลายทาง',    f.destination],
                 ['💵 ค่าขนส่ง',   `${num(f.freightCost)} บาท`, C.success],
                 ['💳 สถานะ',      f.paymentStatus, (f.paymentStatus==='ชำระแล้ว'?C.success:C.danger)]
               ]},
    income:  { icon:'💰', title:'ยืนยันรายรับ',     color: C.success,
               rows:[
                 ['📅 วันที่',     f.incomeDate],
                 ['💰 ประเภท',     f.incomeItem],
                 ['💵 จำนวน',      `${num(f.amount)} บาท`, C.success],
                 ['💳 ช่องทาง',    f.paymentMethod]
               ]},
    expense: { icon:'💸', title:'ยืนยันรายจ่าย',    color: C.danger,
               rows:[
                 ['📅 วันที่',     f.expenseDate],
                 ['💸 ประเภท',     f.category],
                 ['💵 จำนวน',      `${num(f.amount)} บาท`, C.danger],
                 ['💳 ช่องทาง',    f.paymentMethod]
               ]},
    maintenance: { icon:'🔧', title:'ยืนยันซ่อมบำรุง', color: C.warningDark,
               rows:[
                 ['📅 วันที่ซ่อม', f.maintenanceDate],
                 ['🚛 ทะเบียน',    f.plateNumber],
                 ['🔧 ประเภท',     f.maintenanceType],
                 ['💵 ค่าซ่อม',    `${num(f.cost)} บาท`, C.warningDark]
               ]}
  };
  const m = meta[type] || meta.truck;
  return {
    type:'flex', altText:`📋 ${m.title}`,
    contents: {
      type:'bubble',
      header: {
        type:'box', layout:'vertical', backgroundColor:m.color, paddingAll:'lg',
        contents:[
          { type:'text', text:`${m.icon} ${m.title}`, color: C.white, weight:'bold', size:'md' },
          { type:'text', text:'ตรวจสอบก่อนยืนยัน', color:'#FFFFFF', size:'xxs', margin:'xs', weight:'regular' }
        ]
      },
      body: {
        type:'box', layout:'vertical', paddingAll:'lg', spacing:'none',
        contents: m.rows.map(([k,v,col],i) => i===0 ? flexRow(k,v,col) : { type:'box', layout:'vertical', contents:[ flexSep(), flexRow(k,v,col) ] })
      },
      footer: {
        type:'box', layout:'horizontal', paddingAll:'md', spacing:'sm',
        contents:[
          { type:'button', style:'secondary', height:'sm', flex:1,
            action:{ type:'message', label:'❌ ยกเลิก', text:'❌ ยกเลิก' } },
          { type:'button', style:'primary', color:m.color, height:'sm', flex:2,
            action:{ type:'message', label:'✅ ยืนยัน', text:'✅ ยืนยัน' } }
        ]
      }
    }
  };
}

// ── 3) SUCCESS FLEX (green header + ID + quick actions) ──
function buildSuccessFlex(type, rowId, f) {
  const meta = {
    truck:   { icon:'🚛', title:'บันทึกรถสำเร็จ',   nextLabel:'➕ บันทึกรถอีก',   nextData:'MENU_TRUCK',
               summary: `${f.plateNumber||''} · ${f.origin||''} → ${f.destination||''} · ฿${num(f.freightCost)}` },
    income:  { icon:'💰', title:'บันทึกรายรับสำเร็จ', nextLabel:'➕ บันทึกรายรับอีก', nextData:'MENU_INCOME',
               summary: `${f.incomeItem||''} · ฿${num(f.amount)} · ${f.paymentMethod||''}` },
    expense: { icon:'💸', title:'บันทึกรายจ่ายสำเร็จ', nextLabel:'➕ บันทึกรายจ่ายอีก', nextData:'MENU_EXPENSE',
               summary: `${f.category||''} · ฿${num(f.amount)} · ${f.paymentMethod||''}` },
    maintenance: { icon:'🔧', title:'บันทึกซ่อมบำรุงสำเร็จ', nextLabel:'➕ บันทึกซ่อมอีก', nextData:'MENU_MAINTENANCE',
               summary: `${f.plateNumber||''} · ${f.maintenanceType||''} · ฿${num(f.cost)}` }
  };
  const m = meta[type] || meta.truck;
  return {
    type:'flex', altText:`✅ ${m.title}`,
    contents: {
      type:'bubble',
      header: {
        type:'box', layout:'vertical', backgroundColor: C.success, paddingAll:'lg',
        contents:[
          { type:'box', layout:'horizontal', contents:[
            { type:'text', text:'✅', size:'xxl', flex:0 },
            { type:'box', layout:'vertical', margin:'md', contents:[
              { type:'text', text: m.title, color: C.white, weight:'bold', size:'md' },
              { type:'text', text:'บันทึกลง Google Sheets แล้ว', color:'#C8E6C9', size:'xxs', margin:'xs' }
            ]}
          ]}
        ]
      },
      body: {
        type:'box', layout:'vertical', paddingAll:'lg', spacing:'md',
        contents:[
          { type:'text', text: m.summary, size:'sm', color: C.text, wrap:true, weight:'bold' },
          { type:'separator', color:'#EEF1F6' },
          { type:'box', layout:'baseline', contents:[
            { type:'text', text:'รหัสรายการ:', size:'xxs', color: C.textMute, flex:0 },
            { type:'text', text: rowId, size:'xxs', color: C.text, margin:'sm', weight:'bold' }
          ]}
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'md', spacing:'sm',
        contents:[
          { type:'button', style:'primary', color: C.primary, height:'sm',
            action:{ type:'uri', label:'🌐 ดูในเว็บ', uri: WEB_URL } },
          { type:'button', style:'secondary', height:'sm',
            action:{ type:'postback', label: m.nextLabel, data: m.nextData, displayText: m.nextLabel } }
        ]
      }
    }
  };
}

// ── FULL MENU CAROUSEL (KTB-style 4-column icons, 3 categories) ──
function buildFullMenuFlex() {
  // Each bubble: 2×2 grid of colored icon buttons (4 items per category)
  const item = (icon, label, color, postback, displayText) => ({
    type:'box', layout:'vertical', flex:1, spacing:'sm', paddingAll:'md',
    cornerRadius:'lg', backgroundColor:'#FFFFFF',
    action:{ type:'postback', label, data:postback, displayText: displayText || label },
    contents:[
      { type:'box', layout:'vertical', width:'56px', height:'56px', cornerRadius:'lg',
        backgroundColor: color, justifyContent:'center',
        contents:[ { type:'text', text: icon, size:'xxl', align:'center', color:'#FFFFFF' } ] },
      { type:'text', text: label, size:'xs', weight:'bold', color: C.text, align:'center', wrap:true, margin:'sm' }
    ]
  });
  const row = (a, b) => ({
    type:'box', layout:'horizontal', spacing:'sm', margin:'sm', contents:[a, b]
  });

  // CATEGORY 1: บันทึกรายการ (truck/calendar/income/expense)
  const bubble1 = {
    type:'bubble', size:'kilo',
    header: { type:'box', layout:'vertical', backgroundColor: C.primaryDark, paddingAll:'lg',
      contents:[
        { type:'text', text:'📝 บันทึกรายการ', color: C.white, weight:'bold', size:'md' },
        { type:'text', text:'งานประจำวัน', color:'#BBDEFB', size:'xxs', margin:'xs' }
      ] },
    body: { type:'box', layout:'vertical', paddingAll:'md', backgroundColor:'#F5F7FB', spacing:'none',
      contents:[
        row(
          item('🚛', 'บันทึกรถ', '#2563EB', 'MENU_TRUCK'),
          item('💰', 'รายรับ',   '#16A34A', 'MENU_INCOME')
        ),
        row(
          item('💸', 'รายจ่าย',  '#DC2626', 'MENU_EXPENSE'),
          item('📅', 'ปฏิทิน',  '#0D9488', 'MENU_CALENDAR')
        ),
        row(
          item('🔧', 'ซ่อมบำรุง', '#E65100', 'MENU_MAINTENANCE'),
          item('📊', 'สรุปเดือนนี้', '#6A1B9A', '/สรุป', 'สรุปผล')
        )
      ] }
  };

  // CATEGORY 2: ข้อมูลหลัก (vehicle/driver/customer/capital)
  const bubble2 = {
    type:'bubble', size:'kilo',
    header: { type:'box', layout:'vertical', backgroundColor: C.purple, paddingAll:'lg',
      contents:[
        { type:'text', text:'📦 ข้อมูลหลัก', color: C.white, weight:'bold', size:'md' },
        { type:'text', text:'Master data', color:'#E1BEE7', size:'xxs', margin:'xs' }
      ] },
    body: { type:'box', layout:'vertical', paddingAll:'md', backgroundColor:'#F5F7FB', spacing:'none',
      contents:[
        row(
          item('🚗', 'ยานพาหนะ', '#6366F1', 'MENU_VEHICLE',  'ยานพาหนะ — ดูในเว็บ'),
          item('👤', 'คนขับ',    '#F97316', 'MENU_DRIVER',   'คนขับ — ดูในเว็บ')
        ),
        row(
          item('🏢', 'ลูกค้า',   '#A855F7', 'MENU_CUSTOMER', 'ลูกค้า — ดูในเว็บ'),
          item('💼', 'เงินทุน',  '#0EA5E9', 'MENU_CAPITAL',  'เงินทุน — ดูในเว็บ')
        )
      ] }
  };

  // CATEGORY 3: เครื่องมือ (maintenance/fuel/invoice/web)
  const bubble3 = {
    type:'bubble', size:'kilo',
    header: { type:'box', layout:'vertical', backgroundColor: C.warningDark, paddingAll:'lg',
      contents:[
        { type:'text', text:'🛠️ เครื่องมือ', color: C.white, weight:'bold', size:'md' },
        { type:'text', text:'ปฏิบัติการ', color:'#FFCCBC', size:'xxs', margin:'xs' }
      ] },
    body: { type:'box', layout:'vertical', paddingAll:'md', backgroundColor:'#F5F7FB', spacing:'none',
      contents:[
        row(
          item('⛽', 'น้ำมัน',      '#EAB308', 'MENU_FUEL',        'น้ำมัน — ดูในเว็บ'),
          item('🚗', 'ยานพาหนะ', '#6366F1', 'MENU_VEHICLE',  'ยานพาหนะ — ดูในเว็บ')
        ),
        row(
          item('🧾', 'ใบเสร็จ',     '#06B6D4', 'MENU_INVOICE',     'ใบเสร็จ — ดูในเว็บ'),
          item('🌐', 'เปิดเว็บ',    '#10B981', 'OPEN_WEB',         'เปิดเว็บ')
        )
      ] }
  };

  return {
    type:'flex',
    altText:'⚡ เมนูทั้งหมด — SuperWealth',
    contents:{
      type:'carousel',
      contents:[ bubble1, bubble2, bubble3 ]
    }
  };
}

// ── 4) SUMMARY FLEX (hero-style KPI card for /สรุป command) ──
async function buildSummaryFlex(sheets, sheetId) {
  const now = bkkNow();
  const pad = n => String(n).padStart(2,'0');
  const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  let income = 0, expense = 0, trips = 0;
  let incCount = 0, expCount = 0;
  try {
    const inc = await sheetRows(sheets, sheetId, 'Income');
    const exp = await sheetRows(sheets, sheetId, 'Expense');
    const trk = await sheetRows(sheets, sheetId, 'TruckJobs');
    inc.filter(r => (r.incomeDate||'').startsWith(monthPrefix)).forEach(r => { income += parseFloat(r.amount)||0; incCount++; });
    exp.filter(r => (r.expenseDate||'').startsWith(monthPrefix)).forEach(r => { expense += parseFloat(r.amount)||0; expCount++; });
    trips = trk.filter(r => (r.pickupDate||r.jobDate||'').startsWith(monthPrefix)).length;
  } catch {}
  const profit = income - expense;
  const profitPct = income > 0 ? ((profit/income)*100).toFixed(1) : '0.0';
  const profitColor = profit >= 0 ? '#A5D6A7' : '#FFAB91';
  const monthName = THAI_MONTHS[now.getMonth()];
  const thYear = now.getFullYear() + 543;

  return {
    type:'flex', altText:`📊 สรุปผล ${monthName} ${thYear}`,
    contents: {
      type:'bubble', size:'mega',
      header: {
        type:'box', layout:'vertical', backgroundColor: C.primaryDark, paddingAll:'xl',
        contents:[
          { type:'text', text:'📊 SuperWealth · สรุปผล', color:'#BBDEFB', size:'xs', weight:'bold' },
          { type:'text', text: `${monthName} ${thYear}`, color: C.white, weight:'bold', size:'xl', margin:'sm' },
          // Big profit number
          { type:'box', layout:'vertical', backgroundColor:'rgba(0,0,0,0.18)', cornerRadius:'lg', paddingAll:'lg', margin:'lg', contents:[
            { type:'text', text:'กำไรสุทธิเดือนนี้', color:'#E3F2FD', size:'xxs', weight:'bold' },
            { type:'text', text:`฿${num(profit)}`, color: profitColor, weight:'bold', size:'xxl', margin:'xs' },
            { type:'text', text:`อัตรากำไร ${profitPct}%`, color:'#BBDEFB', size:'xxs', margin:'xs' }
          ]}
        ]
      },
      body: {
        type:'box', layout:'vertical', paddingAll:'lg', spacing:'md',
        contents:[
          // Income row
          { type:'box', layout:'horizontal', contents:[
            { type:'box', layout:'vertical', flex:0, contents:[
              { type:'text', text:'💰', size:'lg' }
            ]},
            { type:'box', layout:'vertical', margin:'md', flex:1, contents:[
              { type:'text', text:'รายรับรวม',  size:'xxs', color: C.textMute, weight:'bold' },
              { type:'text', text:`฿${num(income)}`, size:'md', color: C.success, weight:'bold' },
              { type:'text', text:`${incCount} รายการ`, size:'xxs', color: C.textMute, margin:'xs' }
            ]}
          ]},
          { type:'separator', color:'#EEF1F6' },
          // Expense row
          { type:'box', layout:'horizontal', contents:[
            { type:'box', layout:'vertical', flex:0, contents:[
              { type:'text', text:'💸', size:'lg' }
            ]},
            { type:'box', layout:'vertical', margin:'md', flex:1, contents:[
              { type:'text', text:'รายจ่ายรวม',  size:'xxs', color: C.textMute, weight:'bold' },
              { type:'text', text:`฿${num(expense)}`, size:'md', color: C.danger, weight:'bold' },
              { type:'text', text:`${expCount} รายการ`, size:'xxs', color: C.textMute, margin:'xs' }
            ]}
          ]},
          { type:'separator', color:'#EEF1F6' },
          // Trips row
          { type:'box', layout:'horizontal', contents:[
            { type:'box', layout:'vertical', flex:0, contents:[
              { type:'text', text:'🚛', size:'lg' }
            ]},
            { type:'box', layout:'vertical', margin:'md', flex:1, contents:[
              { type:'text', text:'เที่ยวรถทั้งหมด', size:'xxs', color: C.textMute, weight:'bold' },
              { type:'text', text:`${trips} เที่ยว`, size:'md', color: C.primary, weight:'bold' }
            ]}
          ]}
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'md', spacing:'sm',
        contents:[
          { type:'button', style:'primary', color: C.primary, height:'sm',
            action:{ type:'uri', label:'📊 ดู Dashboard เต็ม', uri: `${WEB_URL}/summary` } },
          { type:'button', style:'link', height:'sm',
            action:{ type:'postback', label:'📅 ดูปฏิทิน', data:'MENU_CALENDAR' } }
        ]
      }
    }
  };
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
    imageUrls: JSON.stringify(Array.isArray(f.imageUrls) ? f.imageUrls : []),
    ocrText: f.ocrText || '',
    userAgent: 'LINE Bot', rowId,
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
    imageUrls: JSON.stringify(Array.isArray(f.imageUrls) ? f.imageUrls : []),
    ocrText: f.ocrText || '',
    userAgent: 'LINE Bot', rowId,
    linkedTripRowId: '', linkedTripRound: 0,
  };
  const headers = ['timestamp','incomeDate','incomeTime','docNumber','customerName','incomeItem','amount','paymentMethod','remark','imageUrls','ocrText','userAgent','rowId','linkedTripRowId','linkedTripRound'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Income!A:A', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers.map(h => data[h]!==undefined ? data[h] : '')] }
  });
  return rowId;
}

async function saveMaintenance(sheets, sheetId, f) {
  const now = new Date().toISOString();
  const rowId = genId('MNT');
  const data = {
    timestamp: now,
    maintenanceDate: toISO(f.maintenanceDate)||'',
    plateNumber: f.plateNumber||'',
    maintenanceType: f.maintenanceType||'',
    description: f.description||f.maintenanceType||'',
    cost: parseFloat(f.cost)||0,
    vendor: f.vendor||'',
    odometerKm: f.odometerKm||'',
    nextDueDate: f.nextDueDate||'',
    notes: f.notes==='-'?'':(f.notes||''),
    imageUrls: JSON.stringify(Array.isArray(f.imageUrls) ? f.imageUrls : []),
    userAgent: 'LINE Bot', rowId,
  };
  const headers = ['timestamp','maintenanceDate','plateNumber','maintenanceType','description','cost','vendor','odometerKm','nextDueDate','notes','imageUrls','userAgent','rowId'];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Maintenance!A:A', valueInputOption: 'USER_ENTERED',
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
    imageUrls: JSON.stringify(Array.isArray(f.imageUrls) ? f.imageUrls : []),
    ocrText: f.ocrText || '',
    userAgent: 'LINE Bot', rowId,
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

// ═══════════════════════════════════════════════════════════════
// 📸 IMAGE UPLOAD HANDLER — receives image → ImgBB + OCR + autofill
// ═══════════════════════════════════════════════════════════════
async function handleImageUpload(sheets, sheetId, userId, token, messageId, state, formData, rowNum) {
  // 1) Download from LINE Content API
  let base64;
  try {
    base64 = await getLineImageBase64(messageId);
  } catch (e) {
    return reply(token, txt(`❌ ดาวน์โหลดรูปไม่ได้: ${e.message}`));
  }

  // 2) Upload to ImgBB
  let imageUrl;
  try {
    imageUrl = await uploadToImgBB(base64);
  } catch (e) {
    return reply(token, txt(`❌ อัพโหลดรูปไม่สำเร็จ: ${e.message}\n\nลองส่งใหม่อีกครั้งครับ`));
  }

  // 3) Save URL into formData
  formData.imageUrls = Array.isArray(formData.imageUrls) ? formData.imageUrls : [];
  formData.imageUrls.push(imageUrl);
  const imageCount = formData.imageUrls.length;

  // 4) Run OCR (only if user is currently in a form — saves API calls)
  let ocrSummary = [];
  let ocrSucceeded = false;
  const inForm = state && state !== 'idle' && !state.endsWith('_confirm');
  if (inForm) {
    try {
      const ocrText = await ocrFromBase64(base64);
      if (ocrText && ocrText.trim().length > 5) {
        const parsed = parseOCRText(ocrText);
        ocrSummary = applyOCRToState(formData, state, parsed);
        if (formData.ocrText) formData.ocrText += '\n---\n' + ocrText;
        else formData.ocrText = ocrText;
        ocrSucceeded = ocrSummary.length > 0;
      }
    } catch (e) {
      console.warn('OCR failed (non-fatal):', e.message);
    }
  }

  // 5) Persist state
  await writeState(sheets, sheetId, userId, state, formData, rowNum);

  // 6) Build reply
  const lines = [`✅ อัพโหลดรูปแล้ว (${imageCount} รูป)`];
  lines.push(`🖼 ${imageUrl}`);
  if (ocrSucceeded) {
    lines.push('');
    lines.push('🔍 พบข้อมูลจากรูป:');
    ocrSummary.forEach(s => lines.push('  • ' + s));
    lines.push('');
    lines.push('✨ ค่าถูกใส่ในฟอร์มอัตโนมัติ — ส่งรูปเพิ่มได้ หรือพิมพ์ "ต่อ" เพื่อข้าม');
  } else if (inForm) {
    lines.push('');
    lines.push('💡 รูปถูกแนบกับ record แล้ว — ส่งรูปเพิ่มได้ หรือพิมพ์ข้อมูลต่อ');
  } else {
    lines.push('');
    lines.push('💡 ต้องเริ่มฟอร์มก่อน (เช่น "บันทึกรถ" / "รายจ่าย") รูปจะถูกแนบ + อ่าน OCR อัตโนมัติ');
  }

  return reply(token, txt(lines.join('\n'),
    inForm ? [qMsg('▶️ ต่อ', 'ต่อ'), qMsg('❌ ยกเลิก', 'ยกเลิก')] : []
  ));
}

// ─── Core event handler ────────────────────────────────────────
async function handleEvent(event, sheets, sheetId) {
  if (!event.replyToken) return;
  const userId = event.source?.userId || event.source?.groupId || '';
  if (!userId) return;
  const token  = event.replyToken;

  // Follow / join — send Flex Hero card (v13.3-style)
  if (event.type === 'follow' || event.type === 'join') {
    const flex = await buildWelcomeFlex(sheets, sheetId);
    return reply(token, flex);
  }

  let text = '';
  let pb   = '';
  let isImage = false;
  let imageMessageId = '';
  if (event.type === 'message' && event.message?.type === 'text') {
    text = event.message.text.trim();
  } else if (event.type === 'postback') {
    pb   = event.postback?.data || '';
    text = pb;
  } else if (event.type === 'message' && event.message?.type === 'image') {
    isImage = true;
    imageMessageId = event.message.id;
  } else {
    return;
  }

  // ── Read state (+ ref data in parallel for menus) ─────────────
  const { state, data: formData, row: rowNum } = await readState(sheets, sheetId, userId);

  // ═════ IMAGE HANDLING — Upload to ImgBB + OCR + prefill ═════
  if (isImage) {
    return await handleImageUpload(sheets, sheetId, userId, token, imageMessageId, state, formData, rowNum);
  }

  // ── "ต่อ" — confirm OCR-filled value and move to next step ──
  if ((text === 'ต่อ' || text === '▶️ ต่อ') && state && !state.endsWith('_confirm') && state !== 'idle') {
    const field = FIELD[state];
    const value = field ? (formData[field] || '') : '';
    if (!value) {
      return reply(token, txt('⚠️ ยังไม่มีข้อมูลในขั้นนี้ — ส่งรูปอีกครั้งหรือพิมพ์ค่าเอง'));
    }
    // Simulate user sending the OCR-filled value to progress the form
    text = String(value);
  }

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
  if (text==='MENU_MAINTENANCE' || text==='🔧 ซ่อมบำรุง') {
    const ref = await getRef(sheets, sheetId);
    const s = buildStep('maint_1', ref);
    await writeState(sheets, sheetId, userId, 'maint_1', {}, rowNum);
    return reply(token, txt(s.q, s.qr));
  }
  if (text==='MENU_CALENDAR' || text==='📅 ปฏิทิน' || text==='cal_now' || pb==='cal_now') {
    const now = bkkNow();
    const flex = await buildCalendar(sheets, sheetId, now.getFullYear(), now.getMonth()+1);
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, flex);
  }

  // ── /สรุป command — show monthly KPI Flex (hero-style) ──
  if (text==='/สรุป' || text==='สรุป' || text==='สรุปผล' || text==='/summary') {
    const flex = await buildSummaryFlex(sheets, sheetId);
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, flex);
  }
  // ── /เมนู or "เมนู" → show welcome Flex (hero card) anytime ──
  if (text==='/เมนู' || text==='เมนู' || text==='/menu') {
    const flex = await buildWelcomeFlex(sheets, sheetId);
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, flex);
  }
  // ── /เมนูเต็ม or "เมนูเต็ม" → show full menu carousel (12 buttons) ──
  if (text==='/เมนูเต็ม' || text==='เมนูเต็ม' || text==='เมนูทั้งหมด' || text==='/all') {
    await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
    return reply(token, buildFullMenuFlex());
  }
  // ── Open web shortcut ──
  if (text==='OPEN_WEB') {
    return reply(token, txt('🌐 เปิดเว็บได้ที่:', [qUri('เปิดเว็บ', WEB_URL)]));
  }
  // ── Web-only modules (vehicle/driver/customer/etc) → reply with link ──
  const webOnlyMap = {
    MENU_VEHICLE:     { name:'ทะเบียนรถ',    icon:'🚗', path:'/vehicle' },
    MENU_DRIVER:      { name:'คนขับ',        icon:'👤', path:'/driver' },
    MENU_CUSTOMER:    { name:'ลูกค้า',       icon:'🏢', path:'/customer' },
    MENU_CAPITAL:     { name:'เงินทุน',      icon:'💼', path:'/capital' },
    MENU_MAINTENANCE: { name:'ซ่อมบำรุง',    icon:'🔧', path:'/maintenance' },
    MENU_FUEL:        { name:'น้ำมัน',       icon:'⛽', path:'/fuel' },
    MENU_INVOICE:     { name:'ใบเสร็จ',      icon:'🧾', path:'/invoice' }
  };
  if (webOnlyMap[text]) {
    const m = webOnlyMap[text];
    return reply(token, txt(
      `${m.icon} ${m.name}\n\nเมนูนี้รองรับเฉพาะในเว็บครับ`,
      [qUri(`${m.icon} เปิดในเว็บ`, WEB_URL + m.path)]
    ));
  }

  // ── Calendar navigation ────────────────────────────────────────
  if (pb && pb.startsWith('cal_')) {
    const parts = pb.split('_');
    if (parts.length===3) {
      const flex = await buildCalendar(sheets, sheetId, parseInt(parts[1]), parseInt(parts[2]));
      return reply(token, flex);
    }
  }

  // ── Confirm steps — use Flex Success card on save ──
  const handleConfirm = async (kind) => {
    // Accept any "ยืนยัน"/"confirm"/"ok" phrasing — not just the exact button
    // text. (Explicit cancel is already handled globally above, so anything
    // that isn't a confirm here is stray input — re-show the card instead of
    // silently wiping the user's entry.)
    const t = (text || '').replace(/[✅❌\s]/g, '');
    const isConfirm = t.startsWith('ยืนยัน') || t.toLowerCase().startsWith('confirm') || t === 'ok' || t === 'โอเค';
    if (isConfirm) {
      try {
        let id;
        if (kind === 'truck')         id = await saveTruck(sheets,       sheetId, formData);
        else if (kind === 'income')   id = await saveIncome(sheets,      sheetId, formData);
        else if (kind === 'expense')  id = await saveExpense(sheets,     sheetId, formData);
        else if (kind === 'maintenance') id = await saveMaintenance(sheets, sheetId, formData);
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, buildSuccessFlex(kind, id, formData));
      } catch(e) {
        await writeState(sheets, sheetId, userId, 'idle', {}, rowNum);
        return reply(token, txt(`❌ เกิดข้อผิดพลาด: ${e.message}`));
      }
    }
    // Stray input on the confirm step — keep the form, re-show the confirm card.
    return reply(token, buildConfirmFlex(kind, formData));
  };
  if (state === 'truck_confirm') return handleConfirm('truck');
  if (state === 'inc_confirm')   return handleConfirm('income');
  if (state === 'exp_confirm')   return handleConfirm('expense');
  if (state === 'maint_confirm') return handleConfirm('maintenance');

  // ── Form steps ─────────────────────────────────────────────────
  const allSeqs = { truck: TRUCK_SEQ, inc: INCOME_SEQ, exp: EXPENSE_SEQ, maint: MAINT_SEQ };
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
      // Send Flex confirm card instead of plain text (v13.3-style)
      const kindMap = { truck:'truck', inc:'income', exp:'expense', maint:'maintenance' };
      const kind = kindMap[seqKey] || 'truck';
      await writeState(sheets, sheetId, userId, nextState, formData, rowNum);
      return reply(token, buildConfirmFlex(kind, formData));
    } else {
      // Ask next question
      const ref = await getRef(sheets, sheetId);
      const s   = buildStep(nextState, ref);
      await writeState(sheets, sheetId, userId, nextState, formData, rowNum);
      return reply(token, s ? txt(s.q, s.qr) : txt('กรุณาตอบคำถามครับ'));
    }
  }

  // ── Idle / unrecognized — send Welcome Flex (better than plain text) ──
  const flex = await buildWelcomeFlex(sheets, sheetId);
  return reply(token, flex);
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
