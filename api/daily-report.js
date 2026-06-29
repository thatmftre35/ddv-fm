/* ════════════════════════════════════════════════════════════════
   BAI Excavating — Daily Fleet Email Report
   Vercel Serverless Function (Node runtime, CommonJS, zero deps).

   Fires from Vercel Cron at 5:00 PM America/New_York (see vercel.json).
   Pulls live data from Supabase (publishable key), builds a styled
   HTML summary, and emails it via Resend to the fleet manager.

   Endpoints / query params:
     (no params)   → cron mode: only sends if it's the 5pm ET hour
     ?force=1      → send now with LIVE data (bypass time guard)
     ?test=1       → send now with SAMPLE data (preview the format)

   Secrets come from environment variables — never hard-code the
   Resend key here. Set in Vercel → Project → Settings → Env Vars:
     RESEND_API_KEY   (required)
     REPORT_TO        (optional, default fleetmanager@battag.com)
     REPORT_FROM      (optional, default onboarding@resend.dev)
     CRON_SECRET      (optional; if set, cron requests must carry it)
   ════════════════════════════════════════════════════════════════ */

const SUPA_URL = process.env.SUPA_URL || "https://ucrjcquksswdyartguuy.supabase.co";
const SUPA_KEY = process.env.SUPA_KEY || "sb_publishable_J3MME56UsbEVLlFKLWPXeA_e_XGBzwj";
const REPORT_TO   = process.env.REPORT_TO   || "fleetmanager@battag.com";
const REPORT_FROM = process.env.REPORT_FROM || "BAI Fleet Manager <onboarding@resend.dev>";

const C = { dark:"#2C2C2C", dark2:"#383838", red:"#D42B2B", red2:"#B82020",
            green:"#2EC278", orange:"#F5922F", ink:"#1f1f1f", mute:"#6b7280",
            line:"#e5e7eb", soft:"#f7f7f8", paper:"#ffffff" };

/* ── Eastern-time helpers (Vercel runs in UTC) ───────────────────── */
function easternParts(){
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone:"America/New_York", hourCycle:"h23",
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", weekday:"long"
  });
  const p = {};
  for (const part of f.formatToParts(new Date())) p[part.type] = part.value;
  return p; // {year,month,day,hour,minute,weekday}
}
function easternTodayStr(p){ return `${p.month}/${p.day}/${p.year}`; }            // MM/DD/YYYY (matches app)
function easternDateLabel(){
  return new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York",
    weekday:"long", month:"long", day:"numeric", year:"numeric" }).format(new Date());
}
function easternTimeLabel(){
  return new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York",
    hour:"numeric", minute:"2-digit", hour12:true }).format(new Date()) + " ET";
}

/* ── Service-interval status (mirrors the app's gs()) ────────────── */
function svcStatus(h, last, interval){
  if (!last) return "ok";
  const due = last + interval;
  if (h >= due) return "ov";
  if (due - h <= 50) return "sn";
  return "ok";
}
const SVC_DEFS = [["s500",500,"500-HR"],["s1k",1000,"1,000-HR"],["s2k",2000,"2,000-HR"],["s5k",5000,"5,000-HR"]];

/* ── Pull live data from Supabase + normalize into report shape ──── */
async function fetchJSON(path){
  const r = await fetch(SUPA_URL + path, { headers:{ apikey:SUPA_KEY, Authorization:"Bearer "+SUPA_KEY } });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()).slice(0,200));
  return r.json();
}
async function gatherLive(){
  const [fleetRows, dailyRows] = await Promise.all([
    fetchJSON("/rest/v1/fleet?select=payload"),
    fetchJSON("/rest/v1/daily_reports?select=eq_id,payload")
  ]);
  const units = fleetRows.map(r => r.payload).filter(Boolean);
  const byUnit = {};
  dailyRows.forEach(r => { (byUnit[r.eq_id] = byUnit[r.eq_id] || []).push(r.payload); });
  return normalize(units, byUnit);
}

