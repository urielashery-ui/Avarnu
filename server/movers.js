// פיילוט מובילים: בחירת מובילים לפנייה, פורטל מוביל (בלי סיסמה), ביקורות, ודפים ציבוריים.
import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { catalog as C } from "./validate.js";

const now = () => new Date().toISOString();
const token = () => randomBytes(18).toString("base64url");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const normCity = (s) => String(s || "").replace(/[\s\-־"״'׳]/g, "").replace(/^תלאביב(יפו)?$/, "תלאביב").trim();

export const MOVER_STATUS = { pending: "ממתין לשליחה", sent: "נשלח למוביל", contacted: "המוביל יצר קשר", quoted: "המוביל נתן הצעה", won: "נסגרה הובלה", lost: "לא נסגר" };
const PORTAL_STATUSES = ["contacted", "quoted", "won", "lost"];

const cache = new WeakMap();
export function moversApi(db) {
  if (cache.has(db)) return cache.get(db);
  const raw = db.raw;
  const q = {
    all: raw.prepare("SELECT * FROM movers ORDER BY active DESC, name"),
    active: raw.prepare("SELECT * FROM movers WHERE active = 1"),
    get: raw.prepare("SELECT * FROM movers WHERE id = ?"),
    insert: raw.prepare(`INSERT INTO movers (name, contact, phone, email, website, areas, company_id, insurance, agreement, checked_at, notes, active, paying, weekly_cap, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: raw.prepare(`UPDATE movers SET name=?, contact=?, phone=?, email=?, website=?, areas=?, company_id=?, insurance=?, agreement=?, checked_at=?, notes=?, active=?, paying=?, weekly_cap=? WHERE id=?`),
    recent: raw.prepare("SELECT mover_id, COUNT(*) AS n FROM mover_leads WHERE created_at >= ? GROUP BY mover_id"),
    rating: raw.prepare("SELECT mover_id, AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE published = 1 GROUP BY mover_id"),
    assign: raw.prepare("INSERT OR IGNORE INTO mover_leads (lead_id, mover_id, token, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)"),
    forLead: raw.prepare("SELECT ml.*, m.name, m.phone, m.email, m.contact FROM mover_leads ml JOIN movers m ON m.id = ml.mover_id WHERE ml.lead_id = ? ORDER BY ml.id"),
    byToken: raw.prepare("SELECT ml.*, m.name AS mover_name FROM mover_leads ml JOIN movers m ON m.id = ml.mover_id WHERE ml.token = ?"),
    setStatus: raw.prepare("UPDATE mover_leads SET status = ?, updated_at = ?, first_action_at = COALESCE(first_action_at, ?) WHERE id = ?"),
    setSent: raw.prepare("UPDATE mover_leads SET status = 'sent', updated_at = ? WHERE id = ? AND status = 'pending'"),
    leadByReview: raw.prepare("SELECT * FROM leads WHERE review_token = ?"),
    reviewFor: raw.prepare("SELECT * FROM reviews WHERE lead_id = ?"),
    addReview: raw.prepare("INSERT INTO reviews (lead_id, mover_id, stars, text, public_name, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    reviews: raw.prepare("SELECT r.*, m.name AS mover_name FROM reviews r JOIN movers m ON m.id = r.mover_id ORDER BY r.published, r.created_at DESC LIMIT 200"),
    publishedFor: raw.prepare("SELECT * FROM reviews WHERE mover_id = ? AND published = 1 ORDER BY created_at DESC LIMIT 5"),
    setPublished: raw.prepare("UPDATE reviews SET published = ? WHERE id = ?"),
    delReview: raw.prepare("DELETE FROM reviews WHERE id = ?"),
    due: raw.prepare(`SELECT * FROM leads WHERE move_quote = 1 AND review_sent_at IS NULL AND review_token IS NOT NULL
      AND status != 'awaiting_payment' AND move_date IS NOT NULL AND move_date <= ?`),
    reviewSent: raw.prepare("UPDATE leads SET review_sent_at = ? WHERE id = ?"),
    stats: raw.prepare(`SELECT mover_id, COUNT(*) AS leads,
      SUM(CASE WHEN first_action_at IS NOT NULL THEN 1 ELSE 0 END) AS acted,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
      AVG(CASE WHEN first_action_at IS NOT NULL THEN (julianday(first_action_at) - julianday(created_at)) * 24 END) AS hours
      FROM mover_leads WHERE created_at >= ? GROUP BY mover_id`),
    unmatched: raw.prepare(`SELECT new_city, COUNT(*) AS n FROM leads l WHERE move_quote = 1 AND created_at >= ?
      AND NOT EXISTS (SELECT 1 FROM mover_leads ml WHERE ml.lead_id = l.id) GROUP BY new_city ORDER BY n DESC LIMIT 15`)
  };
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const moverFields = (m) => [m.name, m.contact || null, m.phone, m.email || null, m.website || null, m.areas || "", m.company_id || null,
    m.insurance ? 1 : 0, m.agreement ? 1 : 0, m.checked_at || null, m.notes || null, m.active ? 1 : 0, m.paying ? 1 : 0, Number(m.weekly_cap) || 10];

  const api = {
    all: () => q.all.all(),
    get: (id) => q.get.get(id),
    create: (m, source = "admin") => Number(q.insert.run(...moverFields(m), source, now()).lastInsertRowid),
    update: (id, m) => q.update.run(...moverFields(m), id),
    ratings() { return Object.fromEntries(q.rating.all().map((r) => [r.mover_id, { avg: r.avg, n: r.n }])); },
    anyPaying: () => q.active.all().some((m) => m.paying),
    /** עד n מובילים פעילים שמשרתים את אחת הערים. תורנות: מי שקיבל הכי מעט פניות השבוע קודם; אחר כך דירוג. */
    pick(cities, n) {
      const want = cities.map(normCity).filter(Boolean);
      const recent = Object.fromEntries(q.recent.all(since(7)).map((r) => [r.mover_id, r.n]));
      const rating = api.ratings();
      return q.active.all()
        .filter((m) => {
          const areas = String(m.areas).split(",").map((a) => a.trim()).filter(Boolean);
          return areas.includes("*") || areas.some((a) => want.includes(normCity(a)));
        })
        .filter((m) => (recent[m.id] || 0) < m.weekly_cap)
        .map((m) => ({ m, load: recent[m.id] || 0, stars: (rating[m.id] || {}).avg || 0, r: Math.random() }))
        .sort((a, b) => a.load - b.load || b.stars - a.stars || a.r - b.r)
        .slice(0, n).map((x) => x.m);
    },
    assign(leadId, movers) {
      const t = now(), exp = new Date(Date.now() + 45 * 864e5).toISOString();
      for (const m of movers) q.assign.run(leadId, m.id, token(), t, t, exp);
    },
    forLead: (leadId) => q.forLead.all(leadId),
    byToken: (t) => q.byToken.get(String(t)),
    setStatus: (id, status) => { const t = now(); q.setStatus.run(status, t, t, id); },
    markSent: (id) => q.setSent.run(now(), id),
    leadByReview: (t) => q.leadByReview.get(String(t)),
    reviewFor: (leadId) => q.reviewFor.get(leadId),
    addReview: (r) => q.addReview.run(r.leadId, r.moverId, r.stars, r.text || null, r.publicName || null, r.city || null, now()),
    reviews: () => q.reviews.all(),
    publishedFor: (moverId) => q.publishedFor.all(moverId),
    setPublished: (id, v) => q.setPublished.run(v ? 1 : 0, id),
    deleteReview: (id) => q.delReview.run(id),
    due(delayDays) { return q.due.all(new Date(Date.now() - delayDays * 864e5).toISOString().slice(0, 10)); },
    reviewSent: (id) => q.reviewSent.run(now(), id),
    stats: (days) => Object.fromEntries(q.stats.all(since(days)).map((r) => [r.mover_id, r])),
    unmatched: (days) => q.unmatched.all(since(days))
  };
  cache.set(db, api);
  return api;
}

// ---------- תיאור הבקשה (משותף למייל ולפורטל) ----------
const ROOMS = { "1": "חדר אחד", "6": "6 חדרים ויותר" };
export function jobSummary(d) {
  const floor = (f, el) => (f === "" || f == null ? "לא צוין" : f === "0" ? "קרקע" : "קומה " + f) + (el ? ", יש מעלית" : ", בלי מעלית");
  const extras = [d.packing && "אריזה", d.assembly && "פירוק והרכבה של רהיטים", d.storage && "אחסון זמני"].filter(Boolean);
  return [
    ["תאריך", C.fmtDate(d.moveDate) + (d.dateFlex === "flex" ? " (גמיש בכמה ימים)" : "")],
    ["מאיפה", (d.oldCity || "לא צוין") + " · " + floor(d.oldFloor, d.oldElevator)],
    ["לאן", (d.newCity || "") + " · " + floor(d.floor, d.newElevator)],
    ["גודל הדירה", ROOMS[d.rooms] || (d.rooms ? d.rooms + " חדרים" : "לא צוין")],
    ["מה עוד צריך", extras.join(", ") || "רק הובלה"],
    ["פריטים מיוחדים", d.specialItems || "אין"]
  ].concat(d.lang && d.lang !== "he" ? [["שפה מועדפת לשיחה", C.LANG_NAMES_HE[d.lang]]] : []);
}
export function waLink(phone, text) {
  const p = C.digits(phone).replace(/^0/, "972");
  return "https://wa.me/" + p + "?text=" + encodeURIComponent(text);
}

// ---------- עמוד באתר (עם העיצוב של האתר) ----------
const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="15" width="22" height="18" rx="3" class="lg-box"/><path d="M3 21h22" class="lg-line"/><path d="M19 17l9-8 9 8v14a2 2 0 0 1-2 2H21a2 2 0 0 1-2-2z" class="lg-house"/><rect x="25.5" y="23" width="5" height="10" rx="1" class="lg-door"/></svg>`;
export function sitePage(title, body, { noindex = false, lang = "he" } = {}) {
  const T = (k) => C.T(lang, k), dir = C.RTL[lang] ? "rtl" : "ltr";
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${noindex ? '<meta name="robots" content="noindex">' : ""}
<title>${esc(title)} · עברנו</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Secular+One&family=Rubik:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/styles.css"></head>
<body><div id="app" lang="${lang}" dir="${dir}"><a class="skip" href="#main">${esc(T("skip"))}</a><div class="wrap">
<header class="top"><a class="brand" href="${lang === "he" ? "/" : "/" + lang}">${LOGO}<span>עברנו</span><span class="tld" dir="ltr" aria-hidden="true">${lang === "he" ? ".com" : "avarnu.com"}</span></a></header>
<main id="main" tabindex="-1">${body}</main>
<footer><a href="${lang === "he" ? "/" : "/" + lang}">${esc(T("mvp.home"))}</a><a href="/movers?lang=${lang}">${esc(T("foot.movers"))}</a>${lang === "he" ? '<a href="/movers/join">מובילים? הצטרפו</a>' : ""}</footer>
</div></div></body></html>`;
}

// ---------- דפים ציבוריים ----------
export function publicMoversRouter({ db, crypt, cfg }) {
  const M = moversApi(db);
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: "10kb" });
  const joinLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false });
  const sameOrigin = (req, res, next) => {
    const o = req.headers.origin || req.headers.referer;
    if (o && new URL(o).host !== req.headers.host) return res.status(403).send("בקשה ממקור לא מורשה");
    next();
  };

  // מובילים מומלצים
  r.get("/movers", (req, res) => {
    if (!cfg.moversEnabled) return res.redirect(302, "/");
    const lang = C.LANGS.includes(req.query.lang) ? req.query.lang : "he", T = (k, v) => C.T(lang, k, v);
    const rating = M.ratings();
    const list = M.all().filter((m) => m.active);
    const cards = list.map((m) => {
      const rt = rating[m.id], revs = M.publishedFor(m.id);
      const stars = rt && rt.n >= cfg.minReviewsToShow ? `<p><strong>${esc(T("mvp.rating", { avg: rt.avg.toFixed(1) }))}</strong> <span class="muted">${esc(T("mvp.count", { n: rt.n }))}</span></p>` : `<p class="muted">${esc(T("mvp.noRating"))}</p>`;
      const areas = String(m.areas).split(",").map((a) => a.trim()).filter(Boolean);
      return `<li class="partner"><h2 class="mv-name">${esc(m.name)}</h2>${stars}
        <p class="muted">${esc(T("mvp.areas"))} ${esc(areas.includes("*") ? T("mvp.all") : areas.map((a) => C.cityName(a, lang)).join(", "))}</p>
        <ul class="need" aria-label="${esc(T("mvp.checked"))}">${m.insurance ? `<li>${esc(T("mvp.ins"))}</li>` : ""}${m.company_id ? `<li>${esc(T("mvp.reg"))}</li>` : ""}${m.checked_at ? `<li>${esc(T("mvp.date", { date: C.fmtDate(m.checked_at) }))}</li>` : ""}</ul>
        ${revs.length ? `<ul class="mv-revs">${revs.map((v) => `<li><span role="img" aria-label="${esc(T("rev.starsSr", { n: v.stars }))}">${"★".repeat(v.stars)}${"☆".repeat(5 - v.stars)}</span> <span lang="${/[\u0590-\u05FF]/.test(v.text || "") ? "he" : ""}">${esc(v.text || "")}</span> <span class="muted">— ${esc(v.public_name || T("mvp.customer"))}${v.city ? ", " + esc(C.cityName(v.city, lang)) : ""}</span></li>`).join("")}</ul>` : ""}
      </li>`;
    }).join("");
    const paidNote = M.anyPaying() ? " " + T("mvp.paid") : "";
    res.send(sitePage(T("mvp.title"), `<section class="panel"><h1 class="pg-h1">${esc(T("mvp.title"))}</h1>
      <p class="lead">${esc(T("mvp.lead") + paidNote)}</p>
      <p><a class="btn primary" href="${lang === "he" ? "/" : "/" + lang}">${esc(T("mvp.cta"))}</a></p></section>
      ${list.length ? `<ul class="partners mv-list">${cards}</ul>` : `<p class="lead">${esc(T("mvp.soon"))}</p>`}`, { lang }));
  });

  // הצטרפות מובילים
  const joinForm = (err = "", v = {}) => sitePage("מובילים? הצטרפו", `<section class="panel"><h1 class="pg-h1">מובילים? הצטרפו לעברנו</h1>
    <p class="lead">אנשים שעוברים דירה ממלאים אצלנו טופס. מי שמבקש הצעות מחיר מקבל עד 3 מובילים מאושרים מהאזור שלו. הפנייה מגיעה אליכם במייל, עם כל הפרטים וכפתור וואטסאפ ללקוח.</p>
    <p class="lead">בפיילוט ההצטרפות בחינם. אנחנו בודקים כל מוביל לפני שמאשרים אותו.</p>
    ${err ? `<div class="errsum" role="alert"><h2>יש מה לתקן</h2><p>${esc(err)}</p></div>` : ""}
    <form method="post" action="/movers/join" class="grid" novalidate>
      <div class="field w3"><label for="j-name">שם העסק <span class="req">(חובה)</span></label><input id="j-name" name="name" required maxlength="80" value="${esc(v.name)}" autocomplete="organization"></div>
      <div class="field w3"><label for="j-contact">שם איש הקשר <span class="req">(חובה)</span></label><input id="j-contact" name="contact" required maxlength="60" value="${esc(v.contact)}" autocomplete="name"></div>
      <div class="field w3"><label for="j-phone">טלפון <span class="req">(חובה)</span></label><input id="j-phone" name="phone" type="tel" required maxlength="20" value="${esc(v.phone)}" autocomplete="tel"></div>
      <div class="field w3"><label for="j-email">מייל לקבלת פניות <span class="req">(חובה)</span></label><input id="j-email" name="email" type="email" required maxlength="80" value="${esc(v.email)}" autocomplete="email"></div>
      <div class="field w3"><label for="j-cid">ח.פ. או מספר עוסק <span class="req">(חובה)</span></label><input id="j-cid" name="company_id" inputmode="numeric" required maxlength="12" value="${esc(v.company_id)}"></div>
      <div class="field w3"><label for="j-web">אתר או עמוד פייסבוק</label><input id="j-web" name="website" type="url" maxlength="120" value="${esc(v.website)}"></div>
      <div class="field w6"><label for="j-areas">באילו ערים אתם עובדים? <span class="req">(חובה)</span></label><p class="hint" id="j-areas-h">מפרידים בפסיק. לדוגמה: פתח תקווה, רמת גן, תל אביב-יפו</p><input id="j-areas" name="areas" required maxlength="300" aria-describedby="j-areas-h" value="${esc(v.areas)}"></div>
      <div class="field w6"><label class="choice"><input type="checkbox" name="insurance" value="1"${v.insurance ? " checked" : ""}> יש לנו ביטוח לתכולה בזמן הובלה</label></div>
      <div class="field w6"><label class="choice"><input type="checkbox" name="terms" value="1" required> אני מאשר/ת שהפרטים נכונים, ושנחזור ללקוחות שמגיעים מעברנו תוך יום עבודה.</label></div>
      <input type="text" name="website2" class="sr" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="field w6"><button type="submit" class="primary">שליחת בקשת הצטרפות</button></div>
    </form></section>`);
  r.get("/movers/join", (req, res) => res.send(joinForm()));
  r.post("/movers/join", joinLimiter, form, sameOrigin, (req, res) => {
    const b = req.body || {};
    if (b.website2) return res.send(sitePage("תודה", `<section class="panel"><h1 class="pg-h1">תודה!</h1><p class="lead">קיבלנו את הבקשה.</p></section>`));
    const v = Object.fromEntries(["name", "contact", "phone", "email", "company_id", "website", "areas"].map((k) => [k, String(b[k] || "").trim().slice(0, k === "areas" ? 300 : 120)]));
    v.insurance = b.insurance === "1";
    const miss = !v.name || !v.contact || !v.phone || !v.email || !v.company_id || !v.areas || b.terms !== "1";
    if (miss) return res.status(400).send(joinForm("צריך למלא את כל שדות החובה ולסמן את האישור.", v));
    if (!C.validPhone(v.phone)) return res.status(400).send(joinForm("מספר הטלפון לא תקין.", v));
    if (!C.validEmail(v.email)) return res.status(400).send(joinForm("כתובת המייל לא תקינה.", v));
    if (v.website && !/^https?:\/\//.test(v.website)) v.website = "";
    const id = M.create({ ...v, active: false, notes: "בקשת הצטרפות מהאתר" }, "join");
    db.bump("mover:join");
    console.log("[movers] בקשת הצטרפות חדשה", id);
    res.send(sitePage("תודה", `<section class="panel"><h1 class="pg-h1">תודה, ${esc(v.contact)}!</h1><p class="lead">קיבלנו את הבקשה. נחזור אליכם בימים הקרובים לשיחה קצרה ולבדיקת הפרטים.</p></section>`));
  });

  // פורטל מוביל — הקישור מהמייל הוא הכניסה. בלי סיסמה.
  const moverView = (req, res) => {
    const ml = M.byToken(req.params.token);
    if (!ml || ml.expires_at < now()) { res.status(404).send(sitePage("הקישור לא בתוקף", `<section class="panel"><h1 class="pg-h1">הקישור לא בתוקף</h1><p class="lead">אם צריך עזרה, כתבו לנו.</p></section>`, { noindex: true })); return null; }
    return ml;
  };
  r.get("/m/:token", (req, res) => {
    const ml = moverView(req, res); if (!ml) return;
    const row = db.raw.prepare("SELECT * FROM leads WHERE id = ?").get(ml.lead_id);
    const d = crypt.decrypt(row.data);
    const name = d.firstName + " " + d.lastName;
    const wa = waLink(d.phone, `שלום ${d.firstName}, כאן ${ml.mover_name}. קיבלנו את הבקשה שלך דרך עברנו להובלה ב-${C.fmtDate(d.moveDate)}.`);
    const saved = req.query.saved ? `<div class="refbox" role="status">עודכן. תודה!</div>` : "";
    res.set("Cache-Control", "no-store").send(sitePage("בקשת הובלה", `<section class="panel">
      <h1 class="pg-h1">בקשת הובלה: ${esc(name)}</h1>${saved}
      <p class="lead">הגיעה דרך עברנו. מספר פנייה ${esc(row.ref)}. חשוב לחזור ללקוח תוך יום עבודה.</p>
      <dl class="mv-dl"><dt>טלפון</dt><dd><a href="tel:${esc(C.digits(d.phone))}">${esc(d.phone)}</a></dd>${d.email ? `<dt>מייל</dt><dd>${esc(d.email)}</dd>` : ""}
      ${jobSummary(d).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <p><a class="btn primary" href="${esc(wa)}" target="_blank" rel="noopener">שליחת וואטסאפ ללקוח <span aria-hidden="true">↗</span><span class="sr"> (נפתח בחלון חדש)</span></a></p>
      </section>
      <section class="panel mv-status"><h2>מה המצב?</h2><p class="lead">עכשיו: <strong>${esc(MOVER_STATUS[ml.status])}</strong>. העדכון עוזר לנו לשלוח לכם עוד פניות.</p>
      <form method="post" action="/m/${esc(req.params.token)}" class="opts">${PORTAL_STATUSES.map((s) => `<button type="submit" name="status" value="${s}"${ml.status === s ? ' aria-pressed="true"' : ""}>${esc(MOVER_STATUS[s])}</button>`).join("")}</form>
      </section>`, { noindex: true }));
  });
  r.post("/m/:token", form, sameOrigin, (req, res) => {
    const ml = moverView(req, res); if (!ml) return;
    const s = String(req.body.status || "");
    if (PORTAL_STATUSES.includes(s)) { M.setStatus(ml.id, s); db.event(ml.lead_id, "mover:" + ml.mover_id, MOVER_STATUS[s]); }
    res.redirect(303, "/m/" + encodeURIComponent(req.params.token) + "?saved=1");
  });

  // ביקורת של לקוח — בשפה שבה מילא את הטופס
  const leadLang = (lead) => { try { return crypt.decrypt(lead.data).lang || "he"; } catch { return "he"; } };
  r.get("/r/:token", (req, res) => {
    const lead = M.leadByReview(req.params.token);
    if (!lead) return res.status(404).send(sitePage(C.T("he", "rev.invalid"), `<section class="panel"><h1 class="pg-h1">${esc(C.T("he", "rev.invalid"))}</h1></section>`, { noindex: true }));
    const lang = leadLang(lead), T = (k, v) => C.T(lang, k, v);
    if (M.reviewFor(lead.id)) return res.send(sitePage(T("rev.thanks"), `<section class="panel"><h1 class="pg-h1">${esc(T("rev.already"))}</h1></section>`, { noindex: true, lang }));
    const movers = M.forLead(lead.id);
    res.set("Cache-Control", "no-store").send(sitePage(T("rev.pageT"), `<section class="panel"><h1 class="pg-h1">${esc(T("rev.pageT"))}</h1>
      <p class="lead">${esc(T("rev.pageP"))}</p>
      <form method="post" action="/r/${esc(req.params.token)}" class="grid" novalidate>
        <fieldset class="choices w6" role="radiogroup" aria-required="true"><legend>${esc(T("rev.which"))} <span class="req">${esc(T("req"))}</span></legend>
          ${movers.map((m) => `<label class="choice"><input type="radio" name="mover" value="${m.mover_id}" required> ${esc(m.name)}</label>`).join("")}
          <label class="choice"><input type="radio" name="mover" value="none"> ${esc(T("rev.none"))}</label></fieldset>
        <fieldset class="choices w6" role="radiogroup" aria-required="true"><legend>${esc(T("rev.stars"))} <span class="req">${esc(T("req"))}</span></legend>
          ${[5, 4, 3, 2, 1].map((n) => `<label class="choice"><input type="radio" name="stars" value="${n}"> <span aria-hidden="true">${"★".repeat(n)}</span><span class="sr">${esc(T("rev.starsSr", { n }))}</span></label>`).join("")}</fieldset>
        <div class="field w6"><label for="r-text">${esc(T("rev.text"))}</label><input id="r-text" name="text" maxlength="300"></div>
        <div class="field w6"><label class="choice"><input type="checkbox" name="publish" value="1"> ${esc(T("rev.publish"))}</label></div>
        <div class="field w6"><button type="submit" class="primary">${esc(T("rev.send"))}</button></div>
      </form></section>`, { noindex: true, lang }));
  });
  r.post("/r/:token", form, sameOrigin, (req, res) => {
    const lead = M.leadByReview(req.params.token);
    if (!lead || M.reviewFor(lead.id)) return res.redirect(303, "/r/" + encodeURIComponent(req.params.token));
    const lang = leadLang(lead), T = (k, v) => C.T(lang, k, v);
    const b = req.body || {};
    if (b.mover === "none") { db.event(lead.id, "review", "עבר עם מוביל אחר"); return res.send(sitePage(T("rev.otherT"), `<section class="panel"><h1 class="pg-h1">${esc(T("rev.otherT"))}</h1><p class="lead">${esc(T("rev.otherP"))}</p></section>`, { lang })); }
    const movers = M.forLead(lead.id), mover = movers.find((m) => String(m.mover_id) === String(b.mover));
    const stars = Number(b.stars);
    if (!mover || !(stars >= 1 && stars <= 5)) return res.status(400).send(sitePage(T("rev.missingT"), `<section class="panel"><h1 class="pg-h1">${esc(T("rev.missingT"))}</h1><p class="lead">${esc(T("rev.missingP"))} <a href="/r/${esc(req.params.token)}">${esc(T("rev.back"))}</a></p></section>`, { noindex: true, lang }));
    const d = crypt.decrypt(lead.data), publish = b.publish === "1";
    M.addReview({ leadId: lead.id, moverId: mover.mover_id, stars, text: String(b.text || "").trim().slice(0, 300),
      publicName: publish ? d.firstName : null, city: publish ? d.newCity : null });
    if (mover.status !== "won") M.setStatus(mover.id, "won");
    db.event(lead.id, "review", stars + " כוכבים ל" + mover.name);
    res.send(sitePage(T("rev.thanks"), `<section class="panel"><h1 class="pg-h1">${esc(T("rev.thanks"))}</h1><p class="lead">${esc(T("rev.thanksP"))}</p></section>`, { noindex: true, lang }));
  });

  return r;
}
