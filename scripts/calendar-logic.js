function initCalendar() {
  if (!_calInited) {
    const today = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
    _calYear  = today.getFullYear();
    _calMonth = today.getMonth();
    _calInited = true;
  }
  loadCalTrips();
}
function calNav(delta) {
  _calMultiMonths = [];   // exit multi-month view when using arrows
  _calMonth += delta;
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
  renderCalendar();
}
function calGoToday() {
  _calMultiMonths = [];
  const today = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
  _calYear  = today.getFullYear();
  _calMonth = today.getMonth();
  renderCalendar();
}
function calChangePlate(plate) {
  _calPlate = plate || '';
  renderCalendar();
}

// ── MONTH PICKER (always multi-select, click to add/remove) ──
const CAL_TH_MON_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
let _mpYear = null;
let _mpStaging = [];           // staging selection [{year,month}, ...]

function toggleMonthPicker(e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById('month-picker');
  if (!dd) return;
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    _mpYear = _calYear;
    // Start with current selection (multi or single current month)
    _mpStaging = _calMultiMonths.length ? [..._calMultiMonths] : [{year:_calYear, month:_calMonth}];
    _renderMonthPicker();
  }
}
function calMpYear(delta) {
  _mpYear += delta;
  _renderMonthPicker();
}
function _isStagingSelected(year, month) {
  return _mpStaging.some(s => s.year === year && s.month === month);
}
function _renderMonthPicker() {
  const yl = document.getElementById('mp-year-label');
  const mc = document.getElementById('mp-months');
  const ft = document.getElementById('mp-footer');
  if (yl) yl.textContent = `พ.ศ. ${_mpYear + 543}`;
  if (mc) {
    mc.innerHTML = CAL_TH_MON_SHORT.map((name, idx) => {
      const sel = _isStagingSelected(_mpYear, idx);
      return `<button class="mp-month-btn ${sel?'active':''}" onclick="calMpClickMonth(${idx})">${name}</button>`;
    }).join('');
  }
  if (ft) {
    const n = _mpStaging.length;
    ft.innerHTML = `
      <div style="font-size:.7rem;color:#64748b;text-align:center;margin-bottom:6px;line-height:1.4">
        ${n === 0 ? '⚠️ ยังไม่ได้เลือกเดือน' : `เลือกแล้ว ${n} เดือน — กดเดือนเพื่อเพิ่ม/นำออก`}
      </div>
      <button class="mp-apply" onclick="calMpApply()" ${n===0?'disabled style="opacity:.4;cursor:not-allowed"':''}>
        ✅ ${n <= 1 ? 'แสดงเดือนนี้' : 'แสดง ' + n + ' เดือน'}
      </button>
      ${n > 1 ? '<button class="mp-clear" onclick="_mpStaging=[];_renderMonthPicker()">🗑 ล้างทั้งหมด</button>' : ''}`;
  }
}
function calMpClickMonth(month) {
  // Always toggle in staging
  const i = _mpStaging.findIndex(s => s.year === _mpYear && s.month === month);
  if (i >= 0) _mpStaging.splice(i, 1);
  else        _mpStaging.push({year:_mpYear, month});
  _renderMonthPicker();
}
function calMpApply() {
  if (_mpStaging.length === 0) return;
  if (_mpStaging.length === 1) {
    _calMultiMonths = [];
    _calYear  = _mpStaging[0].year;
    _calMonth = _mpStaging[0].month;
  } else {
    // Sort chronologically
    _calMultiMonths = [..._mpStaging].sort((a,b) => (a.year - b.year) || (a.month - b.month));
    _calYear  = _calMultiMonths[0].year;
    _calMonth = _calMultiMonths[0].month;
  }
  document.getElementById('month-picker').classList.remove('open');
  renderCalendar();
}
// Close month picker on outside click
document.addEventListener('click', e => {
  const mp = document.getElementById('month-picker');
  if (!mp || !mp.classList.contains('open')) return;
  if (!e.target.closest('#month-picker') && !e.target.closest('#cal-month-label')) {
    mp.classList.remove('open');
  }
});
async function loadCalTrips() {
  document.getElementById('cal-container').innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">⏳ กำลังโหลดข้อมูลเที่ยวรถ...</div>';
  try {
    const res  = await fetch('/api/get-data?type=truck');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'load failed');
    _calTrips = ((json.data || {}).truck) || [];
    _refreshPlateFilterOptions();
    renderCalendar();
  } catch (e) {
    document.getElementById('cal-container').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626">❌ โหลดข้อมูลไม่สำเร็จ: ' + e.message + '</div>';
  }
}
function _refreshPlateFilterOptions() {
  const plates = Array.from(new Set(_calTrips.map(t => (t.plateNumber||'').trim()).filter(p => p))).sort();
  const sel = document.getElementById('cal-plate-filter');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">🚛 ดูรถทุกคัน · ' + _calTrips.length + ' เที่ยวรวม</option>' +
    plates.map(p => `<option value="${escHtml(p)}">🚚 ${escHtml(p)}</option>`).join('');
  if (cur && plates.includes(cur)) sel.value = cur;
}
// ─── STATUS LOGIC (only 2 statuses) ───
// Simple rule based on delivery date (end of trip):
//   - deliveryDate < TODAY  → "ส่งแล้ว"
//   - deliveryDate ≥ TODAY  → "กำลังขนส่ง"
// Fallback: if no deliveryDate, use pickupDate (= single-day trip)
function _autoTripStatus(r) {
  const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
  const todayNum = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const endNum = _calDateNum(r.deliveryDate || r.pickupDate || r.jobDate);
  if (endNum === null) return 'กำลังขนส่ง';
  return endNum < todayNum ? 'ส่งแล้ว' : 'กำลังขนส่ง';
}
function _statusColor(s) {
  return s === 'ส่งแล้ว' ? '#10b981' : '#3b82f6';   // green | blue
}
function _statusDot(s) {
  return s === 'ส่งแล้ว' ? '🟢' : '🔵';
}
function _calStatusClass(s) {
  const auto = (typeof s === 'object') ? _autoTripStatus(s) : s;
  return auto === 'ส่งแล้ว' ? 's-done' : 's-driving';
}
function escHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Date utility — convert "YYYY-MM-DD" → number of days since epoch (UTC midnight)
function _calDateNum(s) {
  if (!s) return null;
  const [y,m,d] = s.slice(0,10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m-1, d) / 86400000);
}
function _numToDateKey(n) {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}
// Compute trip span: returns {startNum, endNum} where each is days-since-epoch
function _getTripSpan(t) {
  const j = _calDateNum(t.jobDate);
  const p = _calDateNum(t.pickupDate);
  const d = _calDateNum(t.deliveryDate);
  const all = [j,p,d].filter(x => x !== null);
  if (all.length === 0) return null;
  return { startNum: Math.min(...all), endNum: Math.max(...all) };
}

