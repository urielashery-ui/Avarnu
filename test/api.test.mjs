// בדיקות שרת: קליטת פנייה, בדיקות תקינות, הצפנה, ניהול, ייצוא, webhook, אבטחה.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { sentLog } from "../server/connectors/email.js";
import { sign } from "../server/crypto.js";

let server, base, db, hook, hookUrl, hooks = [];
const cfg = loadConfig({
  NODE_ENV: "test", DATA_KEY: "a".repeat(64), ADMIN_USER: "admin", ADMIN_PASS: "test-password-123",
  NOTIFY_TO: "office@example.com", WEBHOOK_SECRET: "s3cret", RATE_LIMIT: "1000", PUBLIC_URL: "http://localhost"
});
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const future = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
const good = () => ({
  firstName: "נועה", lastName: "לוי", tz: "123456782", phone: "050-1234567", email: "noa@example.com", people: "3",
  tenure: "rent", landlord: "משה כהן", newStreet: "הרצל", newNum: "10", newCity: "פתח תקווה", zip: "4951234",
  oldStreet: "ילין 5", oldCity: "פתח תקווה", moveDate: future, elecContract: "123", elecMeter: "456", elecRead: "7890",
  isp: "בזק", hmo: "מכבי", xCar: true, xPost: true, service: "self", consent: true,
  kidsCount: "2", kidsUnder3: true, singleParent: true, reservist: true
});
const post = (body) => fetch(base + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  hook = createServer((req, res) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => { hooks.push({ headers: req.headers, body: b }); res.end("ok"); }); });
  await new Promise((r) => hook.listen(0, r));
  hookUrl = "http://127.0.0.1:" + hook.address().port + "/hook";
  cfg.webhookUrl = hookUrl;
  db = openDb(":memory:");
  const app = createApp(cfg, db);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  server.app = app;
});
after(() => { server.close(); hook.close(); });

test("האתר נטען עם lang=he ו-CSP מחמיר", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<html lang="he" dir="rtl">/);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal((await fetch(base + "/config.js")).status, 200);
});

test("פנייה תקינה נשמרת מוצפנת ויוצרות משימות", async () => {
  hooks = []; sentLog.length = 0;
  const r = await post({ lead: good() });
  assert.equal(r.status, 201);
  const { ref } = await r.json();
  assert.match(ref, /^MV-[A-Z0-9]{6}$/);
  await server.app.locals.pending;
  const row = db.byRef(ref);
  assert.ok(row.data.startsWith("v1:"));
  assert.ok(!row.data.includes("123456782"), "תעודת הזהות לא נשמרת כטקסט גלוי");
  const tasks = db.tasks(row.id);
  const ids = tasks.map((t) => t.body_id);
  for (const id of ["moin", "elec", "water", "arnona", "isp", "hmo", "car", "post"]) assert.ok(ids.includes(id), "יש משימה ל-" + id);
  assert.equal(tasks.find((t) => t.body_id === "btl").status, "auto");
  // מיילים: לעסק וללקוח, בלי ת״ז
  assert.equal(sentLog.length, 2);
  for (const m of sentLog) assert.ok(!m.html.includes("123456782"));
  assert.ok(sentLog.some((m) => m.to === "noa@example.com" && m.html.includes("iec.co.il")));
  const cust = sentLog.find((m) => m.to === "noa@example.com");
  assert.ok(cust.html.includes("הנחות וחיסכון") && cust.html.includes("הורה יחיד") && cust.html.includes("מעון יום"), "המייל ללקוח כולל את ההנחות");
  assert.ok(!sentLog.find((m) => m.to === "office@example.com").html.includes("הורה יחיד"), "במייל לעסק אין פרטי זכאות");
  // webhook חתום, בלי ת״ז
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].headers["x-movers-signature"], sign("s3cret", hooks[0].body));
  const payload = JSON.parse(hooks[0].body);
  assert.equal(payload.ref, ref);
  assert.ok(!hooks[0].body.includes("123456782"));
  assert.ok(payload.benefitsCount >= 5 && !hooks[0].body.includes("הורה יחיד"), "ב-webhook רק מספר ההנחות");
  assert.ok(!tasks.some((t) => t.body_id.startsWith("b:")), "בעדכון עצמי אין משימות הנחה לנציג");
});

