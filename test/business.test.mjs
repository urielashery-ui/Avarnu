// בדיקות לחלק העסקי: שותפים ממומנים, מונים אנונימיים, הסכמה לדיוור, ותשלום (עם ספק mock).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";

const dir = mkdtempSync(join(tmpdir(), "avarnu-"));
const sponsorsFile = join(dir, "sponsors.json");
writeFileSync(sponsorsFile, JSON.stringify({ sponsors: [
  { id: "movers-a", slot: "moving", title: "הובלות א", text: "הובלה עם הנחה", cta: "להצעה", url: "https://example.com/m" },
  { id: "bad id!", slot: "moving", title: "x", text: "y", url: "https://example.com" },
  { id: "http-only", slot: "moving", title: "x", text: "y", url: "http://example.com" },
  { id: "old", slot: "save", title: "ישן", text: "נגמר", url: "https://example.com/o", to: "2020-01-01" },
  { id: "off", slot: "save", title: "כבוי", text: "כבוי", url: "https://example.com/f", active: false }
] }));

const future = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
const lead = (x = {}) => ({ lead: {
  firstName: "דן", lastName: "כהן", tz: "123456782", phone: "0521234567", email: "dan@example.com", tenure: "own",
  newStreet: "הרצל", newNum: "1", newCity: "חיפה", moveDate: future, service: "concierge", consent: true, poa: true, ...x } });

function start(overrides) {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "d".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000", PUBLIC_URL: "http://localhost", ...overrides });
  const db = openDb(":memory:");
  const app = createApp(cfg, db);
  const server = app.listen(0);
  return new Promise((r) => server.once("listening", () => r({ app, db, server, cfg, base: "http://127.0.0.1:" + server.address().port })));
}
const post = (base, path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let A, B; // A: הכול כבוי (ברירת מחדל). B: שותפים + תשלום mock
before(async () => {
  A = await start({});
  B = await start({ ADS_ENABLED: "true", SPONSORS_FILE: sponsorsFile, PAYMENTS_ENABLED: "true", PAYMENT_PROVIDER: "mock", PRICE_CONCIERGE: "39" });
});
after(() => { A.server.close(); B.server.close(); });

test("ברירת מחדל: בלי פרסום ובלי תשלום", async () => {
  const js = await (await fetch(A.base + "/config.js")).text();
  assert.match(js, /"ads":false/);
  assert.match(js, /"enabled":false/);
  assert.deepEqual((await (await fetch(A.base + "/api/sponsors")).json()).sponsors, []);
  const r = await post(A.base, "/api/leads", lead());
  const j = await r.json();
  assert.equal(r.status, 201);
  assert.equal(j.payUrl, undefined, "אין תשלום");
  assert.equal(A.db.byRef(j.ref).status, "new");
  assert.equal((await post(A.base, "/api/payments/webhook", {})).status, 404);
});

test("שותפים: רק תקינים ופעילים, והקליק נספר ומועבר עם UTM", async () => {
  const js = await (await fetch(B.base + "/config.js")).text();
  assert.match(js, /"ads":true/);
  assert.match(js, /"priceConcierge":39/);
  const list = (await (await fetch(B.base + "/api/sponsors")).json()).sponsors;
  assert.deepEqual(list.map((s) => s.id), ["movers-a"]);
  assert.equal(list[0].href, "/go/movers-a");
  assert.equal(list[0].url, undefined, "הכתובת האמיתית לא נחשפת");
  const go = await fetch(B.base + "/go/movers-a", { redirect: "manual" });
  assert.equal(go.status, 302);
  assert.match(go.headers.get("location"), /^https:\/\/example\.com\/m\?utm_source=avarnu&utm_medium=referral&utm_campaign=movers-a$/);
  assert.equal(B.db.counters(1)["click:movers-a"], 1);
  assert.equal((await fetch(B.base + "/go/off", { redirect: "manual" })).headers.get("location"), "/");
});

test("מונים אנונימיים: רק מפתחות מוכרים", async () => {
  for (const k of ["step:0", "step:0", "step:1", "results", "evil<script>"]) await post(B.base, "/api/hit", { k });
  const c = B.db.counters(1);
  assert.equal(c["view:step:0"], 2);
  assert.equal(c["view:results"], 1);
  assert.ok(!Object.keys(c).some((k) => k.includes("evil")));
});

test("תשלום: הפנייה ממתינה, החיבורים רצים רק אחרי אישור חתום", async () => {
  const r = await post(B.base, "/api/leads", lead({ marketing: true }));
  const j = await r.json();
  assert.equal(r.status, 201);
  assert.equal(j.amount, 39);
  assert.match(j.payUrl, /\/pay\/mock\//);
  const row = B.db.byRef(j.ref);
  assert.equal(row.status, "awaiting_payment");
  assert.equal(row.marketing, 1, "הסכמה לדיוור נשמרת");
  // חתימה מזויפת נדחית
  assert.equal((await post(B.base, "/api/payments/webhook", { ref: j.ref, status: "paid", signature: "x" })).status, 400);
  assert.equal(B.db.byRef(j.ref).status, "awaiting_payment");
  // אישור אמיתי
  const sig = B.app.locals.pay.sign(j.ref, "paid");
  const ok = await post(B.base, "/api/payments/webhook", { ref: j.ref, status: "paid", signature: sig });
  assert.equal(ok.status, 200);
  await B.app.locals.pending;
  const paid = B.db.byRef(j.ref);
  assert.equal(paid.status, "new");
  assert.ok(paid.paid_at);
  // אישור כפול לא מריץ שוב
  await post(B.base, "/api/payments/webhook", { ref: j.ref, status: "paid", signature: sig });
  assert.equal(B.db.events(paid.id).filter((e) => e.type === "payment:paid").length, 1);
  // עדכון עצמי במחיר 0 — בלי תשלום
  const free = await (await post(B.base, "/api/leads", lead({ service: "self", poa: false }))).json();
  assert.equal(free.payUrl, undefined);
});

test("פניות שלא שולמו נמחקות אחרי הזמן שהוגדר", () => {
  B.db.createLead({ ref: "MV-PEND01", service: "concierge", newCity: "x", moveDate: future, data: "v1:x", tasks: [], status: "awaiting_payment" });
  B.db.raw.prepare("UPDATE leads SET created_at = '2020-01-01T00:00:00Z' WHERE ref = 'MV-PEND01'").run();
  assert.ok(B.db.purgePending(48) >= 1);
  assert.equal(B.db.byRef("MV-PEND01"), undefined);
});

test("מסך נתונים בניהול", async () => {
  const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
  const html = await (await fetch(B.base + "/admin/stats", { headers: auth })).text();
  for (const s of ["משפך בטופס", "ערים חדשות מובילות", "ההנחות הנפוצות", "movers-a", "הכנסות"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes("חיפה"));
});

test("ספק mock חסום בייצור", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", DATA_KEY: "d".repeat(64), ADMIN_USER: "a", ADMIN_PASS: "long-password-1", PAYMENTS_ENABLED: "true", PAYMENT_PROVIDER: "mock" }), /mock/);
});
