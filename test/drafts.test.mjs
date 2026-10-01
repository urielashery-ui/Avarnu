// "שמרו לי ותזכירו": נשמר רק בהסכמה, בלי תעודת זהות, מוצפן, עם קישור להמשך, תזכורות, ביטול ומחיקה אחרי 30 יום.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { sentLog } from "../server/connectors/email.js";

async function start(extra = {}) {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "9".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000", PUBLIC_URL: "https://avarnu.test",
    NOTIFY_TO: "biz@example.com", ...extra });
  const db = openDb(":memory:"), app = createApp(cfg, db), server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { app, db, server, base: "http://127.0.0.1:" + server.address().port };
}
const auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
const post = (S, p, b) => fetch(S.base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const partial = { tenure: "rent", newCity: "חולון", newStreet: "סוקולוב", newNum: "5", moveDate: "2026-11-01", tz: "123456782", consent: true, people: "3", disability75: true };

test("בלי הסכמה או בלי פרטי קשר תקינים — לא נשמר כלום", async () => {
  const S = await start();
  try {
    assert.equal((await post(S, "/api/drafts", { contact: "dana@example.com", consent: false, data: partial })).status, 400);
    assert.equal((await post(S, "/api/drafts", { contact: "abc", consent: true, data: partial })).status, 400);
    assert.equal(S.db.raw.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 0);
  } finally { S.server.close(); }
});

test("שמירה במייל: מוצפן, בלי ת״ז, קישור להמשך, התראה לעסק בלי פרטים, שחזור, עדכון והמרה לפנייה", async () => {
  const S = await start({ SMTP_URL: "smtp://localhost:1" });   // "מוגדר"; בבדיקות לא נשלח באמת (mailDryRun)
  try {
    sentLog.length = 0;
    const r = await post(S, "/api/drafts", { contact: "dana@example.com", consent: true, step: 1, lang: "he", src: "fb-test", data: partial });
    assert.equal(r.status, 201);
    const { token, mailed } = await r.json();
    assert.ok(token.length >= 20); assert.equal(mailed, true);
    const raw = S.db.raw.prepare("SELECT * FROM drafts").get();
    assert.doesNotMatch(raw.data, /dana|חולון/, "מוצפן");
    assert.equal(raw.src, "fb-test"); assert.equal(raw.kind, "email");
    const back = await (await fetch(S.base + "/api/drafts/" + token)).json();
    assert.equal(back.data.newCity, "חולון"); assert.equal(back.step, 1);
    assert.equal(back.data.tz, undefined, "תעודת זהות לא נשמרת"); assert.equal(back.data.consent, undefined, "הסכמה לא נשמרת");
    // עדכון בהמשך המילוי
    assert.equal((await post(S, "/api/drafts", { token, step: 3, data: { ...partial, firstName: "דנה" } })).status, 200);
    assert.equal(S.db.raw.prepare("SELECT step FROM drafts").get().step, 3);
    // בניהול
    const page = await (await fetch(S.base + "/admin/drafts", { headers: auth })).text();
    assert.match(page, /dana@example\.com/); assert.match(page, /דנה/); assert.match(page, /fb-test/);
    // שליחת פנייה עם הטוקן — הטיוטה מסומנת "השלים" ולא נשלפת יותר
    const lr = await post(S, "/api/leads", { draft: token, lead: { firstName: "דנה", lastName: "כהן", phone: "0541234567", email: "dana@example.com", tenure: "rent",
      newStreet: "סוקולוב", newNum: "5", newCity: "חולון", moveDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), service: "self", consent: true } });
    assert.equal(lr.status, 201);
    assert.equal(S.db.raw.prepare("SELECT status FROM drafts").get().status, "converted");
    assert.equal((await fetch(S.base + "/api/drafts/" + token)).status, 404);
  } finally { S.server.close(); }
});

test("טלפון: נשמר בלי מייל, עם קישור וואטסאפ בניהול; ביטול תזכורות; מחיקה אחרי 30 יום", async () => {
  const S = await start();
  try {
    const { token, mailed } = await (await post(S, "/api/drafts", { contact: "054-1234567", consent: true, step: 2, data: partial })).json();
    assert.equal(mailed, false);
    assert.match(await (await fetch(S.base + "/admin/drafts", { headers: auth })).text(), /wa\.me\/972541234567/);
    // ביטול: GET מציג כפתור בלבד (לא מבטל), POST מבטל
    assert.match(await (await fetch(S.base + "/d/" + token + "/stop")).text(), /<form method="post">/);
    assert.equal(S.db.raw.prepare("SELECT status FROM drafts").get().status, "open");
    await fetch(S.base + "/d/" + token + "/stop", { method: "POST" });
    assert.equal(S.db.raw.prepare("SELECT status FROM drafts").get().status, "stopped");
    // ישן מ-30 יום — נמחק
    S.db.raw.prepare("UPDATE drafts SET updated_at = ?").run(new Date(Date.now() - 31 * 864e5).toISOString());
    await S.app.locals.runDraftReminders();
    assert.equal(S.db.raw.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 0);
  } finally { S.server.close(); }
});

test("תזכורות במייל: אחרי יום, ועוד אחת אחרי 4 ימים, ולא יותר", async () => {
  const S = await start({ SMTP_URL: "smtp://localhost:1" });
  try {
    await post(S, "/api/drafts", { contact: "dana@example.com", consent: true, step: 1, data: partial });
    const run = () => S.app.locals.runDraftReminders();
    assert.equal((await run()).sent, 0, "לא מיד");
    S.db.raw.prepare("UPDATE drafts SET updated_at = ?").run(new Date(Date.now() - 25 * 3600e3).toISOString());
    assert.equal((await run()).sent, 1);
    assert.equal((await run()).sent, 0, "לא שוב באותו יום");
    S.db.raw.prepare("UPDATE drafts SET remind_at = ?").run(new Date(Date.now() - 97 * 3600e3).toISOString());
    assert.equal((await run()).sent, 1);
    S.db.raw.prepare("UPDATE drafts SET remind_at = ?").run(new Date(Date.now() - 200 * 3600e3).toISOString());
    assert.equal((await run()).sent, 0, "מקסימום 2");
    const m = sentLog.filter((x) => x.to === "dana@example.com").pop();
    assert.match(m.html, /\/d\/[A-Za-z0-9_-]+\/stop/); assert.match(m.html, /\?d=/);
  } finally { S.server.close(); }
});
