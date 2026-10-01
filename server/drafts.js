// "שמרו לי ותזכירו": מי שלא מסיים את הטופס יכול להשאיר מייל או טלפון, בהסכמה מפורשת.
// נשמר מוצפן בטבלה נפרדת, מקבל קישור להמשיך מאותה נקודה, ועד 2 תזכורות. נמחק אוטומטית אחרי 30 יום.
// בלי הסכמה — לא נשמר כלום בשרת (הפרטים נשארים רק בדפדפן של המשתמש).
import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { catalog as C } from "./validate.js";
import { sitePage } from "./movers.js";
import { sendMail } from "./connectors/email.js";

export const DRAFT_DAYS = 30;
// שדות שלא נשמרים אף פעם בטיוטה: תעודת זהות והסכמות (הסכמה נותנים מחדש בשליחה)
const NEVER = new Set(["tz", "consent", "poa", "marketing", "moversConsent", "suppliesConsent", "card", "bank"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const now = () => new Date().toISOString();

export function draftsDb(db) {
  const raw = db.raw;
  raw.exec(`CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    step INTEGER NOT NULL DEFAULT 0, lang TEXT, src TEXT, kind TEXT NOT NULL,      -- kind: email | phone
    status TEXT NOT NULL DEFAULT 'open',                                           -- open | handled | converted | stopped
    remind_count INTEGER NOT NULL DEFAULT 0, remind_at TEXT,
    data TEXT NOT NULL                                                             -- {contact, data} מוצפן
  )`);
  const q = {
    ins: raw.prepare("INSERT INTO drafts (token, created_at, updated_at, step, lang, src, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    upd: raw.prepare("UPDATE drafts SET updated_at = ?, step = MAX(step, ?), data = ? WHERE token = ? AND status IN ('open', 'handled')"),
    get: raw.prepare("SELECT * FROM drafts WHERE token = ?"),
    setStatus: raw.prepare("UPDATE drafts SET status = ? WHERE id = ?"),
    convert: raw.prepare("UPDATE drafts SET status = 'converted' WHERE token = ?"),
    list: raw.prepare("SELECT * FROM drafts WHERE (? = '' OR status = ?) ORDER BY updated_at DESC LIMIT 500"),
    counts: raw.prepare("SELECT status, COUNT(*) AS n FROM drafts GROUP BY status"),
    since: raw.prepare("SELECT COUNT(*) AS n FROM drafts WHERE created_at >= ?"),
    remindable: raw.prepare("SELECT * FROM drafts WHERE status = 'open' AND kind = 'email' AND remind_count < 2"),
    reminded: raw.prepare("UPDATE drafts SET remind_count = remind_count + 1, remind_at = ? WHERE id = ?"),
    purge: raw.prepare("DELETE FROM drafts WHERE updated_at < ?")
  };
  return {
    create: (d) => q.ins.run(d.token, now(), now(), d.step, d.lang, d.src, d.kind, d.data),
    update: (token, step, data) => Number(q.upd.run(now(), step, data, token).changes),
    get: (token) => (token ? q.get.get(String(token)) : undefined),
    setStatus: (id, s) => q.setStatus.run(s, id),
    convert: (token) => (token ? Number(q.convert.run(String(token)).changes) : 0),
    list: (status = "") => q.list.all(status, status),
    counts: () => Object.fromEntries(q.counts.all().map((r) => [r.status, r.n])),
    since: (days) => q.since.get(new Date(Date.now() - days * 864e5).toISOString()).n,
    remindable: () => q.remindable.all(),
    reminded: (id) => q.reminded.run(now(), id),
    purge: () => Number(q.purge.run(new Date(Date.now() - DRAFT_DAYS * 864e5).toISOString()).changes)
  };
}

// מנקה את מה שהדפדפן שלח: רק שדות בשם תקין, ערכים קצרים, בלי שדות רגישים
export function cleanDraft(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (n >= 150 || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(k) || NEVER.has(k)) continue;
    if (typeof v === "boolean") { if (v) { out[k] = true; n++; } }
    else if ((typeof v === "string" || typeof v === "number") && String(v).trim()) { out[k] = String(v).trim().slice(0, 120); n++; }
  }
  return out;
}

export function contactKind(s) {
  const v = String(s || "").trim();
  if (C.validEmail(v)) return "email";
  if (C.validPhone(v)) return "phone";
  return "";
}

const continueUrl = (cfg, lang, token) => cfg.publicUrl + (lang && lang !== "he" ? "/" + lang : "") + "/?d=" + encodeURIComponent(token);

export function draftSavedEmail(lang, url, stopUrl, kind) {
  const T = (k, v) => C.T(lang, k, v), rtl = !!C.RTL[lang], dir = rtl ? "rtl" : "ltr";
  const intro = kind === "reminder" ? T("email.dr.remP") : T("email.dr.p");
  return {
    subject: T(kind === "reminder" ? "email.dr.remSubject" : "email.dr.subject"),
    html: `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"></head><body style="margin:0;background:#F6F8FC;font-family:Arial,sans-serif;color:#0F1B33;direction:${dir};text-align:${rtl ? "right" : "left"}">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-size:16px;line-height:1.6">
<h1 style="font-size:22px;margin:0 0 8px">${esc(T("email.dr.h1"))}</h1><p>${esc(intro)}</p>
<p style="margin:18px 0"><a href="${esc(url)}" style="background:#1452CC;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(T("email.dr.btn"))}</a></p>
<p style="font-size:13px;color:#4D5A75">${esc(T("email.dr.stop"))} <a href="${esc(stopUrl)}" style="color:#1452CC">${esc(stopUrl)}</a></p>
<p style="color:#4D5A75;font-size:13px;margin-top:32px">${esc(T("email.footer"))}</p></div></body></html>`,
    text: intro + "\n" + url + "\n\n" + T("email.dr.stop") + " " + stopUrl
  };
}

export function draftsRouter({ db, crypt, cfg, drafts }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
  const json = express.json({ limit: "16kb" });
  const form = express.urlencoded({ extended: false, limit: "2kb" });

  // שמירה ראשונה (עם מייל/טלפון והסכמה) או עדכון של טיוטה קיימת (עם הטוקן)
  r.post("/api/drafts", limiter, json, (req, res) => {
    const b = req.body || {}, step = Math.max(0, Math.min(9, parseInt(b.step, 10) || 0)), data = cleanDraft(b.data);
    if (b.token) {
      const row = drafts.get(b.token);
      if (!row) return res.status(404).json({ message: "not found" });
      const prev = crypt.decrypt(row.data);
      if (drafts.update(b.token, step, crypt.encrypt({ contact: prev.contact, data })) === 0) return res.status(409).json({ message: "closed" });
      return res.json({ ok: true });
    }
    const contact = String(b.contact || "").trim().slice(0, 120), kind = contactKind(contact), errors = {};
    if (!kind) errors.contact = "contact";
    if (b.consent !== true) errors.consent = "consent";
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const token = randomBytes(18).toString("base64url"), lang = C.LANGS.includes(b.lang) ? b.lang : "he";
    const src = /^[a-z0-9_-]{1,32}$/.test(b.src || "") ? b.src : "";
    drafts.create({ token, step, lang, src, kind, data: crypt.encrypt({ contact, data }) });
    db.bump("draft");
    const url = continueUrl(cfg, lang, token), stopUrl = cfg.publicUrl + "/d/" + token + "/stop";
    let mailed = false;
    if (kind === "email" && cfg.smtpUrl) {
      mailed = true;
      sendMail(cfg, { to: contact, ...draftSavedEmail(lang, url, stopUrl, "saved") }).catch((e) => console.error("[draft:mail]", e.message));
    }
    // התראה לעסק — בלי פרטים אישיים במייל; הכול במסך הניהול
    if (cfg.notifyTo) sendMail(cfg, { to: cfg.notifyTo, subject: "עברנו: מתעניין שמר טופס להמשך (" + (kind === "email" ? "מייל" : "טלפון") + ")",
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">מישהו התחיל למלא ושמר להמשך, והסכים שנפנה אליו. הפרטים במסך הניהול: <a href="${esc(cfg.publicUrl)}/admin/drafts">${esc(cfg.publicUrl)}/admin/drafts</a></div>`,
      text: "מתעניין שמר טופס להמשך. הפרטים: " + cfg.publicUrl + "/admin/drafts" }).catch(() => {});
    res.status(201).json({ token, mailed });
  });

  // שחזור מהקישור שבמייל
  r.get("/api/drafts/:token", limiter, (req, res) => {
    const row = drafts.get(req.params.token);
    if (!row || row.status === "converted" || row.status === "stopped") return res.status(404).json({ message: "not found" });
    const d = crypt.decrypt(row.data);
    res.set("Cache-Control", "no-store").json({ step: row.step, lang: row.lang, data: d.data });
  });

  // ביטול תזכורות: דף עם כפתור (POST), כדי שסורקי קישורים במייל לא יבטלו בטעות
  const stopPage = (req, res, done) => {
    const row = drafts.get(req.params.token), lang = (row && row.lang) || "he", T = (k) => C.T(lang, k);
    if (!row) return res.status(404).send(sitePage(T("dr.stopT"), `<section class="panel"><h1 class="pg-h1">${esc(T("dr.gone"))}</h1></section>`, { noindex: true, lang }));
    res.send(sitePage(T("dr.stopT"), `<section class="panel"><h1 class="pg-h1">${esc(T("dr.stopT"))}</h1>` + (done || row.status === "stopped"
      ? `<p class="welcome" role="status">${esc(T("dr.stopped"))}</p>`
      : `<form method="post"><button type="submit" class="primary">${esc(T("dr.stopBtn"))}</button></form>`) + "</section>", { noindex: true, lang }));
  };
  r.get("/d/:token/stop", limiter, (req, res) => stopPage(req, res, false));
  r.post("/d/:token/stop", limiter, form, (req, res) => {
    const row = drafts.get(req.params.token);
    if (row && row.status !== "converted") drafts.setStatus(row.id, "stopped");
    stopPage(req, res, true);
  });
  return r;
}

// תזכורות: יום אחרי העדכון האחרון, ועוד אחת אחרי 4 ימים. רק במייל, רק אם לא הושלם ולא ביקשו להפסיק.
export async function runDraftReminders({ drafts, crypt, cfg }) {
  const n = drafts.purge();
  if (!cfg.smtpUrl) return { sent: 0, purged: n };
  let sent = 0;
  for (const row of drafts.remindable()) {
    const wait = row.remind_count === 0 ? 24 : 96, since = Date.parse(row.remind_at || row.updated_at);
    if (Date.now() - since < wait * 3600e3) continue;
    try {
      const { contact } = crypt.decrypt(row.data);
      await sendMail(cfg, { to: contact, ...draftSavedEmail(row.lang || "he", continueUrl(cfg, row.lang, row.token), cfg.publicUrl + "/d/" + row.token + "/stop", "reminder") });
      drafts.reminded(row.id); sent++;
    } catch (e) { console.error("[draft:remind]", e.message); }
  }
  return { sent, purged: n };
}
