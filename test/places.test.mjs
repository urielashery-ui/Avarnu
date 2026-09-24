// בדיקות לרשימת הערים והרחובות (השלמה אוטומטית בטופס).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { openDb } from "../server/db.js";
import { parseCsv, buildIndex, fetchOnline, createPlaces, pkey } from "../server/places.js";

// קובץ בפורמט של data.gov.il (כולל רווחים מיותרים, כמו במקור)
const CSV = "﻿_id,סמל_ישוב,שם_ישוב,סמל_רחוב,שם_רחוב\n" +
  '1,5000,"תל אביב - יפו ",101,"דיזנגוף "\n2,5000,תל אביב - יפו,102,אבן גבירול\n3,5000,תל אביב - יפו,103,"שד רוטשילד"\n' +
  "4,7900,פתח תקווה,201,ילין\n5,7900,פתח תקווה,202,ז'בוטינסקי\n6,6600,חולון,301,סוקולוב\n7,6600,חולון,301,סוקולוב\n";

test("קריאת CSV ובניית אינדקס: מנקה רווחים, בלי כפילויות, ממוין", () => {
  const idx = buildIndex(parseCsv(CSV));
  assert.deepEqual(idx.cities, ["חולון", "פתח תקווה", "תל אביב - יפו"]);
  assert.deepEqual(idx.streets.get("חולון"), ["סוקולוב"]);
  assert.deepEqual(idx.streets.get("תל אביב - יפו"), ["אבן גבירול", "דיזנגוף", "שד רוטשילד"]);
  assert.equal(pkey('תל-אביב "יפו"'), "תל אביב יפו");
});

test("הורדה מ-data.gov.il: כמה עמודים, ושגיאה כשהתשובה לא תקינה", async () => {
  const recs = Array.from({ length: 1500 }, (_, i) => ({ "שם_ישוב": "עיר" + (i % 10), "שם_רחוב": "רחוב " + i }));
  const calls = [];
  const fake = async (url) => {
    calls.push(url); const off = Number(new URL(url).searchParams.get("offset"));
    return { ok: true, json: async () => ({ success: true, result: { total: 1500, records: off === 0 ? recs : [] } }) };
  };
  const rows = await fetchOnline(fake);
  assert.equal(rows.length, 1500);
  assert.match(calls[0], /resource_id=9ad3862c-8391-4b2f-84a4-2d4c68625f4b/);
  await assert.rejects(fetchOnline(async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(fetchOnline(async () => ({ ok: true, json: async () => ({ success: true, result: { total: 1, records: [{ a: 1 }] } }) })), /השתנו/);
});

test("אם ההורדה נכשלת: נשארים עם הקובץ המקומי; אם מצליחה: שומרים עותק", async () => {
  const dir = mkdtempSync(join(tmpdir(), "places-")), csv = join(dir, "s.csv");
  writeFileSync(csv, CSV);
  const quiet = { log() {}, warn() {} };
  const bad = createPlaces({ dbPath: join(dir, "m.db"), placesCsv: csv, placesOnline: false }, { fetchImpl: async () => ({ ok: false, status: 500 }), log: quiet });
  bad.loadLocal(); await bad.refresh();
  assert.equal(bad.status().source, "csv"); assert.equal(bad.status().cities, 3); assert.match(bad.status().error, /500/);
  const recs = Array.from({ length: 1200 }, (_, i) => ({ "שם_ישוב": "רמת גן", "שם_רחוב": "רחוב " + i }));
  const good = createPlaces({ dbPath: join(dir, "m.db"), placesCsv: csv }, { fetchImpl: async (u) => ({ ok: true, json: async () => ({ success: true, result: { total: 1200, records: u.includes("offset=0") ? recs : [] } }) }), log: quiet });
  await good.refresh();
  assert.equal(good.status().source, "data.gov.il");
  assert.ok(existsSync(join(dir, "places.json")), "עותק נשמר בדיסק");
  const again = createPlaces({ dbPath: join(dir, "m.db"), placesOnline: false }, { log: quiet }); again.loadLocal();
  assert.equal(again.status().source, "cache");
});

test("API: ערים, רחובות לפי עיר (גם בשם מקוצר), ו-healthz", async () => {
  const dir = mkdtempSync(join(tmpdir(), "places-")), csv = join(dir, "s.csv");
  writeFileSync(csv, CSV);
  const cfg = loadConfig({ NODE_ENV: "test", DATA_KEY: "9".repeat(64), ADMIN_PASS: "test-password-123", PLACES_CSV: csv });
  const app = createApp(cfg, openDb(":memory:")), server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const c = await (await fetch(base + "/api/places/cities")).json();
    assert.equal(c.cities.length, 3);
    const s = await (await fetch(base + "/api/places/streets?city=" + encodeURIComponent("תל אביב"))).json();
    assert.equal(s.city, "תל אביב - יפו");
    assert.ok(s.streets.includes("דיזנגוף"));
    const p = await (await fetch(base + "/api/places/streets?city=" + encodeURIComponent("פתח תקוה"))).json();
    assert.ok(p.streets.includes("ילין"), "כתיב חסר (תקוה) מזוהה דרך הקטלוג");
    assert.equal((await fetch(base + "/api/places/streets?city=" + encodeURIComponent("עיר שלא קיימת"))).status, 404);
    assert.match((await (await fetch(base + "/healthz")).json()).streets, /csv · 3/);
    assert.match((await fetch(base + "/")).headers.get("content-security-policy"), /frame-src https:\/\/maps\.google\.com/);
  } finally { server.close(); }
});
