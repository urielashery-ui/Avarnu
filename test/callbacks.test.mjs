// בדיקות לתיאום שיחה עם נציג של גוף.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { sentLog } from "../server/connectors/email.js";
import { catalog as C } from "../server/validate.js";

const day = 864e5, iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const lead = { lead: { firstName: "יוסי", lastName: "לוי", tz: "123456782", phone: "0541234567", email: "yosi@example.com", tenure: "own",
  newStreet: "הרצל", newNum: "3", newCity: "חולון", moveDate: iso(10), service: "self", consent: true, gas: "פזגז" } };

async function start(extra) {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "9".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000",
    PUBLIC_URL: "http://localhost", NOTIFY_TO: "biz@example.com", ...extra });
  const db = openDb(":memory:"), app = createApp(cfg, db), server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { app, db, server, base: "http://127.0.0.1:" + server.address().port };
}
let ON, OFF;
before(async () => { ON = await start({ CALLBACK_ENABLED: "true" }); OFF = await start({}); });
after(() => { ON.server.close(); OFF.server.close(); });
const post = (S, path, body) => fetch(S.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("ימים לתיאום: א׳–ה׳, ממחר ועד 30 יום", () => {
  assert.equal(C.validCallDay(iso(0)), false, "לא היום");
  assert.equal(C.validCallDay(iso(40)), false);
  const nd = C.nextCallDay();
  assert.ok(C.validCallDay(nd));
  const wd = new Date(nd + "T12:00:00Z").getUTCDay();
  assert.ok(wd !== 5 && wd !== 6);
});

test("בקשת שיחה: נשמרת, מגיעה לעסק במייל בלי פרטים אישיים, ומופיעה בניהול", async () => {
  const j = await (await post(ON, "/api/leads", lead)).json();
  await ON.app.locals.pending; sentLog.length = 0;
  const d = C.nextCallDay();
  const bad = await post(ON, "/api/callbacks", { token: j.editToken, body: "gas", day: iso(0), slot: "99", consent: false });
  assert.equal(bad.status, 400);
  assert.equal((await post(ON, "/api/callbacks", { token: j.editToken, body: "hacker", day: d, slot: "8-10", consent: true })).status, 400);
  assert.equal((await post(ON, "/api/callbacks", { token: "nope", body: "gas", day: d, slot: "8-10", consent: true })).status, 404);
  const r = await post(ON, "/api/callbacks", { token: j.editToken, body: "gas", day: d, slot: "10-12", note: "לשאול על מונה", consent: true });
  assert.equal(r.status, 201);
  await new Promise((x) => setTimeout(x, 50));
  const m = sentLog.find((x) => x.to === "biz@example.com" && /לתאם שיחה/.test(x.subject));
  assert.ok(m, "מייל לעסק");
  assert.doesNotMatch(m.html, /0541234567|יוסי|לשאול על מונה/, "בלי פרטים אישיים במייל");
  const page = await (await fetch(ON.base + "/admin/callbacks", { headers: auth })).text();
  assert.match(page, /פזגז/); assert.match(page, /0541234567/); assert.match(page, /לשאול על מונה/);
  // ההערה נשמרת מוצפנת
  const raw = ON.db.raw.prepare("SELECT note FROM callbacks").get().note;
  assert.doesNotMatch(raw, /לשאול/);
  // עדכון מצב
  const id = ON.db.raw.prepare("SELECT id FROM callbacks").get().id;
  const u = await fetch(ON.base + "/admin/callbacks/" + id, { method: "POST", redirect: "manual", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, body: "status=done" });
  assert.equal(u.status, 303);
  assert.equal(ON.db.raw.prepare("SELECT status FROM callbacks").get().status, "done");
  const leadPage = await (await fetch(ON.base + "/admin/leads/" + j.ref, { headers: auth })).text();
  assert.match(leadPage, /שיחות לתאם/);
});

test("השירות כבוי: אין אפשרות לתאם", async () => {
  const j = await (await post(OFF, "/api/leads", lead)).json();
  assert.match(await (await fetch(OFF.base + "/config.js")).text(), /"callbacks":false/);
  const r = await post(OFF, "/api/callbacks", { token: j.editToken, body: "gas", day: C.nextCallDay(), slot: "8-10", consent: true });
  assert.equal(r.status, 404);
});
