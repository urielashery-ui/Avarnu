// השלמת פרטים אחרי השליחה, ותזכורות במייל.
// הלקוח מקבל קישור אישי (/u/<token>) שבו אפשר להשלים רק פרטים לא רגישים (מונים, כתובת קודמת, בעל הדירה).
// הקישור לא מציג שום פרט אישי שכבר נשמר — רק שדות ריקים למילוי.
import express from "express";
import rateLimit from "express-rate-limit";
import { catalog as C } from "./validate.js";
import { sitePage } from "./movers.js";
import { sendMail, reminderEmail, callbackNotifyEmail } from "./connectors/email.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NUMERIC = new Set(["elecContract", "elecMeter", "elecRead", "waterMeter", "waterRead", "gasRead"]);

// רק שדות מהרשימה המותרת, מנוקים
export function cleanUpdate(fields) {
  const out = {};
  if (!fields || typeof fields !== "object") return out;
  for (const k of C.LATER) {
    const v = fields[k];
    if (typeof v !== "string" && typeof v !== "number") continue;
    const s = String(v).trim().slice(0, 120);
    if (s) out[k] = k === "oldCity" ? C.canonCity(s) : s;
  }
  return out;
}

export function laterRouter({ db, crypt, cfg }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
  const form = express.urlencoded({ extended: false, limit: "10kb" });
  const sameOrigin = (req, res, next) => {
    const o = req.headers.origin || req.headers.referer;
    if (o && new URL(o).host !== req.headers.host) return res.status(403).send("בקשה ממקור לא מורשה");
    next();
  };

  function apply(row, fields) {
    const lead = crypt.decrypt(row.data), upd = cleanUpdate(fields), keys = Object.keys(upd);
    if (keys.length) {
      Object.assign(lead, upd);
      db.setData(row.id, crypt.encrypt(lead));
      const labels = C.labels("he");
      db.event(row.id, "customer:update", "הלקוח השלים: " + keys.map((k) => labels[k]).join(", "));
    }
    return lead;
  }

  // מהדפדפן, מתוך מסך התוצאות
  r.post("/api/leads/update", limiter, express.json({ limit: "5kb" }), (req, res) => {
    const row = db.byEdit(req.body && req.body.token);
    if (!row) return res.status(404).json({ message: "הקישור לא נמצא" });
    const lead = apply(row, req.body.fields);
    res.json({ ok: true, missing: C.missing(lead) });
  });

  // תיאום שיחה עם נציג של גוף: הלקוח בוחר יום וטווח שעות, ונציג שלנו ממתין על הקו ומחבר אותו
  r.post("/api/callbacks", limiter, express.json({ limit: "5kb" }), (req, res) => {
    if (!cfg.callbacksEnabled) return res.status(404).json({ message: "השירות לא פעיל כרגע" });
    const b = req.body || {}, row = db.byEdit(b.token);
    if (!row) return res.status(404).json({ message: "הקישור לא נמצא" });
    const lead = crypt.decrypt(row.data), body = String(b.body || "");
    const item = C.CALL_IDS.includes(body) && C.build(lead).find((i) => i.id === body);
    const errors = {};
    if (!item) errors.body = "גוף לא מוכר";
    if (!C.validCallDay(b.day)) errors.day = "אפשר לבחור יום א׳–ה׳, ממחר ועד חודש קדימה";
    if (!C.SLOTS.includes(b.slot)) errors.slot = "בחרו טווח שעות";
    if (b.consent !== true) errors.consent = "חסרה הסכמה";
    if (Object.keys(errors).length) return res.status(400).json({ message: Object.values(errors).join(", "), errors });
    if (db.openCallbackCount(row.id) >= 5) return res.status(429).json({ message: "כבר יש 5 שיחות שמחכות לתיאום" });
    const note = String(b.note || "").trim().slice(0, 200);
    db.addCallback(row.id, { body, title: item.t, day: b.day, slot: b.slot, note: note ? crypt.encrypt({ note }) : null });
    db.event(row.id, "callback", "בקשה לשיחה: " + item.t + " · " + C.fmtDate(b.day) + " " + b.slot);
    db.bump("callback");
    if (cfg.notifyTo) sendMail(cfg, { to: cfg.notifyTo, ...callbackNotifyEmail(row.ref, item.t, b.day, b.slot, cfg) })
      .catch((e) => db.event(row.id, "callback:mail-error", e.message));
    res.status(201).json({ ok: true });
  });

  // דף ההשלמה מהמייל
  const view = (req, res) => {
    const row = db.byEdit(req.params.token);
    if (!row) { res.status(404).send(sitePage(C.T("he", "u.title"), `<section class="panel"><h1 class="pg-h1">${esc(C.T("he", "u.gone"))}</h1></section>`, { noindex: true })); return null; }
    return row;
  };
  r.get("/u/:token", limiter, (req, res) => {
    const row = view(req, res); if (!row) return;
    const lead = crypt.decrypt(row.data), lang = lead.lang || "he", T = (k, v) => C.T(lang, k, v);
    const miss = C.missing(lead), labels = C.labels(lang), tok = encodeURIComponent(req.params.token);
    const note = req.query.saved ? `<p class="welcome" role="status">${esc(T("u.saved"))}</p>` : req.query.stopped ? `<p class="welcome" role="status">${esc(T("u.stopped"))}</p>` : "";
    const body = miss.length
      ? `<form method="post" action="/u/${tok}"><div class="grid">${miss.map((k) => `<div class="field w3"><label for="u-${k}">${esc(labels[k])}</label>
          <input type="text" id="u-${k}" name="${k}" maxlength="120"${NUMERIC.has(k) ? ' inputmode="numeric" dir="ltr"' : ""}></div>`).join("")}</div>
          <p class="muted mt1">${esc(T("later.tip"))}</p>
          <p class="mt1"><button type="submit" class="primary">${esc(T("u.save"))}</button></p></form>`
      : `<p>${esc(T("u.done"))}</p>`;
    const stop = row.remind_count < 99 && miss.length
      ? `<form method="post" action="/u/${tok}/stop" class="mt1"><button type="submit" class="quiet">${esc(T("u.stop"))}</button></form>` : "";
    res.send(sitePage(T("u.title"), `<section class="panel">${note}<h1 class="pg-h1">${esc(miss.length ? T("u.h1", { name: lead.firstName }) : T("u.title"))}</h1>
      ${miss.length ? `<p class="lead">${esc(T("u.lead"))}</p>` : ""}${body}${stop}</section>`, { noindex: true, lang }));
  });
  r.post("/u/:token", limiter, form, sameOrigin, (req, res) => {
    const row = view(req, res); if (!row) return;
    apply(row, req.body);
    res.redirect(303, "/u/" + encodeURIComponent(req.params.token) + "?saved=1");
  });
  r.post("/u/:token/stop", limiter, form, sameOrigin, (req, res) => {
    const row = view(req, res); if (!row) return;
    db.stopRemind(row.id); db.event(row.id, "remind:stop", "הלקוח ביקש להפסיק תזכורות");
    res.redirect(303, "/u/" + encodeURIComponent(req.params.token) + "?stopped=1");
  });
  return r;
}

