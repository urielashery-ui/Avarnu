// ערים ורחובות מהרשימה הרשמית של רשות האוכלוסין (data.gov.il, "רשימת רחובות בישראל - מתעדכן").
// השרת מוריד את הרשימה פעם בשבוע, שומר עותק בדיסק, ומגיש לדפדפן רק את הרחובות של העיר שנבחרה.
// אם אין אינטרנט או שהאתר הממשלתי לא זמין — משתמשים בעותק האחרון (או בקובץ CSV שהועלה ידנית),
// ואם אין כלום, הטופס פשוט עובד כרגיל בלי השלמה אוטומטית.
import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog as C } from "./validate.js";

export const STREETS_RESOURCE = "9ad3862c-8391-4b2f-84a4-2d4c68625f4b";
const API = "https://data.gov.il/api/3/action/datastore_search";
const WEEK = 7 * 864e5;
const BUNDLED = fileURLToPath(new URL("../src/assets/streets.csv", import.meta.url));

// "תל אביב - יפו", "תל-אביב יפו", "תל אביב" → מפתח אחיד להשוואה
export const pkey = (s) => String(s || "").replace(/[֑-ׇ]/g, "").replace(/[״"׳'`\-–־().,]/g, " ").replace(/\s+/g, " ").trim();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
// כתיב מלא/חסר: "פתח תקוה" = "פתח תקווה", "קרית" = "קריית"
export const loose = (s) => pkey(s).replace(/וו/g, "ו").replace(/יי/g, "י").replace(/ /g, "");
const ABBR = { "פ ת": "פתח תקווה", "ת א": "תל אביב - יפו", "ב ש": "באר שבע", "ר ג": "רמת גן", "ר ל": "ראשון לציון", "ק ש": "קריית שמונה", "י ם": "ירושלים" };

// בונה אינדקס מרשומות: [[עיר, רחוב], ...]
export function buildIndex(rows) {
  const map = new Map();
  for (const [c, s] of rows) {
    const city = clean(c), street = clean(s);
    if (!city || !street) continue;
    if (!map.has(city)) map.set(city, new Set());
    map.get(city).add(street);
  }
  const cities = [...map.keys()].sort((a, b) => a.localeCompare(b, "he"));
  const streets = new Map(cities.map((c) => [c, [...map.get(c)].sort((a, b) => a.localeCompare(b, "he"))]));
  const byKey = new Map(cities.map((c) => [pkey(c), c]));
  const byLoose = new Map();
  for (const c of cities) { const k = loose(c); byLoose.set(k, byLoose.has(k) ? null : c); }  // null = לא חד-משמעי
  return { cities, streets, byKey, byLoose };
}

// קורא CSV פשוט (כמו שמורידים מ-data.gov.il): מחפש את עמודות שם הישוב ושם הרחוב לפי הכותרת
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const split = (l) => { const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out; };
  const head = split(lines[0]).map((h) => h.trim());
  const ci = head.findIndex((h) => /שם[_ ]ישוב/.test(h) && !/לועזי/.test(h)), si = head.findIndex((h) => /שם[_ ]רחוב/.test(h));
  if (ci < 0 || si < 0) throw new Error("לא נמצאו עמודות שם_ישוב / שם_רחוב בקובץ");
  return lines.slice(1).map((l) => { const r = split(l); return [r[ci], r[si]]; });
}

// מוריד את כל הרשימה מ-data.gov.il (כמה עמודים)
export async function fetchOnline(fetchImpl = fetch) {
  const rows = [];
  for (let offset = 0, total = Infinity; offset < total; offset += 32000) {
    const r = await fetchImpl(`${API}?resource_id=${STREETS_RESOURCE}&limit=32000&offset=${offset}`, { headers: { "User-Agent": "avarnu.com (street list)" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error("data.gov.il החזיר " + r.status);
    const j = await r.json();
    if (!j.success) throw new Error("data.gov.il: תשובה לא תקינה");
    const recs = j.result.records || [];
    total = j.result.total ?? 0;
    if (!recs.length) break;
    const keys = Object.keys(recs[0]);
    const ck = keys.find((k) => /שם[_ ]ישוב/.test(k) && !/לועזי/.test(k)), sk = keys.find((k) => /שם[_ ]רחוב/.test(k));
    if (!ck || !sk) throw new Error("data.gov.il: שמות השדות השתנו");
    for (const x of recs) rows.push([x[ck], x[sk]]);
  }
  if (rows.length < 1000) throw new Error("data.gov.il: רשימה קצרה מדי (" + rows.length + ")");
  return rows;
}

export function createPlaces(cfg, { fetchImpl = fetch, log = console } = {}) {
  const cacheFile = cfg.placesFile || join(dirname(cfg.dbPath === ":memory:" ? "data/x" : cfg.dbPath), "places.json");
  const state = { idx: null, source: "none", updatedAt: null, error: null, loading: null };

  function use(rows, source, updatedAt) { state.idx = buildIndex(rows); state.source = source; state.updatedAt = updatedAt; }

  function loadLocal() {
    try {
      if (existsSync(cacheFile)) { const j = JSON.parse(readFileSync(cacheFile, "utf8")); use(j.rows, "cache", j.updatedAt); return true; }
    } catch (e) { log.warn?.("[places] cache:", e.message); }
    try {
      const f = cfg.placesCsv || BUNDLED;
      if (existsSync(f)) { use(parseCsv(readFileSync(f, "utf8")), "csv", statSync(f).mtime.toISOString()); return true; }
    } catch (e) { state.error = e.message; log.warn?.("[places] csv:", e.message); }
    return false;
  }

  async function refresh() {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      try {
        const rows = await fetchOnline(fetchImpl), updatedAt = new Date().toISOString();
        use(rows, "data.gov.il", updatedAt); state.error = null;
        try { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ updatedAt, rows })); } catch (e) { log.warn?.("[places] save:", e.message); }
        log.log?.(`[places] נטענו ${state.idx.cities.length} ישובים מ-data.gov.il`);
      } catch (e) { state.error = e.message; log.warn?.("[places] לא הצלחנו לעדכן:", e.message); }
      finally { state.loading = null; }
    })();
    return state.loading;
  }

  // עיר לפי מה שהמשתמש כתב: שם מדויק, שם מוכר מהקטלוג, או התחלה ייחודית ("תל אביב" → "תל אביב - יפו")
  function findCity(name) {
    const idx = state.idx; if (!idx || !name) return null;
    const cands = [name, C.canonCity(name), ABBR[pkey(name)]].filter(Boolean);
    for (const cand of cands) { const hit = idx.byKey.get(pkey(cand)) || idx.byLoose.get(loose(cand)); if (hit) return hit; }
    const k = loose(C.canonCity(name));
    if (k.length < 2) return null;
    const starts = idx.cities.filter((c) => loose(c).startsWith(k));
    return starts.length === 1 ? starts[0] : null;
  }

  const status = () => ({ ready: !!state.idx, source: state.source, updatedAt: state.updatedAt, cities: state.idx ? state.idx.cities.length : 0, error: state.error });

  function router() {
    const r = express.Router();
    r.get("/api/places/cities", (req, res) => {
      if (!state.idx) return res.status(503).json({ message: "רשימת הערים לא זמינה כרגע" });
      res.set("Cache-Control", "public, max-age=86400").json({ cities: state.idx.cities });
    });
    r.get("/api/places/streets", (req, res) => {
      if (!state.idx) return res.status(503).json({ message: "רשימת הרחובות לא זמינה כרגע" });
      const city = findCity(String(req.query.city || "").slice(0, 60));
      if (!city) return res.status(404).json({ message: "העיר לא נמצאה ברשימה" });
      res.set("Cache-Control", "public, max-age=86400").json({ city, streets: state.idx.streets.get(city) });
    });
    return r;
  }

  // התחלה: עותק מקומי מיד, ועדכון מהאינטרנט ברקע אם העותק ישן משבוע (או לא קיים)
  function start() {
    loadLocal();
    const stale = !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > WEEK || state.source === "csv";
    if (stale && cfg.placesOnline !== false) refresh();
    const t = setInterval(() => refresh(), WEEK); t.unref();
  }

  return { start, refresh, router, status, findCity, loadLocal, _state: state };
}
