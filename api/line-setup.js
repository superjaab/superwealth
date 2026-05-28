'use strict';
/**
 * GET  /api/line-setup          → show current rich menu status
 * POST /api/line-setup          → create rich menu + set as default
 * POST /api/line-setup?delete=1 → delete all rich menus
 *
 * Call once after deploy. Requires LINE_CHANNEL_ACCESS_TOKEN in env.
 */

const LINE_API = 'https://api.line.me/v2/bot';

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
  // 2×3 grid = 6 cells, each ~833×843
  // Row 1: 🚛 บันทึกรถ · 💰 รายรับ · 💸 รายจ่าย
  // Row 2: 📅 ปฏิทิน · 🔧 ซ่อมบำรุง · ⚡ เมนูทั้งหมด
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686">
  <!-- Row 1 -->
  <rect x="0"    y="0"    width="833"  height="843" fill="#1565C0"/>
  <rect x="833"  y="0"    width="834"  height="843" fill="#2E7D32"/>
  <rect x="1667" y="0"    width="833"  height="843" fill="#B71C1C"/>
  <!-- Row 2 -->
  <rect x="0"    y="843"  width="833"  height="843" fill="#0D47A1"/>
  <rect x="833"  y="843"  width="834"  height="843" fill="#E65100"/>
  <rect x="1667" y="843"  width="833"  height="843" fill="#6A1B9A"/>

  <!-- Icons row 1 -->
  <text x="416"  y="420"  text-anchor="middle" fill="white" font-size="200" font-family="Arial">🚛</text>
  <text x="416"  y="600"  text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">บันทึกรถ</text>

  <text x="1250" y="420"  text-anchor="middle" fill="white" font-size="200" font-family="Arial">💰</text>
  <text x="1250" y="600"  text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">รายรับ</text>

  <text x="2083" y="420"  text-anchor="middle" fill="white" font-size="200" font-family="Arial">💸</text>
  <text x="2083" y="600"  text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">รายจ่าย</text>

  <!-- Icons row 2 -->
  <text x="416"  y="1263" text-anchor="middle" fill="white" font-size="200" font-family="Arial">📅</text>
  <text x="416"  y="1443" text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">ปฏิทินรถ</text>

  <text x="1250" y="1263" text-anchor="middle" fill="white" font-size="200" font-family="Arial">🔧</text>
  <text x="1250" y="1443" text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">ซ่อมบำรุง</text>

  <text x="2083" y="1263" text-anchor="middle" fill="white" font-size="200" font-family="Arial">⚡</text>
  <text x="2083" y="1443" text-anchor="middle" fill="white" font-size="78"  font-family="Arial" font-weight="bold">เมนูทั้งหมด</text>

  <!-- Grid lines -->
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
  if (req.method === 'POST') {
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

  return res.status(405).end();
};