function renderCalendar() {
  // Update label (use first month if multi)
  const labelEl = document.getElementById('cal-month-label');
  if (labelEl) {
    if (_calMultiMonths.length > 1) {
      labelEl.textContent = `${_calMultiMonths.length} เดือนที่เลือก ▼`;
    } else {
      labelEl.textContent = `${CAL_TH_MONTHS[_calMonth]} ${_calYear + 543}`;
    }
  }

  // Apply plate filter
  const trips = _calPlate ? _calTrips.filter(t => (t.plateNumber||'') === _calPlate) : _calTrips;

  // Build list of months to render
  const monthsToRender = _calMultiMonths.length > 1
    ? _calMultiMonths
    : [{year:_calYear, month:_calMonth}];

  const container = document.getElementById('cal-container');
  if (!container) return;
  container.innerHTML = monthsToRender.map(m => _buildMonthSection(m.year, m.month, trips)).join('');
}

function _buildMonthSection(year, month, trips) {
  const showTitle = _calMultiMonths.length > 1;
  const tripCount = trips.filter(t => {
    const span = _getTripSpan(t);
    if (!span) return false;
    const monthStart = Math.floor(Date.UTC(year, month, 1) / 86400000);
    const monthEnd   = Math.floor(Date.UTC(year, month + 1, 0) / 86400000);
    return !(span.endNum < monthStart || span.startNum > monthEnd);
  }).length;

  const titleHtml = showTitle
    ? `<div class="cal-month-section-title">📅 ${CAL_TH_MONTHS[month]} ${year + 543}<span class="month-trip-count">${tripCount} เที่ยว</span></div>`
    : '';

  return `<div class="cal-month-section">
    ${titleHtml}
    <div class="cal-grid" ${showTitle?'style="border-radius:0 0 12px 12px"':''}>
      <div class="cal-weekdays">
        <div class="cal-weekday sun">อา</div>
        <div class="cal-weekday">จ</div>
        <div class="cal-weekday">อ</div>
        <div class="cal-weekday">พ</div>
        <div class="cal-weekday">พฤ</div>
        <div class="cal-weekday">ศ</div>
        <div class="cal-weekday sat">ส</div>
      </div>
      <div>${_buildMonthGridWeeks(year, month, trips)}</div>
    </div>
  </div>`;
}

