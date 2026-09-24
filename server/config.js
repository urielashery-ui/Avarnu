// כל ההגדרות מגיעות ממשתני סביבה (קובץ .env בשרת, או הגדרות בפלטפורמת האחסון).
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

// טעינה פשוטה של .env בלי תלות חיצונית
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function loadConfig(overrides = {}) {
  const e = { ...process.env, ...overrides };
  const prod = e.NODE_ENV === "production";
  let dataKey = e.DATA_KEY;
  if (!dataKey) {
    if (prod) throw new Error("DATA_KEY חסר. צרו מפתח עם: npm run keygen");
    dataKey = randomBytes(32).toString("hex");
    console.warn("[config] DATA_KEY לא הוגדר — נוצר מפתח זמני. מידע שיישמר עכשיו לא ייקרא אחרי הפעלה מחדש.");
  }
  // מקבל מפתח של 64 תווים הקסדצימליים, או כל מחרוזת אקראית ארוכה (למשל מה ש-Render יוצר ב-generateValue)
  if (!/^[0-9a-f]{64}$/i.test(dataKey)) {
    if (String(dataKey).length < 32) throw new Error("DATA_KEY קצר מדי. צריך לפחות 32 תווים. אפשר ליצור עם: npm run keygen");
    dataKey = createHash("sha256").update(String(dataKey)).digest("hex");
  }
  if (prod && (!e.ADMIN_USER || !e.ADMIN_PASS || e.ADMIN_PASS.length < 12)) {
    throw new Error("ADMIN_USER ו-ADMIN_PASS חובה בייצור (סיסמה של 12 תווים לפחות).");
  }
  const payments = {
    enabled: e.PAYMENTS_ENABLED === "true",
    provider: e.PAYMENT_PROVIDER || "none",
    priceConcierge: Number(e.PRICE_CONCIERGE || 0),   // בשקלים. 0 = חינם
    priceSelf: Number(e.PRICE_SELF || 0)
  };
  if (prod && payments.enabled && payments.provider === "mock") throw new Error("ספק התשלום mock מיועד לבדיקות בלבד.");
  return {
    prod,
    payments,
    adsEnabled: e.ADS_ENABLED === "true",
    moversEnabled: e.MOVERS_ENABLED === "true",
    // הזמנת קרטונים וחומרי אריזה עם משלוח. SUPPLIES_TO = המייל של ספק האריזות (אם ריק — ההזמנה מגיעה אליך כמשימה)
    suppliesEnabled: e.SUPPLIES_ENABLED === "true",
    // תיאום שיחה עם נציג של גוף: נציג שלנו ממתין על הקו ומחבר את הלקוח. להפעיל רק כשיש מי שיעשה את זה.
    callbacksEnabled: e.CALLBACK_ENABLED === "true",
    suppliesTo: e.SUPPLIES_TO || "",
    supportLangs: String(e.SUPPORT_LANGS || "he").split(",").map((x) => x.trim()).filter((x) => ["he", "en", "ru", "ar"].includes(x)),
    moversPerLead: Math.min(5, Math.max(1, Number(e.MOVERS_PER_LEAD || 3))),
    reviewDelayDays: Number(e.REVIEW_DELAY_DAYS || 3),
    remindAfterHours: Number(e.REMIND_AFTER_HOURS || 24),   // תזכורת ראשונה על פרטים חסרים
    minReviewsToShow: Number(e.MIN_REVIEWS_TO_SHOW || 3),
    sponsorsFile: e.SPONSORS_FILE || "config/sponsors.json",
    port: Number(e.PORT || 3000),
    publicUrl: (e.PUBLIC_URL || "http://localhost:" + (e.PORT || 3000)).replace(/\/$/, ""),
    dbPath: e.DB_PATH || "data/movers.db",
    dataKey,
    adminUser: e.ADMIN_USER || "admin",
    adminPass: e.ADMIN_PASS || "admin-dev-only",
    retentionDays: Number(e.RETENTION_DAYS || 180),
    trustProxy: e.TRUST_PROXY || (prod ? "1" : ""),
    smtpUrl: e.SMTP_URL || "",
    mailFrom: e.MAIL_FROM || "עברנו <no-reply@avarnu.com>",
    notifyTo: e.NOTIFY_TO || "",
    webhookUrl: e.WEBHOOK_URL || "",
    webhookSecret: e.WEBHOOK_SECRET || "",
    rateLimit: Number(e.RATE_LIMIT || 10),
    pendingPaymentHours: Number(e.PENDING_PAYMENT_HOURS || 48)
  };
}
