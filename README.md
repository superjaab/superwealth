# ระบบขนส่งรถบรรทุก — คู่มือการติดตั้งและ Deploy

## ภาพรวม

Web App สำหรับบริษัทขนส่งรถบรรทุก ใช้งานผ่านมือถือและคอมพิวเตอร์ได้  
บันทึกข้อมูลลง **Google Sheets** และรูปภาพลง **Google Drive** มีฟีเจอร์ OCR อ่านข้อความจากภาพ

---

## ขั้นตอนที่ 1 — สร้าง Google Sheet

1. ไปที่ [sheets.google.com](https://sheets.google.com) แล้วกด **"+ Blank"** สร้าง Spreadsheet ใหม่
2. ตั้งชื่อไฟล์ว่า **"ระบบขนส่งรถบรรทุก"** (หรือชื่ออื่นก็ได้)
3. คัดลอก **Spreadsheet ID** จาก URL:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```
4. เก็บ ID นี้ไว้ใช้ในขั้นตอนที่ 5

> **หมายเหตุ:** ไม่ต้องสร้าง Sheet เอง — Apps Script จะสร้าง Sheet ชื่อ `TruckJobs`, `Income`, `Expense` ให้อัตโนมัติตอนบันทึกครั้งแรก

---

## ขั้นตอนที่ 2 — สร้าง Folder ใน Google Drive

1. ไปที่ [drive.google.com](https://drive.google.com)
2. กด **"+ New" → "Folder"** สร้างโฟลเดอร์ชื่อ **"รูปขนส่ง"** (หรือชื่ออื่น)
3. เปิดโฟลเดอร์ แล้วคัดลอก **Folder ID** จาก URL:
   ```
   https://drive.google.com/drive/folders/[FOLDER_ID]
   ```
4. เก็บ ID นี้ไว้ใช้ในขั้นตอนที่ 5

---

## ขั้นตอนที่ 3 — เปิดใช้งาน Google Cloud Vision API

> ต้องทำถ้าต้องการฟีเจอร์ OCR อ่านข้อความจากรูปภาพ  
> ถ้าไม่ต้องการ OCR ข้ามขั้นตอนนี้ได้ (ปุ่ม OCR จะแสดง error แต่ระบบอื่นยังทำงานได้ปกติ)

1. ไปที่ [console.cloud.google.com](https://console.cloud.google.com)
2. สร้าง Project ใหม่ หรือเลือก Project ที่มีอยู่
3. ไปที่เมนู **"APIs & Services" → "Library"**
4. ค้นหา **"Cloud Vision API"** แล้วกด **Enable**
5. ไปที่ **"APIs & Services" → "Credentials"**
6. กด **"+ CREATE CREDENTIALS" → "API Key"**
7. คัดลอก API Key ที่ได้
8. (แนะนำ) กด **"Restrict Key"** → ตั้ง API restrictions เลือกเฉพาะ **Cloud Vision API**
9. เก็บ API Key นี้ไว้ใช้ในขั้นตอนที่ 5

---

## ขั้นตอนที่ 4 — สร้าง Google Apps Script Project

1. ไปที่ [script.google.com](https://script.google.com)
2. กด **"+ New project"**
3. ตั้งชื่อโปรเจกต์ว่า **"ระบบขนส่งรถบรรทุก"**
4. จะมีไฟล์ `Code.gs` อยู่แล้ว — **ลบโค้ดเดิมทิ้งทั้งหมด**
5. วางโค้ดจากไฟล์ `Code.gs` ที่ให้มาทั้งหมด
6. กด **"+" ด้านซ้าย → "HTML"** สร้างไฟล์ใหม่ชื่อ **`index`** (ไม่ต้องใส่ .html)
7. วางโค้ดจากไฟล์ `index.html` ที่ให้มาทั้งหมด
8. กด **บันทึก (Ctrl+S)**

---

## ขั้นตอนที่ 5 — ตั้งค่า Script Properties (สำคัญมาก)

ค่า `SHEET_ID`, `DRIVE_FOLDER_ID`, `VISION_API_KEY` ต้องเก็บในนี้ **ห้ามใส่ใน Code โดยตรง**

1. ใน Apps Script Editor ไปที่เมนู **"Project Settings"** (ไอคอนรูปเฟือง ⚙️)
2. เลื่อนลงหา **"Script Properties"**
3. กด **"Add script property"** แล้วเพิ่มค่าดังนี้:

| Property Name    | Value                          |
|------------------|-------------------------------|
| `SHEET_ID`       | ID ของ Google Sheets (จากขั้นตอนที่ 1) |
| `DRIVE_FOLDER_ID`| ID ของ Drive Folder (จากขั้นตอนที่ 2) |
| `VISION_API_KEY` | API Key ของ Vision API (จากขั้นตอนที่ 3) |

4. กด **"Save script properties"**

---

## ขั้นตอนที่ 6 — Deploy เป็น Web App

1. ใน Apps Script Editor กด **"Deploy" → "New deployment"**
2. กด ⚙️ ด้านข้าง **"Select type"** เลือก **"Web app"**
3. ตั้งค่าดังนี้:
   - **Description:** ระบบขนส่งรถบรรทุก v1.0
   - **Execute as:** `Me (your-email@gmail.com)`
   - **Who has access:** `Anyone` (ถ้าต้องการให้ทุกคนใช้ได้) หรือ `Anyone with Google Account`
4. กด **"Deploy"**
5. ยืนยันสิทธิ์การเข้าถึง → กด **"Authorize access"** → เลือกบัญชี → กด **"Allow"**
6. คัดลอก **Web app URL** ที่แสดง เช่น:
   ```
   https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec
   ```
7. URL นี้คือลิงก์สำหรับเปิด Web App

---

## ขั้นตอนที่ 7 — ทดสอบบนมือถือ

1. เปิด URL จากขั้นตอนที่ 6 บนมือถือ
2. เพิ่มเป็น Home Screen:
   - **iPhone (Safari):** กด Share → "Add to Home Screen"
   - **Android (Chrome):** กด ⋮ → "Add to Home screen"
3. ทดสอบกรอกข้อมูลและบันทึก
4. ตรวจสอบว่าข้อมูลปรากฏใน Google Sheets

---

## ขั้นตอนที่ 8 — อัปเดตโค้ด (ถ้าแก้ไขในอนาคต)

เมื่อแก้ไข `Code.gs` หรือ `index.html` แล้วต้องการ Deploy เวอร์ชันใหม่:

1. กด **"Deploy" → "Manage deployments"**
2. กดดินสอ ✏️ แก้ไข deployment ที่มีอยู่
3. เปลี่ยน **Version** เป็น **"New version"**
4. กด **"Deploy"**
5. URL เดิมยังใช้ได้ ไม่ต้องเปลี่ยน

---

## โครงสร้างไฟล์

```
web super wealth/
├── Code.gs        → Google Apps Script (backend)
├── index.html     → หน้าเว็บหลัก (HTML + CSS + JS)
└── README.md      → คู่มือนี้
```

---

## โครงสร้าง Google Sheets

### Sheet: TruckJobs
| คอลัมน์ | ชื่อ | คำอธิบาย |
|---|---|---|
| A | timestamp | เวลาที่บันทึก |
| B | jobDate | วันที่งาน |
| C | jobTime | เวลา |
| D | plateNumber | ทะเบียนรถ |
| E | driverName | ชื่อคนขับ |
| F | driverPhone | เบอร์โทรคนขับ |
| G | origin | ต้นทาง |
| H | destination | ปลายทาง |
| I | customerName | ชื่อลูกค้า |
| J | cargoList | รายการสินค้า |
| K | cargoWeight | น้ำหนัก (กก.) |
| L | tripCount | จำนวนเที่ยว |
| M | freightCost | ค่าขนส่ง (บาท) |
| N | jobStatus | สถานะงาน |
| O | remark | หมายเหตุ |
| P | imageUrls | URL รูปภาพ (JSON array) |
| Q | ocrText | ข้อความจาก OCR |
| R | userAgent | Browser ที่ใช้ |
| S | rowId | รหัส TRUCK-YYYYMMDD-XXXX |

### Sheet: Income
| คอลัมน์ | ชื่อ | คำอธิบาย |
|---|---|---|
| A | timestamp | เวลาที่บันทึก |
| B | incomeDate | วันที่รับเงิน |
| C | docNumber | เลขที่เอกสาร |
| D | customerName | ชื่อลูกค้า |
| E | incomeItem | รายการรายรับ |
| F | amount | จำนวนเงิน (บาท) |
| G | paymentMethod | วิธีรับเงิน |
| H | remark | หมายเหตุ |
| I | imageUrls | URL รูปภาพ |
| J | ocrText | ข้อความจาก OCR |
| K | userAgent | Browser |
| L | rowId | รหัส INC-YYYYMMDD-XXXX |

### Sheet: Expense
| คอลัมน์ | ชื่อ | คำอธิบาย |
|---|---|---|
| A | timestamp | เวลาที่บันทึก |
| B | expenseDate | วันที่จ่ายเงิน |
| C | category | หมวดรายจ่าย |
| D | plateNumber | ทะเบียนรถ |
| E | vendor | ร้านค้า/ผู้รับเงิน |
| F | expenseDetail | รายละเอียด |
| G | amount | จำนวนเงิน (บาท) |
| H | paymentMethod | วิธีจ่ายเงิน |
| I | remark | หมายเหตุ |
| J | imageUrls | URL รูปภาพ |
| K | ocrText | ข้อความจาก OCR |
| L | userAgent | Browser |
| M | rowId | รหัส EXP-YYYYMMDD-XXXX |

---

## การแก้ปัญหาที่พบบ่อย

**Q: กด Deploy แล้วขึ้น "Authorization required"**  
A: กด "Authorize access" → เลือกบัญชี Google → กด "Advanced" → "Go to ระบบขนส่ง (unsafe)" → "Allow"

**Q: บันทึกแล้วไม่ขึ้น Google Sheets**  
A: ตรวจสอบว่าตั้ง `SHEET_ID` ใน Script Properties ถูกต้อง และ Spreadsheet อยู่ใน Google Account เดียวกับที่ Deploy

**Q: อัปโหลดรูปไม่ได้**  
A: ตรวจสอบ `DRIVE_FOLDER_ID` และให้แน่ใจว่า Apps Script มีสิทธิ์เข้าถึง Drive (จะถามตอน Authorize ครั้งแรก)

**Q: OCR ไม่ทำงาน**  
A: ตรวจสอบ `VISION_API_KEY` และดูว่า Cloud Vision API ถูก Enable ใน Google Cloud Console แล้ว

**Q: แก้โค้ดแล้วหน้าเว็บยังเหมือนเดิม**  
A: ต้อง Deploy เวอร์ชันใหม่ — ดูขั้นตอนที่ 8 ด้านบน

---

## ความปลอดภัย

- `SHEET_ID`, `DRIVE_FOLDER_ID`, `VISION_API_KEY` เก็บใน Script Properties เท่านั้น ไม่ปรากฏในโค้ด HTML
- รับเฉพาะไฟล์รูปภาพ (image/jpeg, png, webp, gif, heic)
- จำกัดขนาดไฟล์ไม่เกิน 10MB ต่อรูป
- ชื่อไฟล์รูปภาพถูกตั้งใหม่อัตโนมัติ: `{formKey}-{timestamp}-{random}.{ext}`