test("בדיקות תקינות בשרת", async () => {
  const bad = { ...good(), tz: "123456789", phone: "12", consent: false };
  const r = await post({ lead: bad });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.ok(j.errors.tz && j.errors.phone && j.errors.consent);
  assert.match(j.message, /תעודת זהות/);
  const c = await post({ lead: { ...good(), service: "concierge" } });
  assert.equal(c.status, 400, "שירות מלא דורש הסכמה לפנייה בשם הלקוח");
  const s = await post({ lead: { ...good(), email: "" } });
  assert.equal(s.status, 400, "עדכון עצמי דורש מייל");
  assert.equal((await post({ lead: { ...good(), isp: "<script>" } })).status, 400);
  assert.equal((await post({ lead: { ...good(), kidsCount: "abc" } })).status, 400);
  assert.equal((await post("x")).status, 400);
  const big = await fetch(base + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead: { a: "x".repeat(30000) } }) });
  assert.equal(big.status, 413);
});

test("מלכודת בוטים לא שומרת כלום", async () => {
  const before_ = db.list().length;
  const r = await post({ lead: good(), website: "spam" });
  assert.equal(r.status, 201);
  assert.equal(db.list().length, before_);
});

test("מסך ניהול: סיסמה, צפייה, עדכון משימות, ייצוא ומחיקה", async () => {
  assert.equal((await fetch(base + "/admin")).status, 401);
  const r = await post({ lead: { ...good(), service: "concierge", poa: true } });
  const { ref } = await r.json();
  await server.app.locals.pending;
  const list = await (await fetch(base + "/admin", { headers: auth })).text();
  assert.ok(list.includes(ref) && list.includes("נועה"));
  const page = await (await fetch(base + "/admin/leads/" + ref, { headers: auth })).text();
  assert.ok(page.includes("*****6782") && !page.includes("123456782"), "ת״ז מוסתרת כברירת מחדל");
  assert.ok(page.includes("הנחות שכדאי לבקש") && page.includes("הורה יחיד"), "הנציג רואה את ההנחות");
  const rowC = db.byRef(ref);
  assert.ok(db.tasks(rowC.id).some((t) => t.body_id === "b:ar-singleParent"), "בשירות מלא: משימה להגשת ההנחה");
  const rev = await (await fetch(base + "/admin/leads/" + ref + "?reveal=1", { headers: auth })).text();
  assert.ok(rev.includes("123456782"));
  const row = db.byRef(ref);
  assert.ok(db.events(row.id).some((e) => e.type === "admin:reveal-tz"), "חשיפת ת״ז נרשמת ביומן");
  // עדכון משימה
  const form = new URLSearchParams({ s_moin: "done", n_moin: "עודכן באתר" });
  const u = await fetch(base + "/admin/leads/" + ref + "/tasks", { method: "POST", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form, redirect: "manual" });
  assert.equal(u.status, 303);
  assert.equal(db.tasks(row.id).find((t) => t.body_id === "moin").status, "done");
  assert.equal(db.byRef(ref).status, "in_progress");
  // CSRF
  const x = await fetch(base + "/admin/leads/" + ref + "/status", { method: "POST", headers: { ...auth, Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" }, body: "status=done", redirect: "manual" });
  assert.equal(x.status, 403);
  // ייצוא
  const csv = await fetch(base + "/admin/export.csv", { headers: auth });
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM בשביל אקסל בעברית");
  const text = buf.toString("utf8");
  assert.ok(text.includes(ref) && !text.includes("123456782"));
  // מחיקה
  const del = await fetch(base + "/admin/leads/" + ref + "/delete", { method: "POST", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, body: "confirm=yes", redirect: "manual" });
  assert.equal(del.status, 303);
  assert.equal(db.byRef(ref), undefined);
  assert.equal(db.tasks(row.id).length, 0);
});

test("מחיקה אוטומטית של פניות ישנות", () => {
  const id = db.createLead({ ref: "MV-OLD001", service: "self", newCity: "x", moveDate: "2020-01-01", data: "v1:x", tasks: [] });
  assert.ok(id);
  assert.ok(db.purgeOlderThan(180) >= 1);
  assert.equal(db.byRef("MV-OLD001"), undefined);
});
