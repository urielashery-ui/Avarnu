// שליחת הפנייה ל-CRM / Make / Zapier / n8n. בלי תעודת זהות.
// אם מוגדר WEBHOOK_SECRET, נשלחת חתימה בכותרת X-Movers-Signature (HMAC-SHA256 של גוף הבקשה).
import { sign } from "../crypto.js";

export function webhookPayload(lead, ref) {
  return {
    event: "lead.created",
    ref,
    createdAt: new Date().toISOString(),
    service: lead.service,
    name: { first: lead.firstName, last: lead.lastName },
    phone: lead.phone,
    email: lead.email || null,
    tenure: lead.tenure,
    lang: lead.lang || "he",
    moveDate: lead.moveDate,
    newAddress: { street: lead.newStreet, number: lead.newNum, apt: lead.newApt, city: lead.newCity, zip: lead.zip },
    oldAddress: { street: lead.oldStreet, apt: lead.oldApt, city: lead.oldCity },
    household: { people: lead.people, kids: lead.kidsCount },
    bodies: lead.checklist.map((b) => ({ id: b.id, title: b.title, auto: b.auto })),
    // רק מספר ההנחות, בלי הסיבות (מידע רגיש). הפירוט במסך הניהול.
    benefitsCount: lead.benefits.length,
    // הסכמה לקבל הצעות שיווקיות (חוק התקשורת, סעיף 30א). בלי הסכמה — לא שולחים דיוור.
    marketingConsent: !!lead.marketing,
    moveQuote: lead.moveStatus === "quotes" && !!lead.moversConsent
  };
}

export async function postWebhook(cfg, lead, ref) {
  const body = JSON.stringify(webhookPayload(lead, ref));
  const headers = { "Content-Type": "application/json", "User-Agent": "movers-site/1.0" };
  if (cfg.webhookSecret) headers["X-Movers-Signature"] = sign(cfg.webhookSecret, body);
  const r = await fetch(cfg.webhookUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("webhook החזיר " + r.status);
  return "webhook " + r.status;
}