function normalize(units, dailyByUnit){
  const ep = easternParts();
  const today = easternTodayStr(ep);

  const missing=[], failed=[], flagged=[], clean=[], maintenance=[];

  units.forEach(eq => {
    const name = (eq.make||"") + " " + (eq.model||"");
    const entries = dailyByUnit[eq.id] || [];
    const todays = entries.filter(e => e.date === today);

    // maintenance due / overdue (independent of daily reporting)
    const items = [];
    SVC_DEFS.forEach(([k, interval, label]) => {
      const st = svcStatus(eq.hrs||0, eq[k]||0, interval);
      if (st === "ov" || st === "sn") {
        const due = (eq[k]||0) + interval;
        items.push({ label, status:st, detail: st==="ov" ? ("over by "+((eq.hrs||0)-due).toLocaleString()+"h") : ((due-(eq.hrs||0)).toLocaleString()+"h left") });
      }
    });
    if (items.length) maintenance.push({ id:eq.id, name, hrs:eq.hrs||0, loc:eq.loc||"--", items });

    if (!todays.length) { missing.push({ id:eq.id, name, loc:eq.loc||"--", op:eq.op||"--" }); return; }

    // use the latest of today's submissions
    const e = todays[0];
    const base = { id:eq.id, name, op:e.op||"--", ts:e.ts||"", hrs:e.hrs||0, loc:eq.loc||"--", notes:(e.notes||"").trim() };
    if (e.result === "Failed") failed.push({ ...base, failItems: e.failItems || [] });
    else if (base.notes) flagged.push(base);
    else clean.push(base);
  });

  const reported = units.length - missing.length;
  const compliance = units.length ? Math.round((reported/units.length)*100) : 0;

  return {
    dateLabel: easternDateLabel(),
    generatedAt: easternTimeLabel(),
    totals: { units: units.length, reported, missing: missing.length, compliance },
    counts: { failed: failed.length, flagged: flagged.length, maintenance: maintenance.length },
    missing, failed, flagged, clean, maintenance
  };
}

/* ── Sample data (for ?test=1 — shows every section populated) ───── */
function sampleData(){
  const units = [
    { id:"EQ-001", make:"CAT", model:"336 Excavator", loc:"Riverside Site A", op:"M. Reyes", hrs:4180, s500:3800, s1k:3000, s2k:2000, s5k:0 },
    { id:"EQ-002", make:"John Deere", model:"850K Dozer",  loc:"Hwy 9 Grading",  op:"T. Boone", hrs:2040, s500:1800, s1k:1500, s2k:0,    s5k:0 },
    { id:"EQ-003", make:"Komatsu",    model:"PC210 Excavator", loc:"Yard",       op:"D. Ortiz", hrs:980,  s500:600,  s1k:0,    s2k:0,    s5k:0 },
    { id:"EQ-004", make:"Bobcat",     model:"S770 Skid Steer", loc:"Riverside Site A", op:"J. Vance", hrs:3120, s500:3100, s1k:3000, s2k:2000, s5k:0 },
    { id:"EQ-005", make:"Volvo",      model:"A40G Hauler",     loc:"Quarry North", op:"R. Kane",  hrs:6610, s500:6500, s1k:6000, s2k:6000, s5k:5000 },
    { id:"EQ-006", make:"CAT",        model:"D6 Dozer",        loc:"Hwy 9 Grading", op:"S. Pell", hrs:1500, s500:1200, s1k:1000, s2k:0,    s5k:0 }
  ];
  const daily = {
    "EQ-001": [{ date:easternTodayStr(easternParts()), ts:"7:42 AM", op:"M. Reyes", hrs:4180, result:"Passed", failItems:[], notes:"" }],
    "EQ-002": [{ date:easternTodayStr(easternParts()), ts:"8:05 AM", op:"T. Boone", hrs:2040, result:"Failed", failItems:["Hydraulic leak — left track","Backup alarm inoperative"], notes:"Pulled from grading line until hydraulics looked at." }],
    "EQ-004": [{ date:easternTodayStr(easternParts()), ts:"6:58 AM", op:"J. Vance", hrs:3120, result:"Passed", failItems:[], notes:"Slow to start in cold — may need glow plug check." }],
    "EQ-005": [{ date:easternTodayStr(easternParts()), ts:"7:15 AM", op:"R. Kane", hrs:6610, result:"Passed", failItems:[], notes:"" }]
    // EQ-003 and EQ-006 intentionally missing → appear in "Missing Reports"
  };
  return normalize(units, daily);
}

