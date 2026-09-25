// בדיקת נגישות אוטומטית (axe-core, WCAG 2.1 AA) לכל שלבי הטופס, במצב בהיר, כהה וניגודיות גבוהה.
// הרצה: npm run test:a11y   (BASE_URL=http://localhost:3000 לבדיקת האתר החי)
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";

const URL_ = process.env.BASE_URL || new URL("../dist/artifact.html", import.meta.url).href;
const exe = ["/opt/pw-browsers/chromium"].find(existsSync);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page, label) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).include("#app").analyze();
  const v = r.violations.map((x) => `${label}: ${x.id} (${x.impact}) — ${x.help} → ${x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  return v;
}

// תיאום שיחה עם נציג: פתיחה, שגיאות, שליחה
async function bookCall(page, all, label) {
  await page.click('[data-call="elec"]');
  assert.equal(await page.isVisible("#dlgCall"), true, "נפתח חלון תיאום");
  all.push(...await scan(page, label + ": חלון תיאום"));
  await page.click('#cbForm button[type="submit"]');
  assert.equal(await page.isVisible("#cbErr"), true, "שגיאות בחלון");
  all.push(...await scan(page, label + ": שגיאות תיאום"));
  await page.check("#cbSlot-10-12"); await page.check("#cbConsent");
  await page.click('#cbForm button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById("dlgCall").open);
  assert.equal(await page.isVisible('[data-call="elec"]'), false, "הכפתור הוחלף בסימון 'שיחה מתואמת'");
  await page.waitForFunction(() => !document.getElementById("toast").classList.contains("show"), null, { timeout: 6000 }); await page.waitForTimeout(300);
}

// הסדר החדש: קודם כתובת ותאריך (קל), ורק בסוף פרטים אישיים
async function fillAddress(page) {
  await page.fill("#newCity", "פתח תקווה"); await page.fill("#newStreet", "הרצל"); await page.fill("#newNum", "10");
  const d = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await page.fill("#moveDate", d);
  await page.click("details.moref summary");   // הכתובת הישנה — בחלק המקופל
  await page.fill("#oldCity", "פתח תקווה"); await page.fill("#oldStreet", "ילין 5");
}
async function fillPersonal(page) {
  await page.fill("#firstName", "נועה");
  await page.fill("#lastName", "לוי");
  await page.fill("#phone", "050-1234567");
  await page.fill("#email", "noa@example.com");
}

const RUNS = [["he", "light"], ["he", "dark"], ["en", "light"], ["ru", "light"], ["ar", "light"], ["ar", "dark"]];
for (const [lang, scheme] of RUNS) {
  test(`נגישות — ${lang} ${scheme}`, async () => {
    const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--no-proxy-server"] } : {});
    const ctx = await browser.newContext({ colorScheme: scheme, locale: "he-IL" });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/.test(m.text())) errors.push(m.text()); });
    try {
    await page.route((u) => /^https?:/.test(u.href) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u.href), (r) => r.abort());
    page.setDefaultTimeout(8000);
    await page.goto(URL_);
    await page.evaluate((l) => { try { localStorage.clear(); localStorage.setItem("avarnu-lang", l); } catch (e) {} }, lang);
    await page.reload();
    const all = [];
    assert.equal(await page.getAttribute("html", "lang"), lang, "שפת הדף");
    assert.equal(await page.getAttribute("html", "dir"), lang === "he" || lang === "ar" ? "rtl" : "ltr", "כיוון הדף");

    // שלב 1 ריק + שגיאות
    all.push(...await scan(page, "שלב 1"));
    // סרטון הסבר: נפתח, מתנגן עם כתוביות, אפשר לעצור ולסגור
    await page.click("#exOpen");
    assert.equal(await page.isVisible("#explainer"), true, "הסרטון נפתח");
    await page.waitForTimeout(700);
    assert.ok((await page.textContent("#exCap")).length > 5, "יש כתוביות");
    all.push(...await scan(page, "סרטון"));
    const playTxt = await page.textContent("#exPlay");
    await page.click("#exPlay");
    assert.notEqual(await page.textContent("#exPlay"), playTxt, "השהיה");
    assert.equal(await page.locator("#exText li").count(), 7, "תמליל מלא");
    await page.click("#exClose");
    assert.equal(await page.isVisible("#explainer"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "exOpen", "הפוקוס חוזר לכפתור");
    await page.click("#next");
    assert.equal(await page.isVisible("#errsum"), true, "סיכום שגיאות מוצג");
    assert.equal(await page.evaluate(() => document.activeElement.id), "errsum", "הפוקוס עובר לסיכום השגיאות");
    assert.equal(await page.getAttribute("#newCity", "aria-invalid"), "true");
    assert.equal(await page.isVisible("#firstName"), false, "בשלב הראשון לא מבקשים שם");
    all.push(...await scan(page, "שלב 1 עם שגיאות"));

    await fillAddress(page);
    await page.click("#next");
    assert.equal(await page.evaluate(() => document.activeElement.id), "h-1", "הפוקוס עובר לכותרת השלב");
    // יוצאים וחוזרים: ממשיכים מאותו שלב, בלי להתחיל מחדש
    await page.fill("#people", "4");
    await page.reload();
    assert.equal(await page.isVisible("#h-1"), true, "חוזרים לאותו שלב");
    assert.equal(await page.isVisible("#welcome"), true, "הודעת 'ממשיכים מאיפה שעצרתם'");
    assert.equal(await page.inputValue("#people"), "4", "מה שמילאו נשמר");
    all.push(...await scan(page, "חזרה לאתר"));
    await page.click("#back"); await page.click("#next");
    assert.equal(await page.isVisible("#welcome"), false);
    all.push(...await scan(page, "שלב משק בית"));
    await page.fill("#people", "4"); await page.fill("#kidsCount", "2");
    await page.check("#kidsUnder3"); await page.check("#singleParent"); await page.check("#reservist");
    await page.click("#next");
    if (await page.isVisible("#moveStatus-quotes")) {
      all.push(...await scan(page, "שלב הובלה"));
      await page.click("#next");
      assert.equal(await page.getAttribute("#moveStatus-fs", "aria-invalid"), "true", "חובה לבחור מצב הובלה");
      await page.check("#moveStatus-quotes");
      await page.click("#next");
      assert.equal(await page.isVisible("#moversConsent-err"), true, "חובה הסכמה להעברה למובילים");
      await page.selectOption("#rooms", "3"); await page.fill("#oldFloor", "2"); await page.check("#newElevator");
      await page.check("#moversConsent");
      // קרטונים: ההערכה מתמלאת לפי מספר החדרים
      await page.check("#supplies-need");
      assert.equal(await page.inputValue("#kBoxes"), "41", "3 חדרים = 41 קרטונים");
      if (await page.isVisible("#suppliesFrom-delivery")) {
        assert.ok(await page.inputValue("#suppliesDate"), "תאריך משלוח מתמלא לבד");
        await page.click("#next");
        assert.equal(await page.isVisible("#suppliesConsent-err"), true, "חובה הסכמה להעברה לספק");
        await page.check("#suppliesConsent");
      }
      all.push(...await scan(page, "שלב הובלה מלא"));
      await page.click("#next");
    } else if (await page.isVisible("#supplies-need")) { // בלי מובילים: רק קרטונים
      all.push(...await scan(page, "שלב אריזה"));
      await page.check("#supplies-need");
      await page.selectOption("#rooms", "2");
      assert.equal(await page.inputValue("#kBoxes"), "30", "2 חדרים = 30 קרטונים");
      await page.fill("#kTape", "x");
      await page.click("#next");
      assert.equal(await page.isVisible("#kTape-err"), true, "כמות לא תקינה");
      await page.fill("#kTape", "5");
      all.push(...await scan(page, "שלב אריזה מלא"));
      await page.click("#next");
    }
    all.push(...await scan(page, "שלב 3"));
    await page.click("#next");
    await page.selectOption("#isp", "בזק"); await page.selectOption("#hmo", "מכבי"); await page.check("#xCar");
    all.push(...await scan(page, "שלב 4"));
    await page.click("#next");
    // פרטים אישיים — רק בסוף
    all.push(...await scan(page, "שלב פרטים אישיים"));
    await page.click("#next");
    assert.equal(await page.getAttribute("#firstName", "aria-invalid"), "true", "שם חובה");
    await fillPersonal(page);
    await page.click("#next");
    if (await page.isVisible("#service-self")) { // מצב אתר אמיתי: שלב שליחה
      all.push(...await scan(page, "שלב שליחה"));
      assert.equal(await page.isVisible("#tz"), false, "עדכון עצמי: לא מבקשים תעודת זהות");
      await page.check("#service-concierge");
      assert.equal(await page.isVisible("#tz"), true, "\"תעדכנו בשבילי\": מבקשים תעודת זהות");
      all.push(...await scan(page, "שלב שליחה, שירות מלא"));
      await page.check("#service-self");
      await page.click("#next");
      assert.equal(await page.isVisible("#consent-err"), true, "חובה לסמן הסכמה");
      await page.check("#consent");
      await page.click("#next");
      await page.waitForSelector("#refbox:not([hidden])");
      assert.match(await page.textContent("#refbox"), /MV-/);
      if (await page.isVisible("#supplies")) assert.match(await page.textContent("#supplies"), /30|41/, "הרשימה עם הכמויות");
      if (await page.isVisible('[data-call="elec"]')) await bookCall(page, all, "אתר");
      // השלמת פרטים חסרים מתוך הרשימה, ודף ההשלמה מהמייל
      assert.equal(await page.isVisible("#later"), true, "מוצג מה חסר");
      await page.fill("#lt-waterMeter", "12345");
      await page.click("#laterActs button");
      await page.waitForFunction(() => !document.getElementById("lt-waterMeter"));
      all.push(...await scan(page, "אחרי השלמה"));
      const tok = await page.evaluate(() => JSON.parse(localStorage.getItem("movers-v3")).et);
      assert.ok(tok, "נשמר קישור אישי");
      await page.goto(URL_.replace(/\/$/, "") + "/u/" + tok);
      assert.equal(await page.isVisible("#u-waterMeter"), false, "מה שהושלם לא מוצג שוב");
      all.push(...await scan(page, "דף השלמה"));
      if (process.env.EXPECT_PARTNERS) assert.ok(await page.isVisible(".partner"), "מוצג שותף ממומן");
      if (process.env.EXPECT_MOVERS) assert.match(await page.textContent("#moving"), /הובלות הדגמה/, "מוצגים המובילים שקיבלו");
      all.push(...await scan(page, "רשימה אחרי שליחה"));
    } else {
      assert.equal(await page.isVisible("#results"), true);
      assert.ok(await page.isVisible("#done-ar-singleParent"), "מוצגת הנחת הורה יחיד");
      assert.ok(await page.isVisible("#done-kids-daycare"), "מוצג סבסוד מעון");
      assert.ok(await page.isVisible("#done-water-people"));
      assert.match(await page.textContent("#benefits"), /× 4/);
      if (lang !== "he") assert.ok(await page.isVisible("#dosHe"), "הערה שהנוסחים בעברית");
      assert.ok(await page.isVisible(".partner"), "בדמו מוצג מקום לדוגמה לשותף");
      assert.ok(await page.isVisible("#moving"), "בדמו מוצג אזור ההובלה");
      assert.ok(await page.isVisible("#supplies"), "מוצגת רשימת הקרטונים");
      await bookCall(page, all, "דמו");
      assert.ok(await page.isVisible("#later"), "מוצג מה חסר");
      await page.fill("#lt-elecMeter", "777"); await page.click("#laterActs button");
      assert.equal(await page.inputValue("#elecMeter"), "777", "ההשלמה נכנסה לטופס");
      await page.waitForFunction(() => !document.getElementById("toast").classList.contains("show"), null, { timeout: 6000 }); await page.waitForTimeout(300);
      assert.match(await page.textContent("#supplies"), /41/);
      all.push(...await scan(page, "רשימה"));
      // ניגודיות גבוהה + טקסט גדול מאוד
      await page.click("#a11yBtn");
      all.push(...await scan(page, "תפריט נגישות"));
      await page.click('[data-tog="hc"]'); await page.click('[data-fs="135"]');
      all.push(...await scan(page, "רשימה בניגודיות גבוהה"));
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement.id), "a11yBtn", "Esc סוגר ומחזיר פוקוס");
      // חלון הצהרת נגישות
      await page.click('footer [data-open="dlgA11y"]');
      all.push(...await scan(page, "הצהרת נגישות"));
      await page.keyboard.press("Escape");
    }
    // אין גלילה אופקית בטלפון
    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, "אין גלילה אופקית ברוחב 360px");
    assert.deepEqual(errors, [], "אין שגיאות בדף");
    assert.deepEqual(all, [], all.join("\n"));
    } finally { await browser.close(); }
  });
}

if (process.env.BASE_URL && process.env.EXPECT_MOVERS) {
  test("נגישות — דפי מובילים", async () => {
    const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--no-proxy-server"] } : {});
    try {
      const ctx = await browser.newContext({ locale: "he-IL" });
      const page = await ctx.newPage();
      await page.route((u) => /^https?:/.test(u.href) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u.href), (r) => r.abort());
      page.setDefaultTimeout(8000);
      const all = [];
      for (const path of ["/movers", "/movers?lang=ar", "/movers?lang=ru", "/movers/join"]) {
        await page.goto(URL_.replace(/\/$/, "") + path);
        all.push(...await scan(page, path));
      }
      assert.deepEqual(all, [], all.join("\n"));
    } finally { await browser.close(); }
  });
}
