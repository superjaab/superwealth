#!/usr/bin/env python3
"""Replace the tire modal HTML block in index.html with the new Claude Design version."""
import re

INDEX_PATH = r"C:\Users\super\Desktop\web super wealth\index.html"
NEW_TIRE_HTML = r'''<div id="tire-modal" style="display:none;position:fixed;inset:0;background:rgba(6,9,22,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:300;align-items:center;justify-content:center;padding:8px">
  <div class="tm-modal" role="dialog" aria-labelledby="tm-title">
    <!-- Header -->
    <header class="tm-head">
      <div style="min-width:0;flex:1">
        <h2 id="tm-title">🚛 แผนผังยาง 22 เส้น</h2>
        <div class="tm-sub">
          <span>กดยางที่ต้องการเปลี่ยน</span>
          <span style="opacity:.4">·</span>
          <span class="tm-plate" id="tm-plate-label">รถบรรทุก</span>
        </div>
      </div>
      <button class="tm-close" onclick="closeTireModal()" aria-label="ปิด">✕</button>
    </header>

    <!-- Body -->
    <div class="tm-body">
      <!-- Quick chips -->
      <div class="tm-chips">
        <button class="tm-qchip" onclick="selectTireGroup('head')">🚛 ทั้งหัวลาก (10)</button>
        <button class="tm-qchip" onclick="selectTireGroup('trailer')">🚌 ทั้งหาง (12)</button>
        <button class="tm-qchip" onclick="selectTireGroup('all')">⚡ ทั้งคัน (22)</button>
      </div>

      <!-- Truck SVG (Claude Design v14.6) -->
      <div class="tm-truck-wrap">
        <svg class="tm-truck-svg" viewBox="0 0 340 760" xmlns="http://www.w3.org/2000/svg" aria-label="ผังรถบรรทุก 22 ล้อ">
          <defs>
            <linearGradient id="tmTireNormal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#0d1f33"/>
            </linearGradient>
            <linearGradient id="tmTireSel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#c4b5fd"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/>
            </linearGradient>
            <linearGradient id="tmCabGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2549a8"/><stop offset="1" stop-color="#0b1d4e"/>
            </linearGradient>
            <linearGradient id="tmWinGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#cbd5e1" stop-opacity=".8"/><stop offset="1" stop-color="#818cf8" stop-opacity=".35"/>
            </linearGradient>
            <linearGradient id="tmDeckGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#1e293b"/><stop offset=".5" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/>
            </linearGradient>
            <filter id="tmCabShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="0" dy="2"/>
              <feComponentTransfer><feFuncA type="linear" slope=".4"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          <text class="tm-arrow-label" x="170" y="20" text-anchor="middle">▲ หน้ารถ</text>

          <!-- Tractor cab -->
          <g filter="url(#tmCabShadow)">
            <rect x="115" y="32" width="110" height="120" rx="12" fill="url(#tmCabGrad)" stroke="rgba(148,163,184,.28)" stroke-width="1"/>
            <path d="M 132 50 L 208 50 L 213 78 L 127 78 Z" fill="url(#tmWinGrad)"/>
            <line x1="170" y1="50" x2="170" y2="78" stroke="rgba(255,255,255,.1)" stroke-width=".5"/>
            <rect x="130" y="120" width="80" height="22" rx="3" fill="rgba(15,23,42,.75)" stroke="rgba(148,163,184,.22)"/>
            <line x1="134" y1="124" x2="206" y2="124" stroke="rgba(148,163,184,.32)" stroke-width=".6"/>
            <line x1="134" y1="128" x2="206" y2="128" stroke="rgba(148,163,184,.32)" stroke-width=".6"/>
            <line x1="134" y1="132" x2="206" y2="132" stroke="rgba(148,163,184,.32)" stroke-width=".6"/>
            <line x1="134" y1="136" x2="206" y2="136" stroke="rgba(148,163,184,.32)" stroke-width=".6"/>
            <line x1="134" y1="140" x2="206" y2="140" stroke="rgba(148,163,184,.32)" stroke-width=".6"/>
            <circle cx="128" cy="98" r="4.5" fill="#fef3c7" opacity=".9"/>
            <circle cx="212" cy="98" r="4.5" fill="#fef3c7" opacity=".9"/>
            <circle cx="128" cy="98" r="2" fill="#fffbeb"/>
            <circle cx="212" cy="98" r="2" fill="#fffbeb"/>
            <rect x="106" y="62" width="7" height="16" rx="1.5" fill="#1e293b" stroke="rgba(148,163,184,.25)"/>
            <rect x="227" y="62" width="7" height="16" rx="1.5" fill="#1e293b" stroke="rgba(148,163,184,.25)"/>
          </g>

          <rect x="148" y="152" width="44" height="180" fill="#1e293b" stroke="rgba(148,163,184,.12)"/>
          <rect x="164" y="152" width="12" height="180" fill="#0a0f1c" opacity=".7"/>
          <line x1="148" y1="180" x2="192" y2="180" stroke="rgba(148,163,184,.16)" stroke-width=".8"/>
          <line x1="148" y1="252" x2="192" y2="252" stroke="rgba(148,163,184,.16)" stroke-width=".8"/>
          <line x1="148" y1="312" x2="192" y2="312" stroke="rgba(148,163,184,.16)" stroke-width=".8"/>

          <!-- STEER axle -->
          <rect x="92" y="105" width="156" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="115" text-anchor="end">หน้า</text>
          <line x1="44" y1="108" x2="74" y2="108" stroke="rgba(148,163,184,.2)" stroke-width=".6" stroke-dasharray="2 2"/>

          <g class="tm-tire" data-id="H1L" onclick="togTire('H1L','หน้าซ้าย')">
            <rect class="tm-tire-body" x="78" y="86" width="30" height="44" rx="8"/>
            <line class="tm-tread" x1="84" y1="93" x2="102" y2="93"/><line class="tm-tread" x1="84" y1="101" x2="102" y2="101"/><line class="tm-tread" x1="84" y1="109" x2="102" y2="109"/><line class="tm-tread" x1="84" y1="117" x2="102" y2="117"/><line class="tm-tread" x1="84" y1="125" x2="102" y2="125"/>
            <circle class="tm-wear" cx="82" cy="90" r="2.6" fill="#10b981"/>
          </g>
          <g class="tm-tire" data-id="H1R" onclick="togTire('H1R','หน้าขวา')">
            <rect class="tm-tire-body" x="232" y="86" width="30" height="44" rx="8"/>
            <line class="tm-tread" x1="238" y1="93" x2="256" y2="93"/><line class="tm-tread" x1="238" y1="101" x2="256" y2="101"/><line class="tm-tread" x1="238" y1="109" x2="256" y2="109"/><line class="tm-tread" x1="238" y1="117" x2="256" y2="117"/><line class="tm-tread" x1="238" y1="125" x2="256" y2="125"/>
            <circle class="tm-wear" cx="258" cy="90" r="2.6" fill="#10b981"/>
          </g>

          <!-- DRIVE 1 -->
          <rect x="60" y="220" width="220" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="225" text-anchor="end">กลาง1</text>

          <g class="tm-tire" data-id="H2LO" onclick="togTire('H2LO','กลาง1-ซ้ายนอก')"><rect class="tm-tire-body" x="62" y="200" width="28" height="42" rx="8"/><line class="tm-tread" x1="68" y1="207" x2="84" y2="207"/><line class="tm-tread" x1="68" y1="214" x2="84" y2="214"/><line class="tm-tread" x1="68" y1="221" x2="84" y2="221"/><line class="tm-tread" x1="68" y1="228" x2="84" y2="228"/><line class="tm-tread" x1="68" y1="235" x2="84" y2="235"/><circle class="tm-wear" cx="66" cy="204" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="H2LI" onclick="togTire('H2LI','กลาง1-ซ้ายใน')"><rect class="tm-tire-body" x="96" y="200" width="28" height="42" rx="8"/><line class="tm-tread" x1="102" y1="207" x2="118" y2="207"/><line class="tm-tread" x1="102" y1="214" x2="118" y2="214"/><line class="tm-tread" x1="102" y1="221" x2="118" y2="221"/><line class="tm-tread" x1="102" y1="228" x2="118" y2="228"/><line class="tm-tread" x1="102" y1="235" x2="118" y2="235"/><circle class="tm-wear" cx="120" cy="204" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="H2RI" onclick="togTire('H2RI','กลาง1-ขวาใน')"><rect class="tm-tire-body" x="216" y="200" width="28" height="42" rx="8"/><line class="tm-tread" x1="222" y1="207" x2="238" y2="207"/><line class="tm-tread" x1="222" y1="214" x2="238" y2="214"/><line class="tm-tread" x1="222" y1="221" x2="238" y2="221"/><line class="tm-tread" x1="222" y1="228" x2="238" y2="228"/><line class="tm-tread" x1="222" y1="235" x2="238" y2="235"/><circle class="tm-wear" cx="220" cy="204" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="H2RO" onclick="togTire('H2RO','กลาง1-ขวานอก')"><rect class="tm-tire-body" x="250" y="200" width="28" height="42" rx="8"/><line class="tm-tread" x1="256" y1="207" x2="272" y2="207"/><line class="tm-tread" x1="256" y1="214" x2="272" y2="214"/><line class="tm-tread" x1="256" y1="221" x2="272" y2="221"/><line class="tm-tread" x1="256" y1="228" x2="272" y2="228"/><line class="tm-tread" x1="256" y1="235" x2="272" y2="235"/><circle class="tm-wear" cx="274" cy="204" r="2.4" fill="#10b981"/></g>

          <!-- DRIVE 2 -->
          <rect x="60" y="280" width="220" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="285" text-anchor="end">กลาง2</text>

          <g class="tm-tire" data-id="H3LO" onclick="togTire('H3LO','กลาง2-ซ้ายนอก')"><rect class="tm-tire-body" x="62" y="260" width="28" height="42" rx="8"/><line class="tm-tread" x1="68" y1="267" x2="84" y2="267"/><line class="tm-tread" x1="68" y1="274" x2="84" y2="274"/><line class="tm-tread" x1="68" y1="281" x2="84" y2="281"/><line class="tm-tread" x1="68" y1="288" x2="84" y2="288"/><line class="tm-tread" x1="68" y1="295" x2="84" y2="295"/><circle class="tm-wear" cx="66" cy="264" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="H3LI" onclick="togTire('H3LI','กลาง2-ซ้ายใน')"><rect class="tm-tire-body" x="96" y="260" width="28" height="42" rx="8"/><line class="tm-tread" x1="102" y1="267" x2="118" y2="267"/><line class="tm-tread" x1="102" y1="274" x2="118" y2="274"/><line class="tm-tread" x1="102" y1="281" x2="118" y2="281"/><line class="tm-tread" x1="102" y1="288" x2="118" y2="288"/><line class="tm-tread" x1="102" y1="295" x2="118" y2="295"/><circle class="tm-wear" cx="120" cy="264" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="H3RI" onclick="togTire('H3RI','กลาง2-ขวาใน')"><rect class="tm-tire-body" x="216" y="260" width="28" height="42" rx="8"/><line class="tm-tread" x1="222" y1="267" x2="238" y2="267"/><line class="tm-tread" x1="222" y1="274" x2="238" y2="274"/><line class="tm-tread" x1="222" y1="281" x2="238" y2="281"/><line class="tm-tread" x1="222" y1="288" x2="238" y2="288"/><line class="tm-tread" x1="222" y1="295" x2="238" y2="295"/><circle class="tm-wear" cx="220" cy="264" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="H3RO" onclick="togTire('H3RO','กลาง2-ขวานอก')"><rect class="tm-tire-body" x="250" y="260" width="28" height="42" rx="8"/><line class="tm-tread" x1="256" y1="267" x2="272" y2="267"/><line class="tm-tread" x1="256" y1="274" x2="272" y2="274"/><line class="tm-tread" x1="256" y1="281" x2="272" y2="281"/><line class="tm-tread" x1="256" y1="288" x2="272" y2="288"/><line class="tm-tread" x1="256" y1="295" x2="272" y2="295"/><circle class="tm-wear" cx="274" cy="264" r="2.4" fill="#f59e0b"/></g>

          <!-- 5th wheel -->
          <g>
            <circle cx="170" cy="332" r="15" fill="#0f172a" stroke="rgba(148,163,184,.4)" stroke-width="1.5"/>
            <circle cx="170" cy="332" r="9" fill="rgba(99,102,241,.15)" stroke="rgba(167,139,250,.55)" stroke-width="1"/>
            <circle cx="170" cy="332" r="3.5" fill="#a78bfa"/>
            <text x="170" y="358" text-anchor="middle" fill="#64748b" font-size="7.5" font-weight="600">5th wheel</text>
          </g>

          <!-- TRAILER deck -->
          <g>
            <rect x="100" y="368" width="140" height="350" rx="10" fill="url(#tmDeckGrad)" stroke="rgba(148,163,184,.22)" stroke-width="1"/>
            <line x1="105" y1="395" x2="235" y2="395" stroke="rgba(148,163,184,.08)" stroke-width=".7"/>
            <line x1="105" y1="423" x2="235" y2="423" stroke="rgba(148,163,184,.08)" stroke-width=".7"/>
            <line x1="105" y1="500" x2="235" y2="500" stroke="rgba(148,163,184,.08)" stroke-width=".7"/>
            <line x1="105" y1="585" x2="235" y2="585" stroke="rgba(148,163,184,.08)" stroke-width=".7"/>
            <line x1="105" y1="670" x2="235" y2="670" stroke="rgba(148,163,184,.08)" stroke-width=".7"/>
            <rect x="164" y="368" width="12" height="350" fill="#0a0f1c" opacity=".7"/>
          </g>

          <!-- TRAILER 1 -->
          <rect x="60" y="465" width="220" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="470" text-anchor="end">หาง1</text>

          <g class="tm-tire" data-id="T1LO" onclick="togTire('T1LO','หาง1-ซ้ายนอก')"><rect class="tm-tire-body" x="62" y="445" width="28" height="42" rx="8"/><line class="tm-tread" x1="68" y1="452" x2="84" y2="452"/><line class="tm-tread" x1="68" y1="459" x2="84" y2="459"/><line class="tm-tread" x1="68" y1="466" x2="84" y2="466"/><line class="tm-tread" x1="68" y1="473" x2="84" y2="473"/><line class="tm-tread" x1="68" y1="480" x2="84" y2="480"/><circle class="tm-wear" cx="60" cy="449" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="T1LI" onclick="togTire('T1LI','หาง1-ซ้ายใน')"><rect class="tm-tire-body" x="96" y="445" width="28" height="42" rx="8"/><line class="tm-tread" x1="102" y1="452" x2="118" y2="452"/><line class="tm-tread" x1="102" y1="459" x2="118" y2="459"/><line class="tm-tread" x1="102" y1="466" x2="118" y2="466"/><line class="tm-tread" x1="102" y1="473" x2="118" y2="473"/><line class="tm-tread" x1="102" y1="480" x2="118" y2="480"/><circle class="tm-wear" cx="126" cy="449" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="T1RI" onclick="togTire('T1RI','หาง1-ขวาใน')"><rect class="tm-tire-body" x="216" y="445" width="28" height="42" rx="8"/><line class="tm-tread" x1="222" y1="452" x2="238" y2="452"/><line class="tm-tread" x1="222" y1="459" x2="238" y2="459"/><line class="tm-tread" x1="222" y1="466" x2="238" y2="466"/><line class="tm-tread" x1="222" y1="473" x2="238" y2="473"/><line class="tm-tread" x1="222" y1="480" x2="238" y2="480"/><circle class="tm-wear" cx="214" cy="449" r="2.4" fill="#f59e0b"/></g>
          <g class="tm-tire" data-id="T1RO" onclick="togTire('T1RO','หาง1-ขวานอก')"><rect class="tm-tire-body" x="250" y="445" width="28" height="42" rx="8"/><line class="tm-tread" x1="256" y1="452" x2="272" y2="452"/><line class="tm-tread" x1="256" y1="459" x2="272" y2="459"/><line class="tm-tread" x1="256" y1="466" x2="272" y2="466"/><line class="tm-tread" x1="256" y1="473" x2="272" y2="473"/><line class="tm-tread" x1="256" y1="480" x2="272" y2="480"/><circle class="tm-wear" cx="280" cy="449" r="2.4" fill="#f59e0b"/></g>

          <!-- TRAILER 2 -->
          <rect x="60" y="555" width="220" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="560" text-anchor="end">หาง2</text>

          <g class="tm-tire" data-id="T2LO" onclick="togTire('T2LO','หาง2-ซ้ายนอก')"><rect class="tm-tire-body" x="62" y="535" width="28" height="42" rx="8"/><line class="tm-tread" x1="68" y1="542" x2="84" y2="542"/><line class="tm-tread" x1="68" y1="549" x2="84" y2="549"/><line class="tm-tread" x1="68" y1="556" x2="84" y2="556"/><line class="tm-tread" x1="68" y1="563" x2="84" y2="563"/><line class="tm-tread" x1="68" y1="570" x2="84" y2="570"/><circle class="tm-wear" cx="60" cy="539" r="2.4" fill="#dc2626"/></g>
          <g class="tm-tire" data-id="T2LI" onclick="togTire('T2LI','หาง2-ซ้ายใน')"><rect class="tm-tire-body" x="96" y="535" width="28" height="42" rx="8"/><line class="tm-tread" x1="102" y1="542" x2="118" y2="542"/><line class="tm-tread" x1="102" y1="549" x2="118" y2="549"/><line class="tm-tread" x1="102" y1="556" x2="118" y2="556"/><line class="tm-tread" x1="102" y1="563" x2="118" y2="563"/><line class="tm-tread" x1="102" y1="570" x2="118" y2="570"/><circle class="tm-wear" cx="126" cy="539" r="2.4" fill="#dc2626"/></g>
          <g class="tm-tire" data-id="T2RI" onclick="togTire('T2RI','หาง2-ขวาใน')"><rect class="tm-tire-body" x="216" y="535" width="28" height="42" rx="8"/><line class="tm-tread" x1="222" y1="542" x2="238" y2="542"/><line class="tm-tread" x1="222" y1="549" x2="238" y2="549"/><line class="tm-tread" x1="222" y1="556" x2="238" y2="556"/><line class="tm-tread" x1="222" y1="563" x2="238" y2="563"/><line class="tm-tread" x1="222" y1="570" x2="238" y2="570"/><circle class="tm-wear" cx="214" cy="539" r="2.4" fill="#dc2626"/></g>
          <g class="tm-tire" data-id="T2RO" onclick="togTire('T2RO','หาง2-ขวานอก')"><rect class="tm-tire-body" x="250" y="535" width="28" height="42" rx="8"/><line class="tm-tread" x1="256" y1="542" x2="272" y2="542"/><line class="tm-tread" x1="256" y1="549" x2="272" y2="549"/><line class="tm-tread" x1="256" y1="556" x2="272" y2="556"/><line class="tm-tread" x1="256" y1="563" x2="272" y2="563"/><line class="tm-tread" x1="256" y1="570" x2="272" y2="570"/><circle class="tm-wear" cx="280" cy="539" r="2.4" fill="#dc2626"/></g>

          <!-- TRAILER 3 -->
          <rect x="60" y="625" width="220" height="3" fill="#1e293b" opacity=".7"/>
          <text class="tm-axle-label" x="40" y="630" text-anchor="end">หาง3</text>

          <g class="tm-tire" data-id="T3LO" onclick="togTire('T3LO','หาง3-ซ้ายนอก')"><rect class="tm-tire-body" x="62" y="605" width="28" height="42" rx="8"/><line class="tm-tread" x1="68" y1="612" x2="84" y2="612"/><line class="tm-tread" x1="68" y1="619" x2="84" y2="619"/><line class="tm-tread" x1="68" y1="626" x2="84" y2="626"/><line class="tm-tread" x1="68" y1="633" x2="84" y2="633"/><line class="tm-tread" x1="68" y1="640" x2="84" y2="640"/><circle class="tm-wear" cx="60" cy="609" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="T3LI" onclick="togTire('T3LI','หาง3-ซ้ายใน')"><rect class="tm-tire-body" x="96" y="605" width="28" height="42" rx="8"/><line class="tm-tread" x1="102" y1="612" x2="118" y2="612"/><line class="tm-tread" x1="102" y1="619" x2="118" y2="619"/><line class="tm-tread" x1="102" y1="626" x2="118" y2="626"/><line class="tm-tread" x1="102" y1="633" x2="118" y2="633"/><line class="tm-tread" x1="102" y1="640" x2="118" y2="640"/><circle class="tm-wear" cx="126" cy="609" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="T3RI" onclick="togTire('T3RI','หาง3-ขวาใน')"><rect class="tm-tire-body" x="216" y="605" width="28" height="42" rx="8"/><line class="tm-tread" x1="222" y1="612" x2="238" y2="612"/><line class="tm-tread" x1="222" y1="619" x2="238" y2="619"/><line class="tm-tread" x1="222" y1="626" x2="238" y2="626"/><line class="tm-tread" x1="222" y1="633" x2="238" y2="633"/><line class="tm-tread" x1="222" y1="640" x2="238" y2="640"/><circle class="tm-wear" cx="214" cy="609" r="2.4" fill="#10b981"/></g>
          <g class="tm-tire" data-id="T3RO" onclick="togTire('T3RO','หาง3-ขวานอก')"><rect class="tm-tire-body" x="250" y="605" width="28" height="42" rx="8"/><line class="tm-tread" x1="256" y1="612" x2="272" y2="612"/><line class="tm-tread" x1="256" y1="619" x2="272" y2="619"/><line class="tm-tread" x1="256" y1="626" x2="272" y2="626"/><line class="tm-tread" x1="256" y1="633" x2="272" y2="633"/><line class="tm-tread" x1="256" y1="640" x2="272" y2="640"/><circle class="tm-wear" cx="280" cy="609" r="2.4" fill="#10b981"/></g>

          <!-- Tail lights + label -->
          <rect x="110" y="696" width="24" height="14" rx="3" fill="rgba(220,38,38,.75)" stroke="rgba(252,165,165,.55)"/>
          <rect x="206" y="696" width="24" height="14" rx="3" fill="rgba(220,38,38,.75)" stroke="rgba(252,165,165,.55)"/>
          <text class="tm-arrow-label" x="170" y="742" text-anchor="middle">▼ ท้ายรถ</text>
        </svg>
      </div>

      <!-- Legend -->
      <div class="tm-legend">
        <span class="tm-lpill"><span class="tm-lsw tm-lsw-normal"></span><span>ปกติ</span></span>
        <span class="tm-lpill"><span class="tm-lsw tm-lsw-sel"></span><span>เปลี่ยนยาง</span></span>
        <span class="tm-lpill">
          <span class="tm-lwear"><span class="tm-ldot g"></span><span class="tm-ldot y"></span><span class="tm-ldot r"></span></span>
          <span>อายุยาง</span>
        </span>
      </div>

      <!-- Cost summary -->
      <div class="tm-cost-box">
        <div class="tm-cost-row">
          <label for="tm-price-per">ราคา / เส้น</label>
          <input class="tm-cost-input" id="tm-price-per" type="number" value="5500" min="0" step="100" oninput="updateTireModalSummary()">
          <span class="tm-baht">บาท</span>
        </div>
        <div class="tm-cost-formula" id="tm-cost-formula">0 เส้น × ฿5,500 / เส้น</div>
        <div class="tm-cost-total">
          <span class="tm-cost-total-label">รวม</span>
          <span class="tm-cost-total-val" id="tm-cost-total">฿0</span>
        </div>
      </div>

      <!-- Selected list -->
      <div class="tm-sel-wrap">
        <div class="tm-sel-head">
          <span>ยางที่เลือก (<span id="tm-sel-count">0</span>/22)</span>
        </div>
        <div id="tire-modal-summary" class="tm-sel-empty">ยังไม่ได้เลือกยาง — กดที่ผังด้านบน</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="tm-foot">
      <button class="tm-btn tm-btn-ghost" onclick="clearTires()">🗑 ล้างทั้งหมด</button>
      <button class="tm-btn tm-btn-primary" id="tm-confirm-btn" disabled onclick="confirmTires()">
        ✅ ยืนยัน <span id="tm-confirm-count">(0 เส้น)</span>
      </button>
    </div>
  </div>
</div>
'''

with open(INDEX_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Find start: the opening div with id="tire-modal"
start_marker = '<div id="tire-modal" style="display:none;position:fixed;inset:0;background:rgba(2,6,18,.78);'
# End: the closing </div> right before "Invoice print overlay"
end_marker = '<!-- Invoice print overlay -->'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)
if start_idx == -1 or end_idx == -1:
    print(f'ERROR: markers not found. start={start_idx}, end={end_idx}')
    raise SystemExit(1)

# Replace from start_idx to end_idx (exclusive of end_marker)
new_content = content[:start_idx] + NEW_TIRE_HTML + '\n' + content[end_idx:]
with open(INDEX_PATH, 'w', encoding='utf-8') as f:
    f.write(new_content)

old_len = end_idx - start_idx
new_len = len(NEW_TIRE_HTML)
print(f'✅ Replaced {old_len} chars → {new_len} chars (delta: {new_len - old_len:+d})')
