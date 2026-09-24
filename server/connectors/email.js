// מיילים: התראה לעסק (בלי פרטים אישיים) ורשימת עדכונים ללקוח (בלי תעודת זהות).
import nodemailer from "nodemailer";
import { catalog as C } from "../validate.js";
import { jobSummary, waLink } from "../movers.js";

let transport;
function getTransport(cfg) {
  if (!transport) {
    transport = cfg.smtpUrl
      ? nodemailer.createTransport(cfg.smtpUrl)
      : nodemailer.createTransport({ jsonTransport: true }); // בלי SMTP: המייל רק נרשם בלוג
  }
  return transport;
}
export const sentLog = []; // לבדיקות

export async function sendMail(cfg, msg) {
  const info = await getTransport(cfg).sendMail({ from: cfg.mailFrom, ...msg });
  sentLog.push({ to: msg.to, subject: msg.subject, html: msg.html });
  if (!cfg.smtpUrl) console.log("[mail:dev] ל-%s: %s", msg.to, msg.subject);
  return "mail " + (info.messageId || "ok");
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// מעטפת המייל. lang קובע כיוון ושפה; מייל לעסק ולמובילים תמיד בעברית.
const shell = (title, inner, lang = "he") => {
  const rtl = !!C.RTL[lang], dir = rtl ? "rtl" : "ltr", align = rtl ? "right" : "left";
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F6F8FC;font-family:Arial,sans-serif;color:#13261E;direction:${dir};text-align:${align}">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-size:16px;line-height:1.6">${inner}
<p style="color:#4D5A75;font-size:13px;margin-top:32px">${esc(C.T(lang, "email.footer"))}</p></div></body></html>`;
};

function benefitsHtml(lead, lang) {
  const T = (k, v) => C.T(lang, k, v);
  const list = C.benefits(lead, { hideId: true, lang });
  if (!list.length) return "";
  return `<div style="background:#FFF3D1;color:#13261E;border-radius:16px;padding:16px;margin:20px 0 8px">
    <h2 style="font-size:21px;margin:0 0 4px">${esc(T("email.benTitle", { n: list.length }))}</h2>
    <p style="margin:0">${esc(T("email.benNote"))}</p></div>` + list.map((b) => `
    <div style="background:#fff;border:1px solid #D6DEEC;border-radius:10px;padding:14px;margin-bottom:10px">
      <strong>${esc(b.t)}</strong> ${b.amount ? `<span style="background:#FFC940;color:#2B2100;border-radius:6px;padding:1px 8px;font-size:13px;font-weight:bold">${esc(b.amount)}</span>` : ""}
      <p style="margin:6px 0">${esc(T(b.sure === "likely" ? "ben.likely" : "ben.check"))} ${esc(b.d)}</p>
      ${b.how ? `<p style="margin:6px 0"><strong>${esc(T("email.how"))}</strong> ${esc(b.how)}</p>` : ""}
      ${b.docs.length ? `<p style="margin:6px 0"><strong>${esc(T("email.docs"))}</strong> ${b.docs.map(esc).join(" · ")}</p>` : ""}
      ${b.url ? `<a href="${esc(b.url)}" style="color:#12704E;font-weight:bold">${esc(b.search ? T("ben.searchForm") : T("item.visit", { site: b.site || "" }))}</a>` : ""}
    </div>`).join("");
}

function moversHtml(movers, lang) {
  if (!movers || !movers.length) return "";
  return `<div style="background:#E3F2EA;border-radius:16px;padding:16px;margin:20px 0 8px">
    <h2 style="font-size:21px;margin:0 0 6px">${esc(C.T(lang, "email.mvTitle", { n: movers.length }))}</h2>
    <p style="margin:0 0 8px">${esc(C.T(lang, "email.mvP"))}</p>
    ${movers.map((m) => `<p style="margin:4px 0"><strong>${esc(m.name)}</strong> · <a href="tel:${esc(C.digits(m.phone))}" style="color:#12704E" dir="ltr">${esc(m.phone)}</a></p>`).join("")}</div>`;
}

function suppliesHtml(lead, lang) {
  if (lead.supplies !== "need") return "";
  const T = (k, v) => C.T(lang, k, v), from = lead.suppliesFrom;
  const msg = from === "movers" ? T("sup.movers") : from === "delivery"
    ? T("sup.ordered", { date: C.fmtDate(lead.suppliesDate), addr: C.addrL(lead, lead.suppliesTo === "new" ? "new" : "old", lang) }) : T("sup.self");
  return `<div style="background:#E3F2EA;border-radius:16px;padding:16px;margin:20px 0 8px">
    <h2 style="font-size:21px;margin:0 0 6px">${esc(T("email.supTitle"))}</h2><p style="margin:0 0 8px">${esc(msg)}</p>
    ${C.kitLines(lead, lang).map((x) => `<p style="margin:2px 0">• ${esc(x.name)}: <strong>${x.qty}</strong></p>`).join("")}</div>`;
}

// הזמנה לספק האריזות. בעברית, בלי תעודת זהות — רק מה שצריך למשלוח.
export function supplierOrderEmail(lead, ref) {
  const to = lead.suppliesTo === "new" ? "new" : "old";
  const floor = to === "new" ? lead.floor : lead.oldFloor, elev = to === "new" ? lead.newElevator : lead.oldElevator;
  const lines = C.kitLines(lead, "he");
  const rows = [["שם", lead.firstName + " " + lead.lastName], ["טלפון", lead.phone], ["כתובת למשלוח", C.addr(lead, to)],
    ["קומה", floor === "" || floor == null ? "לא צוין" : floor === "0" ? "קרקע" : floor + (elev ? ", יש מעלית" : "")],
    ["מועד משלוח מבוקש", C.fmtDate(lead.suppliesDate)], ["תאריך המעבר", C.fmtDate(lead.moveDate)]]
    .concat(lead.lang && lead.lang !== "he" ? [["שפה מועדפת לשיחה", C.LANG_NAMES_HE[lead.lang]]] : []);
  const wa = waLink(lead.phone, `שלום ${lead.firstName}, כאן ספק האריזות של עברנו. קיבלנו את ההזמנה שלך לקרטונים ל-${C.fmtDate(lead.suppliesDate)}.`);
  const th = "text-align:right;padding:6px 10px;color:#4D5A75;font-weight:normal;vertical-align:top";
  return {
    subject: `הזמנת קרטונים מעברנו ${ref}: ${C.cityName(to === "new" ? lead.newCity : lead.oldCity, "he") || ""}, ${C.fmtDate(lead.suppliesDate)}`,
    html: shell("הזמנת קרטונים", `<h1 style="font-size:22px;margin:0 0 8px">הזמנה חדשה של קרטונים וחומרי אריזה</h1>
      <table role="presentation" style="border-collapse:collapse;width:100%;background:#fff;border-radius:10px">${rows.map(([k, v]) => `<tr><th style="${th}">${esc(k)}</th><td style="padding:6px 10px">${esc(v)}</td></tr>`).join("")}</table>
      <h2 style="font-size:19px;margin:18px 0 6px">מה להביא</h2>
      <table role="presentation" style="border-collapse:collapse;width:100%;background:#fff;border-radius:10px">${lines.map((x) => `<tr><th style="${th}">${esc(x.name)}</th><td style="padding:6px 10px"><strong>${x.qty}</strong></td></tr>`).join("")}</table>
      <p style="margin:18px 0"><a href="${esc(wa)}" style="background:#12704E;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">שליחת וואטסאפ ללקוח</a></p>
      <p style="font-size:13px;color:#4D5A75">הלקוח מחכה לשיחה לאישור מחיר ומועד. התשלום ישירות מול הלקוח, במסירה. הלקוח הסכים שנעביר לכם את הפרטים האלה.</p>`),
    text: `הזמנת קרטונים ${ref}: ${lead.firstName} ${lead.lastName}, ${lead.phone}\n` + rows.map(([k, v]) => k + ": " + v).join("\n") + "\n" + lines.map((x) => x.name + ": " + x.qty).join("\n")
  };
}

// רשימת העדכונים ללקוח — בשפה שבה מילא את הטופס
// קישור להשלמת פרטים חסרים (בלי להתחיל מחדש)
function laterHtml(lead, lang, url) {
  const miss = C.missing(lead);
  if (!url || !miss.length) return "";
  const T = (k, v) => C.T(lang, k, v), labels = C.labels(lang);
  return `<div style="background:#FFF3CC;border-radius:16px;padding:16px;margin:20px 0 8px">
    <p style="margin:0 0 6px"><strong>${esc(T("email.laterLink", { n: miss.length }))}</strong></p>
    <p style="margin:0 0 12px">${miss.map((k) => esc(labels[k])).join(" · ")}</p>
    <a href="${esc(url)}" style="background:#12704E;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(T("email.laterBtn"))}</a></div>`;
}

// התראה לעסק על בקשה לתיאום שיחה. בלי פרטים אישיים — הם במסך הניהול.
export function callbackNotifyEmail(ref, title, day, slot, cfg) {
  return {
    subject: `לתאם שיחה ${C.fmtDate(day)} ${slot}: ${title}`,
    html: shell("בקשה לתיאום שיחה", `<h1 style="font-size:22px">בקשה לתיאום שיחה (${esc(ref)})</h1>
      <p>הלקוח מבקש שנמתין בשבילו על הקו של <strong>${esc(title)}</strong>, ונחבר אותו כשעונים.</p>
      <p>מתי: <strong>${esc(C.fmtDate(day))}, בין ${esc(slot.replace("-", ":00 ל-"))}:00</strong></p>
      <p><a href="${esc(cfg.publicUrl)}/admin/callbacks" style="color:#12704E;font-weight:bold">לכל השיחות לתיאום</a></p>`),
    text: `לתאם שיחה: ${title}, ${C.fmtDate(day)} ${slot}. ${cfg.publicUrl}/admin/callbacks`
  };
}

export function reminderEmail(lead, url, miss, kind) {
  const lang = lead.lang || "he", T = (k, v) => C.T(lang, k, v), labels = C.labels(lang);
  const intro = kind === "keyDay" ? T("rem.p2") : T("rem.p1", { n: miss.length });
  return {
    subject: T(kind === "keyDay" ? "rem.subject2" : "rem.subject1"),
    html: shell(T("u.title"), `<h1 style="font-size:22px;margin:0 0 8px">${esc(T("rem.h1", { name: lead.firstName }))}</h1>
      <p>${esc(intro)}</p><ul>${miss.map((k) => `<li>${esc(labels[k])}</li>`).join("")}</ul>
      <p style="margin:18px 0"><a href="${esc(url)}" style="background:#12704E;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(T("rem.btn"))}</a></p>
      <p style="font-size:13px;color:#4D5A75">${esc(T("rem.stop"))} <a href="${esc(url)}" style="color:#12704E">${esc(url)}</a></p>`, lang),
    text: intro + "\n" + miss.map((k) => "• " + labels[k]).join("\n") + "\n" + url
  };
}

export function customerChecklistEmail(lead, ref, cfg, movers, editUrl) {
  const lang = lead.lang || "he", T = (k, v) => C.T(lang, k, v);
  const items = C.build(lead, { hideId: true, lang });
  const groups = C.groups(lang).map((g) => {
    const its = items.filter((i) => i.grp === g.id);
    if (!its.length) return "";
    return `<h3 style="font-size:19px;margin:24px 0 8px">${esc(g.title)}</h3>` + its.map((i) => `
      <div style="background:#fff;border:1px solid #D6DEEC;border-radius:10px;padding:14px;margin-bottom:10px">
        <strong>${esc(i.t)}</strong> <span style="font-size:13px;color:#4D5A75">(${esc(i.auto ? T("item.auto") : i.when)})</span>
        <p style="margin:6px 0">${esc(i.d)}</p>
        ${i.url ? `<a href="${esc(i.url)}" style="color:#12704E;font-weight:bold">${esc(i.search ? T("item.search") : T("item.visit", { site: i.site || "" }))}</a>` : ""}
      </div>`).join("");
  }).join("");
  const heNote = lang !== "he" ? `<p style="background:#FFF3CC;border-radius:10px;padding:10px 12px">${esc(T("email.heNote"))}</p>` : "";
  return {
    subject: T("email.subject", { ref }),
    html: shell(T("res.title"), `<h1 style="font-size:24px;margin:0 0 8px">${esc(T("email.h1", { name: lead.firstName }))}</h1>
      <p>${esc(T("email.p1", { ref, addr: C.addrL(lead, "new", lang), date: C.fmtDate(lead.moveDate) }))}</p>
      <p>${esc(T("email.p2"))}</p>${heNote}${laterHtml(lead, lang, editUrl)}${moversHtml(movers, lang)}${suppliesHtml(lead, lang)}${benefitsHtml(lead, lang)}
      <h2 style="font-size:21px;margin:28px 0 0">${esc(T("email.updTitle"))}</h2>${groups}`, lang),
    text: T("email.subject", { ref }) + "\n" + items.map((i) => `• ${i.t}: ${i.url || ""}`).join("\n")
  };
}

export function businessNotifyEmail(lead, ref, cfg) {
  const kind = lead.service === "concierge" ? "לקוח מבקש שנעדכן בשבילו" : "לקוח יעדכן בעצמו";
  const sup = lead.supplies !== "need" ? "" : lead.suppliesFrom === "delivery"
    ? `<p><strong>קרטונים:</strong> הזמנה עם משלוח ל-${esc(C.fmtDate(lead.suppliesDate))}. ${cfg.suppliesTo ? "ההזמנה נשלחה לספק." : "אין ספק מוגדר (SUPPLIES_TO): צריך להזמין ידנית."}</p>`
    : `<p>קרטונים: ${lead.suppliesFrom === "movers" ? "המובילים יביאו" : "קיבל רשימת קניות"}.</p>`;
  return {
    subject: `פנייה חדשה ${ref}: ${kind}`,
    html: shell("פנייה חדשה", `<h1 style="font-size:22px">פנייה חדשה: ${esc(ref)}</h1>
      <p>${esc(kind)}. עיר: ${esc(lead.newCity)}. תאריך מעבר: ${esc(C.fmtDate(lead.moveDate))}. ${lead.checklist.length} גופים, ${lead.benefits.length} הנחות לבדוק.</p>${sup}
      <p><a href="${esc(cfg.publicUrl)}/admin/leads/${esc(ref)}" style="color:#12704E;font-weight:bold">לפרטים במסך הניהול</a></p>
      <p style="font-size:13px;color:#4D5A75">מטעמי פרטיות, הפרטים האישיים לא נשלחים במייל.</p>`),
    text: `פנייה חדשה ${ref} — ${kind}. ${cfg.publicUrl}/admin/leads/${ref}`
  };
}

// פנייה חדשה למוביל. בלי תעודת זהות ובלי כתובת מלאה — רק מה שצריך להצעת מחיר.
export function moverLeadEmail(lead, mover, tokenUrl) {
  const rows = jobSummary(lead);
  const wa = waLink(lead.phone, `שלום ${lead.firstName}, כאן ${mover.name}. קיבלנו את הבקשה שלך דרך עברנו להובלה ב-${C.fmtDate(lead.moveDate)}.`);
  return {
    subject: `בקשת הובלה חדשה מעברנו: ${lead.oldCity || "?"} ← ${lead.newCity}, ${C.fmtDate(lead.moveDate)}`,
    html: shell("בקשת הובלה", `<h1 style="font-size:22px;margin:0 0 8px">שלום ${esc(mover.contact || mover.name)}, יש לכם בקשת הובלה חדשה</h1>
      <p><strong>${esc(lead.firstName + " " + lead.lastName)}</strong> · <a href="tel:${esc(C.digits(lead.phone))}" style="color:#12704E">${esc(lead.phone)}</a></p>
      <table role="presentation" style="border-collapse:collapse;width:100%;background:#fff;border-radius:10px">${rows.map(([k, v]) => `<tr><th style="text-align:right;padding:6px 10px;color:#4D5A75;font-weight:normal;vertical-align:top">${esc(k)}</th><td style="padding:6px 10px">${esc(v)}</td></tr>`).join("")}</table>
      <p style="margin:18px 0"><a href="${esc(wa)}" style="background:#12704E;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">שליחת וואטסאפ ללקוח</a></p>
      <p>אחרי שיצרתם קשר, עדכנו כאן בלחיצה אחת: <a href="${esc(tokenUrl)}" style="color:#12704E;font-weight:bold">עדכון מצב הבקשה</a></p>
      <p style="font-size:13px;color:#4D5A75">הלקוח ביקש הצעות מחיר והסכים שנעביר לכם את הפרטים האלה. הבקשה נשלחה לעד 3 מובילים. בבקשה חזרו אליו תוך יום עבודה.</p>`),
    text: `בקשת הובלה: ${lead.firstName} ${lead.lastName}, ${lead.phone}\n` + rows.map(([k, v]) => k + ": " + v).join("\n") + "\nעדכון: " + tokenUrl
  };
}

export function reviewRequestEmail(lead, url) {
  const lang = lead.lang || "he", T = (k, v) => C.T(lang, k, v);
  return {
    subject: T("rev.subject"),
    html: shell(T("rev.pageT"), `<h1 style="font-size:22px;margin:0 0 8px">${esc(T("rev.h1", { name: lead.firstName }))}</h1>
      <p>${esc(T("rev.p"))}</p>
      <p style="margin:18px 0"><a href="${esc(url)}" style="background:#12704E;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(T("rev.btn"))}</a></p>`, lang),
    text: T("rev.pageT") + " " + url
  };
}
