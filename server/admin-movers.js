// ניהול מובילים: רשימה וביצועים, הוספה ועריכה עם רשימת בדיקה, בקשות הצטרפות, ביקורות לאישור, ערים בלי מובילים.
import { moversApi, MOVER_STATUS } from "./movers.js";
import { catalog as C } from "./validate.js";

export function mountMovers(r, { db, cfg, page, esc }) {
  const M = moversApi(db);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");

  r.get("/movers", (req, res) => {
    const st = M.stats(30), rating = M.ratings(), all = M.all();
    const rows = all.map((m) => {
      const s = st[m.id] || { leads: 0, acted: 0, won: 0, hours: null }, rt = rating[m.id];
      const state = m.active ? "פעיל" : m.source === "join" && !m.checked_at ? "בקשת הצטרפות" : "מושהה";
      const checks = [m.company_id && "ח.פ.", m.insurance && "ביטוח", m.agreement && "הסכם"].filter(Boolean).join(", ") || "חסר";
      return `<tr><th scope="row"><a href="/admin/movers/${m.id}">${esc(m.name)}</a>${m.paying ? ' <span class="pill">משלם</span>' : ""}</th>
        <td><span class="pill ${m.active ? "done" : "new"}">${esc(state)}</span></td><td>${esc(checks)}</td>
        <td>${esc(String(m.areas).replace(/,/g, ", "))}</td><td class="n">${s.leads}</td><td class="n">${pct(s.acted, s.leads)}</td>
        <td class="n">${s.hours != null ? s.hours.toFixed(1) + " שעות" : "—"}</td><td class="n">${s.won}</td>
        <td class="n">${rt ? rt.avg.toFixed(1) + " (" + rt.n + ")" : "—"}</td></tr>`;
    }).join("");
    const unmatched = M.unmatched(30);
    const pending = M.reviews().filter((v) => !v.published).length;
    res.send(page("מובילים", `<h1>מובילים ${cfg.moversEnabled ? "" : '<span class="pill new">כבוי באתר (MOVERS_ENABLED)</span>'}</h1>
      <p><a href="/admin/movers/new">הוספת מוביל</a> · <a href="/admin/reviews">ביקורות${pending ? " (" + pending + " מחכות לאישור)" : ""}</a></p>
      ${all.length ? `<div class="t"><table><caption class="muted cap">ביצועים ב-30 הימים האחרונים</caption>
      <thead><tr><th scope="col">מוביל</th><th scope="col">מצב</th><th scope="col">נבדק</th><th scope="col">אזורים</th><th scope="col">פניות</th><th scope="col">הגיבו</th><th scope="col">זמן תגובה</th><th scope="col">נסגרו</th><th scope="col">דירוג</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : "<p>עדיין אין מובילים. מוסיפים ידנית, או שולחים למובילים את הקישור /movers/join.</p>"}
      <section class="card"><h2>ערים שביקשו הצעות ואין בהן מוביל</h2>
      ${unmatched.length ? `<ul>${unmatched.map((u) => `<li>${esc(u.new_city)}: ${u.n} פניות</li>`).join("")}</ul><p class="muted">כאן כדאי לגייס את המובילים הבאים.</p>` : '<p class="muted">אין. כל הבקשות קיבלו מוביל.</p>'}</section>`));
  });

  const field = (id, label, v, extra = "") => `<div class="fld"><label for="${id}">${label}</label><input type="text" id="${id}" name="${id}" value="${esc(v ?? "")}" ${extra}></div>`;
  const check = (id, label, v) => `<div class="fld"><label><input type="checkbox" name="${id}" value="1"${v ? " checked" : ""}> ${label}</label></div>`;
  const form = (m = {}, err = "") => page(m.id ? m.name : "מוביל חדש", `<h1>${m.id ? "עריכת " + esc(m.name) : "מוביל חדש"}</h1>
    ${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}
    <form method="post" action="/admin/movers/${m.id || "new"}" class="card form">
      ${field("name", "שם העסק (חובה)", m.name, "required maxlength=80")}${field("contact", "איש קשר", m.contact, "maxlength=60")}
      ${field("phone", "טלפון (חובה)", m.phone, "required maxlength=20")}${field("email", "מייל לקבלת פניות", m.email, "maxlength=80")}
      ${field("website", "אתר", m.website, "maxlength=120")}
      ${field("areas", "ערים (מופרדות בפסיק, או * לכל הארץ)", m.areas, "required maxlength=400")}
      ${field("company_id", "ח.פ. / עוסק", m.company_id, "maxlength=12")}
      ${field("weekly_cap", "מקסימום פניות בשבוע", m.weekly_cap ?? 10, "inputmode=numeric maxlength=3")}
      <fieldset class="card"><legend>רשימת בדיקה לפני אישור</legend>
        ${check("insurance", "ראיתי אישור ביטוח לתכולה בזמן הובלה", m.insurance)}
        ${check("agreement", "המוביל אישר את תנאי השותפות (חזרה ללקוח תוך יום עבודה, מחיר הוגן, בלי שימוש בפרטים למטרה אחרת)", m.agreement)}
        ${field("checked_at", "תאריך הבדיקה (YYYY-MM-DD)", m.checked_at, "maxlength=10 inputmode=numeric")}
      </fieldset>
      ${check("active", "פעיל: מקבל פניות", m.active)}
      ${check("paying", "משלם על הפניות (יוצג גילוי נאות באתר)", m.paying)}
      <div class="fld"><label for="notes">הערות</label><input type="text" id="notes" name="notes" value="${esc(m.notes ?? "")}" maxlength="500"></div>
      <p><button type="submit">שמירה</button></p>
    </form>
    ${m.id ? `<section class="card"><h2>פניות אחרונות</h2>${moverLeads(m.id)}</section>` : ""}`);
  const moverLeads = (id) => {
    const rows = db.raw.prepare("SELECT ml.*, l.ref, l.new_city, l.move_date FROM mover_leads ml JOIN leads l ON l.id = ml.lead_id WHERE ml.mover_id = ? ORDER BY ml.id DESC LIMIT 30").all(id);
    return rows.length ? `<ul>${rows.map((x) => `<li><a href="/admin/leads/${esc(x.ref)}">${esc(x.ref)}</a> · ${esc(x.new_city)} · ${esc(C.fmtDate(x.move_date))} · ${esc(MOVER_STATUS[x.status])}</li>`).join("")}</ul>` : '<p class="muted">עדיין אין.</p>';
  };
  const readForm = (b) => {
    const m = {};
    for (const k of ["name", "contact", "phone", "email", "website", "areas", "company_id", "checked_at", "notes"]) m[k] = String(b[k] || "").trim().slice(0, k === "areas" ? 400 : k === "notes" ? 500 : 120);
    for (const k of ["insurance", "agreement", "active", "paying"]) m[k] = b[k] === "1";
    m.weekly_cap = Math.min(500, Math.max(1, parseInt(b.weekly_cap, 10) || 10));
    m.areas = m.areas.split(",").map((a) => a.trim()).filter(Boolean).join(",");
    let err = "";
    if (!m.name || !m.phone || !m.areas) err = "חסרים שם, טלפון או ערים.";
    else if (!C.validPhone(m.phone)) err = "הטלפון לא תקין.";
    else if (m.email && !C.validEmail(m.email)) err = "המייל לא תקין.";
    else if (m.checked_at && !/^\d{4}-\d{2}-\d{2}$/.test(m.checked_at)) err = "תאריך הבדיקה צריך להיות בפורמט 2026-10-01.";
    else if (m.active && (!m.insurance || !m.agreement)) err = "לפני שמפעילים מוביל, צריך לסמן שבדקתם ביטוח ושהוא אישר את התנאים.";
    return { m, err };
  };

  r.get("/movers/new", (req, res) => res.send(form()));
  r.post("/movers/new", (req, res) => {
    const { m, err } = readForm(req.body);
    if (err) return res.status(400).send(form(m, err));
    const id = M.create(m);
    res.redirect(303, "/admin/movers/" + id);
  });
  r.get("/movers/:id", (req, res) => {
    const m = M.get(Number(req.params.id));
    if (!m) return res.status(404).send(page("לא נמצא", "<h1>המוביל לא נמצא</h1>"));
    res.send(form(m));
  });
  r.post("/movers/:id", (req, res) => {
    const cur = M.get(Number(req.params.id));
    if (!cur) return res.status(404).send(page("לא נמצא", "<h1>המוביל לא נמצא</h1>"));
    const { m, err } = readForm(req.body);
    if (err) return res.status(400).send(form({ ...m, id: cur.id }, err));
    M.update(cur.id, m);
    res.redirect(303, "/admin/movers");
  });

  r.get("/reviews", (req, res) => {
    const list = M.reviews();
    res.send(page("ביקורות", `<h1>ביקורות על מובילים</h1><p class="muted">ביקורת מתפרסמת רק אחרי אישור. מאשרים גם ביקורות שליליות, אלא אם יש בהן פרטים אישיים או תוכן פוגעני.</p>
      ${list.length ? `<ul class="rev">${list.map((v) => `<li class="card"><strong>${esc(v.mover_name)}</strong> · ${"★".repeat(v.stars)}${"☆".repeat(5 - v.stars)} <span class="sr">${v.stars} מתוך 5</span>
        <p>${esc(v.text || "(בלי טקסט)")}</p><p class="muted">${esc(v.public_name || "בלי שם (לא אישר פרסום שם)")}${v.city ? ", " + esc(v.city) : ""} · ${v.published ? "מפורסם" : "מחכה לאישור"}</p>
        <form method="post" action="/admin/reviews/${v.id}"><button name="action" value="${v.published ? "hide" : "publish"}">${v.published ? "הסתרה" : "פרסום"}</button>
        <button name="action" value="delete" class="del">מחיקה</button></form></li>`).join("")}</ul>` : "<p>עדיין אין ביקורות.</p>"}`));
  });
  r.post("/reviews/:id", (req, res) => {
    const id = Number(req.params.id), a = req.body.action;
    if (a === "publish") M.setPublished(id, true);
    else if (a === "hide") M.setPublished(id, false);
    else if (a === "delete") M.deleteReview(id);
    res.redirect(303, "/admin/reviews");
  });

  // לשימוש בדף הפנייה
  return (leadId) => {
    const rows = M.forLead(leadId);
    if (!rows.length) return "";
    return `<section class="card" aria-labelledby="h-mv"><h2 id="h-mv">הובלה: הצעות מחיר</h2><ul>${rows.map((x) =>
      `<li><a href="/admin/movers/${x.mover_id}">${esc(x.name)}</a> · ${esc(x.phone)} · <strong>${esc(MOVER_STATUS[x.status])}</strong>${x.first_action_at ? "" : x.status === "sent" ? ' <span class="pill new">עוד לא הגיב</span>' : x.status === "pending" && !x.email ? ' <span class="pill new">אין מייל: להתקשר למוביל</span>' : ""}</li>`).join("")}</ul></section>`;
  };
}
