// בדיקות לפיילוט המובילים: בחירה, שליחה, פורטל מוביל, ביקורות, הצטרפות וניהול.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { moversApi } from "../server/movers.js";
import { sentLog } from "../server/connectors/email.js";

const future = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const lead = (x = {}) => ({ lead: {
  firstName: "רוני", lastName: "אבני", tz: "123456782", phone: "0541234567", email: "roni@example.com", tenure: "rent",
  newStreet: "ביאליק", newNum: "3", newCity: "רמת גן", oldStreet: "ילין 5", oldCity: "פתח תקווה", floor: "4", moveDate: future,
  service: "self", consent: true, moveStatus: "quotes", rooms: "3", oldFloor: "2", newElevator: true, packing: true, moversConsent: true, ...x } });

async function start(overrides) {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "e".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000",
    PUBLIC_URL: "http://localhost", MIN_REVIEWS_TO_SHOW: "1", ...overrides });
  const db = openDb(":memory:");
  const app = createApp(cfg, db);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { app, db, server, M: moversApi(db), base: "http://127.0.0.1:" + server.address().port };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const postForm = (base, path, obj, headers = {}) => fetch(base + path, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(obj) });

let S, OFF, ids = {};
before(async () => {
  S = await start({ MOVERS_ENABLED: "true" });
  OFF = await start({});
  const base = { insurance: true, agreement: true, active: true, checked_at: "2026-09-20", company_id: "515000000" };
  ids.A = S.M.create({ ...base, name: "הובלות הדגמה א", phone: "0501111111", email: "a@movers.test", areas: "פתח תקווה, גבעתיים" });
  ids.B = S.M.create({ ...base, name: "הובלות הדגמה ב", phone: "0502222222", email: "b@movers.test", areas: "*", weekly_cap: 2 });
  ids.C = S.M.create({ ...base, name: "הובלות חיפה", phone: "0503333333", email: "c@movers.test", areas: "חיפה" });
  ids.D = S.M.create({ ...base, name: "מושהה", phone: "0504444444", email: "d@movers.test", areas: "פתח תקווה", active: false });
  ids.E = S.M.create({ ...base, name: "בלי מייל", phone: "0505555555", areas: "רמת גן" });
});
after(() => { S.server.close(); OFF.server.close(); });

let first;
test("בקשת הצעות: עד 3 מובילים פעילים מהאזור, בלי ת״ז במייל למוביל", async () => {
  sentLog.length = 0;
  const r = await post(S.base, "/api/leads", lead());
  first = await r.json();
  assert.equal(r.status, 201);
  assert.equal(first.moversRequested, true);
  const names = first.movers.map((m) => m.name).sort();
  assert.deepEqual(names, ["בלי מייל", "הובלות הדגמה א", "הובלות הדגמה ב"], "רק פעילים שמשרתים את הערים (לא חיפה, לא מושהה)");
  await S.app.locals.pending;
  const toA = sentLog.find((m) => m.to === "a@movers.test");
  assert.ok(toA && toA.subject.includes("בקשת הובלה"));
  assert.ok(toA.html.includes("wa.me/972541234567"), "כפתור וואטסאפ ללקוח");
  assert.ok(toA.html.includes("קומה 2, בלי מעלית") && toA.html.includes("3 חדרים") && toA.html.includes("אריזה"));
  assert.ok(!toA.html.includes("123456782") && !toA.html.includes("ביאליק"), "בלי ת״ז ובלי כתובת מלאה");
  const cust = sentLog.find((m) => m.to === "roni@example.com");
  assert.ok(cust.html.includes("הובלות הדגמה א") && cust.html.includes("0501111111"), "הלקוח רואה למי נשלח");
  const row = S.db.byRef(first.ref);
  assert.equal(row.move_quote, 1);
  const mls = S.M.forLead(row.id);
  assert.ok(mls.filter((x) => x.email).every((x) => x.status === "sent"));
  assert.ok(S.db.events(row.id).some((e) => e.detail && e.detail.includes("אין מייל למוביל")), "מוביל בלי מייל מסומן לטיפול טלפוני");
});

test("בלי הסכמה או בלי בקשה — לא נשלח לאף מוביל", async () => {
  assert.equal((await post(S.base, "/api/leads", lead({ moversConsent: false }))).status, 400);
  assert.equal((await post(S.base, "/api/leads", lead({ rooms: "" }))).status, 400);
  const j = await (await post(S.base, "/api/leads", lead({ moveStatus: "booked", moversConsent: true }))).json();
  assert.equal(j.moversRequested, undefined);
  assert.equal(S.M.forLead(S.db.byRef(j.ref).id).length, 0);
  const off = await (await post(OFF.base, "/api/leads", lead())).json();
  assert.equal(off.moversRequested, undefined, "כשהפיילוט כבוי לא שולחים");
});

