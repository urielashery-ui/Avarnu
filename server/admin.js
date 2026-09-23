// מסך ניהול: רשימת פניות, פרטי פנייה, משימות לכל גוף, ייצוא לאקסל, מחיקה.
// מוגן בסיסמה (Basic Auth). כל צפייה בתעודת זהות נרשמת ביומן.
import express from "express";
import { safeEqual } from "./crypto.js";
import { catalog as C } from "./validate.js";
import { mountMovers } from "./admin-movers.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { new: "חדשה", in_progress: "בטיפול", done: "הסתיימה", awaiting_payment: "ממתינה לתשלום" };
const TASK = { todo: "לטפל", done: "בוצע", auto: "מתעדכן לבד", na: "לא רלוונטי", error: "נכשל" };
const SERVICE = { self: "מעדכן בעצמו", concierge: "אנחנו מעדכנים" };
const d8 = (iso) => iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }) : "";

const CSS = `
:root{--g:#F6F8FC;--s:#fff;--i:#16233F;--m:#4D5A75;--l:#D6DEEC;--a:#2A63C9;--e:#B42318}
*{box-sizing:border-box}body{margin:0;background:var(--g);color:var(--i);font:16px/1.6 Arial,sans-serif}
.w{max-width:72rem;margin:0 auto;padding:1rem 16px 3rem}a{color:var(--a)}h1{font-size:1.6rem;margin:.5rem 0 1rem}h2{font-size:1.2rem;margin:1.5rem 0 .5rem}
nav.top{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--l);padding-bottom:.6rem}
.chips{display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0 1rem}.chips a{padding:.3rem .8rem;border:2px solid var(--l);border-radius:99px;text-decoration:none;color:var(--i)}
.chips a[aria-current]{border-color:var(--a);background:#E4EEFF;font-weight:bold}
.t{overflow-x:auto;background:var(--s);border:1px solid var(--l);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:44rem}th,td{padding:.6rem .8rem;border-bottom:1px solid var(--l);text-align:right;vertical-align:top}
th{background:#EDF1F8;font-size:.9rem}td.n{font-variant-numeric:tabular-nums}
.card{background:var(--s);border:1px solid var(--l);border-radius:10px;padding:1rem 1.2rem;margin-bottom:1rem}.card>h2:first-child{margin-top:0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem;margin:0}dt{color:var(--m)}dd{margin:0}
select,input[type=text]{font:inherit;padding:.4rem .5rem;border:2px solid #687D79;border-radius:6px;min-height:2.5rem;background:#fff;color:var(--i)}
button{font:inherit;font-weight:bold;padding:.5rem 1rem;min-height:2.6rem;border-radius:8px;border:2px solid var(--a);background:var(--a);color:#fff;cursor:pointer}
button.del{background:var(--e);border-color:var(--e)}.muted{color:var(--m)}
:focus-visible{outline:3px solid #1450C8;outline-offset:2px}
.pill{display:inline-block;padding:.05rem .55rem;border-radius:6px;border:1px solid var(--l);font-size:.85rem}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.cap{text-align:right;padding:.5rem .8rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.8rem;margin-bottom:1rem}.tile{background:var(--s);border:1px solid var(--l);border-radius:12px;padding:.8rem 1rem;display:flex;flex-direction:column}.tile strong{font-size:1.8rem;font-variant-numeric:tabular-nums}
table.narrow{min-width:0}
.form .fld{display:flex;flex-direction:column;gap:.2rem;margin-bottom:.7rem;max-width:32rem}.form .fld input[type=text]{width:100%}
.form fieldset{margin:.5rem 0 1rem}.err{color:var(--e);font-weight:bold}.rev{list-style:none;padding:0}
.pill.new{border-color:var(--e);color:var(--e);font-weight:bold}.pill.done{border-color:var(--a);color:var(--a)}
`;
const page = (title, body) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ניהול</title><link rel="stylesheet" href="/admin/admin.css"></head>
<body><div class="w"><nav class="top" aria-label="ניהול"><strong>עברנו · ניהול</strong><a href="/admin">כל הפניות</a><a href="/admin/movers">מובילים</a><a href="/admin/stats">נתונים</a><a href="/admin/export.csv">ייצוא לאקסל</a></nav>
<main>${body}</main></div></body></html>`;

export function adminRouter({ db, crypt, cfg }) {
  const r = express.Router();

  // סיסמה
  r.use((req, res, next) => {
    const h = req.headers.authorization || "";
    const [u, p] = Buffer.from(h.replace(/^Basic /, ""), "base64").toString().split(/:(.*)/s);
    if (h.startsWith("Basic ") && safeEqual(u, cfg.adminUser) && safeEqual(p ?? "", cfg.adminPass)) return next();
    res.set("WWW-Authenticate", 'Basic realm="admin", charset="UTF-8"').status(401).send("נדרשת כניסה");
  });
  // הגנה מ-CSRF: בקשות שינוי חייבות להגיע מאותו אתר
  r.use((req, res, next) => {
    if (req.method !== "POST") return next();
    const o = req.headers.origin || req.headers.referer;
    if (o && new URL(o).host !== req.headers.host) return res.status(403).send("בקשה ממקור לא מורשה");
    next();
  });
  r.use(express.urlencoded({ extended: false, limit: "20kb" }));
  r.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  const open = (row) => { try { return crypt.decrypt(row.data); } catch { return null; } };
  const find = (req, res) => {
    const row = db.byRef(String(req.params.ref));
    if (!row) { res.status(404).send(page("לא נמצא", "<h1>הפנייה לא נמצאה</h1>")); return null; }
    return row;
  };

  r.get("/admin.css", (req, res) => res.type("css").send(CSS));
  const moversSection = mountMovers(r, { db, cfg, page, esc });

  r.get("/", (req, res) => {
    const status = STATUS[req.query.status] ? req.query.status : "";
    const counts = db.counts(), total = Object.values(counts).reduce((a, b) => a + b, 0);
    const rows = db.list({ status, limit: 200 });
    const chip = (k, label, n) => `<a href="/admin${k ? "?status=" + k : ""}"${status === k ? ' aria-current="page"' : ""}>${label} (${n || 0})</a>`;
    const body = rows.map((row) => {
      const d = open(row) || {}, tasks = db.tasks(row.id);
      const open_ = tasks.filter((t) => t.status === "todo" || t.status === "error").length;
      return `<tr><td><a href="/admin/leads/${esc(row.ref)}">${esc(row.ref)}</a></td><td class="n">${esc(d8(row.created_at))}</td>
        <td>${esc((d.firstName || "") + " " + (d.lastName || ""))}</td><td>${esc(row.new_city)}</td><td class="n">${esc(C.fmtDate(row.move_date))}</td>
        <td>${esc(SERVICE[row.service])}</td><td><span class="pill ${esc(row.status)}">${esc(STATUS[row.status])}</span></td>
        <td class="n">${open_ ? open_ + " פתוחות" : "אין"}</td></tr>`;
    }).join("");
    res.send(page("פניות", `<h1>פניות</h1>
      <div class="chips" role="navigation" aria-label="סינון לפי מצב">${chip("", "הכול", total)}${Object.entries(STATUS).map(([k, v]) => chip(k, v, counts[k])).join("")}</div>
      ${rows.length ? `<div class="t"><table><caption class="muted cap">${rows.length} פניות</caption>
      <thead><tr><th scope="col">מספר</th><th scope="col">התקבלה</th><th scope="col">שם</th><th scope="col">עיר חדשה</th><th scope="col">תאריך מעבר</th><th scope="col">שירות</th><th scope="col">מצב</th><th scope="col">משימות</th></tr></thead>
      <tbody>${body}</tbody></table></div>` : "<p>אין פניות להצגה.</p>"}`));
  });

  r.get("/leads/:ref", (req, res) => {
    const row = find(req, res); if (!row) return;
    const d = open(row);
    if (!d) return res.status(500).send(page("שגיאה", "<h1>לא הצלחנו לפענח את הפנייה</h1><p>בדקו שה-DATA_KEY לא השתנה.</p>"));
    const reveal = req.query.reveal === "1";
    if (reveal) db.event(row.id, "admin:reveal-tz", req.ip);
    const tz = reveal ? d.tz : "*****" + String(d.tz).slice(-4);
    const info = [["שם", d.firstName + " " + d.lastName],
      ["תעודת זהות", `${esc(tz)} ${reveal ? "" : `<a href="?reveal=1">הצגה מלאה (נרשם ביומן)</a>`}`, true],
      ["טלפון", d.phone], ["מייל", d.email], ["שפה מועדפת", d.lang && d.lang !== "he" ? C.LANG_NAMES_HE[d.lang] : ""], ["אנשים בבית", d.people], ["בדירה החדשה", d.tenure === "rent" ? "שוכרים" + (d.landlord ? " מ" + d.landlord : "") : "בעלים"],
      ["כתובת קודמת", C.addr(d, "old")], ["כתובת חדשה", C.addr(d, "new") + (d.zip ? ", מיקוד " + d.zip : "") + (d.floor ? ", קומה " + d.floor : "")],
      ["תאריך מעבר", C.fmtDate(d.moveDate)],
      ["משק הבית", [d.people && d.people + " אנשים", d.kidsCount && d.kidsCount !== "0" && d.kidsCount + " ילדים"].filter(Boolean).join(", ")],
      ["זכאויות שסומנו", Object.entries(C.householdLabels).filter(([k]) => d[k]).map(([, v]) => v).join(" · ")],
      ["חשמל", [d.elecSupplier === "private" ? "ספק פרטי" : "", d.elecContract && "חוזה " + d.elecContract, d.elecMeter && "מונה " + d.elecMeter, d.elecRead && "קריאה " + d.elecRead].filter(Boolean).join(" · ")],
      ["מים", [d.waterMeter && "מונה " + d.waterMeter, d.waterRead && "קריאה " + d.waterRead].filter(Boolean).join(" · ")],
      ["גז", [d.gas === "central" ? "מרכזי" : d.gas, d.gasRead && "קריאה " + d.gasRead].filter(Boolean).join(" · ")],
      ["הסכמות", ["שמירת פרטים", d.poa ? "פנייה בשמו (צריך ייפוי כוח חתום)" : "", d.marketing ? "מסכים לקבל הצעות" : "לא מסכים לדיוור"].filter(Boolean).join(" · ")],
      ["תשלום", row.amount ? row.amount + " ₪ · " + (row.paid_at ? "שולם " + d8(row.paid_at) : "לא שולם") : ""]]
      .filter((x) => x[1]).map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join("");
    const items = Object.fromEntries(C.build(d).map((i) => [i.id, i]).concat(C.benefits(d).map((b) => ["b:" + b.id, b])));
    const benefitsList = C.benefits(d).map((b) => `<li><strong>${esc(b.t)}</strong> (${esc(b.amount)}) · ${esc(b.sure === "likely" ? "כנראה מגיע" : "לבדוק")}${b.docs.length ? `<br><span class="muted">מסמכים: ${esc(b.docs.join(" · "))}</span>` : ""}</li>`).join("");
    const tasks = db.tasks(row.id).map((t) => {
      const i = items[t.id] || items[t.body_id] || {};
      return `<tr><th scope="row">${esc(t.title)}${i.url ? ` <a href="${esc(i.url)}" target="_blank" rel="noopener">לאתר<span class="sr"> (נפתח בחלון חדש)</span></a>` : ""}</th>
        <td><label class="sr" for="s-${esc(t.body_id)}">מצב: ${esc(t.title)}</label>
        <select id="s-${esc(t.body_id)}" name="s_${esc(t.body_id)}">${Object.entries(TASK).map(([k, v]) => `<option value="${k}"${t.status === k ? " selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><label class="sr" for="n-${esc(t.body_id)}">הערה: ${esc(t.title)}</label>
        <input type="text" id="n-${esc(t.body_id)}" name="n_${esc(t.body_id)}" value="${esc(t.note || "")}" maxlength="200"></td>
        <td class="n muted">${esc(d8(t.updated_at))}</td></tr>`;
    }).join("");
    const events = db.events(row.id).map((e) => `<li><span class="muted">${esc(d8(e.at))}</span> ${esc(e.type)} ${esc(e.detail || "")}</li>`).join("");
    res.send(page(row.ref, `<h1>פנייה ${esc(row.ref)} <span class="pill ${esc(row.status)}">${esc(STATUS[row.status])}</span></h1>
      <p class="muted">התקבלה ${esc(d8(row.created_at))} · ${esc(SERVICE[row.service])}</p>
      <section class="card" aria-labelledby="h-d"><h2 id="h-d">פרטי הלקוח</h2><dl>${info}</dl></section>
      ${moversSection(row.id)}
      <section class="card" aria-labelledby="h-b"><h2 id="h-b">הנחות שכדאי לבקש</h2><ul>${benefitsList}</ul></section>
      <section class="card" aria-labelledby="h-t"><h2 id="h-t">משימות לפי גוף והנחה</h2>
        <form method="post" action="/admin/leads/${esc(row.ref)}/tasks"><div class="t"><table>
        <thead><tr><th scope="col">גוף</th><th scope="col">מצב</th><th scope="col">הערה</th><th scope="col">עודכן</th></tr></thead><tbody>${tasks}</tbody></table></div>
        <p><button type="submit">שמירת המשימות</button></p></form></section>
      <section class="card" aria-labelledby="h-s"><h2 id="h-s">מצב הפנייה</h2>
        <form method="post" action="/admin/leads/${esc(row.ref)}/status"><label for="st">מצב</label>
        <select id="st" name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${row.status === k ? " selected" : ""}>${v}</option>`).join("")}</select>
        <button type="submit">עדכון</button></form></section>
      <section class="card" aria-labelledby="h-e"><h2 id="h-e">יומן פעולות</h2><ul>${events}</ul></section>
      <section class="card" aria-labelledby="h-x"><h2 id="h-x">מחיקת הפנייה</h2>
        <p>לפי בקשת לקוח, או כשהטיפול הסתיים. אי אפשר לשחזר.</p>
        <form method="post" action="/admin/leads/${esc(row.ref)}/delete"><label><input type="checkbox" name="confirm" value="yes" required> כן, למחוק לצמיתות</label>
        <p><button type="submit" class="del">מחיקה</button></p></form></section>`));
  });

  r.post("/leads/:ref/tasks", (req, res) => {
    const row = find(req, res); if (!row) return;
    for (const t of db.tasks(row.id)) {
      const s = req.body["s_" + t.body_id], n = req.body["n_" + t.body_id];
      if (s && TASK[s] && (s !== t.status || (n ?? "") !== (t.note ?? ""))) {
        db.setTask(row.id, t.body_id, s, String(n || "").slice(0, 200));
        db.event(row.id, "task:" + t.body_id, TASK[s]);
      }
    }
    const left = db.tasks(row.id).filter((t) => t.status === "todo" || t.status === "error").length;
    if (row.status === "new") db.setStatus(row.id, "in_progress");
    if (!left) db.setStatus(row.id, "done");
    res.redirect(303, "/admin/leads/" + encodeURIComponent(row.ref));
  });

  r.post("/leads/:ref/status", (req, res) => {
    const row = find(req, res); if (!row) return;
    if (STATUS[req.body.status]) { db.setStatus(row.id, req.body.status); db.event(row.id, "status", STATUS[req.body.status]); }
    res.redirect(303, "/admin/leads/" + encodeURIComponent(row.ref));
  });

  r.post("/leads/:ref/delete", (req, res) => {
    const row = find(req, res); if (!row) return;
    if (req.body.confirm !== "yes") return res.status(400).send(page("לא נמחק", "<h1>לא נמחק</h1><p>צריך לסמן אישור.</p>"));
    db.remove(row.id);
    console.log("[admin] lead deleted", row.ref);
    res.redirect(303, "/admin");
  });

  // נתונים עסקיים: כמה פניות, מאיפה, אילו הנחות, קליקים על שותפים, משפך בטופס
  r.get("/stats", (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const rows = db.since(days), c = db.counters(days);
    const by = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const top = (m, n = 10) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
    const benefits = {};
    for (const row of rows.slice(0, 5000)) {
      const d = open(row); if (!d || !d.benefits) continue;
      for (const b of d.benefits) if (b.sure === "likely") benefits[b.title] = (benefits[b.title] || 0) + 1;
    }
    const paid = rows.filter((r) => r.paid_at), revenue = paid.reduce((s, r) => s + (r.amount || 0), 0);
    const table = (title, pairs, unit = "") => `<section class="card"><h2>${esc(title)}</h2>${pairs.length ? `<div class="t"><table class="narrow"><tbody>${pairs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="n">${esc(v)}${unit}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">אין עדיין נתונים.</p>`}</section>`;
    const funnel = ["step:0", "step:1", "step:2", "step:3", "step:4", "step:5", "results"].map((k) => [k === "results" ? "הגיעו לרשימה" : "שלב " + (Number(k.slice(5)) + 1), c["view:" + k] || 0]).filter(([, v], i) => v || i < 5);
    const clicks = Object.entries(c).filter(([k]) => k.startsWith("click:")).map(([k, v]) => [k.slice(6), v]).sort((a, b) => b[1] - a[1]);
    const tiles = [["פניות", rows.length], ["שירות מלא", rows.filter((r) => r.service === "concierge").length], ["הסכימו לדיוור", rows.filter((r) => r.marketing).length],
      ["קליקים על שותפים", clicks.reduce((s, x) => s + x[1], 0)]].concat(cfg.payments.enabled ? [["הכנסות (₪)", revenue]] : []);
    res.send(page("נתונים", `<h1>נתונים</h1>
      <div class="chips" role="navigation" aria-label="טווח זמן">${[7, 30, 90].map((n) => `<a href="/admin/stats?days=${n}"${n === days ? ' aria-current="page"' : ""}>${n} ימים</a>`).join("")}</div>
      <section class="tiles" aria-label="סיכום">${tiles.map(([k, v]) => `<div class="tile"><span class="muted">${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</section>
      ${table("משפך בטופס (כניסות לכל שלב)", funnel)}
      ${table("ערים חדשות מובילות", top(by(rows, (r) => r.new_city)))}
      ${table("ההנחות הנפוצות", top(benefits))}
      ${table("קליקים לפי שותף", clicks)}
      <p class="muted">המונים אנונימיים: בלי כתובות IP ובלי עוגיות. זה מספיק כדי להציג לשותפים כמה אנשים עוברים בכל עיר, בלי לחשוף מידע אישי.</p>`));
  });

  r.get("/export.csv", (req, res) => {
    const cols = ["מספר", "התקבלה", "שם פרטי", "שם משפחה", "טלפון", "מייל", "כתובת קודמת", "כתובת חדשה", "תאריך מעבר", "שירות", "מצב", "משימות פתוחות", "הסכמה לדיוור", "סכום", "שפה"];
    const q = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const lines = db.list({ limit: 100000 }).map((row) => {
      const d = open(row) || {};
      const openT = db.tasks(row.id).filter((t) => t.status === "todo" || t.status === "error").length;
      return [row.ref, d8(row.created_at), d.firstName, d.lastName, d.phone, d.email, C.addr(d, "old"), C.addr(d, "new"), C.fmtDate(row.move_date),
        SERVICE[row.service], STATUS[row.status], openT, row.marketing ? "כן" : "לא", row.amount || 0, C.LANG_NAMES_HE[d.lang || "he"]].map(q).join(",");
    });
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="leads.csv"')
      .send("﻿" + cols.map(q).join(",") + "\r\n" + lines.join("\r\n"));
  });

  return r;
}
