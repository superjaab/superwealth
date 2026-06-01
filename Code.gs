/**
 * ระบบขนส่งรถบรรทุก - Google Apps Script
 * Version: 1.1.0
 *
 * Script Properties ที่ต้องตั้งค่า:
 *   SHEET_ID         = ID ของ Google Sheets
 *   DRIVE_FOLDER_ID  = ID ของ Google Drive Folder
 *   VISION_API_KEY   = Google Cloud Vision API Key
 */

// ─────────────────────────────────────────
//  ONETRACK GPS — SERVER-SIDE LOGIN PROXY
//  Login ฝั่ง server → ได้ JSESSIONID → ส่งกลับ browser
//  Browser โหลด iframe ด้วย ;jsessionid= ใน URL
//  ไม่ต้องใช้ cookie → ไม่มีปัญหา SameSite
// ─────────────────────────────────────────

const ONETRACK_BASE = 'https://onetracksmart.onelink.co.th/onetrack.smart.new';

function loginOneTrack(user, pass) {
  try {
    const resp = UrlFetchApp.fetch(ONETRACK_BASE + '/CheckUserPassDJ', {
      method: 'post',
      payload: 'name=' + encodeURIComponent(user) + '&pass=' + encodeURIComponent(pass),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': ONETRACK_BASE + '/login.jsp'
      },
      followRedirects: false,
      muteHttpExceptions: true
    });

    const allHeaders  = resp.getAllHeaders();
    const setCookies  = allHeaders['Set-Cookie'] || allHeaders['set-cookie'] || [];
    const cookieList  = Array.isArray(setCookies) ? setCookies : [setCookies];
    const location    = (allHeaders['Location'] || allHeaders['location'] || '').trim();

    // วิเคราะห์ผล redirect
    if (!location) {
      return { success: false, error: 'ไม่ได้รับ response จากเซิร์ฟเวอร์' };
    }
    if (location.includes('manyConnection')) {
      return { success: false, error: 'MANY_CONNECTION' };
    }
    if (location.includes('login.jsp')) {
      return { success: false, error: 'username หรือ password ไม่ถูกต้อง' };
    }

    // ดึง JSESSIONID จาก Set-Cookie
    let sessionId = '';
    for (const c of cookieList) {
      const m = String(c).match(/JSESSIONID=([^;]+)/i);
      if (m) { sessionId = m[1]; break; }
    }

    if (!sessionId) {
      return { success: false, error: 'ไม่ได้รับ session จากเซิร์ฟเวอร์' };
    }

    // สร้าง authenticated URL โดยฝัง ;jsessionid= ใน path
    // วิธีนี้ทำให้ browser ไม่ต้องมี cookie เลย
    let dashUrl = location.replace(/^http:\/\//i, 'https://');
    if (!dashUrl.includes(';jsessionid=')) {
      const qIdx = dashUrl.indexOf('?');
      dashUrl = qIdx >= 0
        ? dashUrl.slice(0, qIdx) + ';jsessionid=' + sessionId + dashUrl.slice(qIdx)
        : dashUrl + ';jsessionid=' + sessionId;
    }

    return { success: true, sessionId: sessionId, url: dashUrl };

  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ─────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────

function doGet(e) {
  // Health check route (so we can verify the deployment works)
  if (e && e.parameter && e.parameter.action === 'ping') {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบขนส่งรถบรรทุก')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// v14.66 — POST entry-point — routes by `action` field in the JSON body.
// Vercel /api/upload-images forwards image uploads here so files are
// owned by the SHEET OWNER (uses user's Drive quota — no SA quota issue).
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _gasJson({ success: false, error: 'no body' });
    }
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    switch (action) {
      case 'uploadImages':
        return _gasJson(uploadImages(body));
      case 'ping':
        return _gasJson({ ok: true, ts: new Date().toISOString() });
      default:
        return _gasJson({ success: false, error: 'unknown action: ' + action });
    }
  } catch (err) {
    return _gasJson({ success: false, error: String(err && err.message || err) });
  }
}

function _gasJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────

function _getProps() {
  const p = PropertiesService.getScriptProperties();
  return {
    sheetId:   p.getProperty('SHEET_ID'),
    folderId:  p.getProperty('DRIVE_FOLDER_ID'),
    visionKey: p.getProperty('VISION_API_KEY')
  };
}

function _genId(prefix) {
  const d = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd');
  const r = Math.random().toString(36).substr(2, 4).toUpperCase();
  return prefix + '-' + d + '-' + r;
}

function _ensureSheet(ss, name, headers, color) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setFontWeight('bold')
          .setBackground(color)
          .setFontColor('#ffffff')
          .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    // ปรับความกว้างคอลัมน์อัตโนมัติ
    for (let i = 1; i <= headers.length; i++) {
      sheet.setColumnWidth(i, 150);
    }
  }
  return sheet;
}

