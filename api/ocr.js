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

  // วันที่ — รองรับหลายรูปแบบ
  const thaiMonths = {
    'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,
    'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12,
    'มกราคม':1,'กุมภาพันธ์':2,'มีนาคม':3,'เมษายน':4,'พฤษภาคม':5,'มิถุนายน':6,
    'กรกฎาคม':7,'สิงหาคม':8,'กันยายน':9,'ตุลาคม':10,'พฤศจิกายน':11,'ธันวาคม':12
  };
  // รูปแบบไทย: "14 พ.ค. 2569" หรือ "14 พฤษภาคม 2569"
  const thDt = text.match(/(\d{1,2})\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s+(\d{4})/);
  if (thDt) {
    const mm   = String(thaiMonths[thDt[2]] || 1).padStart(2, '0');
    const yr   = parseInt(thDt[3]);
    const adYr = yr > 2400 ? yr - 543 : yr;
    r.date = `${adYr}-${mm}-${String(thDt[1]).padStart(2, '0')}`;
  } else {
    // รูปแบบ "วันที่ 6 เดือน 5 พ.ศ. 69" (ใบชมพู Premier)
    const boxDt = text.match(/วันที่\s*(\d{1,2})\s*เดือน\s*(\d{1,2})\s*(?:พ\.ศ\.)?\s*(\d{2,4})/);
    if (boxDt) {
      let yr = boxDt[3];
      yr = yr.length === 2 ? (parseInt(yr) < 70 ? '20'+yr : '25'+yr) : yr;
      const num = parseInt(yr);
      const adYear = num > 2400 ? num - 543 : num;
      r.date = adYear + '-' + String(boxDt[2]).padStart(2,'0') + '-' + String(boxDt[1]).padStart(2,'0');
    } else {
      // รูปแบบตัวเลข: dd/mm/yyyy หรือ dd-mm-yy (เช่น 01-05-26 ของ KLN)
      const dt = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:\s+\d{1,2}:\d{2})?/);
      if (dt) {
        let yr = dt[3];
        // 2-digit year: 00-69 → 20xx (AD), 70-99 → ตรวจว่า Buddhist หรือ AD
        if (yr.length === 2) yr = parseInt(yr) < 70 ? '20'+yr : '25'+yr;
        const num = parseInt(yr);
        const adYear = num > 2400 ? num - 543 : num;
        r.date = adYear + '-' + String(dt[2]).padStart(2,'0') + '-' + String(dt[1]).padStart(2,'0');
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

  return r;
}
