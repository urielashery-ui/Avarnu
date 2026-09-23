// בדיקה שכל השפות מכילות את כל המפתחות, ושהמשתנים ({x}) זהים.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/i18n/he.js"; import "../src/i18n/en.js"; import "../src/i18n/ru.js"; import "../src/i18n/ar.js";
import "../src/catalog.js";
const D = globalThis.MoversI18N, C = globalThis.MoversCatalog;
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
// מפתחות שמותר שיהיו ריקים בעברית (הערות שמופיעות רק בשפות אחרות)
const HE_EMPTY = new Set(["res.heNote", "dlg.heNote", "email.heNote", "f.moversConsent.lang"]);

for (const lang of ["en", "ru", "ar"]) {
  test("שפה " + lang + ": כל המפתחות קיימים, והמשתנים זהים", () => {
    const missing = Object.keys(D.he).filter((k) => !(k in D[lang]));
    const extra = Object.keys(D[lang]).filter((k) => !(k in D.he));
    assert.deepEqual(missing, [], "חסר: " + missing.join(", "));
    assert.deepEqual(extra, [], "מיותר: " + extra.join(", "));
    const bad = Object.keys(D.he).filter((k) => !HE_EMPTY.has(k) && vars(D.he[k]) !== vars(D[lang][k]));
    assert.deepEqual(bad, [], "משתנים שונים: " + bad.join(", "));
    const empty = Object.keys(D[lang]).filter((k) => !String(D[lang][k]).trim());
    assert.deepEqual(empty, [], "ריק: " + empty.join(", "));
  });
}

test("כל מפתח שהקטלוג משתמש בו קיים, בכל שפה", () => {
  const d = { firstName: "א", lastName: "ב", tz: "123456782", phone: "0501234567", email: "a@b.co", people: "4", kidsCount: "2", tenure: "rent",
    newStreet: "הרצל", newNum: "1", newCity: "Хайфа", oldCity: "פתח תקווה", oldStreet: "ילין 5", moveDate: "2026-10-10", elecSupplier: "private", gas: "פזגז",
    isp: "בזק", tv: "yes", mobile: "אחר", hmo: "מכבי", bank: "לאומי", card: "ישראכרט", xCar: true, xInsurance: true, xPension: true, xPost: true, xEmployer: true, kidsSchool: true,
    kidsUnder3: true, singleParent: true, kidDisability: true, senior: true, seniorSupp: true, nursing: true, disability75: true, disability90: true, blind: true, idf: true,
    bereaved: true, holocaust: true, reservist: true, soldier: true, oleh: true, lowIncome: true, student: true };
  for (const lang of C.LANGS) {
    const all = JSON.stringify([C.build(d, { lang }), C.benefits(d, { lang }), C.groups(lang), C.benefitCats(lang), C.labels(lang)]);
    const leaked = all.match(/"(c|w|site)\.[a-zA-Z0-9.]+"/g);
    assert.equal(leaked, null, lang + ": מפתחות בלי תרגום " + leaked);
  }
  // הנוסחים לגופים תמיד בעברית, והעיר קנונית
  const ru = C.build(d, { lang: "ru" });
  assert.match(ru.find((i) => i.id === "moin").msg, /^שלום, שמי/);
  assert.match(ru.find((i) => i.id === "water").t, /Хайфа/);
  assert.match(ru.find((i) => i.id === "water").url, new RegExp(encodeURIComponent("חיפה")));
  assert.equal(C.canonCity("haifa"), "חיפה");
  assert.equal(C.canonCity("حيفا"), "חיפה");
  assert.equal(C.cityName("חיפה", "ar"), "حيفا");
  assert.equal(C.brand("בזק", "ru"), "Безек");
});