test("מכסה שבועית ותורנות; עיר בלי מוביל נרשמת כביקוש", async () => {
  const j = await (await post(S.base, "/api/leads", lead())).json();
  const j2 = await (await post(S.base, "/api/leads", lead())).json();
  assert.ok(!j2.movers.some((m) => m.name === "הובלות הדגמה ב"), "מוביל ב הגיע למכסה (2 בשבוע)");
  assert.ok(j.movers.length >= 1);
  const e = await (await post(S.base, "/api/leads", lead({ oldCity: "אילת", newCity: "אילת" }))).json();
  assert.deepEqual(e.movers, []);
  const page = await (await fetch(S.base + "/admin/movers", { headers: auth })).text();
  assert.ok(page.includes("אילת: 1 פניות"), "ניהול מראה ערים בלי מוביל");
});

test("פורטל מוביל: קישור בלי סיסמה, עדכון מצב, הגנות", async () => {
  const row = S.db.byRef(first.ref);
  const ml = S.M.forLead(row.id).find((x) => x.mover_id === ids.A);
  const page = await (await fetch(S.base + "/m/" + ml.token)).text();
  assert.ok(page.includes("רוני אבני") && page.includes("wa.me/972541234567") && !page.includes("123456782"));
  assert.equal((await fetch(S.base + "/m/not-a-token")).status, 404);
  assert.equal((await postForm(S.base, "/m/" + ml.token, { status: "contacted" }, { Origin: "https://evil.example" })).status, 403);
  const r = await postForm(S.base, "/m/" + ml.token, { status: "contacted" });
  assert.equal(r.status, 303);
  const after = S.M.byToken(ml.token);
  assert.equal(after.status, "contacted");
  assert.ok(after.first_action_at);
  await postForm(S.base, "/m/" + ml.token, { status: "hacked" });
  assert.equal(S.M.byToken(ml.token).status, "contacted", "רק מצבים מוכרים");
});

test("ביקורת: נשלחת אחרי המעבר, נשמרת לא מפורסמת, מתפרסמת אחרי אישור", async () => {
  const row = S.db.byRef(first.ref);
  S.db.raw.prepare("UPDATE leads SET move_date = ? WHERE id = ?").run(new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), row.id);
  sentLog.length = 0;
  await S.app.locals.runReviews();
  const mail = sentLog.find((m) => m.to === "roni@example.com");
  assert.ok(mail && mail.subject.includes("איך היה המוביל"));
  await S.app.locals.runReviews();
  assert.equal(sentLog.filter((m) => m.subject.includes("איך היה המוביל")).length, 1, "נשלח פעם אחת בלבד");
  const tok = S.db.byRef(first.ref).review_token;
  const form = await (await fetch(S.base + "/r/" + tok)).text();
  assert.ok(form.includes("הובלות הדגמה א"));
  assert.equal((await postForm(S.base, "/r/" + tok, { mover: String(ids.A), stars: "9" })).status, 400);
  const ok = await postForm(S.base, "/r/" + tok, { mover: String(ids.A), stars: "5", text: "מקצועיים ומהירים", publish: "1" });
  assert.equal(ok.status, 200);
  const rev = S.M.reviews()[0];
  assert.equal(rev.stars, 5); assert.equal(rev.published, 0); assert.equal(rev.public_name, "רוני");
  assert.equal(S.M.forLead(row.id).find((x) => x.mover_id === ids.A).status, "won");
  assert.ok(!(await (await fetch(S.base + "/movers")).text()).includes("מקצועיים ומהירים"), "לא מתפרסם לפני אישור");
  await postForm(S.base, "/admin/reviews/" + rev.id, { action: "publish" }, auth);
  const pub = await (await fetch(S.base + "/movers")).text();
  assert.ok(pub.includes("מקצועיים ומהירים") && pub.includes("5.0 מתוך 5"));
  assert.ok(!pub.includes("מושהה"), "מוביל לא פעיל לא מוצג");
});

test("הצטרפות מובילים מהאתר", async () => {
  assert.equal((await fetch(S.base + "/movers/join")).status, 200);
  const bad = await postForm(S.base, "/movers/join", { name: "x" });
  assert.equal(bad.status, 400);
  const good = await postForm(S.base, "/movers/join", { name: "הובלות חדשות", contact: "משה", phone: "0521239999", email: "new@movers.test",
    company_id: "123456789", areas: "רחובות, נס ציונה", insurance: "1", terms: "1" });
  assert.equal(good.status, 200);
  const m = S.M.all().find((x) => x.name === "הובלות חדשות");
  assert.equal(m.active, 0); assert.equal(m.source, "join");
  assert.equal((await fetch(OFF.base + "/movers", { redirect: "manual" })).status, 302, "דף המובילים סגור כשהפיילוט כבוי");
});

test("ניהול: אי אפשר להפעיל מוביל בלי ביטוח והסכם", async () => {
  const bad = await postForm(S.base, "/admin/movers/new", { name: "חדש", phone: "0521230000", areas: "חולון", active: "1" }, auth);
  assert.equal(bad.status, 400);
  const good = await postForm(S.base, "/admin/movers/new", { name: "חדש", phone: "0521230000", areas: "חולון", active: "1", insurance: "1", agreement: "1" }, auth);
  assert.equal(good.status, 303);
  const lp = await (await fetch(S.base + "/admin/leads/" + first.ref, { headers: auth })).text();
  assert.ok(lp.includes("הובלה: הצעות מחיר") && lp.includes("נסגרה הובלה"));
});
