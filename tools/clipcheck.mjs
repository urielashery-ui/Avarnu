// בדיקה: אף אלמנט גלוי לא בורח מרוחב המסך (גם אם הגלילה לרוחב חסומה ולכן זה "מוסתר").
// שימוש: node tools/clipcheck.mjs <base-url>
import { chromium } from "playwright";
const B = process.argv[2] || "http://localhost:3000";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-proxy-server"] });
const probe = () => {
  const W = document.documentElement.clientWidth, out = [];
  for (const e of document.querySelectorAll("#app *")) {
    const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || e.closest("[hidden],.sr,dialog:not([open])")) continue;
    if (e.classList.contains("sr") || e.closest(".hero .scene3d .fchip")) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > W + 1 || r.left < -1) {
      const full = e.matches(".hero,.band,.top.navy,footer.foot,.ctaband,.hero::after") || (r.left <= 0 && r.right >= W && r.width <= W + 2);
      if (!full) out.push(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ")[0]} [${Math.round(r.left)},${Math.round(r.right)}] "${(e.textContent || "").trim().slice(0, 30)}"`);
    }
  }
  return out.slice(0, 6);
};
let bad = 0;
for (const lang of ["he", "en", "ru", "ar"]) for (const w of [320, 360, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 }, isMobile: true, hasTouch: true });
  await p.route((u) => /^https?:/.test(u.href) && !u.href.startsWith(B), (r) => r.abort());
  await p.goto(B + "/" + (lang === "he" ? "" : lang)); await p.waitForTimeout(300);
  const probs = await p.evaluate(probe);
  // גם אחרי שפותחים את החלק המקופל ומגיעים לשלבים הבאים
  await p.click("details.moref summary").catch(() => {});
  const probs2 = await p.evaluate(probe);
  // מעבר על כל השלבים עד דף התוצאות
  let probs3 = [];
  await p.fill("#newCity", "חולון"); await p.fill("#newStreet", "סוקולוב"); await p.fill("#newNum", "5");
  await p.fill("#moveDate", new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10));
  await p.fill("#oldCity", "פתח תקווה"); await p.fill("#oldStreet", "ילין 5");
  for (let i = 0; i < 10 && !(await p.isVisible("#results")); i++) {
    if (await p.isVisible("#moveStatus-quotes")) await p.check("#moveStatus-self");
    if (await p.isVisible("#supplies-need")) { await p.check("#supplies-need"); if (await p.isVisible("#rooms")) await p.selectOption("#rooms", "3"); if (await p.isVisible("#suppliesConsent")) await p.check("#suppliesConsent"); }
    if (await p.isVisible("#firstName")) { await p.fill("#firstName", "Dana"); await p.fill("#lastName", "Cohen"); await p.fill("#phone", "0541234567"); await p.fill("#email", "dana@example.com"); }
    if (await p.isVisible("#service-concierge")) { await p.check("#service-concierge"); probs3 = probs3.concat(await p.evaluate(probe)); await p.check("#service-self"); }
    if (await p.isVisible("#consent")) await p.check("#consent");
    probs3 = probs3.concat(await p.evaluate(probe));
    await p.click("#next"); await p.waitForTimeout(300);
  }
  await p.waitForTimeout(500);
  if (!(await p.isVisible("#results"))) probs3.push("DID NOT REACH RESULTS");
  probs3 = probs3.concat(await p.evaluate(probe));
  const all = [...new Set(probs.concat(probs2, probs3))];
  if (all.length) { bad++; console.log(lang, w, all.join("\n   ")); }
  await p.close();
}
console.log(bad ? "FAIL: " + bad : "OK: nothing sticks out of the screen");
await b.close();
