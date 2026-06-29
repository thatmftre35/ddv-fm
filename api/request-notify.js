/* ════════════════════════════════════════════════════════════════
   BAI Excavating — Equipment Request Notification
   Vercel Serverless Function (Node runtime, CommonJS, zero deps).

   The app POSTs a new request (owned or rental) here; this emails the
   fleet manager a styled summary with a link to the password-gated
   Approvals tab where they approve or deny it.

   Env vars (Vercel → Settings → Environment Variables):
     RESEND_API_KEY  (required)   REPORT_TO  (default fleetmanager@battag.com)
     REPORT_FROM     (default onboarding@resend.dev)
     APP_URL         (default https://ddv-fm.vercel.app)
   ════════════════════════════════════════════════════════════════ */

const REPORT_TO   = process.env.REPORT_TO   || "fleetmanager@battag.com";
const REPORT_FROM = process.env.REPORT_FROM || "BAI Fleet Manager <onboarding@resend.dev>";
const APP_URL     = process.env.APP_URL     || "https://ddv-fm.vercel.app";

const C = { dark:"#2C2C2C", red:"#D42B2B", orange:"#F5922F", green:"#2EC278",
            ink:"#1f1f1f", mute:"#6b7280", line:"#e5e7eb", soft:"#f7f7f8", paper:"#ffffff" };

const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmtDate = s => { if(!s) return "—"; const p=String(s).split("-"); return p.length===3 ? `${p[1]}/${p[2]}/${p[0]}` : String(s); };

async function readJSON(req){
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  return await new Promise((resolve, reject) => {
    let d=""; req.on("data", c => d+=c);
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e){ reject(e); } });
    req.on("error", reject);
  });
}

function row(label, value){
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${C.line};font:700 10px/1.4 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:${C.mute};width:38%;vertical-align:top">${esc(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${C.line};font:600 14px/1.4 Arial,sans-serif;color:${C.ink}">${esc(value||"—")}</td>
  </tr>`;
}

function buildHTML(r){
  const isOwned = r.type === "owned";
  const accent = isOwned ? C.green : C.orange;
  const typeLabel = isOwned ? "OWNED EQUIPMENT" : "RENTAL";
  const headline = isOwned
    ? `${r.eqId ? r.eqId + " · " : ""}${r.eqName || "Owned Equipment"}`
    : `${r.equipType || "Rental"}${r.makeModel ? " · " + r.makeModel : ""}`;

  const rows = [
    isOwned ? row("Equipment", `${r.eqId||""} ${r.eqName||""}`.trim()) : row("Equipment Type", r.equipType),
    !isOwned ? row("Make / Model", r.makeModel) : "",
    row("Requester", r.requester),
    row("Job / Site", r.job),
    row("Date Needed By", fmtDate(r.neededBy)),
    row("Expected End", fmtDate(r.endDate))
  ].join("");

  const subject = `🚜 ${isOwned?"Equipment":"Rental"} Request — ${headline} (${r.requester||"unknown"})`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ececed">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececed"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${C.paper};border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.10)">

      <tr><td style="background:${C.dark};padding:24px 28px">
        <div style="font:800 11px/1 Arial,sans-serif;letter-spacing:3px;color:${C.red}">BAI EXCAVATING</div>
        <div style="font:800 22px/1.2 Arial,sans-serif;color:#fff;margin-top:7px">New Equipment Request</div>
        <div style="margin-top:14px">
          <span style="display:inline-block;padding:4px 11px;border-radius:999px;font:800 10px/1.4 Arial,sans-serif;letter-spacing:.6px;color:#fff;background:${accent}">${esc(typeLabel)}</span>
          <span style="display:inline-block;padding:4px 11px;border-radius:999px;font:800 10px/1.4 Arial,sans-serif;letter-spacing:.6px;color:${C.orange};background:${C.orange}22;margin-left:4px">PENDING</span>
        </div>
        <div style="height:3px;background:linear-gradient(90deg,${C.red},${accent});border-radius:2px;margin-top:18px"></div>
      </td></tr>

      <tr><td style="padding:24px 28px 6px">
        <div style="font:800 18px/1.3 Arial,sans-serif;color:${C.ink}">${esc(headline)}</div>
        <div style="font:400 12px/1.4 Arial,sans-serif;color:${C.mute};margin-top:3px">Request ${esc(r.id||"")} · submitted ${esc(r.created||"")}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${rows}</table>
      </td></tr>

      <tr><td style="padding:18px 28px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${APP_URL}/#approve" style="display:inline-block;background:${C.red};color:#fff;text-decoration:none;font:800 14px/1 Arial,sans-serif;padding:14px 30px;border-radius:10px">Review &amp; Decide →</a>
        </td></tr></table>
        <div style="font:400 11px/1.5 Arial,sans-serif;color:${C.mute};text-align:center;margin-top:12px">
          Opens the password-protected Approvals tab. Approve to add it to the schedule, or deny to dismiss it.
        </div>
      </td></tr>

      <tr><td style="padding:16px 28px 24px;border-top:1px solid ${C.line}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:400 11px/1.5 Arial,sans-serif;color:${C.mute}">Automated request notification</td>
          <td align="right" style="font:800 11px/1.4 Arial,sans-serif;letter-spacing:1px;color:${C.dark}">BAI FLEET</td>
        </tr></table>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html };
}

async function sendEmail(subject, html){
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "Authorization":"Bearer "+process.env.RESEND_API_KEY, "Content-Type":"application/json" },
    body: JSON.stringify({ from:REPORT_FROM, to:[REPORT_TO], subject, html })
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error("Resend " + r.status + ": " + JSON.stringify(body));
  return body;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
    const r = await readJSON(req);
    if (!r || !r.type) return res.status(400).json({ ok:false, error:"missing request body" });
    const { subject, html } = buildHTML(r);
    const result = await sendEmail(subject, html);
    return res.status(200).json({ ok:true, sent:result });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
};

module.exports.buildHTML = buildHTML;
module.exports.sendEmail = sendEmail;
