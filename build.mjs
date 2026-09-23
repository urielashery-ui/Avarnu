// בונה שתי גרסאות מאותו מקור:
//   dist/artifact.html  — קובץ יחיד (דמו מקומי, בלי שרת)
//   public/             — האתר האמיתי: index.html + styles.css + app.js + catalog.js + config.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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
writeFileSync(new URL("./dist/artifact.html", import.meta.url), single);

// 2) האתר האמיתי — בלי סקריפטים או עיצוב מוטמעים, כדי לעבוד עם CSP מחמיר
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const title = html.match(/<title>(.*?)<\/title>/)[1];
const fonts = html.match(/<link rel="stylesheet"[^>]*>/)[0];
const body = html
  .replace(/<title>.*?<\/title>\s*/, "")
  .replace(/<link[^>]*>\s*/g, "")
  .replace(/<style>[\s\S]*?<\/style>\s*/, "")
  .replace("<!--I18N-->", LANGS.map((l) => '<script src="/i18n/' + l + '.js"></script>').join(""))
  .replace("<!--SITEINFO-->", '<script src="/site-info.js"></script>')
  .replace("<!--CATALOG-->", '<script src="/catalog.js"></script>')
  .replace("<!--CONFIG-->", '<script src="/config.js"></script>')
  .replace("<!--APP-->", '<script src="/app.js"></script>');
const page = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="עוברים דירה? ממלאים פרטים פעם אחת ומקבלים רשימה של כל הגופים שצריך לעדכן: משרד הפנים, חברת החשמל, תאגיד המים, ארנונה ועוד.">
<meta name="theme-color" content="#2A63C9">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
${fonts}
<link rel="stylesheet" href="/styles.css">
<link rel="alternate" hreflang="he" href="/">
<link rel="alternate" hreflang="en" href="/en">
<link rel="alternate" hreflang="ru" href="/ru">
<link rel="alternate" hreflang="ar" href="/ar">
<link rel="alternate" hreflang="x-default" href="/">
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
console.log("built: dist/artifact.html, public/");
