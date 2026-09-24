// בדיקות לקרטונים וחומרי אריזה: חישוב הערכה, בדיקות בשרת, שליחה לספק, ומה קורה כשהשירות כבוי.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { sentLog } from "../server/connectors/email.js";
import { webhookPayload } from "../server/connectors/webhook.js";
import { validateLead, catalog as C } from "../server/validate.js";

const day = 864e5, iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const lead = (x = {}) => ({ lead: {
  firstName: "רוני", lastName: "אבני", tz: "123456782", phone: "0541234567", email: "roni@example.com", tenure: "rent",
  newStreet: "ביאליק", newNum: "3", newCity: "רמת גן", oldStreet: "ילין 5", oldCity: "פתח תקווה", oldFloor: "2", moveDate: iso(20),
  service: "self", consent: true, supplies: "need", rooms: "3", suppliesFrom: "delivery", suppliesDate: iso(14), suppliesTo: "old",
  suppliesConsent: true, ...x } });

async function start(overrides) {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "f".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000",
    PUBLIC_URL: "http://localhost", ...overrides });
  const db = openDb(":memory:");
  const app = createApp(cfg, db);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { app, db, server, base: "http://127.0.0.1:" + server.address().port };
}
const post = (base, body) => fetch(base + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let ON, NOSUP, OFF;
before(async () => {
  ON = await start({ SUPPLIES_ENABLED: "true", SUPPLIES_TO: "boxes@supplier.test" });
  NOSUP = await start({ SUPPLIES_ENABLED: "true" });
  OFF = await start({});
});
after(() => { ON.server.close(); NOSUP.server.close(); OFF.server.close(); });

test("הערכת ערכה: גדלה עם מספר החדרים, ומשתמשת בכמויות שהמשתמש שינה", () => {
  const k1 = C.kitFor("1"), k4 = C.kitFor("4");
  assert.ok(k1.kBoxes < k4.kBoxes && k1.kTape <= k4.kTape);
  assert.equal(C.kitFor(""), null);
  const lines = C.kitLines({ rooms: "2", kBoxes: "40", kStretch: "0" }, "he");
  assert.equal(lines.find((x) => x.id === "kBoxes").qty, 40);
  assert.equal(lines.find((x) => x.id === "kStretch"), undefined, "0 = לא צריך");
  assert.match(C.kitText({ rooms: "2" }, "ru"), /коробки/);
  // תאריך משלוח מומלץ: לפני המעבר, ולא בעבר
  const d = C.suppliesDefaultDate(iso(20));
  assert.ok(d >= iso(1) && d <= iso(20));
  assert.ok(C.suppliesDefaultDate(iso(1)) <= iso(1), "מעבר מחר: לא אחרי המעבר");
});

test("בדיקות בשרת: תאריך אחרי המעבר, בלי כתובת נוכחית, בלי הסכמה, מובילים בלי הצעות", () => {
  let v = validateLead(lead({ suppliesDate: iso(25) }));
  assert.ok(v.errors.suppliesDate);
  v = validateLead(lead({ oldStreet: "" }));
  assert.ok(v.errors.suppliesTo);
  assert.ok(validateLead(lead({ oldStreet: "", suppliesTo: "new" })).ok, "משלוח לדירה החדשה בלי כתובת ישנה — בסדר");
  v = validateLead(lead({ suppliesConsent: false }));
  assert.ok(v.errors.suppliesConsent);
  v = validateLead(lead({ suppliesFrom: "movers" }));
  assert.ok(v.errors.suppliesFrom);
  v = validateLead(lead({ kBoxes: "abc" }));
  assert.ok(v.errors.kBoxes);
  v = validateLead(lead({ supplies: "none", kBoxes: "30", suppliesConsent: true }));
  assert.ok(v.ok); assert.equal(v.lead.kBoxes, ""); assert.equal(v.lead.suppliesConsent, false, "בלי אריזה — לא שומרים הסכמה");
});

test("הזמנה עם משלוח: מייל לספק בלי ת״ז, משימה במסך הניהול, והלקוח רואה 'הוזמן'", async () => {
  sentLog.length = 0;
  const r = await post(ON.base, lead({ kBoxes: "50" }));
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.supplies, "ordered");
  await ON.app.locals.pending;
  const sup = sentLog.find((m) => m.to === "boxes@supplier.test");
  assert.ok(sup, "נשלח מייל לספק");
  assert.match(sup.subject, /הזמנת קרטונים/);
  assert.match(sup.html, /ילין 5/); assert.match(sup.html, /קרטונים רגילים/); assert.match(sup.html, />50</);
  assert.doesNotMatch(sup.html, /123456782|56782/, "אין תעודת זהות");
  const cust = sentLog.find((m) => m.to === "roni@example.com");
  assert.match(cust.html, /קרטונים וחומרי אריזה/);
  const page = await (await fetch(ON.base + "/admin/leads/" + j.ref, { headers: auth })).text();
  assert.match(page, /הזמנת קרטונים וחומרי אריזה/);
  assert.match(page, /ההזמנה נשלחה לספק/);
});

test("שירות פעיל בלי מייל של ספק: ההזמנה נשמרת כמשימה ידנית", async () => {
  const j = await (await post(NOSUP.base, lead())).json();
  assert.equal(j.supplies, "ordered");
  await NOSUP.app.locals.pending;
  const page = await (await fetch(NOSUP.base + "/admin/leads/" + j.ref, { headers: auth })).text();
  assert.match(page, /צריך להזמין ידנית/);
});

test("שירות כבוי: משלוח הופך לרשימת קניות, ואין מייל לספק", async () => {
  sentLog.length = 0;
  const cfgJs = await (await fetch(OFF.base + "/config.js")).text();
  assert.match(cfgJs, /"supplies":false/);
  const j = await (await post(OFF.base, lead())).json();
  assert.equal(j.supplies, "self");
  await OFF.app.locals.pending;
  assert.equal(sentLog.filter((m) => /הזמנת קרטונים/.test(m.subject)).length, 0);
});

test("webhook: פרטי האריזה בלי תעודת זהות", () => {
  const v = validateLead(lead());
  const p = webhookPayload(v.lead, "MV-TEST");
  assert.equal(p.supplies.from, "delivery");
  assert.ok(p.supplies.items.kBoxes > 0);
  assert.doesNotMatch(JSON.stringify(p), /123456782/);
});
