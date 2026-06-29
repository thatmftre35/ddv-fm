# BAI Excavating LLC — Equipment Field Manager
## Developer Handoff Document (v5)

> **For the next developer:** This document describes the complete state of the application as of v5. All section numbers are cross-referenced. Read §3 (Architecture) before touching any code — the single-file structure has non-obvious constraints. Read §8 (State of Project) before estimating anything.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Features — Detailed](#4-features--detailed)
5. [Data Models / Schema](#5-data-models--schema)
6. [APIs & Integrations](#6-apis--integrations)
7. [Setup & Run Instructions](#7-setup--run-instructions)
8. [State of the Project](#8-state-of-the-project)
9. [Next Steps / TODOs](#9-next-steps--todos)

---

## 1. Project Overview

**What it is:** A mobile-first Progressive Web App (PWA) for BAI Excavating LLC, a heavy equipment excavation contractor. The app gives field operators and office staff a single interface for daily equipment management without requiring any backend infrastructure in its base form.

**Purpose:**
- Track hour meter readings and fuel levels for a fleet of 10+ heavy equipment units
- Flag service intervals (500-HR, 1,000-HR, 2,000-HR, 5,000-HR) as OK / Due Soon / Overdue
- Enforce daily operator walk-around checklist completion with compliance tracking
- Log maintenance events and service requests
- Generate printable reports and CSV exports
- Provide an AI chat assistant powered by Claude for fleet queries

**Target users:**
- Field operators (primary): access on iPhone/Android from the job site to submit daily reports
- Office staff / foreman: dashboard compliance overview, maintenance log, PDF reports
- Management: cost tracking, service calendar projections

**Delivery format:** The entire application is a single `index.html` file (~172KB, ~1,226 lines). There is no build step, no bundler, no framework, no server required for base operation. It runs by double-clicking the file or serving it from any static host.

---

## 2. Tech Stack

### Runtime

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language | Vanilla JavaScript (ES6+) | — | Zero build toolchain; runs offline, deployable anywhere |
| Markup | HTML5 | — | Single-file delivery |
| Styling | Vanilla CSS with CSS custom properties | — | No framework dependency; `--red`, `--bk`, `--gr` vars for theming |
| AI | Anthropic Claude API | `claude-sonnet-4-20250514` | Already integrated into Claude environment; best quality/cost ratio |
| QR Code | `qrcode.min.js` via CDN | `1.5.3` | Only external JS dependency; loaded from `cdn.jsdelivr.net` |
| Fonts | Google Fonts (Barlow Condensed, Barlow, JetBrains Mono) | — | Loaded via `<link>` at startup |

### Development / Build tooling

| Tool | Version | Purpose |
|---|---|---|
| Python | 3.x | `sync_from_excel.py` script only — not used in app runtime |
| openpyxl | latest | Excel sheet parsing in sync script |

**No npm, no webpack, no React, no Vue, no TypeScript.** This was a deliberate constraint: the app must be openable by double-clicking a file, no install required.

### Hosting (optional, for AI feature)

| Service | Purpose |
|---|---|
| Netlify | Static hosting + serverless function proxy for API key security |
| Netlify Functions | Server-side proxy to attach `ANTHROPIC_API_KEY` to Claude API calls |

---

## 3. Architecture

### High-level structure

```
bax_app/
├── index.html                  ← Entire application (HTML + CSS + JS, ~172KB)
├── data/
│   └── fleet.json              ← Static seed data; output of sync script (NOT loaded at runtime)
├── scripts/
│   └── sync_from_excel.py      ← One-time data migration from Excel workbook
└── README.md                   ← Original user-facing README (not this document)
```

> **CRITICAL:** `data/fleet.json` is **not** loaded by `index.html` at runtime. The app's fleet data is hardcoded as JavaScript arrays inside `index.html`. The JSON file is the output of `sync_from_excel.py` and was the intended data source for a future fetch-on-load pattern that was never implemented. See §8.

### Single-file layout (`index.html`)

```
Lines 1–8      HTML head (meta, title, Google Fonts link)
Lines 9–191    <style> block — all CSS (~182 lines)
Lines 192–210  HTML body — topbar, nav tabs, #main, #mod, #toast divs
Lines 211–213  <script src="qrcode.min.js"> CDN load
Lines 214–215  <script> open + logo/LOGO_WEB injection (build-time injected)
Lines 216–239  Global data: FLEET[], LOG[], DAILY{}
Lines 240–365  TYPE_CHK{} — per-type checklists (7 equipment types × 11–18 items)
Lines 365–394  APP{} state object + utility functions
Lines 395–411  Daily log helpers (hasDailyToday, countMissingToday, getDailyResult)
Lines 412–440  Render shell (ST, render, updateBadge, smod, cmod, toast, uclk)
Lines 441–564  Dashboard + Equipment tab renderers (rDash, rEquip, buildCard, buildDet)
Lines 555–665  Card interaction (toggleCard, saveEq, delEq, openDailyForm, submitDaily)
Lines 681–905  Daily log tab (rDaily, buildDailyEntryView, buildDailyMiniCard, printDailyLog)
Lines 855–933  CSV exports (xDailyCSV, xUnitDailyCSV, dlCSV, xCSV)
Lines 935–979  Maintenance log tab (rLog, addLog)
Lines 980–1054 Add equipment + QR code + service request (openAdd, subAdd, openQR, dlQR, openSvc, subSvc)
Lines 1055–1108 Service calendar tab (rCal)
Lines 1109–1177 Reports tab + PDF generation (rRpt, genFleet, genUnit, openPDF, buildFleet, buildUnit)
Lines 1178–1222 AI tab (rAI, aiCtx, sAI)
Lines 1220–1226 Icon helpers + init (icoSVG, chevSVG, render(), uclk(), setInterval)
```

### Data flow

```
User action
    │
    ▼
DOM event handler (e.g., button click → submitDaily())
    │
    ├─► Mutates in-memory arrays (FLEET[], LOG[], DAILY{})
    │
    └─► Calls render()
            │
            ▼
        render() checks APP.tab
            │
            ▼
        Tab renderer (rDash, rEquip, rDaily, rLog, rCal, rRpt, rAI)
            │
            ▼
        DOM builder functions (mk(), ap(), buildCard(), etc.)
            │
            ▼
        document.getElementById("main").innerHTML replaced
```

**Key architectural constraint:** There is **no virtual DOM, no diffing, no component framework**. Every `render()` call tears down and rebuilds the entire `#main` div. This means:
- All DOM event handlers are re-attached on every render
- No `getElementById` calls should be cached across renders
- Form field values are read immediately when needed, not stored reactively
- Modals live in `#mod` (separate from `#main`) so they survive re-renders of the main content

### State management

All mutable state lives in three places:

1. **`APP` object** — UI state only (which tab is open, which card is expanded, filter selections, AI chat history, pending photo attachments)
2. **`FLEET[]` array** — fleet data (mutated in place by `saveEq`, `subAdd`, `delEq`, `submitDaily`)
3. **`LOG[]` array** — maintenance log entries (prepended via `unshift` by `addLog`, `submitDaily`, `subSvc`, `subChk`)
4. **`DAILY{}` object** — daily operator reports keyed by equipment ID (`DAILY["EQ-001"] = [entries...]`)

**Persistence: NONE.** All state is in-memory JavaScript. A page refresh resets everything to the hardcoded seed data. This is the single largest architectural limitation. See §9.

---

## 4. Features — Detailed

### 4.1 Dashboard Tab (`rDash`)

**User-facing behavior:** Shows KPI cards (Total, All Clear, Due Soon, Overdue), a compliance banner if any units are missing today's report, a second row showing report compliance counts, then a scrollable fleet card list.

**Implementation:**
1. `rDash(m)` — called by `render()` when `APP.tab === "dash"`
2. Iterates `FLEET[]`, calls `gw(eq)` on each to determine worst service status
3. Calls `countMissingToday()` → iterates `FLEET[]`, calls `hasDailyToday(eq.id)` for each → checks if `DAILY[eqId]` has an entry matching `todayStr()`
4. If `miss > 0`, renders a purple `.miss-banner` div with a "View" button that calls `ST("daily")`
5. Renders fleet cards via `buildCard(eq, i, false)` — `manage=false` hides the Remove button

**Non-obvious logic:**
- The "NO RPT" badge on cards (`.s-miss` class) is added inside `buildCard()` when `hasDailyToday(eq.id)` returns false — it appears even on the Dashboard view
- `updateBadge()` is called inside `render()` (not just on tab switch) to keep the nav badge count current

---

### 4.2 Equipment Tab (`rEquip`, `buildCard`, `buildDet`)

**User-facing behavior:** Full fleet list with expandable cards. Each card shows equipment ID, type, location, hour meter, and service status chip. Expanding reveals serial number, year, size, operator, assignment, fuel, three service interval bars, an update form, and action buttons.

**Card expansion:**
- Click on `.eqcard` fires `toggleCard(i)` → sets `APP.open = i` (or null if already open) → calls `render()`
- `buildCard(eq, i, manage)` checks `APP.open === i` to decide whether to call `buildDet(eq, i, manage)`

**Service interval bars:**
- `buildDet()` renders three bars for 500-HR, 1,000-HR, 2,000-HR
- Each calls `gs(eq.hrs, sv.v, sv.d)` where `sv.v` = hour reading when last service was done, `sv.d` = interval length
- `gs()` returns `"ok"` / `"sn"` / `"ov"` based on: if `hrs >= last + interval` → overdue; if `(last + interval) - hrs <= 50` → due soon
- Bar fill width = `pct(eq.hrs, sv.v, sv.d)` = `min(100, round((hrs - last) / interval * 100))`
- If `sv.v` (last service hour) is 0, `gs()` returns `"ok"` and `pct()` returns 0 (no data → no alarm)

**Update form (`saveEq(i)`):**
- Reads `#uh{i}` (hours), `#uf{i}` (fuel select), `#ua{i}` (avg hrs/day)
- Mutates `FLEET[i]` directly, calls `render()`
- Does not write back to `data/fleet.json`

**Action buttons:**
- "Request Service" → `openSvc(i)` (see §4.7)
- "QR Code" → `openQR(i)` (see §4.8)
- "✍ Daily Report" → `openDailyForm(i)` (see §4.3)
- "✕ Remove" — only shown when `manage=true` (Equipment tab, not Dashboard) → `delEq(i)` → `confirm()` dialog → `FLEET.splice(i,1)`, `APP.open=null`, `render()`

**Add Equipment (`openAdd`, `subAdd`):**
- Opens modal with 16 input fields (IDs: `ai0`–`aif` plus `ai4` for type select)
- `nid()` generates the next sequential ID: finds max numeric suffix across `FLEET[]`, pads to 3 digits
- `subAdd()` validates make+model are non-empty, pushes new object to `FLEET[]`, closes modal, calls `render()`

---

### 4.3 Daily Operator Report (`openDailyForm`, `submitDaily`)

**User-facing behavior:** Operator taps "✍ Daily Report" on any equipment card. A modal appears with: operator name, hour meter, fuel level, job site, then the full type-specific checklist (Pass/Fail/N/A per item), then a notes field. Submitting records the entry, updates the fleet reading, and adds a record to `LOG[]`.

**Checklist selection:**
- `openDailyForm(i)` calls `getChk(eq.type)` → returns `TYPE_CHK[type]` or falls back to `DEFAULT_CHK` (Excavator checklist) for unmapped types (Grader, Compactor, Crane, Other)
- Checklist state is managed in a local `chkState = {}` object inside the closure — keys are item IDs, values are `"ps"` / `"fl"` / `"na"`
- Button click handlers toggle the `on` CSS class and write to `chkState`

**Submission (`submitDaily`):**
- Validates operator name and hours are non-empty
- Computes `hasFail = Object.values(chkState).some(v => v === "fl")`
- Computes `failItems` array of label strings for failed items
- Prepends entry to `DAILY[eq.id]` array (creates array if doesn't exist)
- **Side effect 1:** `FLEET[i].hrs = hrs` and `FLEET[i].fuel = val("dr-fuel")` — the daily report updates the fleet's live reading
- **Side effect 2:** Calls `LOG.unshift({...type:"Daily Report"...})` — daily reports appear in the maintenance log with type `"Daily Report"` and a purple `lt-daily` tag
- Calls `cmod()` then `render()`

**Compliance detection:**
- `hasDailyToday(eqId)` checks `DAILY[eqId]` array for any entry where `entry.date === todayStr()`
- `todayStr()` formats as `"MM/DD/YYYY"` using local time — matches the format written by `submitDaily`
- `countMissingToday()` = `FLEET.filter(eq => !hasDailyToday(eq.id)).length`

**Edge cases:**
- If an operator submits twice in one day, both entries are stored. The second submission will be at index 0 of the array. `hasDailyToday()` will find the first match and return true. The compliance badge counts the unit as submitted. No deduplication or "already submitted today" warning exists.
- `getDailyResult(entry)` is defined but unused in rendering — it was superseded by direct use of `entry.result`

---

### 4.4 Daily Log Tab (`rDaily`, `buildDailyEntryView`, `buildDailyMiniCard`)

**User-facing behavior:** Shows today's compliance status per unit — submitted (green "REPORTED" or red "ISSUES") or missing (purple "NO REPORT" + inline Submit button). Filter buttons: All / Missing / Submitted / Has Issues. Expanding a unit card shows the full report for today plus mini-cards for up to 10 previous days.

**Filter logic (`APP.dlFlt`):**
- `"all"` — all units
- `"miss"` — `FLEET.filter(eq => !hasDailyToday(eq.id))`
- `"in"` — `FLEET.filter(eq => hasDailyToday(eq.id))`
- `"fail"` — `FLEET.filter(eq => (DAILY[eq.id]||[]).some(e => e.result === "Failed"))` — note: this shows units that have EVER had a failed report, not just today

**Card expansion:** `APP.dlOpen` stores the currently open unit's `eq.id` string (not index). This is different from `APP.open` which stores a numeric index.

**`buildDailyEntryView(parent, entry, chklist)`:**
- Renders readings row (hours, fuel, job site, submitted time) as a flex div
- Renders all checklist items from the `chklist` param grouped by `cat`, showing Pass/Fail/N/A badges
- If `entry.notes` exists, renders a notes section
- If `entry.failItems.length > 0`, renders a red `.redbg` fail callout box

**Inline submit button:** The "Submit" button on missing cards calls `openDailyForm(idx)` where `idx = FLEET.indexOf(eq)`. This is safe as long as units haven't been deleted/reordered since the card was rendered (which `render()` would handle).

---

### 4.5 Maintenance Log Tab (`rLog`, `addLog`)

**User-facing behavior:** Top section is a form to log completed service events (date, equipment, service type, hours, performed by, parts cost, work description). Below is the full chronological log with cost badges. Total cost shown at bottom.

**Log entry form:** Six-input grid (`#ld`, `#le`, `#lt`, `#lh`, `#lb`, `#lp`) plus `#lw` work description. Equipment select (`#le`) is populated from `FLEET[]` as `"EQ-001 - Caterpillar 336 Excavator"`. `addLog()` splits on `" - "` to extract the ID.

**Log rendering:** All entries in `LOG[]` are rendered — including Daily Reports (tagged `lt-daily`, purple), Service Requests (tagged `lt-req`, red, with left border), and regular service (tagged `lt-svc`, green). Cost shows `"PENDING"` for requests, `"$XX.XX"` for service.

**Total cost:** Sums `parts + labor` for all entries where `isReq === false`. Daily Reports have `parts:0, labor:0` so they contribute nothing.

---

### 4.6 Walk-Around Checklist (`openChk`, `subChk`)

**User-facing behavior:** "✓ Walk-Around" button on equipment cards (Equipment tab only) opens a modal with the type-specific checklist. Different from Daily Report — this is a standalone inspection without hour meter or fuel input.

**Implementation:** Similar to `openDailyForm` but simpler. Uses a separate `APP.chk` state object (`APP.chk[eq.id]`) that persists across renders (unlike daily form's local `chkState`). This means partial checklist state survives if user closes and reopens without submitting.

**Submission (`subChk`):** Determines pass/fail, sets `FLEET[i].insp`, prepends a `LOG` entry with `type:"Inspection"`. Does NOT create a `DAILY[]` entry — walk-around from Equipment tab is separate from daily operator report.

---

### 4.7 Service Request (`openSvc`, `subSvc`)

**User-facing behavior:** "⚠ Request Service" on equipment card opens a modal: name, issue description, priority dropdown. Submits to `LOG[]` with `isReq:true`. Switches to Log tab on submit.

**Note:** Photo attachment UI (`APP.ph[]`) is defined and rendered (file input `#phi`, `hPh()` handler) but the photo data is captured into `APP.ph` and then `APP.ph.slice()` is written to `LOG[entry].photos`. However, photos are not rendered in `rLog()` — photo display code was removed in v5's rewrite. The data structure supports photos but the log tab doesn't show them. See §8.

---

### 4.8 QR Code (`openQR`, `dlQR`)

**User-facing behavior:** Generates a QR code for the selected unit encoding its ID, serial number, make/model, hours, location, and operator. Displays in a modal with a "Download PNG" button.

**Implementation:**
- Calls `QRCode.toCanvas(canvas, qrData, options, callback)` from the CDN-loaded library
- Canvas element ID is `"qrc"` — rendered inside the modal
- `dlQR(id)` gets the canvas, calls `.toDataURL()`, creates a temporary `<a>` element with `download` attribute, triggers click
- The QR data string is plain text, not a URL — scanning it shows raw text, not a link

---

### 4.9 Service Calendar (`rCal`)

**User-facing behavior:** Month-by-month view of projected service dates. "Avg Hrs/Day" adjustors per unit sharpen projections. Filter buttons: All (current month), Overdue, ≤30d, ≤60d, ≤90d. Export CSV button.

**Projection math:**
- For each unit × each interval (`s500`/`s1k`/`s2k`/`s5k`): `needHours = (lastDone + interval) - currentHrs`
- If `needHours <= -interval`, skip (more than one full interval overdue — stale entry)
- `daysAway = ceil(needHours / (eq.adh || 8))`
- `dueDate = today + daysAway days`
- Filter "all" shows entries where `dueDate.month === viewedMonth`

**Navigation:** `APP.calOff` is an integer month offset from today (0 = current month, -1 = last month, etc.). Buttons call `APP.calOff--; render()` and `APP.calOff++; render()`.

**Edge case:** If `s500` (last 500-HR service) is 0, the interval is skipped entirely. This means brand-new equipment with no prior service logged shows no 500-HR projection. Expected behavior — can't project without a baseline.

---

### 4.10 Reports Tab (`rRpt`, `buildFleet`, `buildUnit`)

**User-facing behavior:** Three sections: Quick CSV Exports, Fleet Summary PDF, Per-Unit PDF, Daily Log PDF.

**PDF generation:**
- `genFleet()` / `genUnit()` call `buildFleet()` / `buildUnit()` to produce an HTML string
- `openPDF(html, title)` opens a new window with `window.open()`, writes a full HTML document including embedded CSS and the `LOGO_WEB` base64 string
- The opened window has a "Save as PDF / Print" button that calls `window.print()`
- CSS includes `@media print { .nbp { display:none } }` to hide the print button when printing

**`buildFleet(is, il, ir, ic)` parameters:** service interval details, log, requests, costs — boolean checkboxes `#os`, `#ol`, `#or2`, `#oc`

**`buildUnit(eqId, ih, ir, idl)` parameters:** service history, requests, daily log (last 30 entries)

**Daily log PDF:** Separate section with its own unit selector `#pde`. Button calls `printDailyLog(eq)` which opens a new window with full styled report including every daily entry, checklist items, and fail callouts.

**Note:** PDF functions have duplicate utility functions with `f` prefix (`fss`, `fcl`, `fst`, `fww`, `fpc`) because they run inside the printed window's context, not the app's context. These are exact duplicates of `gs`, `sl`, `gw`, `pct` with different names to avoid future naming conflicts.

---

### 4.11 AI Tab (`rAI`, `sAI`, `aiCtx`)

**User-facing behavior:** Chat interface with Claude. 6 quick-prompt pills. Conversation history persists across renders within the session (`APP.ai[]`). Shows typing dots while waiting.

**Context injection (`aiCtx()`):**
- Returns a string with one line per fleet unit: `"EQ-001 Caterpillar 336 Excavator: 4820hrs | 500HR=sn(180h) | 1kHR=ok | 2kHR=ok | Site A | op:J. Rivera"`
- Appends `"Missing daily report today: EQ-004, EQ-007"` (or "None")
- Sent as the `system` prompt along with the last 5 maintenance log entries and all pending service requests

**API call:**
- `POST https://api.anthropic.com/v1/messages`
- Model: `claude-sonnet-4-20250514`
- `max_tokens: 1000`
- Headers: `{"Content-Type": "application/json"}` — **no API key** (see §6 and §8)
- Full conversation history in `messages[]` array

**Conversation history:** `APP.ai[]` stores `{r: "u"|"b", c: "text"}` objects. On each `sAI()` call, `APP.ai.slice(0,-1)` is sent as history (current question excluded, then appended separately).

**Typing indicator:** A temporary div with class `amsg b` and id `"ath"` containing `.dots` is appended directly to `#aim` (not via `render()`) before the fetch. On completion, `render()` replaces everything including removing the dots.

---

### 4.12 CSV Exports (`xCSV`, `xDailyCSV`, `xUnitDailyCSV`, `dlCSV`)

**`xCSV(type)`** handles three types:
- `"log"` → all `LOG[]` entries → `BAI_Maintenance_Log.csv`
- `"fleet"` → all `FLEET[]` entries → `BAI_Fleet_Export.csv`
- `"cal"` → projected service calendar → `BAI_Service_Calendar.csv`

**`xDailyCSV()`** → all entries across all `DAILY{}` keys → `BAI_Daily_Operator_Log.csv`

**`xUnitDailyCSV(eqId)`** → entries for one unit → `BAI_{eqId}_Daily_Log.csv`

**`dlCSV(rows, fn)`** — shared download helper: converts 2D array to CSV string (all values double-quoted, inner quotes escaped as `""`), creates a Blob, triggers download via temporary `<a>` element.

---

## 5. Data Models / Schema

### 5.1 `FLEET[]` — Equipment unit (in-memory)

```javascript
{
  id:    "EQ-001",              // string, format "EQ-NNN", primary key
  sn:    "CAT336-SN-0081442",  // string, serial number
  make:  "Caterpillar",        // string
  model: "336 Excavator",      // string
  type:  "Excavator",          // string, must match a key in TYPE_CHK or DEFAULT_CHK is used
  size:  "36-ton",             // string, display only
  year:  "2019",               // string (not number)
  hrs:   4820,                 // number, current hour meter reading
  s500:  4600,                 // number, hour reading when 500-HR service was LAST done (0 = never)
  s1k:   4000,                 // number, hour reading when 1000-HR was last done
  s2k:   4000,                 // number, hour reading when 2000-HR was last done
  s5k:   4000,                 // number, hour reading when 5000-HR was last done (0 = N/A for this unit)
  job:   "Site A - Grading",   // string, current job assignment
  loc:   "Main Campus",        // string, current location
  op:    "J. Rivera",          // string, assigned operator (or "--")
  fuel:  "3/4",                // string, one of: "Empty"|"1/4"|"1/2"|"3/4"|"Full"
  insp:  "Passed",             // string, one of: "Passed"|"Pending"|"Failed - See Notes"
  adh:   8                     // number, avg hours operated per day (for calendar projections)
}
```

**Note on `sNNN` fields:** These store the hour-meter reading AT WHICH the last service was done, not the date. The next service is due at `sNNN + interval`. Example: `s500:4600` with `hrs:4820` means 500-HR service was done at 4600 hours, next due at 5100 hours, currently 280 hours past last service.

**Note on `fleet.json` schema mismatch:** The `sync_from_excel.py` script writes a different schema (`make_model` instead of `make`+`model`, `location` instead of `loc`, `operator` instead of `op`, no `type`/`size`/`year`/`adh`). The JSON file is NOT loaded by the app — this is a known mismatch. See §8.

### 5.2 `LOG[]` — Maintenance / event log entry

```javascript
{
  date:    "06/01/2026",                        // string, MM/DD/YYYY
  id:      "EQ-001",                            // string, foreign key to FLEET[].id
  unit:    "Caterpillar 336 Excavator",         // string, denormalized display name
  hrs:     4600,                                // number, hour meter at time of event
  type:    "500-HR",                            // string, one of service types or "Daily Report"|"Inspection"|"Service Request"
  work:    "Engine oil & filter...",            // string, description
  by:      "J. Rivera",                         // string, performed by (empty string for requests)
  reqBy:   "",                                  // string, requester name (only for Service Requests)
  reqDate: "",                                  // string, "MM/DD/YYYY HH:MM" (only for Service Requests)
  parts:   85,                                  // number, parts cost in dollars
  labor:   120,                                 // number, labor cost in dollars
  isReq:   false,                               // boolean, true = Service Request
  photos:  []                                   // array of base64 data URLs (captured but not displayed in v5)
}
```

**`type` values in practice:**
- Service: `"500-HR"`, `"1000-HR"`, `"2000-HR"`, `"5000-HR"`, `"500/1000-HR"`, `"500/1000/2000-HR"`, `"Repair"`, `"Inspection"`
- Auto-generated: `"Daily Report"`, `"Inspection"` (from walk-around), `"Service Request"`

### 5.3 `DAILY{}` — Daily operator reports

```javascript
DAILY = {
  "EQ-001": [        // keyed by equipment ID
    {
      date:          "06/17/2026",    // string, MM/DD/YYYY — used for compliance detection
      ts:            "07:32 AM",      // string, local time of submission
      op:            "J. Rivera",     // string, operator name
      hrs:           4825,            // number, hour meter reading
      fuel:          "3/4",           // string
      job:           "Site A",        // string
      checks:        {                // object, checklist item ID → value
        "eng_oil": "ps",             // "ps" = pass, "fl" = fail, "na" = N/A, absent = not answered
        "coolant":  "ps",
        "air_filt": "fl",
        // ... all items from the unit's type-specific checklist
      },
      checklistType: "Excavator",     // string, eq.type at time of submission
      result:        "Failed",        // string, "Passed"|"Failed"
      failItems:     ["Air filter condition"],  // array of label strings for failed items
      notes:         "Air filter very dirty"    // string
    }
    // ... older entries at higher indices
  ]
}
```

**Ordering:** Entries are prepended with `unshift()`, so `DAILY[id][0]` is always the most recent entry.

### 5.4 `APP` — UI state

```javascript
APP = {
  tab:     "dash",   // string, active tab: "dash"|"equip"|"daily"|"log"|"cal"|"rpt"|"ai"
  open:    null,     // number|null, index of expanded card in Equipment/Dashboard tabs
  calOff:  0,        // number, month offset from current month for calendar view
  calFlt:  "all",    // string, calendar filter: "all"|"ov"|"30"|"60"|"90"
  ai:      [],       // array of {r:"u"|"b", c:"string"} — AI chat history
  ph:      [],       // array of base64 strings — pending photo attachments for service request
  svcI:    null,     // number|null, FLEET index of unit being requested service
  dlFlt:   "all",    // string, daily log filter: "all"|"miss"|"in"|"fail"
  dlOpen:  null      // string|null, eq.id of expanded card in Daily tab
}
```

### 5.5 `TYPE_CHK{}` — Checklist definitions

```javascript
TYPE_CHK = {
  "Excavator":       [ /* 18 items */ ],
  "Mini Excavator":  [ /* 11 items */ ],
  "Backhoe":         [ /* 15 items */ ],
  "Dozer":           [ /* 16 items */ ],
  "Loader":          [ /* 15 items */ ],
  "Track Loader":    [ /* 12 items */ ],
  "Skid Steer":      [ /* 12 items */ ]
}
// Each item:
{ id: "eng_oil", lbl: "Engine oil level", cat: "Engine" }
```

Categories vary by type. Excavator uses: Engine, Hydraulic, Undercarriage, Attachments, Electrical, Safety, Cab. Dozer adds "Drive" category. `cat` is used for grouping in the rendered checklist UI.

---

## 6. APIs & Integrations

### 6.1 Anthropic Claude API

**Endpoint:** `POST https://api.anthropic.com/v1/messages`

**Request:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "system": "<fleet context + compliance data + recent log>",
  "messages": [
    {"role": "user", "content": "What's overdue?"},
    {"role": "assistant", "content": "EQ-004 and EQ-007..."},
    {"role": "user", "content": "current question"}
  ]
}
```

**Response shape used:**
```javascript
data.content
  .filter(b => b.type === "text")
  .map(b => b.text)
  .join("")
```

**Headers sent:** `{"Content-Type": "application/json"}` only — **no `x-api-key` header**.

**Current state:** The AI tab will return an auth error (`401`) in any standalone deployment because no API key is attached. The app was built in Claude's environment where the API key is injected at the infrastructure level. For standalone use, a Netlify proxy function must be added. See §9.

**Required env variable (for Netlify proxy):** `ANTHROPIC_API_KEY=sk-ant-...`

### 6.2 QRCode.js CDN

**URL:** `https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js`

**Usage:** `QRCode.toCanvas(canvasElement, dataString, optionsObject, callback)`

**Fallback:** None. If CDN is unavailable (offline use), `typeof QRCode === "undefined"` and the canvas remains blank. No error shown to user.

### 6.3 Google Fonts CDN

**URL:** `https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`

**Fallback:** CSS has bare `font-family: Barlow, sans-serif` — browser falls back to system sans-serif. App is fully usable without fonts loaded.

### 6.4 No other APIs or services

There are no webhooks, no WebSockets, no database connections, no authentication, no session management, no cookies, no `localStorage`, no `sessionStorage`.

---

## 7. Setup & Run Instructions

### Run locally (no dependencies)

```bash
# Option A: double-click
# Just open index.html in Chrome, Edge, Safari, or Firefox

# Option B: local server (avoids some file:// restrictions)
cd bax_app/
python -m http.server 8080
# Open http://localhost:8080
```

### Excel sync (optional, requires Python)

```bash
pip install openpyxl
python scripts/sync_from_excel.py /path/to/BAX_Equipment_Hour_Tracker_Pro.xlsx
# Output: data/fleet.json (not loaded by app in current v5)
```

### Deploy to Netlify (AI feature requires this)

```bash
# 1. Go to https://app.netlify.com/drop
# 2. Drag the entire bax_app/ folder onto the page
# 3. In Site settings → Environment variables, add:
#    ANTHROPIC_API_KEY = sk-ant-your-key-here
# 4. Add netlify/functions/proxy.js (see §9 — not yet built)
```

### Enable AI locally (quick test, key exposed)

In `index.html`, find the `sAI()` function's `fetch()` call and modify headers:

```javascript
headers: {
  "Content-Type": "application/json",
  "x-api-key": "sk-ant-YOUR_KEY",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-iab": "true"
}
```

The `anthropic-dangerous-direct-browser-iab` header is required by Anthropic when calling from a browser directly. Do not ship this to production.

### Get an API key

1. Go to `https://console.anthropic.com`
2. API Keys → Create Key
3. Key format: `sk-ant-api03-...`
4. New accounts receive free credits

---

## 8. State of the Project

### Fully working

- All 7 tabs render correctly (Dashboard, Equipment, Daily, Log, Calendar, Reports, AI)
- Fleet card expand/collapse with service interval bars
- Save hour meter / fuel / avg hrs per day
- Add new equipment (16-field modal)
- Delete equipment
- Daily operator report form with type-specific checklist (7 types)
- Compliance detection — `hasDailyToday()`, daily tab filter, nav badge count, dashboard banner
- Full daily report view with checklist results
- Daily report history (mini-cards)
- Printable daily log PDF (`printDailyLog`)
- Walk-around checklist (Equipment tab, separate from daily report)
- Service request submission
- Maintenance log with manual entry form
- Service calendar with month navigation and 5 filter modes
- Fleet Summary PDF and Per-Unit PDF generation
- QR code generation and PNG download
- CSV export: fleet, log, calendar, daily (fleet-wide and per-unit)
- AI tab UI, conversation history, typing indicator, quick-prompt pills
- Toast notifications
- Mobile-responsive layout
- BAI logo embedded as base64 in header and PDFs

### Partially implemented

- **Photos on service requests:** `APP.ph[]` captures base64 photo data via FileReader and stores it in `LOG[].photos`. The data is there but `rLog()` does not render photo thumbnails. The `viewPh()` function exists in the codebase from a previous version but is not called. Photo data will export in CSV as empty (the column is included but not populated since the rendering was removed).

- **`getDailyResult(entry)` function:** Defined at line 405, never called. Was intended as a helper but `entry.result` is used directly everywhere.

- **`data/fleet.json` loading:** The sync script produces this file, but `index.html` never fetches it. The app uses hardcoded `FLEET[]` and `LOG[]` arrays. There is no `fetch("data/fleet.json")` call anywhere.

### Stubbed / mocked

- **Fleet data:** 10 hardcoded units (EQ-001 through EQ-010) with realistic but fictional data. Three seed `LOG[]` entries. `DAILY{}` starts empty on every page load.
- **AI without key:** The AI tab renders and accepts input, but `fetch()` returns 401 in standalone deployment. Error is caught and displayed as "Connection error." — no crash.

### Known bugs / limitations

1. **No persistence.** Every page refresh resets all data. This is the most critical limitation. An operator submits a daily report, refreshes the page — it's gone.

2. **AI key not attached.** Direct browser calls to Anthropic API without the `x-api-key` header will 401. The app was designed for Claude's environment where this is handled transparently.

3. **`fleet.json` schema mismatch.** The sync script writes `make_model`, `location`, `operator` etc. — the app's `FLEET[]` uses `make`+`model`, `loc`, `op`. If a developer tries to load the JSON, field mapping will be wrong.

4. **Daily "Has Issues" filter shows historical failures.** `dlFlt === "fail"` shows any unit that has ever had a failed report, not just today. This may or may not be the intended behavior.

5. **No duplicate daily report prevention.** An operator can submit multiple daily reports for the same unit on the same day. Each is stored; the unit shows as "submitted."

6. **Calendar `"all"` filter uses the local month of `vd` (viewed date), not the current month.** If a user navigates to a future month, "All" shows that month's projected events — this is correct behavior but may confuse users who expect "All" to always mean "current."

7. **`sync_from_excel.py` schema not used.** The script is functional and produces valid JSON, but the app doesn't load it. Not a bug per se, but a dead artifact.

8. **`f` prefix duplicate functions.** `fss`, `fcl`, `fst`, `fww`, `fpc` (lines 1144–1147) are exact duplicates of `gs`, `sl`, `gw`, `pct` used inside `buildFleet`/`buildUnit` for the printed PDF window. If service status logic changes, it must be updated in both sets.

---

## 9. Next Steps / TODOs

These items were planned or discussed but not implemented. Listed in recommended priority order.

### P0 — Critical for production use

**1. Data persistence**

The app currently loses all data on refresh. Three viable approaches:

- **`localStorage`** (simplest, per-device): `JSON.stringify(FLEET)` to `localStorage.setItem("bai_fleet", ...)` on every mutation. Load on startup. Works offline, no server. Downside: data is device-local.
- **Netlify + a simple backend** (recommended for multi-user): POST daily reports and log entries to a serverless function that writes to a KV store (Netlify Blobs, Supabase, Firebase). Requires auth to prevent public writes.
- **Google Sheets as backend**: Use Google Sheets API to read/write fleet data. No server needed. Downside: requires OAuth.

Recommended approach: start with `localStorage` for v6 as an immediate fix, then add server sync in v7.

**2. Netlify proxy for AI key**

Create `netlify/functions/proxy.js`:

```javascript
// netlify/functions/proxy.js
exports.handler = async (event) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: event.body
  });
  const data = await response.json();
  return {
    statusCode: response.status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
};
```

Then in `sAI()`, change the fetch URL from `https://api.anthropic.com/v1/messages` to `/.netlify/functions/proxy`.

Create `netlify.toml` in the root:

```toml
[build]
  publish = "bax_app"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

### P1 — High value, near-term

**3. Fix `data/fleet.json` loading OR deprecate the sync script**

Decision needed: either update the app to fetch and parse `fleet.json` on load (mapping `make_model` → `make`+`model`, etc.), or update the sync script to match the app's schema. Currently the script is a dead artifact.

**4. Photo display in maintenance log**

`LOG[].photos` contains base64 strings but `rLog()` never renders them. Add photo thumbnail row inside `rLog()`'s entry builder (same pattern as the old `viewPh(li, pi)` function used in a previous version).

**5. Duplicate daily report guard**

Check `hasDailyToday(eq.id)` before showing the daily report form. If already submitted today, show a "Update today's report?" confirmation instead of opening blank form.

### P2 — Medium priority

**6. Equipment type checklists for unmapped types**

`getChk(type)` falls back to Excavator for `"Grader"`, `"Compactor"`, `"Crane"`, `"Other"`. Add proper checklists for at least Grader and Compactor in `TYPE_CHK`.

**7. Historical compliance calendar**

The Calendar tab currently shows service interval projections. A separate compliance calendar showing which dates had missing reports would be useful for accountability reporting.

**8. Dedicated service request resolution flow**

Service requests currently live in `LOG[]` with `isReq:true` forever. Add a "Mark Resolved" button that converts them to regular service log entries (filling in work performed, cost).

**9. Unit-level report history limit**

`buildDailyEntryView` shows up to 10 past entries in mini-cards. The full `DAILY[eqId]` array grows unbounded. Add a cap (e.g., keep last 90 days) when storing.

### P3 — Architectural improvements

**10. Split JS into modules**

The single-file approach becomes unwieldy past ~1500 lines. If adding a backend, migrate to a proper project structure:

```
src/
├── data/          state.js, fleet.js, daily.js
├── ui/            render.js, cards.js, modals.js
├── features/      calendar.js, reports.js, ai.js
├── utils/         helpers.js, icons.js
└── main.js
```

Use a bundler (Vite recommended — zero-config, fast, excellent single-file output with `vite build`).

**11. Replace duplicate `f`-prefix functions**

`fss`, `fcl`, `fst`, `fww`, `fpc` should be unified with `gs`, `sl`, `gw`, `pct`. PDF content is injected into a new window as HTML strings — passing the functions as stringified JS into the printed page is one approach. Alternatively, move PDF generation to a server-side function that renders HTML properly.

**12. Service interval last-done tracking by date (not just hours)**

Currently `s500`, `s1k` etc. store the hour meter reading when service was done. This works for hour-based intervals but doesn't support calendar-based intervals (e.g., oil change every 6 months regardless of hours). Adding a `s500_date` field would enable this.

### Architectural constraints the next developer must respect

1. **The single-file constraint is intentional.** Do not introduce a build step without confirming with the client that they can run `npm install`. The target users are field operators, not developers.

2. **No jQuery, no React, no Vue.** The `mk()` / `ap()` DOM builder pattern is the intentional abstraction for DOM creation. It was chosen because template literal HTML strings with nested quotes caused cascading escaping bugs in the Python build script.

3. **`render()` is nuclear.** Every state change calls `render()` which rebuilds `#main` entirely. This is fine at current scale (~10 units) but will need optimization (partial renders or diffing) if the fleet grows past ~100 units.

4. **The Python build step (logo injection) is fragile.** The `LOGO_HDR` and `LOGO_WEB` base64 strings are injected by a Python script (`logos.py`) at build time. If the HTML file is regenerated from scratch, the logos must be re-injected. The logos are stored in `/home/claude/logos.py` in the Claude environment and must be preserved.

5. **`APP.dlOpen` stores an ID string; `APP.open` stores an index.** This inconsistency exists because Daily tab cards can be filtered/reordered, making index-based tracking fragile. Equipment tab always shows all units in FLEET order, so index is stable. Do not normalize these to the same approach without testing both tabs.

---

## Daily Email Report (`/api/daily-report.js` + `vercel.json`)

An automated end-of-day digest emailed to the fleet manager at **5:00 PM ET every day**.
It pulls live data from Supabase and summarizes:

- **No Report Submitted** — units missing a daily operator report today
- **Failed Inspections** — failed checks + operator notes
- **Flagged Notes** — units that passed but had notes worth flagging
- **Maintenance Due** — units overdue / within 50h of a 500/1k/2k/5k service
- **Reported & Clean** — the all-good roster, plus KPI header (compliance %, etc.)

### Scheduling & DST

Vercel Cron runs in **UTC only** with no daylight-saving awareness. To hit 5pm
Eastern year-round, `vercel.json` registers **two** cron times (21:00 and 22:00 UTC)
and the function guards on the actual Eastern hour — only the invocation where it's
17:00 ET actually sends; the other exits early. Do not "simplify" this to a single
cron entry or it will drift by an hour twice a year.

### Environment variables (set in Vercel → Settings → Environment Variables)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `RESEND_API_KEY` | ✅ | — | Resend API key. **Never commit this.** |
| `REPORT_TO`   | — | `fleetmanager@battag.com` | Recipient. |
| `REPORT_FROM` | — | `BAI Fleet Manager <onboarding@resend.dev>` | Sender. The shared `onboarding@resend.dev` only delivers when the Resend account owner == `REPORT_TO`; to send to arbitrary recipients, verify a domain in Resend and use an address on it. |
| `SUPA_URL` / `SUPA_KEY` | — | publishable values baked in | Override only if the project moves. |
| `CRON_SECRET` | — | — | If set, scheduled (non-test) requests must carry `Authorization: Bearer <CRON_SECRET>`. |

### Manual triggers

- `https://ddv-fm.vercel.app/api/daily-report?test=1` — send **sample** data (preview the format)
- `https://ddv-fm.vercel.app/api/daily-report?force=1` — send **live** data off-schedule
- No params → cron mode (only sends during the 5pm-ET hour)

Zero npm dependencies — uses native `fetch` for both Supabase REST and the Resend API.

---

*Document generated June 17, 2026. Reflects BAI_FieldApp_v5.zip.*
