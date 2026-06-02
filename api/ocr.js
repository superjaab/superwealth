/**
 * POST /api/ocr
 * Body: { base64: string, mimeType?: string }
 * → { success, text, parsed }  |  { success: false, error }
 *
 * ใช้ OCR.space API (ฟรี 25,000 req/เดือน)
 * สมัครรับ API Key ได้ที่ https://ocr.space/ocrapi
 *
 * Env: OCRSPACE_API_KEY
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey)
    return res.status(500).json({ success: false, error: 'Missing OCRSPACE_API_KEY' });

  const { base64, mimeType = 'image/jpeg' } = req.body || {};
  if (!base64)
    return res.status(400).json({ success: false, error: 'Missing base64' });

  try {
    // ลองทั้ง Engine 2 (แม่นกว่า) และ Engine 1 (รองรับภาพได้หลายแบบ)
    const engines = ['2', '1'];
    let lastError = '';

    for (const engine of engines) {
      const resp = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          apikey:            apiKey,
          base64Image:       `data:${mimeType};base64,${base64}`,
          language:          'tha',
          OCREngine:         engine,
          isTable:           'false',
          scale:             'true',
          detectOrientation: 'true',
          isCreateSearchablePdf: 'false'
        })
      });

      let json;
      try { json = await resp.json(); }
      catch(je) {
        // OCR.space อาจ return HTML error page แทน JSON (เช่น 429 rate limit)
        const raw = await resp.text().catch(() => '');
        lastError = `Engine${engine}: JSON parse error (HTTP ${resp.status}) ${raw.slice(0,80)}`;
        console.error(`[OCR Engine${engine}] Non-JSON response HTTP ${resp.status}:`, raw.slice(0,200));
        continue;
      }

      // debug: log full response
      console.log(`[OCR Engine${engine}] HTTP:${resp.status} ExitCode:${json.OCRExitCode} Errored:${json.IsErroredOnProcessing} Results:${json.ParsedResults?.length}`);

      // ─ handle response รูปแบบผิดปกติ (rate-limit, auth error ฯลฯ)
      // OCR.space บางครั้ง return {"error":...} หรือ {"message":...} โดยไม่มี OCRExitCode
      if (json.OCRExitCode === undefined && !Array.isArray(json.ParsedResults)) {
        const hint = (Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join(', ') : json.ErrorMessage)
                  || json.error || json.message || JSON.stringify(json).slice(0, 120);
        lastError = `Engine${engine}: ${hint}`;
        console.error(`[OCR Engine${engine}] Unexpected response format:`, JSON.stringify(json).slice(0,300));
        continue;
      }

      // ─ error จาก OCR.space (รองรับ boolean true และ string "True"/"true")
      const isErrored = json.IsErroredOnProcessing === true
                     || String(json.IsErroredOnProcessing).toLowerCase() === 'true';
      const exitCode  = typeof json.OCRExitCode === 'string' ? parseInt(json.OCRExitCode) : json.OCRExitCode;

      if (isErrored || exitCode === 6 || exitCode === 99) {
        const errMsg = Array.isArray(json.ErrorMessage)
          ? json.ErrorMessage.join(', ')
          : (json.ErrorMessage || json.ErrorDetails || `ExitCode=${exitCode}`);
        lastError = `Engine${engine}: ${errMsg}`;
        console.error(`[OCR Engine${engine}] API error:`, errMsg);
        continue;
      }

      // OCRExitCode 2 = fatal error (wrong API key ฯลฯ)
      if (exitCode === 2) {
        lastError = `Engine${engine}: Fatal error (key อาจไม่ถูกต้อง, ExitCode=2)`;
        continue;
      }

      const result = json.ParsedResults?.[0];
      if (!result) {
        lastError = `Engine${engine}: ไม่มี ParsedResults (ExitCode=${exitCode})`;
        continue;
      }

      const fileExitCode = typeof result.FileParseExitCode === 'string'
        ? parseInt(result.FileParseExitCode) : result.FileParseExitCode;
      if (fileExitCode !== 1) {
        lastError = `Engine${engine}: ${result.ErrorMessage || 'FileParseExitCode=' + fileExitCode}`;
        continue;
      }

      const text = (result.ParsedText || '').trim();
      if (!text) { lastError = `Engine${engine}: ข้อความว่าง`; continue; }

      // สำเร็จ!
      return res.json({
        success: true,
        text,
        engine,           // บอกว่าใช้ engine ไหน
        parsed: parseOCR(text)
      });
    }

    // ทั้ง 2 engine ล้มเหลว
    return res.json({ success: false, error: `อ่านภาพไม่ได้ทั้ง 2 engine: ${lastError}` });

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

// ─── OCR parser — แยกข้อมูลจากข้อความดิบ ─────────────────

function parseOCR(text) {
  const r = {};

  // ทะเบียนรถ — ค้นหาจาก keyword ก่อน แล้วค่อย fallback pattern ทั่วไป
  const plateByKeyword = text.match(/(?:ทะเบียนรถ|ทะเบียน|Truck\s*Reg(?:istration)?(?:\s*No\.?)?)\s*[:\s]\s*([ก-ฮ]{1,3}[\d]{1,2}[-\s]\d{3,4}|\d{1,2}[-\s]\d{3,4}\s*[ก-ฮ]{1,3}|[ก-ฮ]{1,3}\s*\d{4})/i);
  if (plateByKeyword) {
    r.plateNumber = plateByKeyword[1].trim();
  } else {
    const plate = text.match(/[ก-ฮ]{1,3}[\s]?\d{1,2}[-]\d{3,4}|\d{1,2}[-]\d{3,4}[\s]?[ก-ฮ]{1,3}|[ก-ฮ]{1,3}[\s-]?\d{3,4}/);
    if (plate) r.plateNumber = plate[0].replace(/\s+/g, '').trim();
  }

  // ── วันที่ — รองรับหลายรูปแบบ (สลิปธนาคาร / ใบเสร็จ / ใบกำกับ) ──
  // v15.51: เพิ่ม (1) ปี พ.ศ. 2 หลัก "พ.ค. 68"  (2) OCR ตัดจุดทิ้ง "พค 68"
  //         (3) เดือนภาษาอังกฤษ "14 May 2025" / "May 14, 2025"
  const TH_MON_NUM = {
    'มกราคม':1,'กุมภาพันธ์':2,'มีนาคม':3,'เมษายน':4,'พฤษภาคม':5,'มิถุนายน':6,
    'กรกฎาคม':7,'สิงหาคม':8,'กันยายน':9,'ตุลาคม':10,'พฤศจิกายน':11,'ธันวาคม':12,
    'มค':1,'กพ':2,'มีค':3,'เมย':4,'พค':5,'มิย':6,'กค':7,'สค':8,'กย':9,'ตค':10,'พย':11,'ธค':12
  };
  const EN_MON_NUM = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  // ปี 2 หลัก: ภาษาไทย→พ.ศ. 25xx, อังกฤษ→ค.ศ. 20xx | ปี >2400 = พ.ศ. → ลบ 543
  const _toAD = (yrStr, buddhist) => {
    let num = parseInt(yrStr, 10);
    if (String(yrStr).length <= 2) num = (buddhist ? 2500 : 2000) + num;
    return num > 2400 ? num - 543 : num;
  };
  // (1) ชื่อเดือนไทย — เต็ม/ย่อ, มี/ไม่มีจุด (เรียงเฉพาะเจาะจงก่อน), ปี 2 หรือ 4 หลัก
  const TH_MON_RE = '(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|มี\\.?ค\\.?|เม\\.?ย\\.?|มิ\\.?ย\\.?|ม\\.?ค\\.?|ก\\.?พ\\.?|พ\\.?ค\\.?|ก\\.?ค\\.?|ส\\.?ค\\.?|ก\\.?ย\\.?|ต\\.?ค\\.?|พ\\.?ย\\.?|ธ\\.?ค\\.?)';
  const thDt = text.match(new RegExp('(\\d{1,2})\\s*' + TH_MON_RE + '\\s*\\.?\\s*(\\d{2,4})'));
  // (3) ชื่อเดือนอังกฤษ
  const EN_MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const enDt1 = text.match(new RegExp('(\\d{1,2})[\\s-]+' + EN_MON_RE + '[\\s,-]+(\\d{2,4})', 'i'));   // 14 May 2025
  const enDt2 = enDt1 ? null : text.match(new RegExp(EN_MON_RE + '[\\s.]+(\\d{1,2})(?:st|nd|rd|th)?[\\s,]+(\\d{2,4})', 'i')); // May 14, 2025
  // (2) รูปแบบกล่อง "วันที่ 6 เดือน 5 พ.ศ. 69"
  const boxDt = text.match(/วันที่\s*(\d{1,2})\s*เดือน\s*(\d{1,2})\s*(?:พ\.ศ\.)?\s*(\d{2,4})/);
  // (4) ตัวเลขล้วน dd/mm/yy(yy)
  const numDt = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+\d{1,2}:\d{2})?/);

  if (thDt) {
    const mm = TH_MON_NUM[thDt[2].replace(/[.\s]/g, '')] || TH_MON_NUM[thDt[2]] || 1;
    r.date = `${_toAD(thDt[3], true)}-${String(mm).padStart(2,'0')}-${String(thDt[1]).padStart(2,'0')}`;
  } else if (enDt1 || enDt2) {
    const m = enDt1 || enDt2;
    const day = enDt1 ? m[1] : m[2];
    const mm  = EN_MON_NUM[(enDt1 ? m[2] : m[1]).slice(0,3).toLowerCase()] || 1;
    r.date = `${_toAD(m[3], false)}-${String(mm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  } else if (boxDt) {
    r.date = `${_toAD(boxDt[3], true)}-${String(boxDt[2]).padStart(2,'0')}-${String(boxDt[1]).padStart(2,'0')}`;
  } else if (numDt) {
    // v15.64 — ปี 2 หลักของสลิปไทยมักเป็น พ.ศ. (68 = 2568 = 2025) → ใช้เกณฑ์เดียวกับเดือนไทย
    // (เดิม <70 → 20xx ทำให้ 68/69 กลายเป็น 2068/2069 และไม่ตรงกับสาขาเดือนไทย)
    r.date = `${_toAD(numDt[3], true)}-${String(numDt[2]).padStart(2,'0')}-${String(numDt[1]).padStart(2,'0')}`;
  }

  // v15.64 — ตรวจความถูกต้องของวันที่ ถ้าเป็นไปไม่ได้ (OCR อ่านเพี้ยน เช่น 2025-13-45) ให้ทิ้ง
  if (r.date) {
    const p = r.date.split('-').map(n => parseInt(n, 10));
    const dt = new Date(p[0], p[1] - 1, p[2]);
    const ok = p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= 31 &&
               dt.getFullYear() === p[0] && dt.getMonth() === p[1] - 1 && dt.getDate() === p[2];
    if (!ok) delete r.date;
  }

  // เวลา — รองรับ HH:MM และ HH.MM (รูปแบบไทย "22.43 น." ก็รับ)
  const timePatterns = [
    /(?:เวลา|Time)[^\d]{0,5}(\d{1,2})[:.](\d{2})/i,        // "เวลา 22:43" หรือ "Time: 22:43"
    /(\d{1,2})[:.](\d{2})\s*น\.?/,                          // "22:43 น." หรือ "22.43 น"
    /(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(\d{1,2}):(\d{2})/,  // "01/05/26 14:30"
    /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/m                 // บรรทัดที่มีแค่ "14:30" (เช่น สลิป)
  ];
  for (const p of timePatterns) {
    const m = text.match(p);
    if (m) {
      const hh = String(m[1]).padStart(2, '0');
      const mm = String(m[2]).padStart(2, '0');
      if (+hh >= 0 && +hh <= 23 && +mm >= 0 && +mm <= 59) {
        r.time = `${hh}:${mm}`;
        break;
      }
    }
  }

  // ยอดเงิน — รองรับหลายรูปแบบ: สลิปโอนเงิน, ใบเสร็จ, Invoice
  const amtPatterns = [
    // keyword + ตัวเลข (อาจมีช่องว่าง/ขึ้นบรรทัดใหม่ระหว่างกัน)
    /(?:ยอดโอน|ยอดชำระ|ยอดรวม|ยอดสุทธิ|ยอดเงิน|จำนวนเงิน|รวมทั้งสิ้น|รวมเงิน|รวม|ทั้งสิ้น|ค่าขนส่ง|ค่าบริการ|Amount|Total)[\s\S]{0,30}?(\d[\d,]*(?:\.\d{1,2})?)/i,
    // ตัวเลขตามด้วย บาท/฿/THB
    /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿|THB)/i,
    // ฿/THB นำหน้าตัวเลข
    /(?:฿|THB)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    // ตัวเลขที่มี .00 อยู่โดดๆ ในบรรทัด (เช่น สลิป SCB "119.00")
    /^\s*(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/m,
  ];
  for (const p of amtPatterns) {
    const m = text.match(p);
    if (m) {
      const raw = (m[2] || m[1]).replace(/,/g, '');
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0) { r.amount = val; break; }
    }
  }

  // น้ำหนักบรรทุก — ค้นหาจาก keyword ก่อน (ใบชั่งน้ำหนัก)
  const wtKeyword = text.match(/(?:น้ำหนักบรรทุก|น้ำหนักสุทธิ|นน\.สุทธิ|นน\.สุทธิ์|Quantity\s*\(MT\))[^\d]*(\d[\d,]*(?:\.\d+)?)/i);
  if (wtKeyword) {
    let val = parseFloat(wtKeyword[1].replace(/,/g, ''));
    // ถ้าหน่วยเป็น MT (ตันเมตริก) แปลงเป็น กก.
    if (/Quantity\s*\(MT\)/i.test(wtKeyword[0]) && val < 1000) val = val * 1000;
    r.cargoWeight = val;
  } else {
    const wt = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:กก\.?|kg|กิโล(?:กรัม)?)/i);
    if (wt) r.cargoWeight = parseFloat(wt[1].replace(/,/g, ''));
  }

  // เบอร์โทรศัพท์
  const ph = text.match(/0[689]\d[\s-]?\d{3}[\s-]?\d{4}|0\d[\s-]?\d{4}[\s-]?\d{4}/);
  if (ph) r.driverPhone = ph[0].replace(/[\s]/g, '-');

  // เลขที่เอกสาร — รองรับหลาย format
  const doc = text.match(/(?:รหัสอ้างอิง|เลขที่อ้างอิง|เลขที่ใบชั่ง|เลขที่ใบส่ง|เลขที่ชั่ง|เลขที่|ใบส่งของเลขที่|invoice\s*no\.?|inv\.?\s*no\.?|เลขใบเสร็จ|ref\.?)[^\w\dก-ฮ\-]*([A-Z0-9ก-ฮ\-\/]{4,})/i);
  if (doc) r.docNumber = doc[1].trim();
  // No. format (KLN slip: "STARCH-0040")
  else {
    const noFmt = text.match(/^(?:No\.|STARCH|INV|DOC)[^\n]*?([A-Z0-9\-]{4,})/im);
    if (noFmt) r.docNumber = noFmt[0].trim().split(/\s+/).pop();
  }

  // ชื่อสินค้า (cargoList)
  const cargo = text.match(/(?:ชื่อสินค้า|สินค้า|Product\s*Name)[^\n:]{0,5}[:\s]+([^\n]{3,50})/i);
  if (cargo) r.cargoList = cargo[1].trim();

  // ชื่อบริษัท / ลูกค้า / คู่ค้า
  // 1) ค้นจาก keyword "ชื่อคู่ค้า / ชื่อลูกค้า / Customer Name" — รองรับค่าอยู่บรรทัดถัดไปด้วย
  const custKeyword = text.match(/(?:ชื่อผู้ซื้อ|ชื่อลูกค้า|ชื่อคู่ค้า|Customer\s*Name)[^\n:]{0,5}[:\s]+([\s\S]{0,5}?)([^\n]{3,60})/i);
  if (custKeyword) {
    const val = (custKeyword[2] || custKeyword[1] || '').replace(/\[.*?\]/g, '').trim();
    if (val.length >= 3) r.customerName = val;
  }
  // 2) fallback: หาชื่อนิติบุคคลทุกรูปแบบ (บจก./บริษัท/หจก./ห้างฯ/ร้าน)
  if (!r.customerName) {
    const cust = text.match(/(?:บริษัท|บจก\.?|ห้างหุ้นส่วน|หจก\.?|ร้าน)[^\n]{2,50}(?:จำกัด|จก\.)?/);
    if (cust) r.customerName = cust[0].trim();
  }
  // 3) fallback: บรรทัดแรกของเอกสารที่ดูเหมือนชื่อบริษัท (มี บจก/บริษัท/หจก นำหน้า)
  if (!r.customerName) {
    const firstMatch = text.split('\n')
      .map(l => l.trim())
      .find(l => l.length >= 5 && /^(?:บจก|บริษัท|หจก|ห้าง|ร้าน)/.test(l));
    if (firstMatch) r.customerName = firstMatch;
  }

  // ── วิธีชำระเงิน — detect จากข้อความ ──
  if      (/QR|พร้อมเพย์|PromptPay/i.test(text))                              r.paymentMethod = 'โอน QR';
  else if (/โอนเงิน|รับโอน|โอน|transfer/i.test(text))                          r.paymentMethod = 'เงินโอน';
  else if (/เงินสด|cash/i.test(text))                                          r.paymentMethod = 'เงินสด';
  else if (/เช็ค|cheque|check/i.test(text))                                    r.paymentMethod = 'เช็ค';

  // ── หมวดรายจ่าย — detect สำหรับใบเสร็จ ──
  if      (/น้ำมัน|ดีเซล|เบนซิน|ปั๊ม|fuel|diesel|petrol|gasoline/i.test(text))  r.expenseCategory = 'ค่าน้ำมัน';
  else if (/ซ่อม|repair|maintenance|อู่|ช่างรถ/i.test(text))                     r.expenseCategory = 'ค่าซ่อม';
  else if (/อะไหล่|spare|part|ยางรถ|แบตเตอรี่|battery/i.test(text))             r.expenseCategory = 'ค่าอะไหล่';
  else if (/ค่าแรง|แรงงาน|labour|labor/i.test(text))                             r.expenseCategory = 'ค่าแรง';
  else if (/ทางด่วน|expressway|toll|ด่าน/i.test(text))                           r.expenseCategory = 'ค่าทางด่วน';
  else if (/อาหาร|food|ร้านอาหาร|ร้านข้าว/i.test(text))                         r.expenseCategory = 'ค่าอาหาร';

  // ── รายการรายรับ — smart detect สำหรับสลิป/ใบเสร็จ ──
  if (r.cargoList) {
    r.incomeItem = r.cargoList;
  } else if (/ค่าขนส่ง|freight|shipping|ขนส่ง/i.test(text)) {
    r.incomeItem = 'ค่าขนส่ง';
  } else if (/ค่าบริการ|service fee|service/i.test(text)) {
    r.incomeItem = 'ค่าบริการ';
  } else if (/โอนเงิน|สลิป|transfer|รับโอน/i.test(text)) {
    r.incomeItem = 'ค่าขนส่ง';  // สลิปโอนเงิน default = ค่าขนส่ง
  }

  return r;
}