/* ── HTML builder ─────────────────────────────────────────────────── */
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function pill(text, color, bg){
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font:700 11px/1.4 Arial,sans-serif;letter-spacing:.4px;color:${color};background:${bg};white-space:nowrap">${esc(text)}</span>`;
}
function kpi(value, label, accent){
  return `<td align="center" width="25%" style="padding:14px 6px;background:${C.soft};border:1px solid ${C.line};border-radius:12px">
    <div style="font:800 30px/1 Arial,sans-serif;color:${accent}">${value}</div>
    <div style="font:700 10px/1.4 Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:${C.mute};margin-top:6px">${esc(label)}</div>
  </td>`;
}
function sectionHeader(emoji, title, count, accent){
  return `<tr><td style="padding:26px 0 10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:800 15px/1.2 Arial,sans-serif;color:${C.ink}">
        <span style="display:inline-block;width:6px;height:18px;background:${accent};border-radius:3px;vertical-align:-3px;margin-right:9px"></span>${esc(emoji)} ${esc(title)}
      </td>
      <td align="right" style="font:800 13px/1 Arial,sans-serif;color:${accent}">${count}</td>
    </tr></table>
  </td></tr>`;
}
function card(inner, accent){
  return `<tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid ${C.line};border-left:4px solid ${accent};border-radius:10px;background:${C.paper}">
    <tr><td style="padding:13px 15px">${inner}</td></tr></table></td></tr>`;
}