// תזכורות: עד 2 מיילים, רק אם חסרים פרטים ויש מייל.
// 1) יום אחרי השליחה.  2) ביום המעבר (אז מקבלים מפתח ורואים את המונים).
export async function runReminders({ db, crypt, cfg }) {
  const now = Date.now(), hours = cfg.remindAfterHours;
  const today = new Date(now + 3 * 3600e3).toISOString().slice(0, 10); // בערך שעון ישראל
  let sent = 0;
  for (const row of db.remindCandidates()) {
    try {
      const lead = crypt.decrypt(row.data), miss = C.missing(lead);
      if (!lead.email || !miss.length) { db.stopRemind(row.id); continue; } // אין למי או על מה להזכיר
      const first = row.remind_count === 0 && now - Date.parse(row.created_at) >= hours * 3600e3;
      const second = row.remind_count === 1 && row.move_date && row.move_date <= today && now - Date.parse(row.remind_at) >= 20 * 3600e3;
      if (!first && !second) continue;
      const url = cfg.publicUrl + "/u/" + row.edit_token;
      await sendMail(cfg, { to: lead.email, ...reminderEmail(lead, url, miss, second ? "keyDay" : "missing") });
      db.reminded(row.id); db.event(row.id, "remind:sent", second ? "תזכורת ביום המעבר" : "תזכורת על פרטים חסרים");
      sent++;
    } catch (e) { db.event(row.id, "remind:error", e.message); }
  }
  return sent;
}
