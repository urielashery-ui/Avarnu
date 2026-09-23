// שותפים ממומנים: פרסום "קלאסי" — רק הצעות שקשורות למעבר, מסומנות "ממומן", בלי עוגיות ובלי מעקב אחרי משתמשים.
// הרשימה נקראת מקובץ JSON (ברירת מחדל: config/sponsors.json). כבוי עד ש-ADS_ENABLED=true.
import { readFileSync, existsSync, statSync } from "node:fs";

const SLOTS = ["moving", "save", "kids", "home"];
let cache = { mtime: 0, list: [] };

function clean(s, max) { return typeof s === "string" ? s.trim().slice(0, max) : ""; }

export function validateSponsor(x) {
  if (!x || typeof x !== "object") return null;
  const id = clean(x.id, 40);
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
  let url;
  try { url = new URL(x.url); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const s = {
    id, slot: SLOTS.includes(x.slot) ? x.slot : "moving",
    title: clean(x.title, 70), text: clean(x.text, 180), cta: clean(x.cta, 30) || "לפרטים",
    url: url.href, active: x.active !== false,
    from: /^\d{4}-\d{2}-\d{2}$/.test(x.from || "") ? x.from : "", to: /^\d{4}-\d{2}-\d{2}$/.test(x.to || "") ? x.to : "",
    match: {}
  };
  const m = x.match || {};
  if (Array.isArray(m.cities)) s.match.cities = m.cities.map((c) => clean(c, 40)).filter(Boolean).slice(0, 50);
  if (["rent", "own"].includes(m.tenure)) s.match.tenure = m.tenure;
  if (m.kids === true) s.match.kids = true;
  if (!s.title || !s.text) return null;
  return s;
}

export function loadSponsors(file) {
  if (!existsSync(file)) return [];
  const mtime = statSync(file).mtimeMs;
  if (mtime !== cache.mtime) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      cache = { mtime, list: (Array.isArray(raw) ? raw : raw.sponsors || []).map(validateSponsor).filter(Boolean) };
    } catch (e) {
      console.error("[sponsors] קובץ לא תקין:", e.message);
      cache = { mtime, list: [] };
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return cache.list.filter((s) => s.active && (!s.from || s.from <= today) && (!s.to || s.to >= today));
}

// מה שהדפדפן מקבל: בלי הכתובת האמיתית. הקליק עובר דרך /go/:id כדי לספור אותו.
export const publicView = (s) => ({ id: s.id, slot: s.slot, title: s.title, text: s.text, cta: s.cta, match: s.match, href: "/go/" + s.id });

export function withUtm(url, id) {
  const u = new URL(url);
  if (!u.searchParams.has("utm_source")) {
    u.searchParams.set("utm_source", "avarnu");
    u.searchParams.set("utm_medium", "referral");
    u.searchParams.set("utm_campaign", id);
  }
  return u.href;
}