function buildReport(D){
  const T = D.totals;
  const complianceColor = T.compliance >= 90 ? C.green : T.compliance >= 70 ? C.orange : C.red;

  // Missing
  let missingHTML = "";
  if (D.missing.length) {
    const rows = D.missing.map(u => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${C.line};font:700 13px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.id)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${C.line};font:400 13px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.name)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${C.line};font:400 12px/1.3 Arial,sans-serif;color:${C.mute}">${esc(u.loc)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid ${C.line};font:400 12px/1.3 Arial,sans-serif;color:${C.mute}">${esc(u.op)}</td>
      </tr>`).join("");
    missingHTML = sectionHeader("⚠️","No Report Submitted", D.missing.length, C.red) +
      `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px;overflow:hidden">
        <tr style="background:${C.soft}">
          <td style="padding:8px 12px;font:700 10px/1 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute}">Unit</td>
          <td style="padding:8px 12px;font:700 10px/1 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute}">Equipment</td>
          <td style="padding:8px 12px;font:700 10px/1 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute}">Location</td>
          <td style="padding:8px 12px;font:700 10px/1 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute}">Operator</td>
        </tr>${rows}
      </table></td></tr>`;
  }

  // Failed
  let failedHTML = "";
  if (D.failed.length) {
    const cards = D.failed.map(u => {
      const fails = (u.failItems||[]).map(f => `<li style="margin:2px 0">${esc(f)}</li>`).join("");
      return card(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:800 14px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.id)} &nbsp;<span style="font-weight:400;color:${C.mute}">${esc(u.name)}</span></td>
          <td align="right">${pill("FAILED", "#fff", C.red)}</td>
        </tr></table>
        <div style="font:400 12px/1.5 Arial,sans-serif;color:${C.mute};margin-top:5px">Operator ${esc(u.op)} · ${esc(u.ts)} · ${Number(u.hrs).toLocaleString()} hrs · ${esc(u.loc)}</div>
        ${fails ? `<div style="font:700 11px/1 Arial,sans-serif;color:${C.red};text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px">Failed Checks</div><ul style="margin:0;padding-left:18px;font:600 13px/1.4 Arial,sans-serif;color:${C.ink}">${fails}</ul>` : ""}
        ${u.notes ? `<div style="margin-top:9px;padding:8px 10px;background:${C.soft};border-radius:8px;font:400 12px/1.5 Arial,sans-serif;color:${C.ink}"><b style="color:${C.mute}">Notes:</b> ${esc(u.notes)}</div>` : ""}
      `, C.red);
    }).join("");
    failedHTML = sectionHeader("⛔","Failed Inspections", D.failed.length, C.red) + cards;
  }

  // Flagged (passed but has notes)
  let flaggedHTML = "";
  if (D.flagged.length) {
    const cards = D.flagged.map(u => card(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:800 14px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.id)} &nbsp;<span style="font-weight:400;color:${C.mute}">${esc(u.name)}</span></td>
        <td align="right">${pill("NOTE", C.orange, C.orange+"22")}</td>
      </tr></table>
      <div style="font:400 12px/1.5 Arial,sans-serif;color:${C.mute};margin-top:5px">Operator ${esc(u.op)} · ${esc(u.ts)} · ${Number(u.hrs).toLocaleString()} hrs</div>
      <div style="margin-top:8px;font:400 13px/1.5 Arial,sans-serif;color:${C.ink}">${esc(u.notes)}</div>
    `, C.orange)).join("");
    flaggedHTML = sectionHeader("📝","Flagged Notes", D.flagged.length, C.orange) + cards;
  }

  // Maintenance
  let maintHTML = "";
  if (D.maintenance.length) {
    const cards = D.maintenance.map(u => {
      const chips = u.items.map(it =>
        pill(`${it.label} · ${it.detail}`, it.status==="ov"?"#fff":C.orange, it.status==="ov"?C.red:C.orange+"22")
      ).join(" ");
      return card(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:800 14px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.id)} &nbsp;<span style="font-weight:400;color:${C.mute}">${esc(u.name)}</span></td>
          <td align="right" style="font:700 12px/1 Arial,sans-serif;color:${C.mute}">${Number(u.hrs).toLocaleString()} hrs</td>
        </tr></table>
        <div style="margin-top:9px;line-height:2.1">${chips}</div>
      `, C.orange);
    }).join("");
    maintHTML = sectionHeader("🔧","Maintenance Due", D.maintenance.length, C.orange) + cards;
  }

  // Clean
  let cleanHTML = "";
  if (D.clean.length) {
    const rows = D.clean.map(u => `
      <tr>
        <td style="padding:7px 12px;border-bottom:1px solid ${C.line};font:700 12px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.id)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid ${C.line};font:400 12px/1.3 Arial,sans-serif;color:${C.ink}">${esc(u.name)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid ${C.line};font:400 12px/1.3 Arial,sans-serif;color:${C.mute}">${esc(u.op)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid ${C.line};font:400 12px/1.3 Arial,sans-serif;color:${C.mute}">${esc(u.ts)}</td>
        <td align="right" style="padding:7px 12px;border-bottom:1px solid ${C.line}">${pill("OK", C.green, C.green+"1f")}</td>
      </tr>`).join("");
    cleanHTML = sectionHeader("✅","Reported & Clean", D.clean.length, C.green) +
      `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px;overflow:hidden">${rows}</table></td></tr>`;
  }

  const allClear = !D.missing.length && !D.failed.length && !D.flagged.length && !D.maintenance.length;
  const allClearHTML = allClear ? `<tr><td style="padding:24px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.green}14;border:1px solid ${C.green}40;border-radius:12px">
      <tr><td align="center" style="padding:26px">
        <div style="font:800 18px/1.2 Arial,sans-serif;color:${C.green}">✅ All Clear</div>
        <div style="font:400 13px/1.5 Arial,sans-serif;color:${C.mute};margin-top:6px">Every unit reported in — no failures, notes, or maintenance flags today.</div>
      </td></tr></table></td></tr>` : "";

  const subject = `🚜 BAI Fleet Report — ${D.dateLabel}  ·  ${T.reported}/${T.units} reporting`
    + (D.failed.length ? `  ·  ${D.failed.length} FAILED` : "")
    + (D.missing.length ? `  ·  ${D.missing.length} missing` : "");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BAI Daily Fleet Report</title></head>
