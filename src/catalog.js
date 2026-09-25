/*
 * קטלוג הגופים, ההנחות ובדיקות התקינות — קובץ משותף לדפדפן ולשרת.
 * בדפדפן: נטען כסקריפט ומגדיר את globalThis.MoversCatalog.
 * בשרת: import "./catalog.js" ואז globalThis.MoversCatalog.
 *
 * שפות: כל הטקסטים לתצוגה נמצאים בקבצי src/i18n/*.js (he, en, ru, ar), לפי מפתח.
 * הנוסחים שהלקוח מעתיק ושולח לגופים (msg) נשארים תמיד בעברית — כי הם נשלחים לגופים בישראל.
 */
(function (root) {
  "use strict";

  var LANGS = ["he", "en", "ru", "ar"];
  var RTL = { he: true, ar: true };

  // ---------- תרגום ----------
  function T(lang, key, vars) {
    var D = root.MoversI18N || {};
    var s = (D[lang] && D[lang][key] != null) ? D[lang][key] : (D.he && D.he[key] != null ? D.he[key] : key);
    if (vars) s = String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return lang === "ar" ? ltrNums(s) : s;
  }
  // בערבית, הדפדפן הופך סדר של מספרים עם מקף או נקודה (050-1234567 → 1234567-050, 13.10.2026 → 2026.10.13).
  // עוטפים רצף מספרים בבידוד משמאל-לימין (LRI … PDI), כדי שיוצג נכון.
  function ltrNums(s) {
    return String(s).replace(/\u2066[^\u2069]*\u2069|\d[\d.,:\/\-–]*\d/g, function (m) { return m.charAt(0) === "\u2066" ? m : "\u2066" + m + "\u2069"; });
  }

  // ---------- ערים: שם קנוני בעברית + תרגומים ----------
  // [עברית, English, Русский, العربية]
  var CITIES = [
    ["ירושלים", "Jerusalem", "Иерусалим", "القدس"], ["תל אביב-יפו", "Tel Aviv-Yafo", "Тель-Авив-Яффо", "تل أبيب - يافا"],
    ["חיפה", "Haifa", "Хайфа", "حيفا"], ["ראשון לציון", "Rishon LeZion", "Ришон-ле-Цион", "ريشون لتسيون"],
    ["פתח תקווה", "Petah Tikva", "Петах-Тиква", "بيتح تكفا"], ["אשדוד", "Ashdod", "Ашдод", "أسدود"],
    ["נתניה", "Netanya", "Нетания", "نتانيا"], ["באר שבע", "Be'er Sheva", "Беэр-Шева", "بئر السبع"],
    ["חולון", "Holon", "Холон", "حولون"], ["בני ברק", "Bnei Brak", "Бней-Брак", "بني براك"],
    ["רמת גן", "Ramat Gan", "Рамат-Ган", "رمات غان"], ["רחובות", "Rehovot", "Реховот", "رحوفوت"],
    ["בת ים", "Bat Yam", "Бат-Ям", "بات يام"], ["אשקלון", "Ashkelon", "Ашкелон", "عسقلان"],
    ["כפר סבא", "Kfar Saba", "Кфар-Саба", "كفار سابا"], ["הרצליה", "Herzliya", "Герцлия", "هرتسليا"],
    ["מודיעין-מכבים-רעות", "Modi'in-Maccabim-Re'ut", "Модиин-Маккабим-Реут", "موديعين"], ["חדרה", "Hadera", "Хадера", "الخضيرة"],
    ["רעננה", "Ra'anana", "Раанана", "رعنانا"], ["לוד", "Lod", "Лод", "اللد"], ["רמלה", "Ramla", "Рамла", "الرملة"],
    ["גבעתיים", "Givatayim", "Гиватаим", "جفعتايم"], ["הוד השרון", "Hod HaSharon", "Ход-ха-Шарон", "هود هشارون"],
    ["ראש העין", "Rosh HaAyin", "Рош-ха-Аин", "روش هعاين"], ["קריית גת", "Kiryat Gat", "Кирьят-Гат", "كريات جات"],
    ["נהריה", "Nahariya", "Нагария", "نهاريا"], ["עפולה", "Afula", "Афула", "العفولة"], ["אילת", "Eilat", "Эйлат", "إيلات"],
    ["בית שמש", "Beit Shemesh", "Бейт-Шемеш", "بيت شيمش"], ["קריית אתא", "Kiryat Ata", "Кирьят-Ата", "كريات آتا"],
    ["נס ציונה", "Ness Ziona", "Нес-Циона", "نيس تسيونا"], ["יבנה", "Yavne", "Явне", "يفنه"],
    ["קריית ים", "Kiryat Yam", "Кирьят-Ям", "كريات يام"], ["קריית ביאליק", "Kiryat Bialik", "Кирьят-Бялик", "كريات بياليك"],
    ["כרמיאל", "Karmiel", "Кармиэль", "كرميئيل"], ["עכו", "Akko", "Акко", "عكا"], ["נוף הגליל", "Nof HaGalil", "Ноф-ха-Галиль", "نوف هجليل"],
    ["נצרת", "Nazareth", "Назарет", "الناصرة"], ["אום אל-פחם", "Umm al-Fahm", "Умм-эль-Фахм", "أم الفحم"],
    ["רהט", "Rahat", "Рахат", "رهط"], ["טייבה", "Tayibe", "Тайбе", "الطيبة"], ["שפרעם", "Shefa-'Amr", "Шфарам", "شفاعمرو"],
    ["טמרה", "Tamra", "Тамра", "طمرة"], ["סח'נין", "Sakhnin", "Сахнин", "سخنين"], ["באקה אל-גרבייה", "Baqa al-Gharbiyye", "Бака-эль-Гарбия", "باقة الغربية"],
    ["כפר קאסם", "Kafr Qasim", "Кафр-Касем", "كفر قاسم"], ["טירה", "Tira", "Тира", "الطيرة"]
  ];
  function ckey(s) { return String(s || "").toLowerCase().replace(/[\s\-־'"״׳`’.]/g, ""); }
  var CITY_INDEX = {};
  CITIES.forEach(function (row) { row.forEach(function (n) { CITY_INDEX[ckey(n)] = row; }); });
  CITY_INDEX[ckey("תל אביב")] = CITY_INDEX[ckey("תל אביב-יפו")];
  CITY_INDEX[ckey("Tel Aviv")] = CITY_INDEX[ckey("תל אביב-יפו")];
  CITY_INDEX[ckey("Тель-Авив")] = CITY_INDEX[ckey("תל אביב-יפו")];
  CITY_INDEX[ckey("تل أبيب")] = CITY_INDEX[ckey("תל אביב-יפו")];
  function canonCity(s) { var r = CITY_INDEX[ckey(s)]; return r ? r[0] : String(s || "").trim(); }
  function cityName(s, lang) { var r = CITY_INDEX[ckey(s)]; if (!r) return String(s || "").trim(); return r[Math.max(0, LANGS.indexOf(lang))]; }
  function cityList(lang) { var i = Math.max(0, LANGS.indexOf(lang)); return CITIES.map(function (r) { return r[i]; }); }

  // ---------- מותגים ----------
  var BRANDS = {
    "בזק": ["Bezeq", "Безек", "بيزك"], "HOT": ["HOT", "HOT", "HOT"], "פרטנר": ["Partner", "Партнер", "بارتنر"],
    "סלקום": ["Cellcom", "Селком", "سيلكوم"], "yes": ["yes", "yes", "yes"], "פלאפון": ["Pelephone", "Пелефон", "بيليفون"],
    "הוט מובייל": ["Hot Mobile", "Хот Мобайл", "هوت موبايل"], "גולן טלקום": ["Golan Telecom", "Голан Телеком", "جولان تيليكوم"],
    "כללית": ["Clalit", "Клалит", "كلاليت"], "מכבי": ["Maccabi", "Маккаби", "مكابي"], "מאוחדת": ["Meuhedet", "Меухедет", "مئوحيدت"],
    "לאומית": ["Leumit", "Леумит", "لئوميت"], "אמישראגז": ["Amisragas", "Амисрагаз", "أميسراغاز"], "פזגז": ["Pazgas", "Пазгаз", "بازغاز"],
    "סופרגז": ["Supergas", "Супергаз", "سوبرغاز"]
  };
  function brand(name, lang) {
    if (name === "אחר") return T(lang, "c.yourCompany");
    var b = BRANDS[name]; var i = LANGS.indexOf(lang);
    return (b && i > 0) ? b[i - 1] : name;
  }

  // ---------- עזרים ----------
  function g(q) { return "https://www.google.com/search?q=" + encodeURIComponent(q); }
  function addr(d, p) {
    var s = d[p + "Street"], n = d[p + "Num"], a = d[p + "Apt"], c = d[p + "City"];
    if (!s && !c) return "";
    return [s && (s + " " + (n || "")).trim(), a && ("דירה " + a), c && canonCity(c)].filter(Boolean).join(", ");
  }
  // כתובת לתצוגה בשפת הלקוח
  function addrL(d, p, lang) {
    var s = d[p + "Street"], n = d[p + "Num"], a = d[p + "Apt"], c = d[p + "City"];
    if (!s && !c) return "";
    // כל חלק עטוף בבידוד כיווני, כדי שרחוב באותיות לועזיות לא ישבש את הסדר בעברית ובערבית
    return [s && (s + " " + (n || "")).trim(), a && T(lang, "c.apt", { n: a }), c && cityName(c, lang)].filter(Boolean)
      .map(function (x) { return "\u2068" + x + "\u2069"; }).join(lang === "ar" ? "، " : ", ");
  }
  function fmtDate(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
    var p = v.split("-"); return p[2] + "." + p[1] + "." + p[0];
  }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }

  // ---------- בדיקות תקינות ----------
  // תעודת זהות ישראלית: 9 ספרות כולל ספרת ביקורת
  function validTz(v) {
    var s = digits(v);
    if (s.length < 5 || s.length > 9) return false;
    s = s.padStart(9, "0");
    var sum = 0;
    for (var i = 0; i < 9; i++) {
      var x = Number(s[i]) * ((i % 2) + 1);
      sum += x > 9 ? x - 9 : x;
    }
    return sum % 10 === 0;
  }
  function validPhone(v) { var s = digits(v); return /^0\d{8,9}$/.test(s); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); }
  function validZip(v) { return /^\d{7}$/.test(digits(v)); }
  function validDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
    var t = new Date(v + "T12:00:00").getTime(), now = Date.now(), day = 864e5;
    return !isNaN(t) && t > now - 365 * day && t < now + 730 * day;
  }

  // ---------- הגופים ----------
  var sites = {
    "בזק": "https://www.bezeq.co.il", "HOT": "https://www.hot.net.il", "פרטנר": "https://www.partner.co.il",
    "סלקום": "https://www.cellcom.co.il", "yes": "https://www.yes.co.il", "פלאפון": "https://www.pelephone.co.il",
    "כללית": "https://www.clalit.co.il", "מכבי": "https://www.maccabi4u.co.il", "מאוחדת": "https://www.meuhedet.co.il",
    "לאומית": "https://www.leumit.co.il", "אמישראגז": "https://www.amisragas.co.il", "פזגז": "https://www.pazgas.co.il",
    "סופרגז": "https://www.supergas.co.il"
  };
  function site(name, q) { return name === "אחר" ? g("עדכון כתובת " + q) : (sites[name] || g(name + " " + q)); }

  function groups(lang) {
    return [
      { id: "gov", title: T(lang, "c.g.gov"), note: T(lang, "c.g.govNote") },
      { id: "infra", title: T(lang, "c.g.infra"), note: T(lang, "c.g.infraNote") },
      { id: "tel", title: T(lang, "c.g.tel"), note: "" },
      { id: "fin", title: T(lang, "c.g.fin"), note: "" },
      { id: "other", title: T(lang, "c.g.other"), note: "" }
    ];
  }
  var LABEL_KEYS = ["tz", "newStreet", "newCity", "moveDate", "elecContract", "elecMeter", "elecRead", "waterMeter", "waterRead", "landlord", "oldStreet", "oldCity", "gasRead"];
  function labels(lang) { var o = {}; LABEL_KEYS.forEach(function (k) { o[k] = T(lang, "c.l." + k); }); return o; }

  /**
   * בונה את רשימת העדכונים ללקוח.
   * opts.lang — שפת התצוגה (ברירת מחדל: עברית). opts.hideId — לא לכלול ת״ז בנוסחים (למשל במייל).
   */
  function build(d, opts) {
    opts = opts || {};
    var lang = opts.lang || "he";
    var t = function (k, v) { return T(lang, k, v); };
    var cityHe = canonCity(d.newCity) || "[העיר]", city = cityName(d.newCity, lang) || "—";
    var oldHe = canonCity(d.oldCity), oldL = cityName(d.oldCity, lang);
    var na = addr(d, "new") || "[הכתובת החדשה]";
    var date = fmtDate(d.moveDate) || "[תאריך]";
    var name = ((d.firstName || "") + " " + (d.lastName || "")).trim() || "[שם מלא]";
    var idPart = (!opts.hideId && d.tz) ? ", תעודת זהות " + d.tz : "";
    var base = "שלום, שמי " + name + idPart + ". עברתי דירה בתאריך " + date + ". הכתובת החדשה שלי: " + na +
      (d.zip ? ", מיקוד " + d.zip : "") + ". טלפון: " + (d.phone || "") + (d.email ? ". מייל: " + d.email : "") + ".";
    var L = [];
    function add(grp, o) { o.grp = grp; o.need = o.need || []; L.push(o); }

    // ממשלה
    add("gov", { id: "moin", key: true, t: t("c.moin.t"), d: t("c.moin.d"), when: t("w.moveDay"),
      url: "https://www.gov.il/he/service/changing_address", site: t("site.moin"), need: ["tz", "newStreet", "newCity", "moveDate"], msg: base });
    add("gov", { id: "mail", t: t("c.mail.t"), d: t("c.mail.d"), when: t("w.ifNeeded"),
      url: "https://www.gov.il/he/service/changing_mail_address", site: t("site.moin"), need: ["tz"], msg: base });
    add("gov", { id: "btl", t: t("c.btl.t"), d: t("c.btl.d"), auto: true, url: "https://www.btl.gov.il", site: t("site.btl"), msg: base });
    add("gov", { id: "tax", t: t("c.tax.t"), d: t("c.tax.d"), auto: true, url: "https://www.gov.il/he/departments/israel_tax_authority", site: t("site.tax"), msg: base });
    if (d.xCar) add("gov", { id: "car", t: t("c.car.t"), d: t("c.car.d"), auto: true,
      url: "https://www.gov.il/he/departments/ministry_of_transport_and_road_safety", site: t("site.mot"), msg: base });

    // תשתיות
    add("infra", { id: "elec", key: true, t: d.elecSupplier === "private" ? t("c.elec.tPrivate") : t("c.elec.t"), d: t("c.elec.d"),
      when: t("w.keyDay"), url: "https://www.iec.co.il/tenant/", site: t("site.iec"), need: ["elecContract", "elecMeter", "elecRead"],
      msg: base + " מספר חוזה: " + (d.elecContract || "—") + ". מספר מונה: " + (d.elecMeter || "—") + ". המספר במונה: " + (d.elecRead || "—") + "." });
    add("infra", { id: "water", key: true, t: t("c.water.t", { city: city }), d: t("c.water.d"),
      when: t("w.keyDay"), url: g("תאגיד מים " + cityHe + " העברת חשבון לדייר חדש"), site: t("site.waterSearch"), search: true,
      need: ["waterMeter", "waterRead"],
      msg: base + " מספר מונה מים: " + (d.waterMeter || "—") + ". המספר במונה: " + (d.waterRead || "—") + ". מספר האנשים בבית: " + (d.people || "—") + "." });
    add("infra", { id: "arnona", key: true, t: t("c.arnona.t", { city: city }),
      d: t("c.arnona.d") + (d.tenure === "rent" ? " " + t("c.arnona.dRent") : "") + " " + t("c.arnona.dBen"),
      when: t("w.weekAfter"), url: g("ארנונה עיריית " + cityHe + " דייר חדש העברת חשבון"), site: t("site.muniSearch"), search: true,
      need: d.tenure === "rent" ? ["landlord", "moveDate"] : ["moveDate"],
      msg: base + (d.tenure === "rent" ? " אני שוכר/ת את הדירה מ" + (d.landlord || "[שם בעל הדירה]") + ". מצורף חוזה השכירות." : " הדירה בבעלותי.") });
    add("infra", { id: "arnonaOld", t: oldL ? t("c.arnonaOld.tCity", { city: oldL }) : t("c.arnonaOld.t"), d: t("c.arnonaOld.d"),
      when: t("w.leaveDay"), url: g("ארנונה הודעה על עזיבת דירה עיריית " + (oldHe || "")), site: t("site.muniSearch"), search: true,
      need: ["oldStreet", "oldCity"],
      msg: "שלום, שמי " + name + idPart + ". עזבתי את הדירה ב" + (addr(d, "old") || "[הכתובת הקודמת]") + " בתאריך " + date + ". אבקש להפסיק את החיוב על שמי." });
    if (d.gas) {
      var central = d.gas === "central";
      add("infra", { id: "gas", t: central ? t("c.gas.tCentral") : t("c.gas.t", { name: brand(d.gas, lang) }),
        d: central ? t("c.gas.dCentral") : t("c.gas.d"), when: t("w.keyDay"),
        url: central ? "" : site(d.gas, "חברת גז מעבר דירה"), site: t("site.gas"), search: !central && !sites[d.gas],
        need: ["gasRead"], msg: base + " המספר במונה הגז: " + (d.gasRead || "—") + "." });
    }

    // תקשורת
    if (d.isp) add("tel", { id: "isp", t: t("c.isp.t", { name: brand(d.isp, lang) }), d: t("c.isp.d"), when: t("w.twoWeeksBefore"),
      url: site(d.isp, "ספק אינטרנט מעבר דירה"), site: t("site.of", { name: brand(d.isp, lang) }), search: !sites[d.isp],
      msg: base + " אבקש להעביר את האינטרנט לכתובת החדשה ולקבוע טכנאי." });
    if (d.tv && d.tv !== d.isp) add("tel", { id: "tv", t: t("c.tv.t", { name: brand(d.tv, lang) }), d: t("c.tv.d"), when: t("w.twoWeeksBefore"),
      url: site(d.tv, "חברת טלוויזיה מעבר דירה"), site: t("site.of", { name: brand(d.tv, lang) }), search: !sites[d.tv],
      msg: base + " אבקש להעביר את שירות הטלוויזיה לכתובת החדשה." });
    if (d.mobile) add("tel", { id: "mobile", t: t("c.mobile.t", { name: brand(d.mobile, lang) }), d: t("c.mobile.d"), when: t("w.weekAfter"),
      url: site(d.mobile, "חברת סלולר"), site: t("site.of", { name: brand(d.mobile, lang) }), search: !sites[d.mobile],
      msg: base + " אבקש לעדכן את הכתובת בחשבון שלי." });

    // כסף ובריאות
    if (d.hmo) add("fin", { id: "hmo", t: t("c.hmo.t", { name: brand(d.hmo, lang) }), d: t("c.hmo.d"), when: t("w.weekAfter"),
      url: site(d.hmo, "עדכון כתובת"), site: t("site.of", { name: brand(d.hmo, lang) }),
      msg: base + " אבקש לעדכן את הכתובת ולעבור למרפאה קרובה לבית החדש." });
    if (d.bank) add("fin", { id: "bank", t: t("c.bank.t", { name: d.bank }), d: t("c.bank.d"), when: t("w.weekAfter"),
      url: g("בנק " + d.bank + " עדכון כתובת"), site: t("site.bankSearch"), search: true, msg: base });
    if (d.card) add("fin", { id: "card", t: t("c.card.t", { name: d.card }), d: t("c.card.d"), when: t("w.weekAfter"),
      url: g(d.card + " עדכון כתובת"), site: t("site.cardSearch"), search: true, msg: base });
    if (d.xInsurance) add("fin", { id: "ins", t: t("c.ins.t"), d: t("c.ins.d"), when: t("w.beforeMove"),
      url: g("עדכון כתובת נכס בביטוח דירה"), site: t("site.search"), search: true, msg: base + " אבקש לעדכן את כתובת הדירה המבוטחת." });
    if (d.xPension) add("fin", { id: "pension", t: t("c.pension.t"), d: t("c.pension.d"), when: t("w.monthAfter"),
      url: g("הר הכסף משרד האוצר"), site: t("site.harHakesef"), search: true, msg: base });

    // עוד
    if (d.xPost) add("other", { id: "post", t: t("c.post.t"), d: t("c.post.d"), when: t("w.weekBefore"),
      url: "https://doar.israelpost.co.il/content/follow-up-post", site: t("site.post"), need: ["oldStreet", "oldCity"], msg: base + " הכתובת הקודמת: " + (addr(d, "old") || "—") + "." });
    if (d.xKids || d.kidsSchool) add("other", { id: "kids", t: t("c.kids.t", { city: city }), d: t("c.kids.d"), when: t("w.asap"),
      url: g("רישום לגנים ובתי ספר עיריית " + cityHe + " עוברים דירה"), site: t("site.muniSearch"), search: true, msg: base });
    if (d.xEmployer) add("other", { id: "emp", t: t("c.emp.t"), d: t("c.emp.d"), when: t("w.weekAfter"), url: "", msg: base });
    add("other", { id: "vaad", t: t("c.vaad.t"), d: t("c.vaad.d"), when: t("w.weekAfter"), url: "",
      msg: "שלום, שמי " + name + ". אני עובר/ת לדירה " + (d.newApt || "") + " בתאריך " + date + ". הטלפון שלי: " + (d.phone || "") + "." });
    return L;
  }

  // ---------- הנחות וזכאויות ----------
  var KZ = "https://www.kolzchut.org.il/he/";
  var KZ_ARNONA = KZ + encodeURIComponent("ארנונה");
  var KZ_ELEC = KZ + encodeURIComponent("חשמל");
  var KZ_PERIPHERY = KZ + encodeURIComponent("זיכוי_ממס_הכנסה_לתושבים_בפריפריה");
  var DAYCARE = "https://www.gov.il/he/service/daycare-center-parents-request-degree-of-subsidy";

  function benefitCats(lang) {
    return [
      { id: "arnona", title: T(lang, "c.bc.arnona"), note: T(lang, "c.bc.arnonaNote") },
      { id: "elec", title: T(lang, "c.bc.elec"), note: "" },
      { id: "water", title: T(lang, "c.bc.water"), note: "" },
      { id: "kids", title: T(lang, "c.bc.kids"), note: "" },
      { id: "tax", title: T(lang, "c.bc.tax"), note: "" },
      { id: "save", title: T(lang, "c.bc.save"), note: T(lang, "c.bc.saveNote") }
    ];
  }

  // שיעורי ההנחה לפי תקנות ההסדרים במשק המדינה (הנחה מארנונה), תשנ"ג-1993, ומדריך משרד הפנים.
  // "עד" = השיעור המרבי. חלק מההנחות הן חובה, וחלק תלויות בהחלטת העירייה. הטקסטים: c.ar.<f>.t / .area, מסמכים: c.doc.*
  var ARNONA = [
    { f: "seniorSupp", pct: 100, area: true, docs: ["btlSupp"] },
    { f: "soldier", pct: 100, area: true, docs: ["idfService"], must: true },
    { f: "blind", pct: 90, docs: ["blind"] },
    { f: "oleh", pct: 90, area: true, docs: ["oleh"] },
    { f: "lowIncome", pct: 90, area: true, docs: ["payslips", "incomeProof"], from: 40 },
    { f: "disability75", pct: 80, docs: ["btlDisability"] },
    { f: "nursing", pct: 70, docs: ["btlNursing"] },
    { f: "idf", pct: 66, area: true, docs: ["mod"], must: true },
    { f: "bereaved", pct: 66, area: true, docs: ["mod"] },
    { f: "holocaust", pct: 66, area: true, docs: ["holocaust"] },
    { f: "disability90", pct: 40, docs: ["medical"] },
    { f: "kidDisability", pct: 33, area: true, docs: ["btlKid"] },
    { f: "senior", pct: 25, area: true, docs: ["senior"] },
    { f: "singleParent", pct: 20, docs: ["singleParent"] },
    { f: "reservist", pct: 5, area: true, docs: ["reservist"] }
  ];
  var ELEC_WHO = ["seniorSupp", "lowIncome", "kidDisability", "nursing", "idf", "holocaust", "soldier"];

  /**
   * מחזיר את ההנחות שהלקוח כנראה זכאי להן, לפי מה שסימן.
   * sure: "likely" = כנראה מגיע לכם; "check" = כדאי לבדוק. msg (נוסח הבקשה) תמיד בעברית.
   */
  function benefits(d, opts) {
    opts = opts || {};
    var lang = opts.lang || "he";
    var t = function (k, v) { return T(lang, k, v); };
    var cityHe = canonCity(d.newCity) || "[העיר]", city = cityName(d.newCity, lang) || "—";
    var name = ((d.firstName || "") + " " + (d.lastName || "")).trim() || "[שם מלא]";
    var idPart = (!opts.hideId && d.tz) ? ", תעודת זהות " + d.tz : "";
    var na = addr(d, "new") || "[הכתובת החדשה]", date = fmtDate(d.moveDate) || "[תאריך]";
    var B = [];
    function add(o) { o.docs = o.docs || []; B.push(o); }

    // ארנונה
    var ar = ARNONA.filter(function (a) { return d[a.f]; });
    ar.forEach(function (a, i) {
      var area = a.area ? t("c.ar." + a.f + ".area") : "";
      add({ id: "ar-" + a.f, cat: "arnona", best: i === 0, sure: "likely",
        t: t("c.ar." + a.f + ".t"), amount: a.from ? t("c.amt.range", { a: a.from, b: a.pct }) : t("c.amt.upTo", { p: a.pct }),
        d: t("c.ar.d", { city: city }) + (area ? " " + area + "." : "") + " " + t(a.must ? "c.ar.must" : "c.ar.may") + " " + t("c.ar.notTransfer"),
        how: t("c.ar.how"),
        docs: a.docs.map(function (k) { return t("c.doc." + k); }).concat([t("c.doc.idAppendix"), d.tenure === "rent" ? t("c.doc.lease") : t("c.doc.deed")]),
        url: g("הנחה בארנונה עיריית " + cityHe + " טופס בקשה"), site: t("site.muniSearch"), search: true, info: KZ_ARNONA,
        msg: "שלום, שמי " + name + idPart + ". עברתי לגור ב" + na + " בתאריך " + date + ". אבקש הנחה בארנונה בגלל: " + T("he", "c.ar." + a.f + ".t") + ". מצורפים המסמכים." });
    });
    if (d.student) add({ id: "ar-student", cat: "arnona", sure: "check", t: t("c.ar.student.t"), amount: t("c.amt.city"),
      d: t("c.ar.student.d", { city: city }), how: t("c.ar.student.how"), docs: [t("c.doc.study")],
      url: g("הנחה בארנונה סטודנטים עיריית " + cityHe), site: t("site.search"), search: true, msg: "" });

    // חשמל: 50% על 400 קוט״ש ראשונים בחודש, לפי רשימות שביטוח לאומי מעביר לחברת החשמל
    var who = ELEC_WHO.filter(function (k) { return d[k]; });
    if (who.length) add({ id: "elec-disc", cat: "elec", sure: "likely", t: t("c.el.t"), amount: t("c.amt.elec"),
      d: t("c.el.d", { who: who.map(function (k) { return t("c.elw." + k); }).join(", ") }),
      how: t("c.el.how"), docs: [t("c.doc.eligibility")], url: "https://www.iec.co.il/tenant/", site: t("site.iec"), info: KZ_ELEC,
      msg: "שלום, שמי " + name + idPart + ". עברתי ל" + na + " בתאריך " + date + ". אני זכאי/ת להנחה בחשבון החשמל (" +
        who.map(function (k) { return T("he", "c.elw." + k); }).join(", ") + "). אבקש לוודא שההנחה עוברת לחוזה החדש." });

    // מים
    var people = parseInt(d.people, 10) || 0;
    add({ id: "water-people", cat: "water", sure: "likely", t: t("c.wa.t"), amount: people ? t("c.amt.waterN", { n: people }) : t("c.amt.water"),
      d: t("c.wa.d"), how: t("c.wa.how"), docs: [t("c.doc.appendixAll")],
      url: g("תאגיד מים " + cityHe + " עדכון מספר נפשות"), site: t("site.waterSearch"), search: true,
      msg: "שלום, שמי " + name + idPart + ". בנכס ב" + na + " גרים " + (people || "[מספר]") + " אנשים. אבקש לעדכן את מספר האנשים לחישוב התעריף המוזל. מצורפים ספחי תעודות הזהות." });
    if (d.disability75 || d.disability90 || d.nursing || d.kidDisability) add({ id: "water-medical", cat: "water", sure: "check", t: t("c.wm.t"),
      amount: t("c.amt.condition"), d: t("c.wm.d"), how: t("c.wm.how"), docs: [t("c.doc.medicalOrBtl")],
      url: g("תאגיד מים " + cityHe + " הקצאה נוספת אוכלוסיות מיוחדות"), site: t("site.search"), search: true, msg: "" });

    // ילדים
    if (d.kidsUnder3) add({ id: "kids-daycare", cat: "kids", sure: "check", t: t("c.kd.t"), amount: t("c.amt.daycare"),
      d: t("c.kd.d"), how: t("c.kd.how"), docs: [t("c.doc.payslipsParents"), t("c.doc.daycareReg")], url: DAYCARE, site: t("site.labor"), msg: "" });
    if (parseInt(d.kidsCount, 10) > 0 && !d.kidsSchool && !d.kidsUnder3) add({ id: "kids-register", cat: "kids", sure: "check", t: t("c.kr.t"), amount: "",
      d: t("c.kr.d"), how: t("c.kr.how"), docs: [], url: g("רישום לגנים ובתי ספר עיריית " + cityHe), site: t("site.search"), search: true, msg: "" });

    // מס הכנסה
    add({ id: "tax-periphery", cat: "tax", sure: "check", t: t("c.tx.t"), amount: t("c.amt.settlement"),
      d: t("c.tx.d", { city: city }), how: t("c.tx.how"), docs: [t("c.doc.residency")], url: KZ_PERIPHERY, site: t("site.kz"), msg: "" });

    // חיסכון כללי — לכולם
    add({ id: "save-arnona-annual", cat: "save", sure: "check", t: t("c.sa.t"), amount: t("c.amt.annual"), d: t("c.sa.d"), how: t("c.sa.how"),
      docs: [], url: g("ארנונה תשלום מראש הנחה עיריית " + cityHe), site: t("site.search"), search: true, msg: "" });
    add({ id: "save-elec-supplier", cat: "save", sure: "check", t: t("c.se.t"), amount: t("c.amt.supplier"), d: t("c.se.d"), how: t("c.se.how"),
      docs: [], url: g("השוואת ספקי חשמל פרטיים מסלולים"), site: t("site.compare"), search: true, msg: "" });
    if (d.isp || d.tv || d.mobile) add({ id: "save-comms", cat: "save", sure: "check", t: t("c.sc.t"), amount: t("c.amt.negotiate"), d: t("c.sc.d"), how: t("c.sc.how"),
      docs: [], url: "", msg: "שלום, אני עובר/ת דירה ושוקל/ת להחליף ספק. אשמח להצעה משופרת לפני שאני מחליט/ה." });
    if (d.xInsurance) add({ id: "save-insurance", cat: "save", sure: "check", t: t("c.si.t"), amount: t("c.amt.home"), d: t("c.si.d"), how: t("c.si.how"),
      docs: [], url: "", msg: "" });
    return B;
  }

  // תוויות למסך הניהול (עברית בלבד)
  var householdLabels = {
    kidsUnder3: "ילד עד גיל 3", kidsSchool: "ילדים בגן או בבית ספר", singleParent: "הורה יחיד", kidDisability: "ילד עם גמלת ילד נכה",
    senior: "אזרח ותיק", seniorSupp: "קצבת זקנה עם השלמת הכנסה", nursing: "גמלת סיעוד", disability75: "נכות כללית 75% ומעלה",
    disability90: "נכות רפואית 90% ומעלה", blind: "תעודת עיוור", idf: "נכה צה״ל / כוחות הביטחון / נפגע איבה", bereaved: "משפחה שכולה",
    holocaust: "ניצול שואה", reservist: "מילואים פעיל", soldier: "חייל בודד / שירות לאומי", oleh: "עולה חדש", lowIncome: "הכנסה נמוכה", student: "סטודנט"
  };
  var LANG_NAMES_HE = { he: "עברית", en: "אנגלית", ru: "רוסית", ar: "ערבית" };

  // ---------- פרטים שאפשר להשלים אחר כך ----------
  // רק פרטים לא רגישים, שבדרך כלל חסרים ברגע המילוי (מונים, הכתובת הישנה). אפשר לעדכן אותם גם אחרי השליחה.
  var LATER = ["elecContract", "elecMeter", "elecRead", "waterMeter", "waterRead", "gasRead", "landlord", "oldStreet", "oldCity"];
  function missing(d) {
    var seen = {}, out = [];
    build(d).forEach(function (i) {
      i.need.forEach(function (k) { if (LATER.indexOf(k) >= 0 && !d[k] && !seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out;
  }

  // ---------- תיאום שיחה עם נציג של גוף ----------
  // גופים שיש להם מוקד טלפוני. נציג שלנו ממתין על הקו, ומחבר את הלקוח כשעונים.
  var CALL_IDS = ["moin", "btl", "tax", "elec", "water", "arnona", "arnonaOld", "gas", "isp", "tv", "mobile", "hmo", "bank", "card", "ins", "pension"];
  var SLOTS = ["8-10", "10-12", "12-14", "14-16", "16-18"];
  // ימים א׳–ה׳, ממחר ועד 30 יום קדימה
  function validCallDay(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
    var t = new Date(v + "T12:00:00Z"), today = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z");
    var diff = Math.round((t - today) / 864e5), wd = t.getUTCDay();
    return !isNaN(diff) && diff >= 1 && diff <= 30 && wd !== 5 && wd !== 6;
  }
  function nextCallDay() {
    for (var i = 1; i < 8; i++) {
      var s = new Date(Date.now() + i * 864e5).toISOString().slice(0, 10);
      if (validCallDay(s)) return s;
    }
    return "";
  }

  // ---------- ערכת אריזה ----------
  // הערכה לפי מספר חדרים בדירה שיוצאים ממנה. מבוסס על מה שמובילים ממליצים בדרך כלל: 10–12 קרטונים לחדר.
  var KIT = ["kBoxes", "kBigBoxes", "kWardrobe", "kBubble", "kTape", "kStretch"];
  function kitFor(rooms) {
    var r = Math.min(6, Math.max(1, parseInt(rooms, 10) || 0));
    if (!parseInt(rooms, 10)) return null;
    var boxes = 8 + 11 * r;
    return { kBoxes: boxes, kBigBoxes: 2 + 2 * r, kWardrobe: Math.ceil(r / 2), kBubble: r <= 2 ? 1 : r <= 4 ? 2 : 3,
      kTape: Math.ceil(boxes / 12) + 1, kStretch: r <= 2 ? 1 : 2 };
  }
  // השורות בפועל: מה שהמשתמש השאיר או שינה בטופס (0 = לא צריך)
  function kitLines(d, lang) {
    var auto = kitFor(d.rooms) || {};
    return KIT.map(function (k) {
      var v = d[k] === "" || d[k] == null ? auto[k] : parseInt(d[k], 10);
      return { id: k, qty: v || 0, name: T(lang || "he", "kit." + k) };
    }).filter(function (x) { return x.qty > 0; });
  }
  function kitText(d, lang) {
    return kitLines(d, lang).map(function (x) { return "• " + x.name + ": " + x.qty; }).join("\n");
  }
  // תאריך משלוח מומלץ: 5 ימים לפני המעבר, ולא לפני מחרתיים
  function suppliesDefaultDate(moveDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate || "")) return "";
    var day = 864e5, mt = new Date(moveDate + "T12:00:00").getTime(), min = Date.now() + 2 * day;
    if (isNaN(mt)) return "";
    return new Date(Math.min(Math.max(mt - 5 * day, min), mt)).toISOString().slice(0, 10);
  }

  // כל המזהים האפשריים — לאימות בשרת
  var allIds = ["moin", "mail", "btl", "tax", "car", "elec", "water", "arnona", "arnonaOld", "gas", "isp", "tv", "mobile", "hmo", "bank", "card", "ins", "pension", "post", "kids", "emp", "vaad"];

  root.MoversCatalog = {
    T: T, LANGS: LANGS, RTL: RTL, LANG_NAMES_HE: LANG_NAMES_HE,
    build: build, benefits: benefits, householdLabels: householdLabels, benefitCats: benefitCats, groups: groups, labels: labels,
    addr: addr, addrL: addrL, fmtDate: fmtDate, allIds: allIds, canonCity: canonCity, cityName: cityName, cityList: cityList, brand: brand,
    validTz: validTz, validPhone: validPhone, validEmail: validEmail, validZip: validZip, validDate: validDate, digits: digits, ltrNums: ltrNums,
    LATER: LATER, missing: missing, CALL_IDS: CALL_IDS, SLOTS: SLOTS, validCallDay: validCallDay, nextCallDay: nextCallDay, KIT: KIT, kitFor: kitFor, kitLines: kitLines, kitText: kitText, suppliesDefaultDate: suppliesDefaultDate
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
