// השרת של "עברנו": מגיש את האתר, מקבל פניות, מריץ חיבורים, שותפים, תשלום (כבוי) ומסך ניהול.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { makeCrypto, newRef } from "./crypto.js";
import { validateLead } from "./validate.js";
import { runOutbound, bodyMode } from "./connectors/index.js";
import { adminRouter } from "./admin.js";
import { loadSponsors, publicView, withUtm } from "./sponsors.js";
import { getPaymentProvider, priceFor } from "./payments/index.js";
import { moversApi, publicMoversRouter } from "./movers.js";
import { sendMail, reviewRequestEmail } from "./connectors/email.js";
import { randomBytes } from "node:crypto";

const HIT_KEYS = /^(step:[0-9]|results|submit|paid)$/;

export function createApp(cfg = loadConfig(), db = openDb(cfg.dbPath)) {
  const crypt = makeCrypto(cfg.dataKey);
  const pay = getPaymentProvider(cfg); // null כשהתשלום כבוי
  const M = moversApi(db);
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "https://fonts.googleapis.com"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"]
      }
    },
    hsts: cfg.prod,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  }));

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  // הגדרות לדפדפן — נקבעות ממשתני הסביבה, בלי לבנות מחדש
  app.get("/config.js", (req, res) => {
    const pub = {
      api: "/api", ads: cfg.adsEnabled, movers: cfg.moversEnabled, moversPaid: cfg.moversEnabled && M.anyPaying(), supportLangs: cfg.supportLangs,
      payments: { enabled: !!pay, priceConcierge: priceFor(cfg, "concierge"), priceSelf: priceFor(cfg, "self") }
    };
    res.type("js").set("Cache-Control", "no-cache").send("window.MOVERS_CONFIG = " + JSON.stringify(pub) + ";\n");
  });

  // ---- API ----
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: cfg.rateLimit, standardHeaders: "draft-7", legacyHeaders: false,
    message: { message: "שלחתם יותר מדי פעמים. נסו שוב בעוד רבע שעה." }
  });
  const softLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });

  app.post("/api/leads", limiter, express.json({ limit: "20kb" }), async (req, res, next) => {
    try {
      // מלכודת לבוטים: שדה נסתר שאנשים לא ממלאים
      if (req.body && req.body.website) return res.status(201).json({ ref: newRef() });
      const v = validateLead(req.body);
      if (!v.ok) {
        return res.status(400).json({ message: "יש פרטים חסרים או לא תקינים: " + Object.values(v.errors).join(", ") + ".", errors: v.errors });
      }
      const lead = v.lead, ref = newRef(), amount = priceFor(cfg, lead.service);
      if (!cfg.moversEnabled) lead.moversConsent = false;
      const wantsMovers = lead.moveStatus === "quotes" && lead.moversConsent;
      let picked = [];
      const needsPayment = !!pay && amount > 0;
      const tasks = lead.checklist.map((i) => ({ id: i.id, title: i.title, status: bodyMode(i) === "auto" ? "auto" : "todo" }));
      // בשירות מלא: גם הגשת בקשות ההנחה היא משימה של הנציג
      if (lead.service === "concierge") for (const b of lead.benefits) tasks.push({ id: b.id, title: b.title, status: "todo" });
      const id = db.createLead({
        ref, service: lead.service, newCity: lead.newCity, moveDate: lead.moveDate, data: crypt.encrypt(lead), tasks,
        status: needsPayment ? "awaiting_payment" : "new", amount, marketing: lead.marketing,
        moveQuote: wantsMovers, reviewToken: wantsMovers ? randomBytes(18).toString("base64url") : null,
        onCreate: (leadId) => {
          if (!wantsMovers) return;
          picked = M.pick([lead.oldCity, lead.newCity], cfg.moversPerLead);
          M.assign(leadId, picked);
        }
      });
      if (wantsMovers) db.bump(picked.length ? "movers:matched" : "movers:unmatched");
      const moversOut = wantsMovers ? { movers: picked.map((m) => ({ name: m.name, phone: m.phone })), moversRequested: true } : {};
      db.bump("lead");
      if (needsPayment) {
        const c = await pay.createCheckout({
          ref, amount, description: lead.service === "concierge" ? "עברנו: טיפול מלא במעבר" : "עברנו: שליחת הרשימה",
          customer: { name: lead.firstName + " " + lead.lastName, email: lead.email, phone: lead.phone },
          successUrl: cfg.publicUrl + "/#done", cancelUrl: cfg.publicUrl + "/#pay-cancel"
        });
        db.event(id, "payment:checkout", amount + " ₪");
        return res.status(201).json({ ref, payUrl: c.url, amount, ...moversOut });
      }
      res.status(201).json({ ref, ...moversOut });
      // החיבורים רצים אחרי שהלקוח קיבל תשובה, כדי שלא יחכה
      app.locals.pending = runOutbound(lead, ref, id, db, cfg).catch((e) => console.error("[outbound]", e));
    } catch (e) { next(e); }
  });

  // אישור תשלום מספק הסליקה
  async function confirmPayment(body) {
    const r = pay.verifyWebhook({ body });
    const row = db.byRef(r.ref);
    if (!row) return "not-found";
    if (!r.paid) { db.event(row.id, "payment:failed", r.providerRef); return "failed"; }
    if (db.markPaid(row.id, r.providerRef)) {
      db.event(row.id, "payment:paid", row.amount + " ₪");
      db.bump("paid");
      const lead = crypt.decrypt(row.data);
      app.locals.pending = runOutbound(lead, row.ref, row.id, db, cfg).catch((e) => console.error("[outbound]", e));
    }
    return "ok";
  }
  app.post("/api/payments/webhook", express.json({ limit: "20kb" }), express.urlencoded({ extended: false, limit: "20kb" }), async (req, res) => {
    if (!pay) return res.status(404).json({ message: "התשלום לא פעיל" });
    try { res.json({ result: await confirmPayment(req.body) }); }
    catch (e) { console.warn("[payments] webhook נדחה:", e.message); res.status(400).json({ message: "בקשה לא תקינה" }); }
  });

  // שותפים ממומנים
  app.get("/api/sponsors", (req, res) => {
    const list = cfg.adsEnabled ? loadSponsors(cfg.sponsorsFile).map(publicView) : [];
    res.set("Cache-Control", "public, max-age=300").json({ sponsors: list });
  });

  // מונים אנונימיים לשלבי הטופס (בשביל משפך המרה). בלי IP ובלי עוגיות.
  app.post("/api/hit", softLimiter, express.json({ limit: "1kb" }), (req, res) => {
    const k = req.body && req.body.k;
    if (typeof k === "string" && HIT_KEYS.test(k)) db.bump("view:" + k);
    res.status(204).end();
  });

  app.use("/api", (req, res) => res.status(404).json({ message: "לא נמצא" }));
  app.use("/api", (err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ message: status === 413 ? "הבקשה גדולה מדי." : status < 500 ? "הבקשה לא תקינה." : "משהו השתבש אצלנו. נסו שוב בעוד כמה דקות." });
  });

  // קליק על שותף: סופרים ומעבירים
  app.get("/go/:id", (req, res) => {
    const s = cfg.adsEnabled && loadSponsors(cfg.sponsorsFile).find((x) => x.id === req.params.id);
    if (!s) return res.redirect(302, "/");
    db.bump("click:" + s.id);
    res.set("Cache-Control", "no-store").redirect(302, withUtm(s.url, s.id));
  });

  // דף תשלום מדומה — רק בפיתוח, עם ספק mock
  if (pay && pay.name === "mock") {
    app.get("/pay/mock/:ref", (req, res) => {
      const ref = String(req.params.ref).replace(/[^A-Z0-9-]/g, "");
      res.type("html").send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>תשלום לדוגמה</title>
        <body><main><h1>דף תשלום לדוגמה</h1><p>פנייה ${ref}. בייצור, כאן יופיע דף התשלום של ספק הסליקה.</p>
        <form method="post" action="/pay/mock/${ref}"><button name="status" value="paid">אישור תשלום</button> <button name="status" value="failed">ביטול</button></form></main></body></html>`);
    });
    app.post("/pay/mock/:ref", express.urlencoded({ extended: false }), async (req, res) => {
      const ref = String(req.params.ref), status = req.body.status === "paid" ? "paid" : "failed";
      await confirmPayment({ ref, status, signature: pay.sign(ref, status) }).catch(() => {});
      res.redirect(303, status === "paid" ? "/#done" : "/#pay-cancel");
    });
  }

  // ---- מובילים: דפים ציבוריים, פורטל מוביל, ביקורות ----
  app.use(publicMoversRouter({ db, crypt, cfg }));

  // ---- ניהול ----
  app.use("/admin", adminRouter({ db, crypt, cfg }));

  // ---- האתר ----
  // כתובות לפי שפה: /en, /ru, /ar (אותו דף, השפה נקבעת בדפדפן)
  app.get(/^\/(he|en|ru|ar)\/?$/, (req, res) => res.sendFile(fileURLToPath(new URL("../public/index.html", import.meta.url))));
  app.use(express.static(fileURLToPath(new URL("../public/", import.meta.url)), { extensions: ["html"], maxAge: cfg.prod ? "1h" : 0 }));
  app.use((req, res) => res.status(404).type("html").send('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>לא נמצא</title><p>הדף לא נמצא. <a href="/">לדף הבית</a></p></html>'));

  // ---- מחיקה אוטומטית של מידע ישן ----
  const purge = () => {
    const n = db.purgeOlderThan(cfg.retentionDays) + db.purgePending(cfg.pendingPaymentHours);
    if (n) console.log(`[retention] נמחקו ${n} פניות ישנות או שלא שולמו`);
  };
  purge();
  const timer = setInterval(purge, 12 * 3600 * 1000); timer.unref();

  // ---- בקשת דירוג מובילים, כמה ימים אחרי המעבר ----
  async function runReviews() {
    for (const row of M.due(cfg.reviewDelayDays)) {
      M.reviewSent(row.id);
      try {
        const lead = crypt.decrypt(row.data);
        if (!lead.email || !M.forLead(row.id).length) { db.event(row.id, "review:skip", "אין מייל או מובילים"); continue; }
        await sendMail(cfg, { to: lead.email, ...reviewRequestEmail(lead, cfg.publicUrl + "/r/" + row.review_token) });
        db.event(row.id, "review:sent", "");
      } catch (e) { db.event(row.id, "review:error", e.message); }
    }
  }
  const rtimer = setInterval(() => runReviews().catch((e) => console.error("[reviews]", e)), 3600 * 1000); rtimer.unref();
  app.locals.runReviews = runReviews;

  app.locals.db = db;
  app.locals.pay = pay;
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const app = createApp(cfg);
  app.listen(cfg.port, () => console.log(`עברנו רץ על ${cfg.publicUrl} (ניהול: ${cfg.publicUrl}/admin)`));
}
