// קישורי מעקב (?src=): נספרים לפי מקור, נשמרים עם הפנייה ומוצגים בנתונים.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";

test("מקורות: כניסה, התחלה ופנייה נספרים לפי הקישור; ערכים לא תקינים נזרקים", async () => {
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "9".repeat(64), ADMIN_PASS: "test-password-123", RATE_LIMIT: "1000" });
  const app = createApp(cfg, openDb(":memory:")), server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port, auth = { Authorization: "Basic " + Buffer.from("admin:test-password-123").toString("base64") };
  const post = (p, b) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  try {
    await post("/api/hit", { k: "step:0", src: "fb-dirot-tlv" });
    await post("/api/hit", { k: "step:0", src: "fb-dirot-tlv" });
    await post("/api/hit", { k: "start", src: "fb-dirot-tlv" });
    await post("/api/hit", { k: "step:0", src: "<script>" });
    const d = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const r = await post("/api/leads", { lead: { src: "fb-dirot-tlv", firstName: "דנה", lastName: "כהן", phone: "0541234567", email: "d@example.com", tenure: "rent",
      newStreet: "הרצל", newNum: "3", newCity: "חולון", moveDate: d, service: "self", consent: true } });
    assert.equal(r.status, 201);
    const ref = (await r.json()).ref;
    const page = await (await fetch(base + "/admin/stats", { headers: auth })).text();
    assert.match(page, /fb-dirot-tlv<\/th><td class="n">2<\/td><td class="n">1<\/td><td class="n">1<\/td>/);
    assert.doesNotMatch(page, /&lt;script/);
    const lead = await (await fetch(base + "/admin/leads/" + ref, { headers: auth })).text();
    assert.match(lead, /הגיעו דרך/); assert.match(lead, /fb-dirot-tlv/);
  } finally { server.close(); }
});
