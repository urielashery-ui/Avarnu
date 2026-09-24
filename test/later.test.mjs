// בדיקות להשלמת פרטים אחר כך ולתזכורות.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { sentLog } from "../server/connectors/email.js";
import { catalog as C } from "../server/validate.js";

const day = 864e5, iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const lead = (x = {}) => ({ lead: {
  firstName: "דנה", lastName: "כהן", tz: "123456782", phone: "0541234567", email: "dana@example.com", tenure: "own",
  newStreet: "הרצל", newNum: "3", newCity: "חולון", moveDate: iso(10), service: "self", consent: true, ...x } });

let S;
before(async () => {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "c".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000",
    PUBLIC_URL: "http://localhost", REMIND_AFTER_HOURS: "0" });
  const db = openDb(":memory:");
  const app = createApp(cfg, db);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  S = { app, db, server, base: "http://127.0.0.1:" + server.address().port };
});
after(() => S.server.close());
const post = (path, body) => fetch(S.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("מה חסר: רק פרטים לא רגישים שנדרשים ברשימה", () => {
  const miss = C.missing({ newStreet: "א", newCity: "חולון", moveDate: iso(5), tenure: "own" });
  assert.ok(miss.includes("elecMeter") && miss.includes("waterRead"));
  assert.ok(!miss.includes("tz"), "ת״ז לא ברשימה");
  assert.deepEqual(C.missing({ newStreet: "א", newCity: "חולון", moveDate: iso(5), tenure: "own", elecContract: "1", elecMeter: "2", elecRead: "3",
    waterMeter: "4", waterRead: "5", oldStreet: "ב", oldCity: "חיפה" }), []);
});

let token, ref;
test("שליחה מחזירה קישור אישי, והמייל ללקוח כולל קישור להשלמה", async () => {
  sentLog.length = 0;
  const r = await post("/api/leads", lead());
  const j = await r.json();
  assert.equal(r.status, 201);
  assert.ok(j.editToken && j.editToken.length > 20);
  token = j.editToken; ref = j.ref;
  await S.app.locals.pending;
  const m = sentLog.find((x) => x.to === "dana@example.com");
  assert.match(m.html, new RegExp("/u/" + token));
  assert.match(m.html, /השלמת הפרטים החסרים/);
});

test("השלמה מהדפדפן: רק שדות מותרים נשמרים, והשאר נשאר", async () => {
  const r = await post("/api/leads/update", { token, fields: { waterMeter: "555", waterRead: "12.5", tz: "000000018", phone: "0500000000", firstName: "האקר" } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(!j.missing.includes("waterMeter"));
  assert.ok(j.missing.includes("elecMeter"));
  const page = await (await fetch(S.base + "/admin/leads/" + ref, { headers: auth })).text();
  assert.match(page, /555/);
  assert.match(page, /דנה כהן/, "השם לא השתנה");
  assert.match(page, /הלקוח השלים/);
  assert.equal((await post("/api/leads/update", { token: "nope", fields: { waterMeter: "1" } })).status, 404);
});

test("דף ההשלמה מהמייל: מציג רק שדות ריקים, בלי פרטים אישיים, ושומר", async () => {
  const html = await (await fetch(S.base + "/u/" + token)).text();
  assert.match(html, /noindex/);
  assert.match(html, /name="elecMeter"/);
  assert.doesNotMatch(html, /name="waterMeter"/, "מה שכבר מולא לא מוצג");
  assert.doesNotMatch(html, /123456782|0541234567|dana@example.com/);
  const r = await fetch(S.base + "/u/" + token, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ elecMeter: "999", elecContract: "123", elecRead: "4000", oldStreet: "ילין 5", oldCity: "petah tikva" }) });
  assert.equal(r.status, 303);
  const done = await (await fetch(S.base + "/u/" + token + "?saved=1")).text();
  assert.match(done, /הכול מלא/);
  assert.equal((await fetch(S.base + "/u/wrong-token")).status, 404);
  // בקשה מאתר אחר נחסמת
  const x = await fetch(S.base + "/u/" + token, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" }, body: "elecMeter=1" });
  assert.equal(x.status, 403);
});

test("תזכורות: נשלחות רק כשחסר משהו, עד 2, ואפשר להפסיק", async () => {
  sentLog.length = 0;
  // פנייה מלאה — בלי תזכורת. פנייה עם חסרים — כן.
  const full = await (await post("/api/leads", lead({ email: "full@example.com", elecContract: "1", elecMeter: "2", elecRead: "3", waterMeter: "4", waterRead: "5", oldStreet: "א", oldCity: "חיפה" }))).json();
  const part = await (await post("/api/leads", lead({ email: "part@example.com", moveDate: iso(0) }))).json();
  await S.app.locals.pending; sentLog.length = 0;
  await S.app.locals.runReminders();
  assert.equal(sentLog.filter((m) => m.to === "full@example.com").length, 0);
  const r1 = sentLog.filter((m) => m.to === "part@example.com");
  assert.equal(r1.length, 1);
  assert.match(r1[0].subject, /חסרים עוד כמה פרטים/);
  assert.match(r1[0].html, new RegExp("/u/" + part.editToken));
  // תזכורת שנייה ביום המעבר (אחרי 20 שעות מהראשונה)
  S.db.raw.prepare("UPDATE leads SET remind_at = ? WHERE edit_token = ?").run(new Date(Date.now() - 21 * 3600e3).toISOString(), part.editToken);
  sentLog.length = 0; await S.app.locals.runReminders();
  const r2 = sentLog.filter((m) => m.to === "part@example.com");
  assert.equal(r2.length, 1); assert.match(r2[0].subject, /מקבלים מפתח/);
  // לא יותר משתיים
  S.db.raw.prepare("UPDATE leads SET remind_at = ? WHERE edit_token = ?").run(new Date(Date.now() - 50 * 3600e3).toISOString(), part.editToken);
  sentLog.length = 0; await S.app.locals.runReminders();
  assert.equal(sentLog.filter((m) => m.to === "part@example.com").length, 0);
  // הפסקת תזכורות
  const third = await (await post("/api/leads", lead({ email: "stop@example.com" }))).json();
  await S.app.locals.pending;
  const st = await fetch(S.base + "/u/" + third.editToken + "/stop", { method: "POST", redirect: "manual" });
  assert.equal(st.status, 303);
  sentLog.length = 0; await S.app.locals.runReminders();
  assert.equal(sentLog.filter((m) => m.to === "stop@example.com").length, 0);
  assert.ok(full.ref);
});

test("תזכורת בשפת הלקוח", async () => {
  const j = await (await post("/api/leads", lead({ email: "ru@example.com", lang: "ru" }))).json();
  await S.app.locals.pending; sentLog.length = 0;
  await S.app.locals.runReminders();
  const m = sentLog.find((x) => x.to === "ru@example.com");
  assert.match(m.subject, /не хватает/);
  const html = await (await fetch(S.base + "/u/" + j.editToken)).text();
  assert.match(html, /lang="ru"/);
});
