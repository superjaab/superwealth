'use strict';
/**
 * GET  /api/line-setup          → show current rich menu status
 * POST /api/line-setup          → create rich menu + set as default
 * POST /api/line-setup?delete=1 → delete all rich menus
 * POST /api/line-setup?fullSetup=1 → ทำทุก step: delete old + create + render SVG + upload + set default
 *
 * Call once after deploy. Requires LINE_CHANNEL_ACCESS_TOKEN in env.
 */

const LINE_API  = 'https://api.line.me/v2/bot';
const LINE_DATA = 'https://api-data.line.me/v2/bot';

async function lineAPI(path, method = 'GET', body = null, isBlob = false) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  };
  if (body && !isBlob) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isBlob) {
    opts.headers['Content-Type'] = 'image/jpeg';
    opts.body = body;
  }
  const r = await fetch(`${LINE_API}${path}`, opts);
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

// Rich menu definition: 2 rows × 3 columns = 6 cells (5 features + 1 "เมนูเพิ่ม")
// Layout:
//   ┌─────────┬─────────┬─────────┐
//   │ 🚛 รถ   │ 💰 รับ  │ 💸 จ่าย │
//   ├─────────┼─────────┼─────────┤
//   │ 📅 ปฏิทิน│ 🔧 ซ่อม │ ⚡ เมนู │
//   └─────────┴─────────┴─────────┘
function richMenuBody() {
  const W = 2500, H = 1686;
  const CW = Math.floor(W / 3);  // column width ~833
  const RH = Math.floor(H / 2);  // row height = 843
  return {
    size: { width: W, height: H },
    selected: true,
    name: 'SuperWealth Menu v2',
    chatBarText: '📋 เมนู',
    areas: [
      // Row 1
      { bounds: { x: 0,      y: 0,  width: CW, height: RH }, action: { type:'postback', label:'🚛 บันทึกรถ',  data:'MENU_TRUCK',       displayText:'🚛 บันทึกรถ' } },
      { bounds: { x: CW,     y: 0,  width: CW, height: RH }, action: { type:'postback', label:'💰 รายรับ',   data:'MENU_INCOME',      displayText:'💰 รายรับ' } },
      { bounds: { x: CW*2,   y: 0,  width: W-CW*2, height: RH }, action: { type:'postback', label:'💸 รายจ่าย', data:'MENU_EXPENSE',  displayText:'💸 รายจ่าย' } },
      // Row 2
      { bounds: { x: 0,      y: RH, width: CW, height: H-RH }, action: { type:'postback', label:'📅 ปฏิทิน',   data:'MENU_CALENDAR',    displayText:'📅 ปฏิทิน' } },
      { bounds: { x: CW,     y: RH, width: CW, height: H-RH }, action: { type:'postback', label:'🔧 ซ่อมบำรุง', data:'MENU_MAINTENANCE', displayText:'🔧 ซ่อมบำรุง' } },
      { bounds: { x: CW*2,   y: RH, width: W-CW*2, height: H-RH }, action: { type:'postback', label:'⚡ เมนูทั้งหมด', data:'/เมนูเต็ม', displayText:'⚡ เมนูทั้งหมด' } }
    ]
  };
}

