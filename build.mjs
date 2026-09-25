// בונה שתי גרסאות מאותו מקור:
//   dist/artifact.html  — קובץ יחיד (דמו מקומי, בלי שרת)
//   public/             — האתר האמיתי: index.html + styles.css + app.js + catalog.js + config.js
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const src = (f) => readFileSync(new URL("./src/" + f, import.meta.url), "utf8");
const html = src("app.html"), catalog = src("catalog.js"), app = src("app.js"), siteInfo = src("site-info.js");
const LANGS = ["he", "en", "ru", "ar"];
const i18n = LANGS.map((l) => src("i18n/" + l + ".js")).join("\n");
mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });

// 1) גרסת קובץ יחיד
const single = html
  .replace("<!--I18N-->", "<script>\n" + i18n + "\n</script>")
  .replace("<!--SITEINFO-->", "<script>\n" + siteInfo + "\n</script>")
  .replace("<!--CATALOG-->", "<script>\n" + catalog + "\n</script>")
  .replace("<!--CONFIG-->", "<script>window.MOVERS_CONFIG = { demo: true };</script>")
  .replace("<!--APP-->", "<script>\n" + app + "\n</script>");
const asset64 = (f) => "data:image/webp;base64," + readFileSync(new URL("./src/assets/" + f, import.meta.url)).toString("base64");
writeFileSync(new URL("./dist/artifact.html", import.meta.url), single.replace('url("/city.webp")', 'url("' + asset64("city.webp") + '")').replace('url("/city-m.webp")', 'url("' + asset64("city-m.webp") + '")'));

// 2) האתר האמיתי — בלי סקריפטים או עיצוב מוטמעים, כדי לעבוד עם CSP מחמיר
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const title = html.match(/<title>(.*?)<\/title>/)[1];
const fonts = html.match(/<link rel="stylesheet"[^>]*>/)[0];
// גרסה לכל קובץ (לפי התוכן) — משתנה רק כשהקובץ משתנה
const ver = (c) => createHash("sha256").update(c).digest("hex").slice(0, 10);
const V = { css: ver(html.match(/<style>([\s\S]*?)<\/style>/)[1]), app: ver(app), catalog: ver(catalog), site: ver(siteInfo) };
for (const l of LANGS) V["i18n-" + l] = ver(src("i18n/" + l + ".js"));
const body = html
  .replace(/<title>.*?<\/title>\s*/, "")
  .replace(/<link[^>]*>\s*/g, "")
  .replace(/<style>[\s\S]*?<\/style>\s*/, "")
  .replace("<!--I18N-->", LANGS.map((l) => '<script src="/i18n/' + l + '.js?v=' + V["i18n-" + l] + '"></script>').join(""))
  .replace("<!--SITEINFO-->", '<script src="/site-info.js?v=' + V.site + '"></script>')
  .replace("<!--CATALOG-->", '<script src="/catalog.js?v=' + V.catalog + '"></script>')
  .replace("<!--CONFIG-->", '<script src="/config.js"></script>')
  .replace("<!--APP-->", '<script src="/app.js?v=' + V.app + '"></script>');
// הכתובת הקבועה של האתר — לקישורים קנוניים, מפת אתר ושיתוף ברשתות
const SITE = "https://avarnu.com";
const DESC = "עוברים דירה? ממלאים פרטים פעם אחת ומקבלים רשימה של כל הגופים שצריך לעדכן (משרד הפנים, חשמל, מים, ארנונה), את כל ההנחות שמגיעות לכם, וכמה קרטונים צריך.";
// נתונים מובנים לגוגל (שם האתר + שאלות נפוצות). JSON בלבד — לא קוד, ולכן עובר את ה-CSP.
const HE = (() => { const g = {}; new Function("globalThis", src("i18n/he.js"))(g); return g.MoversI18N.he; })();
const faq = [1, 2, 3, 4, 5, 6, 7].filter((n) => HE["faq." + n + "q"]).map((n) => ({ "@type": "Question", name: HE["faq." + n + "q"], acceptedAnswer: { "@type": "Answer", text: HE["faq." + n + "a"] } }));
const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": [
  { "@type": "WebSite", "@id": SITE + "/#site", url: SITE + "/", name: "עברנו", alternateName: "avarnu", inLanguage: ["he", "en", "ru", "ar"], description: DESC },
  { "@type": "Organization", "@id": SITE + "/#org", url: SITE + "/", name: "עברנו", logo: SITE + "/icon-180.png" },
  { "@type": "FAQPage", "@id": SITE + "/#faq", mainEntity: faq }] }).replace(/</g, "\\u003c");
const page = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#0A2463">
<title>${title}</title>
<link rel="canonical" href="${SITE}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="עברנו">
<meta property="og:locale" content="he_IL">
<meta property="og:url" content="${SITE}/">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
${fonts}
<link rel="stylesheet" href="/styles.css?v=${V.css}">
<link rel="preload" as="image" href="/city.webp" type="image/webp" media="(min-width: 641px)">
<link rel="preload" as="image" href="/city-m.webp" type="image/webp" media="(max-width: 640px)">
<link rel="alternate" hreflang="he" href="${SITE}/">
<link rel="alternate" hreflang="en" href="${SITE}/en">
<link rel="alternate" hreflang="ru" href="${SITE}/ru">
<link rel="alternate" hreflang="ar" href="${SITE}/ar">
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<script type="application/ld+json">${ld}</script>
</head>
<body>
${body}
</body>
</html>
`;
const out = (f, c) => writeFileSync(new URL("./public/" + f, import.meta.url), c);
out("index.html", page);
out("styles.css", css.trim() + "\n");
out("app.js", app);
out("catalog.js", catalog);
out("site-info.js", siteInfo);
mkdirSync(new URL("./public/i18n/", import.meta.url), { recursive: true });
for (const l of LANGS) out("i18n/" + l + ".js", src("i18n/" + l + ".js"));
out("config.js", '// הכתובת של ה-API. להשאיר "/api" כשהאתר והשרת באותו דומיין.\nwindow.MOVERS_CONFIG = { api: "/api" };\n');
// תמונת שיתוף (וואטסאפ/פייסבוק) ואייקון למסך הבית
for (const f of ["og.jpg", "icon-180.png", "city.webp", "city-m.webp"]) copyFileSync(new URL("./src/assets/" + f, import.meta.url), new URL("./public/" + f, import.meta.url));
// אייקון, robots.txt ומפת אתר
out("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0A2463"/><rect x="5" y="17" width="19" height="15" rx="2.5" fill="#FFC23D"/><path d="M19 18l8-7 8 7v12a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z" fill="#fff"/><rect x="24.5" y="24" width="5" height="8" rx="1" fill="#0A2463"/></svg>\n`);
out("robots.txt", `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /m/\nDisallow: /r/\nDisallow: /go/\nSitemap: ${SITE}/sitemap.xml\n`);
out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  ["/", "/en", "/ru", "/ar"].map((p) => `  <url><loc>${SITE}${p}</loc>` + [["he", "/"], ["en", "/en"], ["ru", "/ru"], ["ar", "/ar"]].map(([l, q]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${q}"/>`).join("") + `</url>`).join("\n") + `\n</urlset>\n`);
console.log("built: dist/artifact.html, public/");
