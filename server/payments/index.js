/*
 * תשתית תשלום — כבויה כברירת מחדל (PAYMENTS_ENABLED=false). היום השירות בחינם.
 *
 * כשנרצה לגבות, בוחרים ספק סליקה ישראלי שיש לו "דף תשלום מאובטח" (Hosted Payment Page)
 * והודעה לשרת אחרי תשלום (callback / webhook). למשל: Grow (משולם), Cardcom, PayPlus, Tranzila.
 * כולם תומכים גם באשראי, ורובם גם ב-Bit, Apple Pay ו-Google Pay.
 *
 * כדי לחבר ספק, כותבים קובץ בתיקייה הזאת שמממש שתי פונקציות:
 *   createCheckout({ ref, amount, description, customer, successUrl, cancelUrl }) -> { url, providerRef }
 *   verifyWebhook(req) -> { ref, paid: true|false, providerRef }   (זורק שגיאה אם החתימה לא תקינה)
 * ומוסיפים אותו ל-PROVIDERS למטה. שום דבר אחר במערכת לא משתנה.
 * פרטי הכרטיס לא עוברים אצלנו בכלל — רק אצל ספק הסליקה.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// ספק לבדיקות ולפיתוח בלבד. לא פועל בייצור.
function mockProvider(cfg) {
  const secret = createHmac("sha256", cfg.dataKey).update("mock-payments").digest("hex");
  const sig = (ref, status) => createHmac("sha256", secret).update(ref + ":" + status).digest("hex");
  return {
    name: "mock",
    sign: sig,
    async createCheckout({ ref }) {
      return { url: cfg.publicUrl + "/pay/mock/" + encodeURIComponent(ref), providerRef: "mock-" + ref };
    },
    verifyWebhook(req) {
      const { ref, status, signature } = req.body || {};
      const good = Buffer.from(sig(String(ref), String(status)));
      const got = Buffer.from(String(signature || ""));
      if (good.length !== got.length || !timingSafeEqual(good, got)) throw new Error("חתימה לא תקינה");
      return { ref: String(ref), paid: status === "paid", providerRef: "mock-" + ref };
    }
  };
}

const PROVIDERS = { mock: mockProvider };

export function getPaymentProvider(cfg) {
  if (!cfg.payments.enabled) return null;
  const make = PROVIDERS[cfg.payments.provider];
  if (!make) throw new Error("ספק תשלום לא מוכר: " + cfg.payments.provider + ". ראו server/payments/index.js");
  return make(cfg);
}

export function priceFor(cfg, service) {
  if (!cfg.payments.enabled) return 0;
  return Math.max(0, Math.round(service === "concierge" ? cfg.payments.priceConcierge : cfg.payments.priceSelf));
}
