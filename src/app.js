(function () {
  "use strict";
  var C = globalThis.MoversCatalog;
  var CFG = globalThis.MOVERS_CONFIG || {};
  var SITE = globalThis.MOVERS_SITE || {};
  var API = CFG.api || "";               // אם מוגדר — מצב אתר אמיתי: שליחה לשרת
  var $ = function (id) { return document.getElementById(id); };
  var app = $("app");

  // ---------- שפה ----------
  var LANG_KEY = "avarnu-lang";
  function detectLang() {
    var m = location.pathname.match(/^\/(he|en|ru|ar)(\/|$)/); if (m) return m[1];
    var h = location.hash.replace("#", ""); if (C.LANGS.indexOf(h) >= 0) return h;
    try { var s = localStorage.getItem(LANG_KEY); if (C.LANGS.indexOf(s) >= 0) return s; } catch (e) {}
    // זיהוי אוטומטי רק לרוסית ולערבית. דפדפן באנגלית נשאר בעברית — הרבה ישראלים משתמשים בדפדפן באנגלית.
    var navs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < navs.length; i++) {
      var x = String(navs[i]).slice(0, 2).toLowerCase();
      if (x === "he" || x === "iw") return "he";
      if (x === "ru" || x === "ar") return x;
    }
    return "he";
  }
  var LANG = detectLang();
  function t(k, v) { return C.T(LANG, k, v); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- הגדרת השלבים (נבנית מחדש בכל החלפת שפה) ----------
  var MOVERS_ON = !!(CFG.movers || CFG.demo);
  var PAY = (CFG.payments && CFG.payments.enabled) ? CFG.payments : null;
  var SUP_ORDER = !!(CFG.supplies || CFG.demo);
  var CALL_ON = !!(CFG.callbacks || CFG.demo);      // תיאום שיחה עם נציג (נציג שלנו ממתין על הקו)   // הזמנת קרטונים עם משלוח (צריך ספק פעיל בשרת)
  function wantsQuotes(d) { return d.moveStatus === "quotes"; }
  function needsKit(d) { return d.supplies === "need"; }
  function wantsDelivery(d) { return needsKit(d) && d.suppliesFrom === "delivery"; }
  function opts(ids, prefix) { return ids.map(function (x) { return [x, t(prefix + x)]; }); }
  function brands(list) { return [["", t("none")]].concat(list.map(function (x) { return [x, x === "אחר" ? t("o.other") : C.brand(x, LANG)]; })); }
  function priceTag(n) { return PAY ? " " + (n > 0 ? t("price.n", { n: n }) : t("price.free")) : ""; }

  function defineSteps() {
    var S = [
      { id: "personal", fields: [
        { id: "firstName", req: true, w: 3, auto: "given-name" },
        { id: "lastName", req: true, w: 3, auto: "family-name" },
        { id: "tz", req: true, w: 3, mode: "numeric", max: 9, auto: "off", ltr: true, hint: API ? "f.tz.hApi" : "f.tz.h", check: "tz" },
        { id: "phone", req: true, w: 3, type: "tel", auto: "tel", ltr: true, check: "phone", hint: "f.phone.h" },
        { id: "email", w: 6, type: "email", auto: "email", ltr: true, check: "email", hint: API ? "f.email.hApi" : "" },
        { id: "tenure", type: "radio", req: true, w: 6, def: "rent", opts: opts(["rent", "own"], "o.tenure.") }
      ]},
      { id: "household", fields: [
        { id: "people", w: 3, mode: "numeric", max: 2, def: "1", ltr: true, hint: "f.people.h" },
        { id: "kidsCount", w: 3, mode: "numeric", max: 2, def: "0", ltr: true },
        { id: "kidsChecks", type: "checks", w: 6, opts: opts(["kidsUnder3", "kidsSchool", "singleParent", "kidDisability"], "o.") },
        { id: "eligChecks", type: "checks", w: 6, hint: "f.eligChecks.h", opts: opts(["senior", "seniorSupp", "nursing", "disability75", "disability90", "blind",
          "idf", "bereaved", "holocaust", "reservist", "soldier", "oleh", "lowIncome", "student"], "o.") }
      ]},
      { id: "address", fields: [
        // קודם עיר, ואז רחוב מתוך הרשימה הרשמית של אותה עיר
        { group: "g.newAddr", map: "new", fields: [
          { id: "newCity", req: true, w: 4, list: "cities", auto: "address-level2" },
          { id: "newStreet", req: true, w: 4, list: "st-new", auto: "off", note: true },
          { id: "newNum", req: true, w: 2, auto: "off" },
          { id: "newApt", w: 2, mode: "numeric" },
          { id: "zip", w: 3, mode: "numeric", max: 7, auto: "postal-code", ltr: true, check: "zip", hint: "f.zip.h", link: ["f.zip.find", ZIP_URL] },
          { id: "floor", w: 3, mode: "numeric", max: 3 }
        ]},
        { group: "g.oldAddr", hint: "g.oldAddr.h", map: "old", fields: [
          { id: "oldCity", w: 4, list: "cities" }, { id: "oldStreet", w: 6, list: "st-old", auto: "off", note: true }, { id: "oldApt", w: 2, mode: "numeric" }
        ]},
        { id: "moveDate", req: true, w: 3, type: "date", check: "date" },
        { id: "landlord", w: 3, hint: "f.landlord.h", showIf: function (d) { return d.tenure === "rent"; } }
      ]},
      { id: "moving", fields: (MOVERS_ON ? [
        { id: "moveStatus", type: "radio", req: true, w: 6, opts: opts(["quotes", "booked", "self"], "o.moveStatus.") },
        { id: "oldFloor", w: 3, mode: "numeric", max: 2, hint: "f.oldFloor.h", showIf: wantsQuotes },
        { id: "elevChecks", type: "checks", w: 3, showIf: wantsQuotes, opts: opts(["oldElevator", "newElevator"], "o.") },
        { id: "dateFlex", type: "radio", w: 6, def: "exact", showIf: wantsQuotes, opts: opts(["exact", "flex"], "o.dateFlex.") },
        { id: "moveExtras", type: "checks", w: 6, showIf: wantsQuotes, opts: opts(["packing", "assembly", "storage"], "o.") },
        { id: "specialItems", w: 6, max: 120, hint: "f.specialItems.h", showIf: wantsQuotes }
      ] : []).concat([
        { id: "supplies", type: "radio", w: 6, def: "none", opts: opts(["none", "need"], "o.supplies.") },
        { id: "rooms", type: "select", req: true, w: 3, showIf: function (d) { return wantsQuotes(d) || needsKit(d); },
          opts: [["", t("choose")], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", t("o.rooms.6")]] },
        { group: "g.kit", gid: "kit", hint: "g.kit.h", showIf: needsKit, fields: C.KIT.map(function (k) {
          return { id: k, w: 2, mode: "numeric", max: 3, ltr: true, check: "qty", showIf: needsKit };
        }) },
        { id: "suppliesFrom", type: "radio", w: 6, def: SUP_ORDER ? "delivery" : "self", showIf: needsKit,
          opts: opts([MOVERS_ON && "movers", SUP_ORDER && "delivery", "self"].filter(Boolean), "o.suppliesFrom.") },
        { id: "suppliesDate", type: "date", req: true, w: 3, check: "date", hint: "f.suppliesDate.h", showIf: wantsDelivery },
        { id: "suppliesTo", type: "radio", w: 3, def: "old", showIf: wantsDelivery, opts: opts(["old", "new"], "o.suppliesTo.") },
        { id: "suppliesConsent", type: "consent", req: true, w: 6, showIf: wantsDelivery, note: LANG !== "he" ? "f.suppliesConsent.lang" : "" }
      ]).concat(MOVERS_ON ? [
        { id: "moversConsent", type: "consent", req: true, w: 6, showIf: wantsQuotes, note: LANG !== "he" ? "f.moversConsent.lang" : "" }
      ] : [])},
      { id: "meters", fields: [
        { group: "g.elec", fields: [
          { id: "elecContract", w: 3, mode: "numeric", ltr: true, hint: "f.elecContract.h" },
          { id: "elecMeter", w: 3, mode: "numeric", ltr: true, hint: "f.elecMeter.h" },
          { id: "elecRead", w: 3, mode: "numeric", ltr: true, hint: "f.elecRead.h" },
          { id: "elecSupplier", type: "select", w: 3, opts: opts(["iec", "private"], "o.elecSupplier.") }
        ]},
        { group: "g.water", fields: [
          { id: "waterMeter", w: 3, mode: "numeric", ltr: true },
          { id: "waterRead", w: 3, mode: "decimal", ltr: true, hint: "f.waterRead.h" }
        ]},
        { group: "g.gas", fields: [
          { id: "gas", type: "select", w: 3, opts: brands(["אמישראגז", "פזגז", "סופרגז"]).concat([["central", t("o.gas.central")], ["אחר", t("o.other")]]) },
          { id: "gasRead", w: 3, mode: "decimal", ltr: true }
        ]}
      ]},
      { id: "providers", fields: [
        { id: "isp", type: "select", w: 3, opts: brands(["בזק", "HOT", "פרטנר", "סלקום", "אחר"]) },
        { id: "tv", type: "select", w: 3, opts: brands(["yes", "HOT", "פרטנר", "סלקום", "אחר"]) },
        { id: "mobile", type: "select", w: 3, opts: brands(["פלאפון", "סלקום", "פרטנר", "הוט מובייל", "גולן טלקום", "אחר"]) },
        { id: "hmo", type: "select", w: 3, opts: brands(["כללית", "מכבי", "מאוחדת", "לאומית"]) },
        { id: "bank", w: 3, hint: "f.bank.h" },
        { id: "card", w: 3, hint: "f.card.h" },
        { id: "extras", type: "checks", w: 6, opts: opts(["xCar", "xInsurance", "xPension", "xEmployer", "xPost"], "o.") }
      ]}
    ];
    if (API) S.push({ id: "send", fields: [
      { id: "service", type: "radio", req: true, w: 6, def: "self", opts: [
        ["self", t("o.service.self") + priceTag(PAY && PAY.priceSelf)], ["concierge", t("o.service.concierge") + priceTag(PAY && PAY.priceConcierge)]] },
      { id: "consent", type: "consent", req: true, w: 6 },
      { id: "poa", type: "consent", req: true, w: 6, showIf: function (d) { return d.service === "concierge"; } },
      { id: "marketing", type: "consent", w: 6 }
    ]});
    return S;
  }
  var STEPS, LAST, allFields, fieldById, groupShows;

  function stepKey(s, part) { return "s." + s.id + (s.id === "moving" && !MOVERS_ON ? "Pack" : "") + "." + part; }
  function stepLead(s) {
    var l = t(stepKey(s, "lead"));
    if (s.id === "moving" && MOVERS_ON) l += " " + t("s.movingPack.lead");
    if (s.id === "moving" && CFG.moversPaid) l += " " + t("s.moving.paid");
    if (s.id === "send") {
      if (PAY) l += " " + t("s.send.payNote");
      var sl = (CFG.supportLangs || ["he"]).map(function (x) { return t("ln." + x); });
      if (LANG !== "he" || sl.length > 1) l += " " + t("s.send.support", { langs: sl.join(", ") });
    }
    return l;
  }

  // ---------- יצירת הטופס ----------
  function fieldHTML(f) {
    allFields.push(f); fieldById[f.id] = f;
    var label = t("f." + f.id);
    var w = "w" + (f.w || 6), hintId = f.id + "-hint", errId = f.id + "-err";
    var hintText = f.hint ? t(f.hint) : "";
    var desc = (hintText ? hintId + " " : "") + errId;
    var reqMark = f.req && f.type !== "consent" ? ' <span class="req">' + esc(t("req")) + "</span>" : "";
    var hint = hintText ? '<p class="hint" id="' + hintId + '">' + esc(hintText) +
      (f.link ? ' <a href="' + f.link[1] + '" target="_blank" rel="noopener">' + esc(t(f.link[0])) + ' <span class="sr">' + esc(t("newWin")) + "</span></a>" : "") + "</p>" : "";
    if (f.note) hint += '<p class="fnote" id="note-' + f.id + '" aria-live="polite"></p>';
    var err = '<p class="ferr" id="' + errId + '" hidden></p>';
    var wrapOpen = '<div class="field ' + w + '" id="wrap-' + f.id + '">';
    if (f.type === "radio" || f.type === "checks") {
      var inputs = f.opts.map(function (o) {
        var isChk = f.type === "checks";
        return '<label class="choice"><input type="' + (isChk ? "checkbox" : "radio") + '" ' +
          (isChk ? 'id="' + o[0] + '"' : 'name="' + f.id + '" id="' + f.id + "-" + o[0] + '" value="' + o[0] + '"') + '> ' + esc(o[1]) + "</label>";
      }).join("");
      return wrapOpen + '<fieldset class="choices" aria-describedby="' + desc + '"' + (f.type === "radio" ? ' role="radiogroup"' + (f.req ? ' aria-required="true"' : "") : "") +
        ' id="' + f.id + '-fs"><legend>' + esc(label) + reqMark + "</legend>" + inputs + "</fieldset>" + hint + err + "</div>";
    }
    if (f.type === "consent") {
      var note = f.note && t(f.note) ? ' <strong>' + esc(t(f.note)) + "</strong>" : "";
      return wrapOpen + '<label class="choice"><input type="checkbox" id="' + f.id + '"' + (f.req ? ' aria-required="true"' : "") + ' aria-describedby="' + desc + '"> <span>' + esc(label) + note +
        (f.id === "consent" ? ' <button type="button" class="quiet" data-open="dlgPrivacy">' + esc(t("f.consent.read")) + "</button>" : "") + "</span></label>" + err + "</div>";
    }
    var common = ' id="' + f.id + '" name="' + f.id + '" aria-describedby="' + desc + '"' + (f.req ? ' aria-required="true"' : "") +
      (f.auto ? ' autocomplete="' + f.auto + '"' : "") + (f.ltr ? ' dir="ltr"' : "");
    var control;
    if (f.type === "select") {
      control = "<select" + common + ">" + f.opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>";
    } else {
      control = '<input type="' + (f.type || "text") + '"' + common + (f.mode ? ' inputmode="' + f.mode + '"' : "") +
        (f.max ? ' maxlength="' + f.max + '"' : "") + (f.list ? ' list="' + f.list + '"' : "") + ">";
    }
    return wrapOpen + '<label for="' + f.id + '">' + esc(label) + reqMark + "</label>" + control + hint + err + "</div>";
  }
  function stepHTML(s, i) {
    var body = s.fields.map(function (f) {
      if (f.group) {
        if (f.showIf) groupShows.push(f);
        return '<fieldset class="group"' + (f.gid ? ' id="grp-' + f.gid + '"' : "") + '><legend>' + esc(t(f.group)) + "</legend>" + (f.hint ? '<p class="hint">' + esc(t(f.hint)) + "</p>" : "") +
          '<div class="grid">' + f.fields.map(fieldHTML).join("") + "</div>" +
          (f.map ? '<div class="maprow"><button type="button" class="quiet mapbtn" id="mapbtn-' + f.map + '" data-map="' + f.map + '" aria-expanded="false" aria-controls="map-' + f.map + '">' +
            '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg> ' + esc(t("addr.map")) +
            '</button><p class="fnote" id="mapmsg-' + f.map + '" aria-live="polite"></p><div class="mapbox" id="map-' + f.map + '" hidden></div></div>' : "") + "</fieldset>";
      }
      return fieldHTML(f);
    }).join("");
    return '<section class="panel" data-step="' + i + '" aria-labelledby="h-' + i + '" hidden><h2 id="h-' + i + '" tabindex="-1">' + esc(t(stepKey(s, "h"))) +
      '</h2><p class="lead">' + esc(stepLead(s)) + '</p><div class="grid">' + body + "</div></section>";
  }
  function buildForm(keep) {
    STEPS = defineSteps(); LAST = STEPS.length; allFields = []; fieldById = {}; groupShows = [];
    $("steps").innerHTML = STEPS.map(stepHTML).join("") +
      '<datalist id="cities">' + cityOptions() + "</datalist>" + '<datalist id="st-new"></datalist><datalist id="st-old"></datalist>';
    stLoaded = { new: null, old: null };
    if (keep) setData(keep);
    else {
      allFields.forEach(function (f) {
        if (f.def == null) return;
        if (f.type === "radio") { var r = $(f.id + "-" + f.def); if (r) r.checked = true; } else $(f.id).value = f.def;
      });
      if ($("xPost")) $("xPost").checked = true;
    }
  }

  // ---------- כתובת: ערים ורחובות מהרשימה הרשמית, מיקוד ומפה ----------
  var ZIP_URL = "https://israelpost.co.il/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99%D7%9D/%D7%90%D7%99%D7%AA%D7%95%D7%A8-%D7%9E%D7%99%D7%A7%D7%95%D7%93/";
  // בגרסת ההדגמה (בלי שרת) יש רק כמה רחובות לדוגמה. באתר עצמו הרשימה המלאה מגיעה מהשרת.
  var DEMO_STREETS = {
    "תל אביב": ["אבן גבירול", "אלנבי", "בוגרשוב", "בן יהודה", "דיזנגוף", "הירקון", "הרצל", "ויצמן", "ז'בוטינסקי", "יהודה הלוי", "נמיר", "קינג ג'ורג'", "רוטשילד"],
    "ירושלים": ["אגריפס", "בית לחם", "בן יהודה", "הנביאים", "הרצל", "יפו", "עזה", "עמק רפאים", "קינג ג'ורג'", "קרן היסוד"],
    "חיפה": ["אבא חושי", "הגפן", "הנביאים", "הרצל", "חורב", "מוריה"],
    "פתח תקווה": ["אחד העם", "ז'בוטינסקי", "חיים עוזר", "ילין", "קפלן", "רוטשילד"],
    "חולון": ["אילת", "גולדה מאיר", "הרצל", "ויצמן", "סוקולוב"]
  };
  var govCities = [], stCache = {}, stLoaded = { new: null, old: null }, stTimer = {};
  // מפתח להשוואה בלבד (לא מוצג): בלי ניקוד וסימנים, וכתיב מלא/חסר נחשב אותו דבר (תקוה = תקווה)
  function pkey(s) { return String(s || "").replace(/[֑-ׇ]/g, "").replace(/[״"׳'`\-–־().,]/g, " ").replace(/וו/g, "ו").replace(/יי/g, "י").replace(/\s+/g, " ").trim(); }
  function cityOptions() {
    var seen = {}, out = [];
    C.cityList(LANG).concat(govCities).forEach(function (c) { var k = pkey(c); if (c && !seen[k]) { seen[k] = 1; out.push('<option value="' + esc(c) + '"></option>'); } });
    return out.join("");
  }
  function loadCities() {
    if (!API || govCities.length || loadCities.busy) return;
    loadCities.busy = true;
    fetch(API.replace(/\/$/, "") + "/places/cities").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.cities) { govCities = j.cities; var dl = $("cities"); if (dl) dl.innerHTML = cityOptions(); }
    }).catch(function () {}).then(function () { loadCities.busy = false; });
  }
  function demoStreets(city) {
    var k = pkey(C.canonCity(city)), hit = null;
    Object.keys(DEMO_STREETS).forEach(function (c) { var ck = pkey(c); if (ck === k || k.indexOf(ck) === 0) hit = c; });
    return hit ? { city: hit, streets: DEMO_STREETS[hit] } : null;
  }
  function getStreets(city) {
    var k = pkey(city);
    if (!k) return Promise.resolve(null);
    if (k in stCache) return Promise.resolve(stCache[k]);
    var p = API
      ? fetch(API.replace(/\/$/, "") + "/places/streets?city=" + encodeURIComponent(city)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      : Promise.resolve(demoStreets(city));
    return p.then(function (j) { stCache[k] = j; return j; });
  }
  // מרחק עריכה קצר, בשביל "אולי התכוונתם ל..."
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function streetOnly(v, which) { return which === "old" ? String(v).replace(/[\s,]*\d+\s*[א-תa-z]?\s*$/i, "").trim() : String(v).trim(); }
  function suggest(v, list) {
    var k = pkey(v).replace(/^(רחוב|רח|שדרות|שד|דרך)\s+/, "");
    if (!k) return [];
    return list.map(function (s) {
      var sk = pkey(s), core = sk.replace(/^(רחוב|רח|שדרות|שד|דרך)\s+/, ""), score = lev(k, core);
      if (core.indexOf(k) >= 0 || k.indexOf(core) >= 0) score = Math.min(score, 1);
      return [score, s];
    }).filter(function (x) { return x[0] <= Math.max(1, Math.floor(k.length / 3)); })
      .sort(function (a, b) { return a[0] - b[0] || a[1].length - b[1].length; }).slice(0, 3).map(function (x) { return x[1]; });
  }
  // מעדכנים רק אם השתנה — אחרת לחיצה על הצעה (שגורמת ל-blur) מחליפה את הכפתור באמצע הלחיצה
  // וגם: לא משנים את הדף באמצע נגיעה/לחיצה (למשל על "המשך"), כדי שהכפתור לא יזוז מתחת לאצבע. מחכים שהלחיצה תסתיים.
  var tapping = false, pendingNotes = {}, pendingFns = [];
  document.addEventListener("pointerdown", function () { tapping = true; }, true);
  function endTap() {
    if (!tapping) return;
    setTimeout(function () {
      tapping = false;
      Object.keys(pendingNotes).forEach(function (id) { var n = pendingNotes[id]; delete pendingNotes[id]; note(id, n[0], n[1]); });
      pendingFns.splice(0).forEach(function (fn) { fn(); });
    }, 0);
  }
  document.addEventListener("pointerup", endTap, true); document.addEventListener("pointercancel", endTap, true);
  function afterTap(fn) { if (tapping) pendingFns.push(fn); else fn(); }
  function note(id, html, cls) {
    if (tapping) { pendingNotes[id] = [html, cls]; return; }
    var el = $("note-" + id); if (!el || el._h === html + cls) return; el._h = html + cls; el.className = "fnote" + (cls ? " " + cls : ""); el.innerHTML = html;
  }
  function cityChanged(which) {
    var cityId = which + "City", stId = which + "Street", city = $(cityId) && $(cityId).value.trim();
    if (!city) { stLoaded[which] = null; $("st-" + which).innerHTML = ""; note(stId, ""); return; }
    getStreets(city).then(function (j) {
      if (!$(cityId) || $(cityId).value.trim() !== city) return;
      stLoaded[which] = j && j.streets && j.streets.length ? j : null;
      $("st-" + which).innerHTML = stLoaded[which] ? j.streets.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join("") : "";
      if (!stLoaded[which]) { note(stId, ""); return; }
      if ($(stId).value.trim()) checkStreet(which);
      else note(stId, esc(t("addr.found", { n: j.streets.length, city: j.city })) + (API ? "" : " " + esc(t("addr.demo"))));
    });
  }
  function checkStreet(which) {
    var stId = which + "Street", j = stLoaded[which], v = $(stId) && streetOnly($(stId).value, which);
    if (!j || !v) { if (j && !v) note(stId, esc(t("addr.found", { n: j.streets.length, city: j.city }))); return; }
    if (!/[א-ת]/.test(v)) { note(stId, ""); return; }   // הרשימה הרשמית בעברית בלבד — לא מזהירים על "Dizengoff"
    var k = pkey(v), ok = j.streets.some(function (s) { return pkey(s) === k; });
    if (ok) { note(stId, esc(t("addr.ok")), "ok"); return; }
    var sug = suggest(v, j.streets);
    note(stId, esc(t("addr.miss", { s: v, city: j.city })) + " " + (sug.length
      ? esc(t("addr.maybe")) + " " + sug.map(function (s) { return '<button type="button" class="sugg" data-fill="' + stId + '" data-val="' + esc(s) + '">' + esc(s) + "</button>"; }).join(" ")
      : esc(t("addr.missNone"))), "warn");
  }
  function fillSuggestion(btn) {
    var id = btn.getAttribute("data-fill"), el = $(id), which = id.indexOf("old") === 0 ? "old" : "new", val = btn.getAttribute("data-val");
    if (which === "old") { var m = el.value.match(/\s*\d+\s*[א-תa-z]?\s*$/i); val += m ? " " + m[0].trim() : ""; }
    el.value = val; checkStreet(which); save(); el.focus();
  }
  function addrText(which) {
    var d = data(), street = which === "new" ? [d.newStreet, d.newNum].filter(Boolean).join(" ") : d.oldStreet, city = which === "new" ? d.newCity : d.oldCity;
    return street && city && (which === "old" || d.newNum) ? street + ", " + city : "";
  }
  function toggleMap(which) {
    var box = $("map-" + which), btn = $("mapbtn-" + which), msg = $("mapmsg-" + which), open = !box.hidden;
    if (open) { box.hidden = true; box.innerHTML = ""; btn.setAttribute("aria-expanded", "false"); btn.lastChild.textContent = " " + t("addr.map"); return; }
    var a = addrText(which);
    if (!a) { msg.textContent = t("addr.mapNeed"); return; }
    msg.textContent = "";
    var q = encodeURIComponent(a + ", ישראל"), hl = LANG === "he" ? "iw" : LANG;
    box.innerHTML = '<iframe title="' + esc(t("addr.mapTitle", { a: a })) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=' + q + "&hl=" + hl + '&z=16&output=embed"></iframe>' +
      '<p class="fnote">' + esc(t("addr.mapNote")) + ' <a href="https://www.google.com/maps/search/?api=1&query=' + q + '" target="_blank" rel="noopener">' + esc(t("addr.mapOpen")) + ' <span class="sr">' + esc(t("newWin")) + "</span></a></p>";
    box.hidden = false; btn.setAttribute("aria-expanded", "true"); btn.lastChild.textContent = " " + t("addr.mapHide");
  }
  function refreshMap(which) { var box = $("map-" + which); if (box && !box.hidden) { toggleMap(which); toggleMap(which); } }

  // ---------- נתונים ----------
  function data() {
    var d = {};
    allFields.forEach(function (f) {
      if (f.type === "radio") { var c = document.querySelector('input[name="' + f.id + '"]:checked'); d[f.id] = c ? c.value : ""; }
      else if (f.type === "checks") { f.opts.forEach(function (o) { d[o[0]] = $(o[0]).checked; }); }
      else if (f.type === "consent") d[f.id] = $(f.id).checked;
      else d[f.id] = $(f.id).value.trim();
    });
    d.lang = LANG;
    return d;
  }
  function setData(d) {
    allFields.forEach(function (f) {
      var v = d[f.id];
      if (f.type === "radio") { var r = v && $(f.id + "-" + v); if (r) r.checked = true; else if (f.def) { var r2 = $(f.id + "-" + f.def); if (r2) r2.checked = true; } }
      else if (f.type === "checks") f.opts.forEach(function (o) { if (o[0] in d) $(o[0]).checked = !!d[o[0]]; });
      else if (f.type === "consent") { if (f.id in d) $(f.id).checked = !!d[f.id]; }
      else if (v != null) $(f.id).value = v;
    });
  }

  var KEY = "movers-v3", step = 0, done = {}, submittedRef = "", paying = false, seen = {}, moversSent = null, kitTouched = false, suppliesSent = null, editToken = "", restored = false, callsAsked = {};
  function hit(k) {
    if (!API || seen[k]) return; seen[k] = true;
    try { fetch(API.replace(/\/$/, "") + "/hit", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: k }) }).catch(function () {}); } catch (e) {}
  }
  function save() {
    try {
      var d = data(); delete d.tz; delete d.consent; delete d.poa; delete d.marketing; delete d.moversConsent; delete d.suppliesConsent;
      localStorage.setItem(KEY, JSON.stringify({ d: d, done: done, step: step, ref: submittedRef, mv: moversSent, kt: kitTouched, sup: suppliesSent, et: editToken, cb: callsAsked }));
    } catch (e) {}
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (!s) return;
      var d = s.d || {}; delete d.tz; setData(d);
      done = s.done || {}; submittedRef = s.ref || ""; moversSent = s.mv || null; kitTouched = !!s.kt; suppliesSent = s.sup || null; editToken = s.et || ""; callsAsked = s.cb || {};
      step = Math.min(s.step || 0, LAST);
      restored = step > 0;
      if (step === LAST && !submittedRef && API) step = LAST - 1;
    } catch (e) {}
  }

  function applyShowIf() {
    var d = data();
    allFields.forEach(function (f) { if (f.showIf) $("wrap-" + f.id).hidden = !f.showIf(d); });
    groupShows.forEach(function (g) { $("grp-" + g.gid).hidden = !g.showIf(d); });
    // "המובילים יביאו" — רק למי שביקש הצעות ממובילים
    var mo = $("suppliesFrom-movers");
    if (mo) {
      mo.closest("label").hidden = !wantsQuotes(d);
      if (mo.checked && !wantsQuotes(d)) { mo.checked = false; var alt = $("suppliesFrom-" + (SUP_ORDER ? "delivery" : "self")); if (alt) alt.checked = true; d = data(); }
    }
    if (wantsDelivery(d) && !d.suppliesDate && d.moveDate && $("suppliesDate")) $("suppliesDate").value = C.suppliesDefaultDate(d.moveDate);
  }
  // ממלאים את הכמויות לפי מספר החדרים, כל עוד המשתמש לא שינה אותן בעצמו
  function fillKit() {
    if (kitTouched || !$("kBoxes")) return;
    var k = C.kitFor(data().rooms); if (!k) return;
    C.KIT.forEach(function (id) { $(id).value = k[id]; });
  }

  // ---------- בדיקת תקינות ----------
  var checks = { tz: C.validTz, phone: C.validPhone, email: C.validEmail, zip: C.validZip, date: C.validDate, qty: function (v) { return /^\d{1,3}$/.test(v); } };
  function setErr(f, msg) {
    var e = $(f.id + "-err"), ctrl = (f.type === "radio" || f.type === "checks") ? $(f.id + "-fs") : $(f.id);
    if (msg) { e.textContent = msg; e.hidden = false; ctrl.setAttribute("aria-invalid", "true"); }
    else { e.textContent = ""; e.hidden = true; ctrl.removeAttribute("aria-invalid"); }
  }
  function fieldsOf(n) {
    var out = [];
    (STEPS[n] ? STEPS[n].fields : []).forEach(function (f) { if (f.group) out = out.concat(f.fields); else out.push(f); });
    return out;
  }
  function validate(n) {
    var d = data(), errs = [];
    fieldsOf(n).forEach(function (f) {
      if (f.showIf && !f.showIf(d)) { setErr(f, ""); return; }
      var v = d[f.id], msg = "";
      if (f.req && !v) { var mk = "m." + f.id; msg = C.T(LANG, mk) !== mk ? t(mk) : t("m.default"); }
      else if (v && f.check && checks[f.check] && !checks[f.check](v)) msg = t("chk." + f.check);
      if (!msg && f.id === "service" && v === "self" && !d.email) msg = t("chk.serviceEmail");
      if (!msg && f.id === "suppliesDate" && v && d.moveDate && v > d.moveDate) msg = t("chk.suppliesAfter");
      if (!msg && f.id === "suppliesTo" && wantsDelivery(d) && v === "old" && !(d.oldStreet && d.oldCity)) msg = t("chk.suppliesOld");
      setErr(f, msg);
      if (msg) errs.push([f, msg]);
    });
    var box = $("errsum");
    if (!errs.length) { box.hidden = true; box.innerHTML = ""; return true; }
    box.innerHTML = "<h2>" + esc(errs.length === 1 ? t("err.one") : t("err.many", { n: errs.length })) + "</h2><ul>" +
      errs.map(function (e) {
        var target = (e[0].type === "radio") ? e[0].id + "-" + e[0].opts[0][0] : e[0].id;
        return '<li><a href="#' + target + '" data-focus="' + target + '">' + esc(t("f." + e[0].id)) + ": " + esc(e[1]) + "</a></li>";
      }).join("") + "</ul>";
    box.hidden = false; box.focus();
    return false;
  }
  $("errsum").addEventListener("click", function (e) {
    var a = e.target.closest("a[data-focus]"); if (!a) return;
    e.preventDefault(); var el = $(a.dataset.focus); if (el) { el.focus(); el.scrollIntoView({ block: "center" }); }
  });

  // ---------- מעבר בין שלבים ----------
  function showStep(n, focus) {
    step = n;
    document.querySelectorAll("[data-step]").forEach(function (s) { s.hidden = +s.dataset.step !== n; });
    var res = n === LAST;
    $("results").hidden = !res; $("nav").hidden = res; $("hero").hidden = n > 0; $("how").hidden = res || n > 0; $("more").hidden = res || n > 0;
    $("progress").hidden = res; $("autosave").hidden = res;
    if (n > 0 && !$("explainer").hidden && !document.documentElement.classList.contains("videomode")) exClose(false);
    if (focus) $("welcome").hidden = true;
    $("errsum").hidden = true;
    if (!res) {
      $("stepText").innerHTML = esc(t("step.of", { n: n + 1, total: STEPS.length })) + ' <span class="muted">' + esc(t(stepKey(STEPS[n], "name"))) + "</span>";
      $("stepBar").style.width = ((n + 1) / STEPS.length * 100) + "%";
      $("dots").innerHTML = STEPS.map(function (s, i) { return '<li class="' + (i < n ? "done" : i === n ? "cur" : "") + '">' + (i < n ? "✓" : i + 1) + "</li>"; }).join("");
      $("back").hidden = n === 0;
      $("next").textContent = n < STEPS.length - 1 ? t("nav.next") : (API ? t("nav.send") : t("nav.finish"));
    }
    applyShowIf();
    // בשלב הכתובת: אם כבר יש עיר (למשל חזרתם לאתר), טוענים את הרחובות שלה
    if (!res && STEPS[n] && STEPS[n].id === "address") ["new", "old"].forEach(function (w) { if ($(w + "City") && $(w + "City").value.trim() && !stLoaded[w]) cityChanged(w); });
    hit(res ? "results" : "step:" + n);
    if (res) render();
    updateLabel(); save();
    try { window.dispatchEvent(new Event("avarnu-step")); } catch (e) {}
    if (focus) {
      var h = res ? $("rTitle") : $("h-" + n);
      h.focus(); window.scrollTo({ top: 0, behavior: app.classList.contains("nm") ? "auto" : "smooth" });
    }
  }

  function updateLabel() {
    var d = data();
    $("lblFrom").textContent = C.addrL(d, "old", LANG) || t("label.fromEmpty");
    $("lblTo").textContent = C.addrL(d, "new", LANG) || t("label.toEmpty");
    $("lblDate").textContent = (LANG === "ar" ? C.ltrNums(C.fmtDate(d.moveDate)) : C.fmtDate(d.moveDate)) || t("label.whenEmpty");
    var items = C.build(d, { lang: LANG }), c = items.filter(function (i) { return done[i.id]; }).length;
    $("lblStatus").textContent = c ? t("label.statusN", { c: c, n: items.length }) : t("label.statusNone");
    var bl = C.benefits(d, { lang: LANG }).filter(function (b) { return b.sure === "likely"; }).length;
    $("lblBen").textContent = step < 2 ? t("label.benLater") : (bl === 1 ? t("label.benOne") : t("label.benMany", { n: bl }));
  }

  // ---------- מסך התוצאות ----------
  function extLink(url, text, cls, rel) {
    var a = document.createElement("a"); a.className = "btn" + (cls ? " " + cls : ""); a.href = url; a.target = "_blank"; a.rel = rel || "noopener";
    a.innerHTML = esc(text) + ' <span aria-hidden="true">↗</span><span class="sr"> ' + esc(t("newWin")) + "</span>";
    return a;
  }
  function render() {
    var d = data(), items = C.build(d, { lang: LANG }), box = $("groups"), labels = C.labels(LANG);
    box.innerHTML = "";
    if (LANG !== "he") { var hn = document.createElement("p"); hn.className = "henote"; hn.textContent = t("res.heNote"); box.appendChild(hn); }
    C.groups(LANG).forEach(function (g) {
      var its = items.filter(function (i) { return i.grp === g.id; }); if (!its.length) return;
      var sec = document.createElement("section"); sec.className = "sect"; sec.setAttribute("aria-labelledby", "g-" + g.id);
      sec.innerHTML = '<h3 id="g-' + g.id + '">' + esc(g.title) + (g.note ? ' <span class="muted">' + esc(g.note) + "</span>" : "") + "</h3>";
      var ul = document.createElement("ul"); ul.className = "items";
      its.forEach(function (i) {
        var li = document.createElement("li"); li.className = "item" + (i.key ? " key" : "") + (done[i.id] ? " is-done" : "");
        var when = i.auto ? t("item.auto") : i.when;
        var need = i.need.length ? '<ul class="need" aria-label="' + esc(t("item.need")) + '">' + i.need.map(function (k) {
          return '<li class="' + (d[k] ? "" : "miss") + '">' + esc(t(d[k] ? "item.has" : "item.missing", { l: labels[k] })) + "</li>";
        }).join("") + "</ul>" : "";
        li.innerHTML = '<div class="head"><label class="check"><input type="checkbox" id="done-' + i.id + '" aria-describedby="desc-' + i.id + '"' + (done[i.id] ? " checked" : "") +
          '><span><span class="ttl">' + esc(i.t) + '</span><span class="sr">' + esc(t("item.markSr")) + '</span></span></label>' +
          '<span class="when' + (i.auto ? " auto" : "") + '">' + esc(when) + "</span></div>" +
          '<p class="desc" id="desc-' + i.id + '">' + esc(i.d) + "</p>" + need + '<div class="acts"></div>';
        var acts = li.querySelector(".acts");
        if (i.url) acts.appendChild(extLink(i.url, i.search ? t("item.search") : t("item.visit", { site: i.site || "" }), "primary"));
        var b = document.createElement("button"); b.type = "button";
        b.innerHTML = esc(t("item.copy")) + '<span class="sr">' + esc(t("item.copyFor", { t: i.t })) + "</span>";
        b.onclick = function () { copy(i.msg, t("copy.done")); };
        acts.appendChild(b);
        if (CALL_ON && C.CALL_IDS.indexOf(i.id) >= 0 && (!API || submittedRef)) {
          var ask = callsAsked[i.id];
          if (ask) {
            var sp = document.createElement("span"); sp.className = "cbasked";
            sp.textContent = t("cb.asked", { day: C.fmtDate(ask.day), slot: slotText(ask.slot) }); acts.appendChild(sp);
          } else {
            var cbb = document.createElement("button"); cbb.type = "button"; cbb.setAttribute("data-call", i.id);
            cbb.innerHTML = esc(t("cb.btn")) + '<span class="sr">' + esc(t("item.copyFor", { t: i.t })) + "</span>";
            cbb.onclick = function () { openCall(i, cbb); };
            acts.appendChild(cbb);
          }
        }
        li.querySelector("input").onchange = function (e) { done[i.id] = e.target.checked; li.classList.toggle("is-done", e.target.checked); tally(); save(); };
        ul.appendChild(li);
      });
      sec.appendChild(ul); box.appendChild(sec);
    });
    renderBenefits(d);
    renderLater(d);
    renderMoving(d);
    renderSupplies(d);
    $("rTitle").textContent = d.firstName ? t("res.titleName", { name: d.firstName }) : t("res.title");
    $("rSub").textContent = t("res.sub", { n: items.length, addr: C.addrL(d, "new", LANG) || "—", date: C.fmtDate(d.moveDate) || "—" });
    var rb = $("refbox");
    if (submittedRef) {
      rb.hidden = false;
      rb.innerHTML = esc(t("res.ref", { ref: "" })) + "<strong>" + esc(submittedRef) + "</strong>" +
        (d.service === "concierge" ? "<br>" + esc(t("res.refConcierge")) : (d.email ? "<br>" + esc(t("res.refEmail")) : ""));
    } else rb.hidden = true;
    $("dossier").textContent = dossier(d);
    $("dosHe").hidden = LANG === "he";
    renderPartners(d);
    tally();
  }
  function tally() {
    var items = C.build(data(), { lang: LANG }), c = items.filter(function (i) { return done[i.id]; }).length;
    $("count").textContent = t("label.statusN", { c: c, n: items.length });
    $("bar").style.width = (items.length ? c / items.length * 100 : 0) + "%";
    updateLabel();
  }
  // תיק הפרטים — תמיד בעברית, כדי להדביק בטפסים של גופים בישראל
  function dossier(d) {
    var rows = [["שם", ((d.firstName || "") + " " + (d.lastName || "")).trim()], ["תעודת זהות", d.tz], ["טלפון", d.phone], ["מייל", d.email],
      ["אנשים בבית", d.people], ["ילדים מתחת לגיל 18", d.kidsCount !== "0" ? d.kidsCount : ""], ["בדירה החדשה", d.tenure === "rent" ? "שוכרים" : "בעלי הדירה"],
      ["בעל הדירה", d.tenure === "rent" ? d.landlord : ""], ["הכתובת הקודמת", C.addr(d, "old")], ["הכתובת החדשה", C.addr(d, "new")], ["מיקוד", d.zip], ["קומה", d.floor],
      ["תאריך המעבר", C.fmtDate(d.moveDate)],
      ["חשמל (חוזה / מונה / מספר במונה)", [d.elecContract, d.elecMeter, d.elecRead].filter(Boolean).join(" / ")],
      ["מים (מונה / מספר במונה)", [d.waterMeter, d.waterRead].filter(Boolean).join(" / ")],
      ["גז", [d.gas === "central" ? "גז מרכזי" : d.gas, d.gasRead].filter(Boolean).join(" / ")]];
    return rows.filter(function (r) { return r[1]; }).map(function (r) { return r[0] + ": " + r[1]; }).join("\n");
  }

  function renderBenefits(d) {
    var list = C.benefits(d, { lang: LANG }), box = $("benefits"), likely = list.filter(function (b) { return b.sure === "likely"; }).length;
    box.innerHTML = '<div class="bhead"><h2 id="bTitle" tabindex="-1">' + esc(t("ben.title")) + "</h2>" +
      "<p>" + esc(t("ben.lead", { n: list.length })) + " " +
      esc(likely ? t("ben.likelyN", { n: likely }) : t("ben.none")) + (API ? "" : " " + esc(t("ben.prepared"))) + "</p></div>";
    C.benefitCats(LANG).forEach(function (cat) {
      var its = list.filter(function (b) { return b.cat === cat.id; }); if (!its.length) return;
      var sec = document.createElement("section"); sec.className = "sect"; sec.setAttribute("aria-labelledby", "bc-" + cat.id);
      sec.innerHTML = '<h3 id="bc-' + cat.id + '">' + esc(cat.title) + (cat.note ? ' <span class="muted">' + esc(cat.note) + "</span>" : "") + "</h3>";
      var ul = document.createElement("ul"); ul.className = "items";
      its.forEach(function (b) {
        var key = "b:" + b.id, li = document.createElement("li");
        li.className = "item" + (b.best ? " key" : "") + (done[key] ? " is-done" : "");
        li.innerHTML = '<div class="head"><label class="check"><input type="checkbox" id="done-' + b.id + '" aria-describedby="bd-' + b.id + '"' + (done[key] ? " checked" : "") +
          '><span><span class="ttl">' + esc(b.t) + "</span>" + (b.best ? '<span class="bestb">' + esc(t("ben.best")) + "</span>" : "") +
          '<span class="sr">' + esc(t("ben.markSr")) + '</span></span></label>' + (b.amount ? '<span class="amount">' + esc(b.amount) + "</span>" : "") + "</div>" +
          '<p class="desc" id="bd-' + b.id + '"><span class="sure">' + esc(b.sure === "likely" ? t("ben.likely") : t("ben.check")) + " </span>" + esc(b.d) + "</p>" +
          (b.how ? '<p class="how"><strong>' + esc(t("ben.how")) + "</strong>" + esc(b.how) + "</p>" : "") +
          (b.docs.length ? '<p class="how"><strong>' + esc(t("ben.docs")) + '</strong></p><ul class="docs">' + b.docs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
          '<div class="acts"></div>';
        var acts = li.querySelector(".acts");
        if (b.url) acts.appendChild(extLink(b.url, b.search ? t("ben.searchForm") : t("item.visit", { site: b.site || "" }), acts.children.length ? "" : "primary"));
        if (b.info) acts.appendChild(extLink(b.info, t("ben.info"), ""));
        if (b.msg) {
          var btn = document.createElement("button"); btn.type = "button";
          btn.innerHTML = esc(t("ben.copyReq")) + '<span class="sr">' + esc(t("item.copyFor", { t: b.t })) + "</span>";
          btn.onclick = function () { copy(b.msg, t("copy.req")); }; acts.appendChild(btn);
        }
        li.querySelector("input").onchange = function (e) { done[key] = e.target.checked; li.classList.toggle("is-done", e.target.checked); save(); };
        ul.appendChild(li);
      });
      sec.appendChild(ul); box.appendChild(sec);
    });
  }

  function renderMoving(d) {
    var box = $("moving");
    if (!MOVERS_ON || d.moveStatus !== "quotes") { box.hidden = true; return; }
    box.hidden = false;
    var html = '<h2 id="mvTitle">' + esc(t("mv.title")) + "</h2>";
    if (CFG.demo) html += "<p>" + esc(t("mv.demo")) + "</p>";
    else if (moversSent && moversSent.length) {
      html += "<p>" + esc(t("mv.sent", { n: moversSent.length })) + '</p><ul class="mv-sent">' +
        moversSent.map(function (m) { return "<li><strong>" + esc(m.name) + '</strong> · <span dir="ltr">' + esc(m.phone) + "</span></li>"; }).join("") +
        '</ul><p class="muted">' + esc(t("mv.after")) + "</p>";
    } else if (moversSent) html += "<p>" + esc(t("mv.none")) + "</p>";
    else html += "<p>" + esc(t("mv.pending")) + "</p>";
    box.innerHTML = html;
  }

  // ---------- פרטים שחסרים: משלימים אחר כך, בלי להתחיל מחדש ----------
  function renderLater(d) {
    var box = $("later"), miss = C.missing(d), labels = C.labels(LANG);
    if (!miss.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<h2 id="laterTitle" tabindex="-1">' + esc(miss.length === 1 ? t("later.one") : t("later.title", { n: miss.length })) + "</h2>" +
      "<p>" + esc(t("later.lead")) + (API && submittedRef && d.email ? " " + esc(t("later.leadApi")) : "") + '</p><p class="muted">' + esc(t("later.tip")) + "</p>" +
      '<div class="grid">' + miss.map(function (k) {
        var f = fieldById[k] || {};
        return '<div class="field w3"><label for="lt-' + k + '">' + esc(labels[k]) + '</label><input type="text" id="lt-' + k + '" maxlength="120"' +
          (f.mode ? ' inputmode="' + f.mode + '"' : "") + (f.ltr ? ' dir="ltr"' : "") + (f.list ? ' list="' + f.list + '"' : "") + "></div>";
      }).join("") + '</div><div class="acts" id="laterActs"></div>';
    var acts = $("laterActs"), b = document.createElement("button");
    b.type = "button"; b.className = "primary"; b.textContent = t("later.save"); b.onclick = saveLater;
    acts.appendChild(b);
    if (d.moveDate) acts.appendChild(extLink(calUrl(d), t("later.cal"), ""));
  }
  function saveLater() {
    var fields = {}, n = 0;
    C.LATER.forEach(function (k) { var el = $("lt-" + k); if (el && el.value.trim()) { fields[k] = el.value.trim(); n++; } });
    if (!n) { toast(t("later.empty")); $("lt-" + C.missing(data())[0]).focus(); return; }
    Object.keys(fields).forEach(function (k) { if ($(k)) $(k).value = fields[k]; });
    save();
    function after(ok) {
      render();
      var left = C.missing(data()).length;
      toast(!ok ? t("later.fail") : left ? t("later.savedSome", { n: left }) : t("later.saved"));
      var h = left ? $("laterTitle") : $("rTitle"); if (h) h.focus();
    }
    if (API && editToken) {
      fetch(API.replace(/\/$/, "") + "/leads/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: editToken, fields: fields }) })
        .then(function (r) { after(r.ok); }, function () { after(false); });
    } else after(true);
  }
  // תזכורת ביומן גוגל ליום שמקבלים מפתח
  function calUrl(d) {
    var next = new Date(d.moveDate + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    var link = API && editToken ? location.origin + "/u/" + editToken : (API ? location.origin : "https://avarnu.com");
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(t("later.calText")) +
      "&dates=" + d.moveDate.replace(/-/g, "") + "/" + next.toISOString().slice(0, 10).replace(/-/g, "") +
      "&details=" + encodeURIComponent(t("later.calDetails", { url: link }));
  }

  // ---------- סרטון הסבר (אנימציה עם כתוביות, בלי קול) ----------
  var EX_N = 7, EX_MS = 4500, exIdx = 0, exT0 = 0, exElapsed = 0, exTimer = null, exPlaying = false, exEnded = false;
  function exShow(i) {
    document.querySelectorAll("#stage .scene").forEach(function (sc) { sc.classList.toggle("on", +sc.dataset.sc === i); });
    $("exCap").textContent = i ? t("ex.s" + i) : "";
  }
  function exBtn() { $("exPlay").textContent = exPlaying ? t("ex.pause") : exEnded ? t("ex.replay") : exElapsed ? t("ex.resume") : t("ex.play"); }
  function exTick() {
    var total = EX_N * EX_MS, el = exElapsed + (Date.now() - exT0);
    if (el >= total) { clearInterval(exTimer); exPlaying = false; exEnded = true; exElapsed = 0; $("exBar").style.width = "100%"; exBtn(); return; }
    var i = Math.floor(el / EX_MS) + 1;
    if (i !== exIdx) { exIdx = i; exShow(i); }
    $("exBar").style.width = (el / total * 100) + "%";
  }
  function exPlay() {
    if (exEnded) { exEnded = false; exIdx = 0; exShow(0); }
    exPlaying = true; exT0 = Date.now(); $("stage").classList.remove("paused");
    clearInterval(exTimer); exTimer = setInterval(exTick, 100); exTick(); exBtn();
  }
  function exPause() {
    if (!exPlaying) return;
    exPlaying = false; exElapsed += Date.now() - exT0; clearInterval(exTimer); $("stage").classList.add("paused"); exBtn();
  }
  function exClose(focusBack) {
    exPause(); $("explainer").hidden = true; $("exOpen").setAttribute("aria-expanded", "false");
    if (focusBack) $("exOpen").focus();
  }
  $("exOpen").onclick = function () {
    $("explainer").hidden = false; $("exOpen").setAttribute("aria-expanded", "true");
    exEnded = false; exElapsed = 0; exIdx = 0; exShow(0); exPlay(); hit("video");
    $("exTitle").setAttribute("tabindex", "-1"); $("exTitle").focus();
    $("explainer").scrollIntoView({ block: "start", behavior: app.classList.contains("nm") ? "auto" : "smooth" });
  };
  $("exPlay").onclick = function () { if (exPlaying) exPause(); else exPlay(); };
  $("exClose").onclick = function () { exClose(true); };
  // כפתור ההתחלה בראש הדף
  function goFill() { $("firstName").focus(); $("firstName").scrollIntoView({ block: "center", behavior: app.classList.contains("nm") ? "auto" : "smooth" }); hit("go"); }
  $("heroGo").onclick = goFill; $("stickyGo").onclick = goFill; $("ctaGo").onclick = goFill;
  // בטלפון: כפתור "מתחילים" צף, כל עוד לא רואים את הכפתור הראשי או את הטופס
  (function () {
    if (!("IntersectionObserver" in window)) return;
    var vis = { go: true, form: false };
    function upd() { $("stickyCta").hidden = !(step === 0 && !vis.go && !vis.form && !document.documentElement.classList.contains("videomode")); }
    new IntersectionObserver(function (es) { vis.go = es[0].isIntersecting; upd(); }).observe($("heroGo"));
    new IntersectionObserver(function (es) { vis.form = es[0].isIntersecting; upd(); }, { rootMargin: "0px 0px -30% 0px" }).observe($("f"));
    window.addEventListener("avarnu-step", upd);
  })();
  // האיור נעצר כשמבקשים לעצור תנועה
  function artMotion() {
    var a = $("moveArt"); if (!a || !a.pauseAnimations) return;
    var stop = app.classList.contains("nm") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (stop) a.pauseAnimations(); else a.unpauseAnimations();
  }
  // תלת-ממד: הסצנה נוטה לפי העכבר (לא כשביקשו לעצור תנועה)
  (function () {
    var viz = $("viz"), hero = $("hero"), reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!viz || reduce) return;
    hero.addEventListener("pointermove", function (e) {
      if (app.classList.contains("nm") || e.pointerType === "touch") return;
      var r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      viz.style.setProperty("--ry", (-14 + x * 22).toFixed(1) + "deg"); viz.style.setProperty("--rx", (8 - y * 14).toFixed(1) + "deg");
    });
    hero.addEventListener("pointerleave", function () { viz.style.removeProperty("--ry"); viz.style.removeProperty("--rx"); });
  })();
  $("exStart").onclick = function () { exClose(false); $("firstName").focus(); $("firstName").scrollIntoView({ block: "center" }); };

  // ---------- תיאום שיחה עם נציג של גוף ----------
  var curCall = null;
  function slotText(sl) { var p = String(sl).split("-"); return ("0" + p[0]).slice(-2) + ":00–" + ("0" + p[1]).slice(-2) + ":00"; }
  function openCall(item, btn) {
    curCall = item;
    $("dlgCallT").textContent = t("cb.title", { t: item.t });
    $("cbLead").textContent = t("cb.lead");
    $("cbDay").value = C.nextCallDay(); $("cbDay").removeAttribute("aria-invalid");
    $("cbSlot-fs").removeAttribute("aria-invalid");
    $("cbSlot-fs").innerHTML = "<legend>" + esc(t("cb.slot")) + "</legend>" + C.SLOTS.map(function (sl) {
      return '<label class="choice"><input type="radio" name="cbSlot" id="cbSlot-' + sl + '" value="' + sl + '"> <span dir="ltr">' + slotText(sl) + "</span></label>";
    }).join("");
    var d = data();
    $("cbPhone").textContent = d.phone ? t("cb.phone", { phone: d.phone }) : "";
    $("cbNote").value = ""; $("cbConsent").checked = false; $("cbErr").hidden = true;
    opener = btn;
    var dl = $("dlgCall"); if (dl.showModal) dl.showModal(); else dl.setAttribute("open", "");
    $("cbDay").focus();
  }
  $("cbForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var day = $("cbDay").value, sl = document.querySelector('input[name="cbSlot"]:checked'), errs = [];
    $("cbDay").toggleAttribute("aria-invalid", !C.validCallDay(day));
    $("cbSlot-fs").toggleAttribute("aria-invalid", !sl);
    if (!C.validCallDay(day)) errs.push(["cbDay", t("cb.errDay")]);
    if (!sl) errs.push(["cbSlot-" + C.SLOTS[0], t("cb.errSlot")]);
    if (!$("cbConsent").checked) errs.push(["cbConsent", t("cb.errConsent")]);
    var box = $("cbErr");
    function showErr(list) {
      box.innerHTML = "<h2>" + esc(list.length === 1 ? t("err.one") : t("err.many", { n: list.length })) + "</h2><ul>" +
        list.map(function (x) { return '<li><a href="#' + x[0] + '" data-focus="' + x[0] + '">' + esc(x[1]) + "</a></li>"; }).join("") + "</ul>";
      box.hidden = false; box.focus();
    }
    if (errs.length) return showErr(errs);
    var req = { body: curCall.id, day: day, slot: sl.value, note: $("cbNote").value.trim(), consent: true };
    function done(msg) {
      callsAsked[curCall.id] = { day: day, slot: sl.value }; save();
      opener = null; $("dlgCall").close(); render(); toast(msg);
      var c = $("done-" + curCall.id); if (c) c.focus();
    }
    if (!API) return done(t("cb.demoOk"));
    req.token = editToken;
    fetch(API.replace(/\/$/, "") + "/callbacks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; }); })
      .then(function () { done(t("cb.ok", { day: C.fmtDate(day), slot: slotText(sl.value) })); },
        function (err) { showErr([["cbDay", (err && err.message) || t("err.network")]]); });
  });
  $("cbErr").addEventListener("click", function (e) {
    var a = e.target.closest("a[data-focus]"); if (!a) return;
    e.preventDefault(); var el = $(a.dataset.focus); if (el) el.focus();
  });

  // ---------- קרטונים וחומרי אריזה ----------
  function renderSupplies(d) {
    var box = $("supplies");
    if (!needsKit(d)) { box.hidden = true; return; }
    var lines = C.kitLines(d, LANG);
    box.hidden = false;
    var from = d.suppliesFrom, msg;
    if (from === "movers") msg = t("sup.movers");
    else if (from === "delivery" && CFG.demo) msg = t("sup.demo");
    else if (from === "delivery" && suppliesSent === "ordered") msg = t("sup.ordered", { date: C.fmtDate(d.suppliesDate), addr: C.addrL(d, d.suppliesTo === "new" ? "new" : "old", LANG) });
    else msg = t("sup.self");
    var html = '<h2 id="supTitle">' + esc(t("sup.title")) + "</h2><p>" + esc(msg) + "</p>" +
      '<ul class="kit" aria-label="' + esc(t("sup.listSr")) + '">' + lines.map(function (x) { return "<li><span>" + esc(x.name) + "</span><b>" + x.qty + "</b></li>"; }).join("") + "</ul>" +
      '<div class="acts" id="supActs"></div>' +
      '<h3 id="tipsTitle">' + esc(t("sup.tipsTitle")) + '</h3><ol class="tips" aria-labelledby="tipsTitle">' +
      ["1", "2", "3", "4", "5"].map(function (n) { return "<li>" + esc(t("sup.tip" + n)) + "</li>"; }).join("") + "</ol>";
    box.innerHTML = html;
    var acts = $("supActs");
    var b = document.createElement("button"); b.type = "button"; b.textContent = t("sup.copy");
    b.onclick = function () { copy(t("sup.title") + ":\n" + C.kitText(d, LANG), t("sup.copied")); };
    if (from !== "delivery" || CFG.demo) {
      var city = C.cityName(C.canonCity(d.oldCity || d.newCity), "he");
      acts.appendChild(extLink("https://www.google.com/search?q=" + encodeURIComponent("קרטונים להובלה משלוח " + (city || "")), t("sup.search"), from === "self" ? "primary" : ""));
    }
    acts.appendChild(b);
  }

  // ---------- שותפים (תוכן ממומן) ----------
  var partnersCache = null;
  function renderPartners(d) {
    var box = $("partners");
    function draw(list) {
      var kids = parseInt(d.kidsCount, 10) > 0, order = { moving: 0, home: 1, save: 2, kids: 3 }, city = C.canonCity(d.newCity);
      list = list.filter(function (s) {
        var m = s.match || {};
        if (m.cities && m.cities.length && m.cities.indexOf(city) < 0) return false;
        if (m.tenure && m.tenure !== d.tenure) return false;
        if ((m.kids || s.slot === "kids") && !kids) return false;
        return true;
      }).sort(function (a, b) { return order[a.slot] - order[b.slot]; }).slice(0, 3);
      if (!list.length) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '<h2 id="pTitle" class="listhead">' + esc(t("pt.title")) + '</h2><p class="muted">' + esc(CFG.demo ? t("pt.demoNote") : t("pt.note")) + '</p><ul class="partners"></ul>';
      var ul = box.querySelector("ul");
      list.forEach(function (s) {
        var li = document.createElement("li"); li.className = "partner";
        li.innerHTML = '<span class="ptag">' + esc(CFG.demo ? t("pt.tagDemo") : t("pt.tag")) + "</span><h3></h3><p></p>";
        li.querySelector("h3").textContent = s.title; li.querySelector("p").textContent = s.text;
        if (s.href) {
          var a = extLink(s.href, s.cta || t("pt.cta"), "", "sponsored noopener");
          a.querySelector(".sr").textContent = " " + t("pt.sr");
          li.appendChild(a);
        }
        ul.appendChild(li);
      });
    }
    if (CFG.demo) return draw([{ slot: "moving", title: t("pt.demo1.t"), text: t("pt.demo1.d") }, { slot: "home", title: t("pt.demo2.t"), text: t("pt.demo2.d") }]);
    if (!API || !CFG.ads) { box.hidden = true; return; }
    if (partnersCache) return draw(partnersCache);
    fetch(API.replace(/\/$/, "") + "/sponsors").then(function (r) { return r.json(); })
      .then(function (j) { partnersCache = j.sponsors || []; draw(partnersCache); })
      .catch(function () { box.hidden = true; });
  }

  // ---------- העתקה והודעות ----------
  function copy(text, msg) {
    try { navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { fallback(text, msg); }); }
    catch (e) { fallback(text, msg); }
  }
  function fallback(text, msg) {
    var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.className = "sr";
    document.body.appendChild(ta); ta.select(); var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove(); toast(ok ? msg : t("copy.fail"));
  }
  var tt;
  function toast(m) { var el = $("toast"); el.textContent = m; el.classList.add("show"); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove("show"); }, 3500); }

  // ---------- שליחה לשרת (מצב אתר אמיתי) ----------
  function submitLead() {
    var d = data(), btn = $("next");
    btn.disabled = true; btn.textContent = t("nav.sending");
    var body = { lead: d, website: $("website").value };
    return fetch(API.replace(/\/$/, "") + "/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; }); })
      .then(function (j) {
        submittedRef = j.ref;
        moversSent = j.moversRequested ? (j.movers || []) : null;
        suppliesSent = j.supplies || null;
        editToken = j.editToken || "";
        if (j.payUrl) { paying = true; save(); toast(t("pay.redirect")); location.href = j.payUrl; return; }
        showStep(LAST, true);
      })
      .catch(function (e) {
        var box = $("errsum");
        box.innerHTML = "<h2>" + esc(t("err.sendFail")) + "</h2><p>" + esc((e && e.message) || t("err.network")) + "</p>";
        box.hidden = false; box.focus();
      })
      .then(function () { if (!paying) { btn.disabled = false; btn.textContent = t("nav.send"); } });
  }

  // ---------- טקסטים קבועים בדף ----------
  function applyStatic() {
    var rtl = !!C.RTL[LANG];
    document.documentElement.lang = LANG; document.documentElement.dir = rtl ? "rtl" : "ltr";
    app.setAttribute("lang", LANG); app.setAttribute("dir", rtl ? "rtl" : "ltr");
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    document.querySelectorAll("[data-i18n-hl]").forEach(function (el) {
      el.innerHTML = esc(t(el.getAttribute("data-i18n-hl"))).replace(/\[\[(.+?)\]\]/g, '<mark class="hl">$1</mark>');
    });
    // פרטי קשר בהצהרות — ממולאים פעם אחת בקובץ site-info.js
    var fill = function (v, ph) { return '<span class="fill">' + esc(v || ph) + "</span>"; };
    $("a11yCoord").innerHTML = esc(t("dlg.a11y.coord")) + " " + fill(SITE.a11yName, "[שם מלא]") + "<br>" + esc(t("dlg.a11y.phone")) + ' <span dir="ltr">' + fill(SITE.a11yPhone, "[מספר]") +
      "</span><br>" + esc(t("dlg.a11y.mail")) + ' <span dir="ltr">' + fill(SITE.a11yEmail, "[כתובת מייל]") + "</span>";
    $("a11yReply").innerHTML = esc(t("dlg.a11y.reply", { n: "\u0000" })).replace("\u0000", fill(SITE.a11yReplyDays, "[מספר]"));
    $("a11yUpdated").innerHTML = esc(t("dlg.a11y.updated", { date: "\u0000" })).replace("\u0000", fill(SITE.a11yUpdated, "[תאריך]"));
    $("prRetention").innerHTML = esc(t("dlg.pr.m3", { n: "\u0000" })).replace("\u0000", fill(SITE.retentionDays, "[מספר]"));
    $("prContact").innerHTML = esc(t("dlg.pr.contact")) + " " + fill(SITE.privacyName, "[שם]") + ", " + ' <span dir="ltr">' + fill(SITE.privacyEmail, "[כתובת מייל]") + "</span>";
    $("prBiz").innerHTML = esc(t("dlg.pr.biz")) + " " + fill(SITE.business, "[שם העסק ומספר ח.פ.]");
    $("trBiz").innerHTML = esc(t("dlg.pr.biz")) + " " + fill(SITE.business, "[שם העסק ומספר ח.פ.]");
    // יצירת קשר בתחתית הדף — מופיע רק אם מולאו פרטים ב-site-info.js
    var cl = $("contactLine"), parts = [];
    if (SITE.contactEmail) parts.push('<a href="mailto:' + esc(SITE.contactEmail) + '" dir="ltr">' + esc(SITE.contactEmail) + "</a>");
    if (SITE.whatsapp) parts.push('<a href="https://wa.me/' + esc(String(SITE.whatsapp).replace(/\D/g, "").replace(/^0/, "972")) + '" target="_blank" rel="noopener">' + esc(t("foot.wa")) + '<span class="sr"> ' + esc(t("newWin")) + "</span></a>");
    cl.hidden = !parts.length; cl.innerHTML = parts.length ? esc(t("foot.contact")) + " " + parts.join("") : "";
    $("copyLine").textContent = "© " + new Date().getFullYear() + " " + t("foot.brand") + (SITE.business ? " · " + SITE.business : "");
    $("privMode").textContent = API ? t("dlg.pr.modeApi") : t("dlg.pr.modeLocal");
    $("footNote").textContent = API ? t("foot.noteApi") : t("foot.note");
    document.querySelectorAll(".henote-dlg").forEach(function (el) { el.hidden = LANG === "he"; el.textContent = t("dlg.heNote"); });
    var facts = $("facts");
    facts.innerHTML = ["fact.time", "fact.bodies", "fact.benefits"].concat(MOVERS_ON ? ["fact.movers"] : []).map(function (k) { return "<li>" + esc(t(k)) + "</li>"; }).join("");
    $("moverLinks").innerHTML = API && CFG.movers ? '<a href="/movers?lang=' + LANG + '">' + esc(t("foot.movers")) + '</a> <a href="/movers/join">' + esc(t("foot.join")) + "</a>" : "";
    $("langSel").value = LANG;
    document.querySelector(".brand .tld").textContent = LANG === "he" ? ".com" : "avarnu.com";
    if (armed) { armed = false; }
    $("resetBtn").textContent = t("reset.btn");
    themeLabel();
    $("exText").innerHTML = [1, 2, 3, 4, 5, 6, 7].map(function (i) { return "<li>" + esc(t("ex.s" + i)) + "</li>"; }).join("");
    if (exIdx) exShow(exIdx);
    exBtn();
  }

  function setLang(l, focus) {
    if (C.LANGS.indexOf(l) < 0 || l === LANG) return;
    var keep = data(); keep.tz = $("tz") ? $("tz").value : "";
    ["consent", "poa", "marketing", "moversConsent", "suppliesConsent"].forEach(function (k) { if ($(k)) keep[k] = $(k).checked; });
    LANG = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    if (API && history.replaceState) {
      var path = location.pathname.replace(/^\/(he|en|ru|ar)(\/|$)/, "/");
      history.replaceState(null, "", (l === "he" ? "" : "/" + l) + (path === "/" ? (l === "he" ? "/" : "") : path) + location.search);
    }
    buildForm(keep);
    applyStatic();
    showStep(step, false);
    if (focus) $("langSel").focus();
  }

  // ---------- אירועים ----------
  $("f").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate(step)) return;
    if (API && step === STEPS.length - 1) {
      // לפני שליחה בודקים את כל השלבים (למשל ת״ז, שלא נשמרת בדפדפן ולכן חסרה אחרי חזרה לאתר)
      for (var n = 0; n < step; n++) if (!validate(n)) { showStep(n, true); validate(n); return; }
      submitLead(); return;
    }
    showStep(step + 1, true);
  });
  $("back").onclick = function () { showStep(Math.max(0, step - 1), true); };
  $("editBtn").onclick = function () { showStep(0, true); };
  $("copyDossier").onclick = function () { copy($("dossier").textContent, t("dos.copied")); };
  $("f").addEventListener("input", function (e) {
    var f = fieldById[e.target.id] || fieldById[e.target.name];
    if (f && $(f.id + "-err") && !$(f.id + "-err").hidden) setErr(f, "");
    if (C.KIT.indexOf(e.target.id) >= 0) kitTouched = true;
    applyShowIf(); updateLabel(); save();
    // בדיקת הרחוב תוך כדי הקלדה (חצי שנייה אחרי שעוצרים), כדי שההודעה תופיע לפני שממשיכים
    if (e.target.id === "newStreet" || e.target.id === "oldStreet") {
      var w = e.target.id.slice(0, 3); clearTimeout(stTimer[w]); stTimer[w] = setTimeout(function () { checkStreet(w); }, 500);
    }
  });
  $("f").addEventListener("change", function (e) {
    if (e.target.id === "rooms" || e.target.name === "supplies") fillKit();
    if (e.target.id === "newCity" || e.target.id === "oldCity") cityChanged(e.target.id.slice(0, 3));
    if (e.target.id === "newStreet" || e.target.id === "oldStreet") checkStreet(e.target.id.slice(0, 3));
    if (/^(new(City|Street|Num)|old(City|Street))$/.test(e.target.id)) { var w = e.target.id.slice(0, 3); afterTap(function () { refreshMap(w); }); }
    applyShowIf(); save();
  });
  $("f").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-map")) toggleMap(b.getAttribute("data-map"));
    else if (b.hasAttribute("data-fill")) fillSuggestion(b);
  });
  $("f").addEventListener("focusin", function (e) { if (e.target.id === "newCity" || e.target.id === "oldCity") loadCities(); });
  $("langSel").addEventListener("change", function (e) { setLang(e.target.value, true); });

  var armed = false;
  $("resetBtn").onclick = function () {
    if (!armed) { armed = true; $("resetBtn").textContent = t("reset.confirm"); setTimeout(function () { armed = false; $("resetBtn").textContent = t("reset.btn"); }, 4000); return; }
    try { localStorage.removeItem(KEY); } catch (e) {}
    done = {}; callsAsked = {}; submittedRef = ""; moversSent = null; suppliesSent = null; kitTouched = false; editToken = ""; armed = false; $("resetBtn").textContent = t("reset.btn");
    buildForm(null);
    showStep(0, true); toast(t("reset.done"));
  };

  // ---------- תפריט נגישות ----------
  var A11Y = "movers-a11y", prefs = { fs: "100", hc: false, ul: false, rf: false, nm: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(A11Y) || "{}")); } catch (e) {}
  function applyA11y() {
    document.documentElement.style.fontSize = prefs.fs + "%";
    ["hc", "ul", "rf", "nm"].forEach(function (k) { app.classList.toggle(k, !!prefs[k]); });
    document.querySelectorAll("[data-fs]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.fs === prefs.fs)); });
    document.querySelectorAll("[data-tog]").forEach(function (b) { b.setAttribute("aria-pressed", String(!!prefs[b.dataset.tog])); });
    try { localStorage.setItem(A11Y, JSON.stringify(prefs)); } catch (e) {}
    if (typeof artMotion === "function") artMotion();
  }
  function panel(open) {
    $("a11yPanel").hidden = !open; $("a11yBtn").setAttribute("aria-expanded", String(open));
    if (open) { $("a11yTitle").setAttribute("tabindex", "-1"); $("a11yTitle").focus(); } else $("a11yBtn").focus();
  }
  $("a11yBtn").onclick = function () { panel($("a11yPanel").hidden); };
  $("a11yClose").onclick = function () { panel(false); };
  $("a11yPanel").addEventListener("keydown", function (e) { if (e.key === "Escape") panel(false); });
  document.querySelectorAll("[data-fs]").forEach(function (b) { b.onclick = function () { prefs.fs = b.dataset.fs; applyA11y(); }; });
  document.querySelectorAll("[data-tog]").forEach(function (b) { b.onclick = function () { prefs[b.dataset.tog] = !prefs[b.dataset.tog]; applyA11y(); }; });
  $("a11yReset").onclick = function () { prefs = { fs: "100", hc: false, ul: false, rf: false, nm: false }; applyA11y(); toast(t("a11y.resetDone")); };
  applyA11y();

  // ---------- חלונות (הצהרת נגישות / פרטיות) ----------
  var opener = null;
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var dl = $(o.dataset.open); opener = o; if (dl.showModal) dl.showModal(); else dl.setAttribute("open", ""); }
    var c = e.target.closest("[data-close]");
    if (c) { c.closest("dialog").close(); }
  });
  document.querySelectorAll("dialog").forEach(function (dl) {
    dl.addEventListener("close", function () { if (opener) opener.focus(); });
    dl.addEventListener("click", function (e) { if (e.target === dl) dl.close(); });
  });

  // ---------- מצב בהיר / כהה ----------
  var TH = "avarnu-theme";
  try { var st = localStorage.getItem(TH); if (st === "dark" || st === "light") document.documentElement.setAttribute("data-theme", st); } catch (e) {}
  function curTheme() {
    var v = document.documentElement.getAttribute("data-theme"); if (v) return v;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function themeLabel() { $("themeBtn").textContent = curTheme() === "dark" ? t("theme.toLight") : t("theme.toDark"); }
  $("themeBtn").onclick = function () {
    var n = curTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem(TH, n); } catch (e) {}
    themeLabel();
  };

  // ---------- הפעלה ----------
  buildForm(null);
  applyStatic();
  load();
  try { localStorage.setItem(LANG_KEY, LANG); } catch (e) {}
  if (location.hash === "#done" && submittedRef) {
    step = LAST; hit("paid");
    showStep(step, true);
    toast(t("pay.ok"));
  } else if (location.hash === "#pay-cancel" && API) {
    submittedRef = "";
    showStep(STEPS.length - 1, false);
    var eb = $("errsum"); eb.innerHTML = "<h2>" + esc(t("err.payCancelT")) + "</h2><p>" + esc(t("err.payCancel")) + "</p>"; eb.hidden = false; eb.focus();
  } else if (location.hash === "#video") {
    // מצב הקלטה: רק הסרטון, על כל המסך (בשביל קובץ וידאו לרשתות)
    document.documentElement.classList.add("videomode");
    showStep(0, false);
    $("explainer").hidden = false; exShow(0);
    setTimeout(exPlay, 800);
  } else {
    showStep(step, false);
    if (restored && step < LAST) {
      var wb = $("welcome");
      wb.textContent = t("wb.back") + ($("tz") && !$("tz").value ? " " + t("wb.tz") : "");
      wb.hidden = false;
    }
  }
})();