function _buildMonthGridWeeks(_calYear, _calMonth, trips) {
  // Determine the visible date range (6 weeks max)
  const firstDay = new Date(_calYear, _calMonth, 1);
  const startDow = firstDay.getDay();
  const gridStart = new Date(_calYear, _calMonth, 1 - startDow);
  const lastDay   = new Date(_calYear, _calMonth + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + lastDay) / 7) * 7;
  const gridStartNum = Math.floor(Date.UTC(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate()) / 86400000);
  const numWeeks = totalCells / 7;

  const today = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));
  const todayNum = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);

  let html = '';

  for (let w = 0; w < numWeeks; w++) {
    const weekStartNum = gridStartNum + w * 7;
    const weekEndNum   = weekStartNum + 6;

    // 1) Day cells row
    let numsHtml = '';
    for (let c = 0; c < 7; c++) {
      const dayNum = weekStartNum + c;
      const dt = new Date(dayNum * 86400000);
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
      const dow = (weekStartNum + c) % 7; // not reliable timezone-wise, use date object
      const realDow = new Date(y, m, d).getDay();
      const otherMonth = (m !== _calMonth || y !== _calYear);
      const isToday = dayNum === todayNum;
      const sunCls = realDow === 0 ? ' sun' : (realDow === 6 ? ' sat' : '');
      const cls = `cal-daycell${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}${sunCls}`;
      const dateKey = _numToDateKey(dayNum);
      numsHtml += `<div class="${cls}" onclick="openCalDay('${dateKey}')"><span class="cal-day-num">${d}</span></div>`;
    }

    // 2) Collect events that overlap this week
    const weekEvents = [];
    trips.forEach(t => {
      const span = _getTripSpan(t);
      if (!span) return;
      if (span.endNum < weekStartNum || span.startNum > weekEndNum) return;
      const segStart = Math.max(span.startNum, weekStartNum);
      const segEnd   = Math.min(span.endNum, weekEndNum);
      weekEvents.push({
        trip: t,
        segStart,
        segEnd,
        isContinuedLeft:  span.startNum < weekStartNum,
        isContinuedRight: span.endNum   > weekEndNum,
        isMultiDay: span.startNum !== span.endNum
      });
    });

    // 3) Sort by start date, then by length desc
    weekEvents.sort((a,b) => {
      if (a.segStart !== b.segStart) return a.segStart - b.segStart;
      return (b.segEnd - b.segStart) - (a.segEnd - a.segStart);
    });

    // 4) Assign each event to a row (avoid overlap)
    const rows = [];  // rows[i] = [{segStart, segEnd}, ...]
    weekEvents.forEach(ev => {
      let assigned = false;
      for (let r = 0; r < rows.length; r++) {
        const conflict = rows[r].some(e => !(ev.segEnd < e.segStart || ev.segStart > e.segEnd));
        if (!conflict) { rows[r].push(ev); ev.row = r; assigned = true; break; }
      }
      if (!assigned) { rows.push([ev]); ev.row = rows.length - 1; }
    });

    // 5) Render events as grid-positioned bars
    let evtsHtml = '';
    const overflowByCol = [0,0,0,0,0,0,0];
    weekEvents.forEach(ev => {
      if (ev.row >= CAL_MAX_ROWS_PER_WEEK) {
        // Mark overflow for each column it covers
        const colStart = ev.segStart - weekStartNum;
        const colEnd   = ev.segEnd - weekStartNum;
        for (let c = colStart; c <= colEnd; c++) overflowByCol[c]++;
        return;
      }
      const colStart = ev.segStart - weekStartNum + 1;   // 1-based for CSS grid
      const colSpan  = ev.segEnd - ev.segStart + 1;
      const t = ev.trip;
      const cls = _calStatusClass(t);

      // Span position class
      let posCls;
      if (ev.isMultiDay) {
        if (ev.isContinuedLeft && ev.isContinuedRight) posCls = 'span-middle';
        else if (ev.isContinuedLeft)                   posCls = 'span-end';
        else if (ev.isContinuedRight)                  posCls = 'span-start';
        else if (colSpan === 1)                        posCls = 'span-single';
        else                                            posCls = 'span-single';  // both ends in this week → full bar
      } else {
        posCls = 'span-single';
      }

      // Build label — clean & readable (no redundant status dot — bar color shows status)
      const tripStat = _autoTripStatus(t);
      const fmtDM = n => {
        const dt = new Date(n * 86400000);
        return String(dt.getUTCDate()).padStart(2,'0') + '/' + String(dt.getUTCMonth()+1).padStart(2,'0');
      };
      let datePart = '';
      if (ev.isMultiDay) {
        if (!ev.isContinuedLeft && !ev.isContinuedRight) {
          datePart = `${fmtDM(ev.segStart)} – ${fmtDM(ev.segEnd)}`;
        } else if (!ev.isContinuedLeft) {
          datePart = `เริ่ม ${fmtDM(ev.segStart)} ›`;
        } else if (!ev.isContinuedRight) {
          datePart = `‹ ถึง ${fmtDM(ev.segEnd)}`;
        } else {
          datePart = '⋯ ต่อเนื่อง ⋯';
        }
      } else {
        datePart = fmtDM(ev.segStart);
      }
      let labelParts = [];
      if (t.tripRound) labelParts.push(`รอบ ${t.tripRound}`);
      if (!_calPlate && t.plateNumber) labelParts.push(t.plateNumber);
      if (t.origin || t.destination) labelParts.push((t.origin||'-') + ' → ' + (t.destination||'-'));
      else if (t.customerName) labelParts.push(t.customerName);
      const label = `${datePart} · ${labelParts.join(' · ')}`;
      // Payment badge (ค้างจ่าย = red, จ่ายแล้ว = subtle ✓)
      const isPaid = (t.paymentStatus || 'ค้างจ่าย') === 'จ่ายแล้ว';
      const payBadge = isPaid
        ? `<span style="background:rgba(255,255,255,.28);padding:1px 6px;border-radius:10px;font-size:.6rem;font-weight:700;margin-left:6px">✓ ชำระแล้ว</span>`
        : `<span style="background:#fef2f2;color:#b91c1c;padding:1px 6px;border-radius:10px;font-size:.6rem;font-weight:800;margin-left:6px;border:1px solid rgba(185,28,28,.3)">⏰ ค้างจ่าย</span>`;

      // Tooltip
      const tip = [
        t.plateNumber || '?',
        t.customerName ? '🏢 ' + t.customerName : '',
        t.driverName ? '👤 ' + t.driverName : '',
        (t.origin || t.destination) ? '📍 ' + (t.origin||'-') + ' → ' + (t.destination||'-') : '',
        t.cargoList ? '📦 ' + t.cargoList : '',
        t.freightCost ? '💰 ' + t.freightCost + '฿' : '',
        ev.isMultiDay ? '📥 ' + (t.pickupDate||t.jobDate||'') + ' → 📤 ' + (t.deliveryDate||t.jobDate||'') : ''
      ].filter(x => x).join('\n');

      // Click → open day modal of the segment's start day
      const clickDate = _numToDateKey(ev.segStart);
      const bg = _statusColor(tripStat);
      evtsHtml += `<div class="cal-evt-bar ${cls} ${posCls}"
        style="background:${bg};grid-column:${colStart} / span ${colSpan}; grid-row:${ev.row + 1}"
        title="${escHtml(tip)}"
        onclick="event.stopPropagation();openCalDay('${clickDate}')">${escHtml(label)}${payBadge}</div>`;
    });

    // Add overflow indicators per column
    overflowByCol.forEach((n, c) => {
      if (n > 0) {
        evtsHtml += `<div class="cal-evt-more"
          style="grid-column:${c+1}; grid-row:${CAL_MAX_ROWS_PER_WEEK + 1}"
          onclick="event.stopPropagation();openCalDay('${_numToDateKey(weekStartNum + c)}')">+ ${n} เที่ยว</div>`;
      }
    });

    // Calc min event-rows height to allocate
    const usedRows = Math.min(rows.length, CAL_MAX_ROWS_PER_WEEK);
    const hasOverflow = overflowByCol.some(n => n > 0);
    const totalRows = usedRows + (hasOverflow ? 1 : 0);
    const minHeight = Math.max(40, totalRows * 24 + 8);

    html += `<div class="cal-week">
      <div class="cal-week-nums">${numsHtml}</div>
      <div class="cal-week-events" style="min-height:${minHeight}px">${evtsHtml}</div>
    </div>`;
  }

  return html;
}

