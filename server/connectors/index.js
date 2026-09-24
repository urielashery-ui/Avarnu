/*
 * שכבת החיבורים (connectors).
 *
 * יש שני סוגים:
 * 1. חיבורי יציאה — רצים על כל פנייה חדשה: מייל לעסק, מייל ללקוח, Webhook ל-CRM / Make / Zapier.
 * 2. חיבורי גופים — אחד לכל גוף ברשימה (משרד הפנים, חברת החשמל...).
 *    היום לאף אחד מהגופים אין API פתוח לעדכון כתובת, ולכן כולם במצב "manual":
 *    נוצרת משימה במסך הניהול, והנציג מעדכן ידנית באתר הגוף.
 *    כשגוף יפתח API (או שיהיה הסכם עם ספק), כותבים לו פונקציית submit כאן — ורק הוא משתנה.
 */
import { sendMail, customerChecklistEmail, businessNotifyEmail, moverLeadEmail, supplierOrderEmail } from "./email.js";
import { moversApi } from "../movers.js";
import { postWebhook } from "./webhook.js";

// ---- חיבורי גופים ----
// mode: "manual" = משימה לנציג; "auto" = מתעדכן לבד מגוף אחר; "api" = שליחה אוטומטית (דורש submit)
const BODY_CONNECTORS = {
  // דוגמה לחיבור עתידי — לא פעיל. מראה את המבנה:
  // elec: { mode: "api", async submit(lead, cfg) { const r = await fetch(cfg.IEC_API_URL, {...}); return { ok: r.ok, note: "..." }; } }
};

export function bodyMode(item) {
  if (BODY_CONNECTORS[item.id]) return BODY_CONNECTORS[item.id].mode;
  return item.auto ? "auto" : "manual";
}

export async function runBodyConnectors(lead, leadId, db, cfg) {
  for (const item of lead.checklist) {
    const c = BODY_CONNECTORS[item.id];
    if (!c || c.mode !== "api" || lead.service !== "concierge") continue;
    try {
      const r = await c.submit(lead, cfg);
      db.setTask(leadId, item.id, r.ok ? "done" : "error", r.note);
      db.event(leadId, "body:" + item.id, r.ok ? "נשלח" : "נכשל: " + r.note);
    } catch (e) {
      db.setTask(leadId, item.id, "error", e.message);
      db.event(leadId, "body:" + item.id, "שגיאה: " + e.message);
    }
  }
}

// ---- חיבורי יציאה ----
// שליחת הבקשה למובילים שנבחרו (רק אם הלקוח ביקש והסכים)
async function dispatchMovers(lead, leadId, db, cfg) {
  if (lead.moveStatus !== "quotes" || !lead.moversConsent) return [];
  const M = moversApi(db), rows = M.forLead(leadId);
  for (const ml of rows.filter((x) => x.status === "pending")) {
    if (!ml.email) { db.event(leadId, "mover:" + ml.mover_id, "אין מייל למוביל. צריך להעביר לו בטלפון"); continue; }
    try {
      await sendMail(cfg, { to: ml.email, ...moverLeadEmail(lead, ml, cfg.publicUrl + "/m/" + ml.token) });
      M.markSent(ml.id);
      db.event(leadId, "mover:" + ml.mover_id, "נשלח ל" + ml.name);
    } catch (e) { db.event(leadId, "mover:" + ml.mover_id + ":error", e.message); }
  }
  return rows;
}

// הזמנת קרטונים לספק (רק אם הלקוח בחר משלוח והסכים)
async function dispatchSupplies(lead, ref, leadId, db, cfg) {
  if (lead.supplies !== "need" || lead.suppliesFrom !== "delivery" || !lead.suppliesConsent) return;
  if (!cfg.suppliesTo) { db.event(leadId, "supplies", "אין ספק מוגדר (SUPPLIES_TO). צריך להזמין ידנית"); return; }
  try {
    await sendMail(cfg, { to: cfg.suppliesTo, ...supplierOrderEmail(lead, ref) });
    db.event(leadId, "supplies", "ההזמנה נשלחה לספק");
    db.setTask(leadId, "supplies", "todo", "נשלח לספק במייל. לוודא שתיאם עם הלקוח");
  } catch (e) { db.event(leadId, "supplies:error", e.message); }
}

export async function runOutbound(lead, ref, leadId, db, cfg) {
  const movers = await dispatchMovers(lead, leadId, db, cfg);
  await dispatchSupplies(lead, ref, leadId, db, cfg);
  const jobs = [];
  if (cfg.notifyTo) jobs.push(["notify", () => sendMail(cfg, { to: cfg.notifyTo, ...businessNotifyEmail(lead, ref, cfg) })]);
  const row = db.byRef(ref), editUrl = row && row.edit_token ? cfg.publicUrl + "/u/" + row.edit_token : "";
  if (lead.email && lead.service === "self") jobs.push(["customer-email", () => sendMail(cfg, { to: lead.email, ...customerChecklistEmail(lead, ref, cfg, movers, editUrl) })]);
  if (cfg.webhookUrl) jobs.push(["webhook", () => postWebhook(cfg, lead, ref)]);
  for (const [name, fn] of jobs) {
    try { const r = await fn(); db.event(leadId, name, r || "ok"); }
    catch (e) { db.event(leadId, name + ":error", e.message); console.error("[connector]", name, e.message); }
  }
  await runBodyConnectors(lead, leadId, db, cfg);
}