// ─────────────────────────────────────────
//  UPLOAD IMAGES TO GOOGLE DRIVE
// ─────────────────────────────────────────

function uploadImages(payload) {
  try {
    const { folderId } = _getProps();
    if (!folderId) return { success: false, error: 'ไม่พบ DRIVE_FOLDER_ID ใน Script Properties' };

    const folder = DriveApp.getFolderById(folderId);
    const results = [];

    for (const img of payload.images) {
      // ตรวจสอบ MIME type
      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic'];
      if (!allowed.includes(img.mimeType)) {
        results.push({ filename: img.filename, url: '', error: 'ประเภทไฟล์ไม่รองรับ: ' + img.mimeType });
        continue;
      }

      const decoded = Utilities.base64Decode(img.base64);
      const blob = Utilities.newBlob(decoded, img.mimeType, img.filename);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      results.push({
        filename: img.filename,
        url: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
        viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
        id: file.getId()
      });
    }

    return { success: true, urls: results };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ─────────────────────────────────────────
//  OCR — Google Cloud Vision API
// ─────────────────────────────────────────

function performOCR(payload) {
  try {
    const { visionKey } = _getProps();
    if (!visionKey) return { success: false, error: 'ไม่พบ VISION_API_KEY ใน Script Properties' };

    const endpoint = 'https://vision.googleapis.com/v1/images:annotate?key=' + visionKey;
    const body = {
      requests: [{
        image: { content: payload.base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['th', 'en'] }
      }]
    };

    const resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const json = JSON.parse(resp.getContentText());

    if (json.error) return { success: false, error: json.error.message };

    const responses = json.responses;
    if (!responses || !responses[0]) return { success: false, error: 'ไม่ได้รับผลลัพธ์จาก Vision API' };

    if (responses[0].error) return { success: false, error: responses[0].error.message };

    const ann = responses[0].fullTextAnnotation;
    if (!ann || !ann.text) return { success: false, error: 'ไม่พบข้อความในภาพ' };

    return {
      success: true,
      text: ann.text,
      parsed: _parseOCR(ann.text)
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function _parseOCR(text) {
  const r = {};

  // ทะเบียนรถ (เช่น กข-1234, กข 1234, 80-1234 กรุงเทพ)
  const plate = text.match(/[ก-ฮ]{1,3}[\s-]?[ก-ฮ]{0,3}[\s-]?\d{3,4}|\d{1,2}[\s-]\d{4}/);
  if (plate) r.plateNumber = plate[0].replace(/\s+/g, ' ').trim();

  // วันที่ (dd/mm/yyyy หรือ dd-mm-yyyy หรือ dd.mm.yyyy)
  const dt = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dt) {
    let yr = dt[3];
    if (yr.length === 2) yr = '25' + yr;
    // แปลงพ.ศ. เป็น ค.ศ. ถ้าปี > 2500
    const num = parseInt(yr);
    const adYear = num > 2400 ? num - 543 : num;
    r.date = adYear + '-' + String(dt[2]).padStart(2, '0') + '-' + String(dt[1]).padStart(2, '0');
  }

  // ยอดเงิน (รวม, ยอด, บาท, ฿)
  const amtPatterns = [
    /(?:รวม|ยอด|ทั้งสิ้น|จำนวนเงิน|ค่าขนส่ง)[^\d]*(\d[\d,]*(?:\.\d{1,2})?)/,
    /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿)/
  ];
  for (const p of amtPatterns) {
    const m = text.match(p);
    if (m) { r.amount = parseFloat((m[1]).replace(/,/g, '')); break; }
  }

  // น้ำหนัก
  const wt = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:กก\.?|kg|กิโล(?:กรัม)?|ตัน|ton)/i);
  if (wt) r.cargoWeight = parseFloat(wt[1].replace(/,/g, ''));

  // เบอร์โทรศัพท์
  const ph = text.match(/0[689]\d[\s-]?\d{3}[\s-]?\d{4}|0\d{1}[\s-]?\d{4}[\s-]?\d{4}/);
  if (ph) r.driverPhone = ph[0].replace(/[\s]/g, '-');

  // เลขที่เอกสาร / Invoice
  const doc = text.match(/(?:เลขที่|ใบส่งของเลขที่|invoice\s*no\.?|inv\.?\s*no\.?|เลขใบเสร็จ)[^\w\dก-ฮ]*([A-Z0-9ก-ฮ\-\/]+)/i);
  if (doc) r.docNumber = doc[1].trim();

  // ชื่อลูกค้า / บริษัท
  const cust = text.match(/(?:บริษัท|ร้าน|หจก\.?)[^\n]{2,30}(?:จำกัด|จก\.)?/);
  if (cust) r.customerName = cust[0].trim();

  return r;
}

// ─────────────────────────────────────────
//  SAVE TRUCK JOB
// ─────────────────────────────────────────

function saveTruckJob(data) {
  try {
    const { sheetId } = _getProps();
    if (!sheetId) return { success: false, error: 'ไม่พบ SHEET_ID ใน Script Properties' };

    const ss = SpreadsheetApp.openById(sheetId);
    const headers = [
      'timestamp', 'jobDate', 'jobTime', 'plateNumber', 'driverName', 'driverPhone',
      'origin', 'destination', 'customerName', 'cargoList', 'cargoWeight', 'tripCount',
      'freightCost', 'jobStatus', 'remark', 'imageUrls', 'ocrText', 'userAgent', 'rowId'
    ];
    const sheet = _ensureSheet(ss, 'TruckJobs', headers, '#1565C0');
    const rowId = _genId('TRUCK');

    sheet.appendRow([
      new Date(),
      data.jobDate    || '',
      data.jobTime    || '',
      data.plateNumber|| '',
      data.driverName || '',
      data.driverPhone|| '',
      data.origin     || '',
      data.destination|| '',
      data.customerName|| '',
      data.cargoList  || '',
      Number(data.cargoWeight)  || 0,
      Number(data.tripCount)    || 1,
      Number(data.freightCost)  || 0,
      data.jobStatus  || 'รอโหลด',
      data.remark     || '',
      JSON.stringify(data.imageUrls || []),
      data.ocrText    || '',
      data.userAgent  || '',
      rowId
    ]);

    return { success: true, rowId: rowId, message: 'บันทึกข้อมูลรถบรรทุกสำเร็จ' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ─────────────────────────────────────────
//  SAVE INCOME
// ─────────────────────────────────────────

function saveIncome(data) {
  try {
    const { sheetId } = _getProps();
    if (!sheetId) return { success: false, error: 'ไม่พบ SHEET_ID ใน Script Properties' };

    const ss = SpreadsheetApp.openById(sheetId);
    const headers = [
      'timestamp', 'incomeDate', 'docNumber', 'customerName', 'incomeItem',
      'amount', 'paymentMethod', 'remark', 'imageUrls', 'ocrText', 'userAgent', 'rowId'
    ];
    const sheet = _ensureSheet(ss, 'Income', headers, '#2E7D32');
    const rowId = _genId('INC');

    sheet.appendRow([
      new Date(),
      data.incomeDate    || '',
      data.docNumber     || '',
      data.customerName  || '',
      data.incomeItem    || '',
      Number(data.amount)|| 0,
      data.paymentMethod || 'เงินสด',
      data.remark        || '',
      JSON.stringify(data.imageUrls || []),
      data.ocrText       || '',
      data.userAgent     || '',
      rowId
    ]);

    return { success: true, rowId: rowId, message: 'บันทึกรายรับสำเร็จ' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ─────────────────────────────────────────
//  SAVE EXPENSE
// ─────────────────────────────────────────

function saveExpense(data) {
  try {
    const { sheetId } = _getProps();
    if (!sheetId) return { success: false, error: 'ไม่พบ SHEET_ID ใน Script Properties' };

    const ss = SpreadsheetApp.openById(sheetId);
    const headers = [
      'timestamp', 'expenseDate', 'category', 'plateNumber', 'vendor',
      'expenseDetail', 'amount', 'paymentMethod', 'remark',
      'imageUrls', 'ocrText', 'userAgent', 'rowId'
    ];
    const sheet = _ensureSheet(ss, 'Expense', headers, '#B71C1C');
    const rowId = _genId('EXP');

    sheet.appendRow([
      new Date(),
      data.expenseDate   || '',
      data.category      || '',
      data.plateNumber   || '',
      data.vendor        || '',
      data.expenseDetail || '',
      Number(data.amount)|| 0,
      data.paymentMethod || 'เงินสด',
      data.remark        || '',
      JSON.stringify(data.imageUrls || []),
      data.ocrText       || '',
      data.userAgent     || '',
      rowId
    ]);

    return { success: true, rowId: rowId, message: 'บันทึกรายจ่ายสำเร็จ' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