// Build a minimal 2500×1686 JPEG image (4 colored quadrants) using Canvas-free approach.
// Uses raw PPM → JPEG via a simple approach. Since we can't use canvas, we generate
// a placeholder PNG-like buffer. LINE requires JPEG; we build a minimal valid JPEG.
// For production: replace this with a proper designed image uploaded via LINE OA Manager.
function buildMenuImageSVG() {
  // 2×3 grid = 6 cells. Emoji dropped (Sarabun has no emoji glyphs and
  // resvg can't render color emoji) — replaced with simple white SVG icons
  // drawn from basic shapes, plus a big Thai label rendered with Sarabun.
  const cells = [
    { x:416,  yt:0,    fill:'#1565C0', label:'บันทึกรถ',   icon:'truck' },
    { x:1250, yt:0,    fill:'#2E7D32', label:'รายรับ',     icon:'plus'  },
    { x:2083, yt:0,    fill:'#B71C1C', label:'รายจ่าย',    icon:'minus' },
    { x:416,  yt:843,  fill:'#0D47A1', label:'ปฏิทินรถ',   icon:'cal'   },
    { x:1250, yt:843,  fill:'#E65100', label:'ซ่อมบำรุง',  icon:'wrench'},
    { x:2083, yt:843,  fill:'#6A1B9A', label:'เมนูทั้งหมด', icon:'grid'  }
  ];

  // Simple white icon centered at (cx, cy), drawn from primitives.
  function icon(name, cx, cy) {
    const S = 'fill="none" stroke="white" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"';
    switch (name) {
      case 'truck':
        return `<rect x="${cx-115}" y="${cy-40}" width="150" height="95" rx="12" ${S}/>
                <path d="M${cx+35} ${cy-10} h55 l30 40 v25 h-85 z" ${S}/>
                <circle cx="${cx-65}" cy="${cy+70}" r="26" ${S}/>
                <circle cx="${cx+65}" cy="${cy+70}" r="26" ${S}/>`;
      case 'plus':
        return `<circle cx="${cx}" cy="${cy+10}" r="85" ${S}/>
                <line x1="${cx-45}" y1="${cy+10}" x2="${cx+45}" y2="${cy+10}" ${S}/>
                <line x1="${cx}" y1="${cy-35}" x2="${cx}" y2="${cy+55}" ${S}/>`;
      case 'minus':
        return `<circle cx="${cx}" cy="${cy+10}" r="85" ${S}/>
                <line x1="${cx-45}" y1="${cy+10}" x2="${cx+45}" y2="${cy+10}" ${S}/>`;
      case 'cal':
        return `<rect x="${cx-90}" y="${cy-65}" width="180" height="160" rx="16" ${S}/>
                <line x1="${cx-90}" y1="${cy-20}" x2="${cx+90}" y2="${cy-20}" ${S}/>
                <line x1="${cx-45}" y1="${cy-95}" x2="${cx-45}" y2="${cy-45}" ${S}/>
                <line x1="${cx+45}" y1="${cy-95}" x2="${cx+45}" y2="${cy-45}" ${S}/>`;
      case 'wrench':
        return `<path d="M${cx+60} ${cy-70} a55 55 0 1 0 -75 75 l-55 55 a30 30 0 0 0 40 40 l55 -55 a55 55 0 0 0 35 -115 l-40 40 -25 -25 z" ${S}/>`;
      case 'grid':
        return [[-55,-55],[55,-55],[-55,55],[55,55]].map(([dx,dy]) =>
          `<rect x="${cx+dx-35}" y="${cy+dy-35}" width="70" height="70" rx="12" ${S}/>`).join('');
      default: return '';
    }
  }

  const rects = cells.map(c =>
    `<rect x="${c.x-416}" y="${c.yt}" width="833" height="843" fill="${c.fill}"/>`).join('');

  const content = cells.map(c => {
    const cy = c.yt + 320;       // icon center
    const ly = c.yt + 600;       // label baseline
    return `${icon(c.icon, c.x, cy)}
      <text x="${c.x}" y="${ly}" text-anchor="middle" fill="white" font-size="120"
            font-family="Sarabun" font-weight="bold">${c.label}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686">
  ${rects}
  ${content}
  <line x1="833"  y1="0"   x2="833"  y2="1686" stroke="white" stroke-width="6"/>
  <line x1="1667" y1="0"   x2="1667" y2="1686" stroke="white" stroke-width="6"/>
  <line x1="0"    y1="843" x2="2500" y2="843"  stroke="white" stroke-width="6"/>
</svg>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Missing LINE_CHANNEL_ACCESS_TOKEN' });

  // ── GET: show status ──────────────────────────────────────────
  if (req.method === 'GET') {
    const list = await lineAPI('/richmenu/list');
    const def  = await lineAPI('/user/all/richmenu');
    return res.json({
      richMenus: list.data?.richmenus || [],
      defaultRichMenuId: def.data?.richMenuId || null,
      svgPreview: buildMenuImageSVG(),
      instructions: [
        '1. POST /api/line-setup  →  สร้าง rich menu (โครงสร้าง + set default)',
        '2. ไปที่ LINE OA Manager → Rich Menu → อัปโหลดรูปภาพทับ rich menu ที่สร้างไว้',
        '   หรือใช้ SVG ใน svgPreview แปลงเป็น JPEG แล้ว POST /api/line-setup?uploadImage=<richMenuId>',
        '3. Webhook URL: https://superwealth.vercel.app/api/line-webhook',
      ]
    });
  }

  // ── DELETE all rich menus ─────────────────────────────────────
  if (req.method === 'POST' && req.query.delete) {
    const list = await lineAPI('/richmenu/list');
    const ids  = (list.data?.richmenus || []).map(m => m.richMenuId);
    for (const id of ids) {
      await lineAPI(`/richmenu/${id}`, 'DELETE');
    }
    return res.json({ deleted: ids });
  }

  // ── POST: create rich menu and set as default ─────────────────
  if (req.method === 'POST' && !req.query.uploadImage && !req.query.fullSetup) {
    // 1. Create rich menu structure
    const create = await lineAPI('/richmenu', 'POST', richMenuBody());
    if (create.status !== 200) {
      return res.status(create.status).json({ error: 'Failed to create rich menu', detail: create.data });
    }
    const richMenuId = create.data.richMenuId;

    // 2. Set as default for all users
    const setDefault = await lineAPI(`/user/all/richmenu/${richMenuId}`, 'POST');

    return res.json({
      success: true,
      richMenuId,
      setDefaultStatus: setDefault.status,
      nextStep: `อัปโหลดรูปเมนูที่ LINE OA Manager หรือ POST /api/line-setup?uploadImage=${richMenuId}`,
      webhookUrl: 'https://superwealth.vercel.app/api/line-webhook',
    });
  }

  // ── POST: upload rendered image to existing rich menu ─────────
  if (req.method === 'POST' && req.query.uploadImage) {
    const richMenuId = String(req.query.uploadImage);
    try {
      const jpegBuffer = await renderMenuSVGtoJPEG();
      const upload = await fetch(`${LINE_DATA}/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: jpegBuffer
      });
      const uploadText = await upload.text();
      if (!upload.ok) {
        return res.status(upload.status).json({ error: 'Image upload failed', detail: uploadText });
      }
      // Set as default after upload
      const setDef = await lineAPI(`/user/all/richmenu/${richMenuId}`, 'POST');
      return res.json({
        success: true,
        richMenuId,
        imageBytes: jpegBuffer.length,
        setDefaultStatus: setDef.status,
        message: '✅ Rich Menu image uploaded + set as default'
      });
    } catch (e) {
      return res.status(500).json({ error: 'Render/upload failed', detail: e.message });
    }
  }

  // ── POST ?fullSetup=1: ทำทั้งหมด (delete old + create + render + upload + set default) ──
  if (req.method === 'POST' && req.query.fullSetup) {
    try {
      // 1. Delete all existing menus
      const list = await lineAPI('/richmenu/list');
      const oldIds = (list.data?.richmenus || []).map(m => m.richMenuId);
      for (const id of oldIds) await lineAPI(`/richmenu/${id}`, 'DELETE');

      // 2. Create new menu structure
      const create = await lineAPI('/richmenu', 'POST', richMenuBody());
      if (create.status !== 200) return res.status(create.status).json({ error:'create failed', detail: create.data });
      const newId = create.data.richMenuId;

      // 3. Render SVG → JPEG
      const jpegBuffer = await renderMenuSVGtoJPEG();

      // 4. Upload image to LINE
      const upload = await fetch(`${LINE_DATA}/richmenu/${newId}/content`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: jpegBuffer
      });
      if (!upload.ok) {
        const t = await upload.text();
        return res.status(upload.status).json({ error:'upload failed', detail: t });
      }

      // 5. Set as default
      const setDef = await lineAPI(`/user/all/richmenu/${newId}`, 'POST');

      return res.json({
        success: true,
        deleted: oldIds,
        created: newId,
        imageBytes: jpegBuffer.length,
        setDefaultStatus: setDef.status,
        message: '🎉 Rich Menu setup complete — 5 features + เมนูทั้งหมด ใช้งานได้ทันที'
      });
    } catch (e) {
      return res.status(500).json({ error:'fullSetup failed', detail: e.message });
    }
  }

  return res.status(405).end();
};

// Render the SVG menu image → JPEG via @resvg/resvg-js (lightweight, ~6MB)
async function renderMenuSVGtoJPEG() {
  const fs   = require('fs');
  const path = require('path');
  const { Resvg } = require('@resvg/resvg-js');

  // Vercel Linux has no Thai (or Arial) system font, so loadSystemFonts
  // rendered Thai text as nothing. Bundle Sarabun and load it explicitly.
  // fs.readFileSync(path.join(__dirname, ...)) is traced by Vercel's file
  // tracer so the .ttf is included in the function bundle.
  const fontBuffer = fs.readFileSync(path.join(__dirname, 'fonts', 'Sarabun-Bold.ttf'));

  const svgString = buildMenuImageSVG();
  const resvg = new Resvg(svgString, {
    background: '#0f172a',
    fitTo: { mode: 'width', value: 2500 },
    font: {
      fontBuffers: [fontBuffer],
      loadSystemFonts: false,
      defaultFontFamily: 'Sarabun'
    }
  });
  const pngData = resvg.render();
  return pngData.asPng();   // LINE accepts PNG (Content-Type: image/png)
}