<body style="margin:0;padding:0;background:#ececed;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${T.reported}/${T.units} units reporting · ${D.failed.length} failed · ${D.missing.length} missing · ${D.maintenance.length} maintenance flags</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececed"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${C.paper};border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.10)">

      <!-- Header -->
      <tr><td style="background:${C.dark};padding:26px 28px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <div style="font:800 11px/1 Arial,sans-serif;letter-spacing:3px;color:${C.red}">BAI EXCAVATING</div>
            <div style="font:800 24px/1.15 Arial,sans-serif;color:#fff;margin-top:7px">Daily Fleet Report</div>
          </td>
          <td align="right" valign="top">
            <div style="font:700 12px/1.4 Arial,sans-serif;color:#cfcfcf">${esc(D.dateLabel)}</div>
            <div style="font:400 11px/1.4 Arial,sans-serif;color:${C.mute};margin-top:3px">Generated ${esc(D.generatedAt)}</div>
          </td>
        </tr></table>
        <div style="height:3px;background:linear-gradient(90deg,${C.red},${C.orange});border-radius:2px;margin-top:18px"></div>
      </td></tr>

      <!-- KPIs -->
      <tr><td style="padding:22px 24px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${kpi(T.units, "Total Units", C.ink)}
          <td width="2%"></td>
          ${kpi(T.reported, "Reported", C.green)}
          <td width="2%"></td>
          ${kpi(T.missing, "Missing", T.missing? C.red : C.mute)}
          <td width="2%"></td>
          ${kpi(T.compliance+"%", "Compliance", complianceColor)}
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:4px 24px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${allClearHTML}
          ${missingHTML}
          ${failedHTML}
          ${flaggedHTML}
          ${maintHTML}
          ${cleanHTML}
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 24px 26px">
        <div style="height:1px;background:${C.line};margin-bottom:16px"></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:400 11px/1.5 Arial,sans-serif;color:${C.mute}">
            Automated end-of-day summary · 5:00 PM ET<br>
            <a href="https://ddv-fm.vercel.app" style="color:${C.red};text-decoration:none;font-weight:700">Open Fleet Manager →</a>
          </td>
          <td align="right" style="font:800 11px/1.4 Arial,sans-serif;letter-spacing:1px;color:${C.dark}">BAI FLEET</td>
        </tr></table>
      </td></tr>

    </table>
    <div style="font:400 10px/1.5 Arial,sans-serif;color:#9aa0a6;margin-top:14px">BAI Excavating · Fleet Operations · This is an automated message.</div>
  </td></tr></table>
</body></html>`;

  return { subject, html };
}

/* ── Resend send ─────────────────────────────────────────────────── */
async function sendEmail(subject, html){
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "Authorization":"Bearer "+process.env.RESEND_API_KEY, "Content-Type":"application/json" },
    body: JSON.stringify({ from:REPORT_FROM, to:[REPORT_TO], subject, html })
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error("Resend " + r.status + ": " + JSON.stringify(body));
  return body; // { id: ... }
}

/* ── Handler ─────────────────────────────────────────────────────── */
module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const isTest  = q.test  === "1" || q.test  === "true";
    const isForce = q.force === "1" || q.force === "true";

    // Optional shared-secret gate for cron (Vercel sends it as a Bearer header)
    if (process.env.CRON_SECRET && !isTest && !isForce) {
      const auth = req.headers["authorization"] || "";
      if (auth !== "Bearer " + process.env.CRON_SECRET)
        return res.status(401).json({ ok:false, error:"unauthorized" });
    }

    // Cron mode: only proceed during the 5pm ET hour (dual UTC cron covers DST)
    if (!isTest && !isForce) {
      const hour = parseInt(easternParts().hour, 10);
      if (hour !== 17)
        return res.status(200).json({ ok:true, skipped:true, reason:"not 5pm ET (hour="+hour+")" });
    }

    const data = isTest ? sampleData() : await gatherLive();
    const { subject, html } = buildReport(data);
    const result = await sendEmail(subject, html);
    return res.status(200).json({ ok:true, mode:isTest?"test":isForce?"force":"cron", sent:result, totals:data.totals });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
};

/* Exports for local testing / reuse */
module.exports.buildReport = buildReport;
module.exports.sampleData  = sampleData;
module.exports.gatherLive  = gatherLive;
module.exports.sendEmail   = sendEmail;
module.exports.normalize   = normalize;
