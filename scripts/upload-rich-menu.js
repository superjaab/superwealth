#!/usr/bin/env node
/**
 * One-off script: convert rich menu SVG → JPEG → upload to LINE + set as default.
 * Requires: LINE_CHANNEL_ACCESS_TOKEN in env (or .env.local).
 *
 * Usage:
 *   node scripts/upload-rich-menu.js <richMenuId>
 *
 * Or auto-detect latest menu:
 *   node scripts/upload-rich-menu.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Load env from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('❌ Missing LINE_CHANNEL_ACCESS_TOKEN');
  process.exit(1);
}

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA = 'https://api-data.line.me/v2/bot';

async function lineFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) }
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

(async () => {
  // 1. Get rich menu ID (from argv or auto-detect)
  let richMenuId = process.argv[2];
  if (!richMenuId) {
    console.log('🔍 Auto-detecting latest rich menu...');
    const list = await lineFetch(`${LINE_API}/richmenu/list`);
    const menus = list.data?.richmenus || [];
    if (!menus.length) { console.error('❌ No rich menus found'); process.exit(1); }
    richMenuId = menus[menus.length - 1].richMenuId;
  }
  console.log(`📋 Rich Menu ID: ${richMenuId}`);

  // 2. Fetch SVG from our deployed endpoint
  console.log('📥 Fetching SVG from /api/line-setup...');
  const setupRes = await fetch('https://superwealth.vercel.app/api/line-setup');
  const setupData = await setupRes.json();
  const svgString = setupData.svgPreview;
  if (!svgString) { console.error('❌ No svgPreview in response'); process.exit(1); }
  console.log(`✅ SVG: ${svgString.length} chars`);

  // 3. Convert SVG → JPEG via sharp (2500×1686, quality 90)
  console.log('🎨 Converting SVG → JPEG...');
  const jpegBuffer = await sharp(Buffer.from(svgString), { density: 150 })
    .resize(2500, 1686, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .jpeg({ quality: 90 })
    .toBuffer();
  console.log(`✅ JPEG: ${(jpegBuffer.length / 1024).toFixed(1)} KB`);

  // Save local preview for debugging
  const previewPath = path.join(__dirname, '..', 'rich-menu-preview.jpg');
  fs.writeFileSync(previewPath, jpegBuffer);
  console.log(`💾 Saved preview: ${previewPath}`);

  // 4. Upload to LINE (must use api-data.line.me endpoint, not api.line.me)
  console.log('📤 Uploading to LINE...');
  const uploadRes = await fetch(`${LINE_DATA}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'image/jpeg'
    },
    body: jpegBuffer
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) {
    console.error(`❌ Upload failed (${uploadRes.status}): ${uploadText}`);
    process.exit(1);
  }
  console.log(`✅ Upload OK (status ${uploadRes.status})`);

  // 5. Set as default rich menu
  console.log('🎯 Setting as default rich menu...');
  const defRes = await lineFetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, { method: 'POST' });
  if (defRes.status !== 200) {
    console.error(`❌ Set default failed (${defRes.status}):`, defRes.data);
    process.exit(1);
  }
  console.log('✅ Set as default for all users');

  console.log('\n🎉 ALL DONE! Rich Menu LIVE บน LINE แล้ว');
  console.log(`   • Menu ID: ${richMenuId}`);
  console.log(`   • 6 buttons (5 features + เมนูทั้งหมด)`);
  console.log(`   • Preview saved at: ${previewPath}`);
})().catch(e => {
  console.error('💥 Error:', e.message);
  process.exit(1);
});
