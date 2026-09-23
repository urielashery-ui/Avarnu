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

async function fillAll(page) {
  await page.fill("#firstName", "נועה");
  await page.fill("#lastName", "לוי");
  await page.fill("#tz", "123456782");
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
    await page.click("#next");
    assert.equal(await page.isVisible("#errsum"), true, "סיכום שגיאות מוצג");
    assert.equal(await page.evaluate(() => document.activeElement.id), "errsum", "הפוקוס עובר לסיכום השגיאות");
    assert.equal(await page.getAttribute("#firstName", "aria-invalid"), "true");
    all.push(...await scan(page, "שלב 1 עם שגיאות"));

    await fillAll(page);
    await page.click("#next");
    assert.equal(await page.evaluate(() => document.activeElement.id), "h-1", "הפוקוס עובר לכותרת השלב");
    all.push(...await scan(page, "שלב משק בית"));
    await page.fill("#people", "4"); await page.fill("#kidsCount", "2");
    await page.check("#kidsUnder3"); await page.check("#singleParent"); await page.check("#reservist");
    await page.click("#next");
    all.push(...await scan(page, "שלב כתובות"));
    await page.fill("#newStreet", "הרצל"); await page.fill("#newNum", "10"); await page.fill("#newCity", "פתח תקווה");
    const d = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    await page.fill("#moveDate", d);
    await page.fill("#oldStreet", "ילין 5"); await page.fill("#oldCity", "פתח תקווה");
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
      all.push(...await scan(page, "שלב הובלה מלא"));
      await page.click("#next");
    }
    all.push(...await scan(page, "שלב 3"));
    await page.click("#next");
    await page.selectOption("#isp", "בזק"); await page.selectOption("#hmo", "מכבי"); await page.check("#xCar");
    all.push(...await scan(page, "שלב 4"));
    await page.click("#next");
    if (await page.isVisible("#service-self")) { // מצב אתר אמיתי: שלב שליחה
      all.push(...await scan(page, "שלב שליחה"));
      await page.click("#next");
      assert.equal(await page.isVisible("#consent-err"), true, "חובה לסמן הסכמה");
      await page.check("#consent");
      await page.click("#next");
      await page.waitForSelector("#refbox:not([hidden])");
      assert.match(await page.textContent("#refbox"), /MV-/);
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