function openCalDay(dateKey) {
  // Apply plate filter to lookups
  const tripsAll = _calPlate ? _calTrips.filter(t => (t.plateNumber||'') === _calPlate) : _calTrips;
  const targetNum = _calDateNum(dateKey);

  // Find all trips whose span covers this date
  const matches = [];
  tripsAll.forEach(t => {
    const span = _getTripSpan(t);
    if (!span) return;
    if (targetNum < span.startNum || targetNum > span.endNum) return;
    // Determine which kind of date this is
    const isPickup   = _calDateNum(t.pickupDate)   === targetNum;
    const isDelivery = _calDateNum(t.deliveryDate) === targetNum;
    const isJob      = _calDateNum(t.jobDate)      === targetNum;
    let kind = 'transit';
    if (isPickup)        kind = 'pickup';
    else if (isDelivery) kind = 'delivery';
    else if (isJob)      kind = 'job';
    matches.push({ trip: t, kind, span });
  });

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m-1, d);
  const dowTh = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'][dateObj.getDay()];
  document.getElementById('cal-modal-title').textContent =
    `📅 วัน${dowTh}ที่ ${d} ${CAL_TH_MONTHS[m-1]} ${y + 543}` +
    (_calPlate ? ` • ${_calPlate}` : '');

  const body = document.getElementById('cal-modal-body');
  if (matches.length === 0) {
    body.innerHTML = `<div class="cal-empty" style="padding:32px 18px;text-align:center;color:#94a3b8">
      <div style="font-size:2.4rem;margin-bottom:6px">🌤️</div>
      <div style="font-weight:700;color:#475569;margin-bottom:4px">ว่างทั้งวัน</div>
      <div style="font-size:.85rem">ไม่มีเที่ยวรถในวันนี้ ${_calPlate ? 'ของ ' + _calPlate : ''}</div>
    </div>`;
  } else {
    // Helper to format a date number as "DD/MM"
    const fmtDM = n => {
      const dt = new Date(n * 86400000);
      return String(dt.getUTCDate()).padStart(2,'0') + '/' + String(dt.getUTCMonth()+1).padStart(2,'0');
    };
    body.innerHTML = `<div style="font-size:.78rem;color:#64748b;padding:0 4px 10px">พบ <b style="color:#0f172a">${matches.length}</b> เที่ยวรถในวันนี้</div>` +
    matches.map(({trip, kind, span}) => {
      const cls = _calStatusClass(trip);
      const autoStat = _autoTripStatus(trip);
      const statText = autoStat === 'ส่งแล้ว' ? '✅ ส่งถึงแล้ว' : '🚚 กำลังขนส่ง';
      const kindLabel = kind === 'pickup'   ? '📥 วันเข้ารับสินค้า'
                     : kind === 'delivery' ? '📤 วันส่งถึงปลายทาง'
                     : kind === 'transit'  ? '🛣️ อยู่ระหว่างขนส่ง'
                     :                       '🚚 เที่ยวรถ';
      const time = trip.jobTime ? ' · ' + trip.jobTime : '';
      const tripRoundBadge = trip.tripRound
        ? `<span style="background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:8px;font-size:.7rem;font-weight:700">รอบ ${escHtml(trip.tripRound)}</span>`
        : '';
      const isPaid = (trip.paymentStatus || 'ค้างจ่าย') === 'จ่ายแล้ว';
      const paymentBadge = isPaid
        ? `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:8px;font-size:.7rem;font-weight:700">✓ ชำระแล้ว</span>`
        : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:8px;font-size:.7rem;font-weight:700">⏰ ค้างจ่าย</span>`;
      const spanLabel = (span.startNum !== span.endNum)
        ? `<div class="cal-trip-row" style="color:#4f46e5;font-weight:600">🗓️ <b>ช่วงเที่ยว:</b> ${fmtDM(span.startNum)} – ${fmtDM(span.endNum)} (${span.endNum - span.startNum + 1} วัน)</div>`
        : '';
      return `
        <div class="cal-trip-card ${cls}">
          <div class="cal-trip-head" style="flex-wrap:wrap;gap:6px">
            <span class="cal-trip-plate">${escHtml(trip.plateNumber || '-')}</span>
            ${tripRoundBadge}
            <span class="cal-trip-badge ${cls}">${statText}</span>
            ${paymentBadge}
          </div>
          <div class="cal-trip-row" style="color:#64748b;font-size:.75rem;margin-top:2px">${kindLabel}${time}</div>
          ${spanLabel}
          ${trip.customerName ? `<div class="cal-trip-row">🏢 <b>ลูกค้า:</b> ${escHtml(trip.customerName)}</div>` : ''}
          ${trip.driverName   ? `<div class="cal-trip-row">👤 <b>คนขับ:</b> ${escHtml(trip.driverName)}${trip.driverPhone ? ' · ☎️ ' + escHtml(trip.driverPhone) : ''}</div>` : ''}
          ${(trip.origin || trip.destination) ? `<div class="cal-trip-row">📍 <b>เส้นทาง:</b> ${escHtml(trip.origin||'-')} → ${escHtml(trip.destination||'-')}</div>` : ''}
          ${trip.cargoList    ? `<div class="cal-trip-row">📦 <b>สินค้า:</b> ${escHtml(trip.cargoList)}${trip.cargoWeight ? ' · ' + escHtml(trip.cargoWeight) + ' ตัน' : ''}</div>` : ''}
          ${trip.freightCost  ? `<div class="cal-trip-row">💰 <b>ค่าขนส่ง:</b> ${fmtBaht(trip.freightCost)}</div>` : ''}
          ${trip.remark       ? `<div class="cal-trip-row" style="color:#94a3b8;font-size:.78rem">📝 ${escHtml(trip.remark)}</div>` : ''}
        </div>`;
    }).join('');
  }
  document.getElementById('cal-day-modal').classList.add('show');
}
function closeCalDay() {
  document.getElementById('cal-day-modal').classList.remove('show');
}
