// שפות בצד השרת: ערים בכל שפה, מייל ללקוח בשפה שלו, המוביל מקבל עברית עם שפה מועדפת, דפים לפי שפה.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { moversApi } from "../server/movers.js";
import { sentLog } from "../server/connectors/email.js";

let S;
const future = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
before(async () => {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "f".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000", PUBLIC_URL: "http://localhost",
    MOVERS_ENABLED: "true", SUPPORT_LANGS: "he,en,ru" });
  const db = openDb(":memory:"), app = createApp(cfg, db), server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  S = { app, db, server, M: moversApi(db), base: "http://127.0.0.1:" + server.address().port };
  S.M.create({ name: "הובלות המרכז", phone: "0501111111", email: "m@movers.test", areas: "פתח תקווה", active: true, insurance: true, agreement: true });
});
after(() => S.server.close());
const post = (body) => fetch(S.base + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("לקוח ברוסית: עיר מזוהה, מייל ברוסית, מוביל בעברית עם שפה מועדפת", async () => {
  sentLog.length = 0;
  const r = await post({ lead: { lang: "ru", firstName: "Ольга", lastName: "Коэн", tz: "123456782", phone: "0521234567", email: "olga@example.com", tenure: "rent",
    newStreet: "Герцль", newNum: "5", newCity: "Хайфа", oldCity: "Петах-Тиква", moveDate: future, service: "self", consent: true,
    moveStatus: "quotes", rooms: "3", moversConsent: true, singleParent: true } });
  const j = await r.json();
  assert.equal(r.status, 201);
  assert.deepEqual(j.movers.map((m) => m.name), ["הובלות המרכז"], "Петах-Тиква זוהתה כפתח תקווה");
  const row = S.db.byRef(j.ref);
  assert.equal(row.new_city, "חיפה", "העיר נשמרת בשם הקנוני");
  await S.app.locals.pending;
  const cust = sentLog.find((m) => m.to === "olga@example.com");
  assert.match(cust.subject, /Ваш список для переезда/);
  assert.ok(cust.html.includes('lang="ru" dir="ltr"') && cust.html.includes("Хайфа") && cust.html.includes("Родитель-одиночка"));
  assert.ok(cust.html.includes("на иврите"), "הסבר שהנוסחים בעברית");
  const mover = sentLog.find((m) => m.to === "m@movers.test");
  assert.ok(mover.html.includes('lang="he"') && mover.html.includes("שפה מועדפת לשיחה") && mover.html.includes("רוסית"));
  // בקשת דירוג ודף הדירוג ברוסית
  S.db.raw.prepare("UPDATE leads SET move_date = ? WHERE id = ?").run("2020-01-01", row.id);
  sentLog.length = 0;
  await S.app.locals.runReviews();
  assert.match(sentLog[0].subject, /Как прошла перевозка/);
  const page = await (await fetch(S.base + "/r/" + S.db.byRef(j.ref).review_token)).text();
  assert.ok(page.includes('<html lang="ru" dir="ltr">') && page.includes("С каким перевозчиком"));
});

test("ערבית: כיוון מימין לשמאל במייל ובדף המובילים", async () => {
  sentLog.length = 0;
  const j = await (await post({ lead: { lang: "ar", firstName: "سارة", lastName: "خليل", tz: "123456782", phone: "0521234567", email: "sara@example.com", tenure: "own",
    newStreet: "الجليل", newNum: "2", newCity: "الناصرة", moveDate: future, service: "self", consent: true } })).json();
  await S.app.locals.pending;
  const m = sentLog.find((x) => x.to === "sara@example.com");
  assert.ok(m.html.includes('lang="ar" dir="rtl"') && m.html.includes("الناصرة"));
  assert.equal(S.db.byRef(j.ref).new_city, "נצרת");
  const pg = await (await fetch(S.base + "/movers?lang=ar")).text();
  assert.ok(pg.includes('<html lang="ar" dir="rtl">') && pg.includes("شركات نقل موصى بها") && pg.includes("بيتح تكفا"));
});

test("כתובות לפי שפה והגדרות לדפדפן", async () => {
  for (const p of ["/en", "/ru", "/ar/"]) {
    const r = await fetch(S.base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /hreflang="ru"/);
  }
  const js = await (await fetch(S.base + "/config.js")).text();
  assert.match(js, /"supportLangs":\["he","en","ru"\]/);
  assert.equal((await post({ lead: { lang: "fr" } })).status, 400);
});
