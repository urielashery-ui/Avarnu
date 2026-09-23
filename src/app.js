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
  function wantsQuotes(d) { return d.moveStatus === "quotes"; }
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
        { group: "g.newAddr", fields: [
          { id: "newStreet", req: true, w: 4, auto: "address-line1" },
          { id: "newNum", req: true, w: 2, auto: "off" },
          { id: "newCity", req: true, w: 4, list: "cities", auto: "address-level2" },
          { id: "newApt", w: 2, mode: "numeric" },
          { id: "zip", w: 3, mode: "numeric", max: 7, auto: "postal-code", ltr: true, check: "zip", hint: "f.zip.h" },
          { id: "floor", w: 3, mode: "numeric", max: 3 }
        ]},
        { group: "g.oldAddr", hint: "g.oldAddr.h", fields: [
          { id: "oldStreet", w: 4 }, { id: "oldApt", w: 2, mode: "numeric" }, { id: "oldCity", w: 6, list: "cities" }
        ]},
        { id: "moveDate", req: true, w: 3, type: "date", check: "date" },
        { id: "landlord", w: 3, hint: "f.landlord.h", showIf: function (d) { return d.tenure === "rent"; } }
      ]},
      { id: "moving", moving: true, fields: [
        { id: "moveStatus", type: "radio", req: true, w: 6, opts: opts(["quotes", "booked", "self"], "o.moveStatus.") },
        { id: "rooms", type: "select", req: true, w: 3, showIf: wantsQuotes, opts: [["", t("choose")], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", t("o.rooms.6")]] },
        { id: "oldFloor", w: 3, mode: "numeric", max: 2, hint: "f.oldFloor.h", showIf: wantsQuotes },
        { id: "elevChecks", type: "checks", w: 6, showIf: wantsQuotes, opts: opts(["oldElevator", "newElevator"], "o.") },
        { id: "dateFlex", type: "radio", w: 6, def: "exact", showIf: wantsQuotes, opts: opts(["exact", "flex"], "o.dateFlex.") },
        { id: "moveExtras", type: "checks", w: 6, showIf: wantsQuotes, opts: opts(["packing", "assembly", "storage"], "o.") },
        { id: "specialItems", w: 6, max: 120, hint: "f.specialItems.h", showIf: wantsQuotes },
        { id: "moversConsent", type: "consent", req: true, w: 6, showIf: wantsQuotes, note: LANG !== "he" ? "f.moversConsent.lang" : "" }
      ]},
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
    if (!MOVERS_ON) S = S.filter(function (s) { return !s.moving; });
    if (API) S.push({ id: "send", fields: [
      { id: "service", type: "radio", req: true, w: 6, def: "self", opts: [
        ["self", t("o.service.self") + priceTag(PAY && PAY.priceSelf)], ["concierge", t("o.service.concierge") + priceTag(PAY && PAY.priceConcierge)]] },
      { id: "consent", type: "consent", req: true, w: 6 },
      { id: "poa", type: "consent", req: true, w: 6, showIf: function (d) { return d.service === "concierge"; } },
      { id: "marketing", type: "consent", w: 6 }
    ]});
    return S;
  }
  var STEPS, LAST, allFields, fieldById;

  function stepLead(s) {
    var l = t("s." + s.id + ".lead");
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
    var hint = hintText ? '<p class="hint" id="' + hintId + '">' + esc(hintText) + "</p>" : "";
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
        return '<fieldset class="group"><legend>' + esc(t(f.group)) + "</legend>" + (f.hint ? '<p class="hint">' + esc(t(f.hint)) + "</p>" : "") +
          '<div class="grid">' + f.fields.map(fieldHTML).join("") + "</div></fieldset>";
      }
      return fieldHTML(f);
    }).join("");
    return '<section class="panel" data-step="' + i + '" aria-labelledby="h-' + i + '" hidden><h2 id="h-' + i + '" tabindex="-1">' + esc(t("s." + s.id + ".h")) +
      '</h2><p class="lead">' + esc(stepLead(s)) + '</p><div class="grid">' + body + "</div></section>";
  }
  function buildForm(keep) {
    STEPS = defineSteps(); LAST = STEPS.length; allFields = []; fieldById = {};
    $("steps").innerHTML = STEPS.map(stepHTML).join("") +
      '<datalist id="cities">' + C.cityList(LANG).map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("") + "</datalist>";
    if (keep) setData(keep);
    else {
      allFields.forEach(function (f) {
        if (f.def == null) return;
        if (f.type === "radio") { var r = $(f.id + "-" + f.def); if (r) r.checked = true; } else $(f.id).value = f.def;
      });
      if ($("xPost")) $("xPost").checked = true;
    }
  }

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

  var KEY = "movers-v3", step = 0, done = {}, submittedRef = "", paying = false, seen = {}, moversSent = null;
  function hit(k) {
    if (!API || seen[k]) return; seen[k] = true;
    try { fetch(API.replace(/\/$/, "") + "/hit", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: k }) }).catch(function () {}); } catch (e) {}
  }
  function save() {
    try {
      var d = data(); delete d.tz; delete d.consent; delete d.poa; delete d.marketing; delete d.moversConsent;
      localStorage.setItem(KEY, JSON.stringify({ d: d, done: done, step: step, ref: submittedRef, mv: moversSent }));
    } catch (e) {}
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (!s) return;
      var d = s.d || {}; delete d.tz; setData(d);
      done = s.done || {}; submittedRef = s.ref || ""; moversSent = s.mv || null;
      step = Math.min(s.step || 0, LAST);
      if (step === LAST && !submittedRef && API) step = LAST - 1;
    } catch (e) {}
  }

  function applyShowIf() {
    var d = data();
    allFields.forEach(function (f) { if (f.showIf) $("wrap-" + f.id).hidden = !f.showIf(d); });
  }

  // ---------- בדיקת תקינות ----------
  var checks = { tz: C.validTz, phone: C.validPhone, email: C.validEmail, zip: C.validZip, date: C.validDate };
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
    $("results").hidden = !res; $("nav").hidden = res; $("hero").hidden = n > 0; $("how").hidden = res || n > 0;
    $("progress").hidden = res;
    $("errsum").hidden = true;
    if (!res) {
      $("stepText").innerHTML = esc(t("step.of", { n: n + 1, total: STEPS.length })) + ' <span class="muted">' + esc(t("s." + STEPS[n].id + ".name")) + "</span>";
      $("stepBar").style.width = ((n + 1) / STEPS.length * 100) + "%";
      $("back").hidden = n === 0;
      $("next").textContent = n < STEPS.length - 1 ? t("nav.next") : (API ? t("nav.send") : t("nav.finish"));
    }
    applyShowIf();
    hit(res ? "results" : "step:" + n);
    if (res) render();
    updateLabel(); save();
    if (focus) {
      var h = res ? $("rTitle") : $("h-" + n);
      h.focus(); window.scrollTo({ top: 0, behavior: app.classList.contains("nm") ? "auto" : "smooth" });
    }
  }

  function updateLabel() {
    var d = data();
    $("lblFrom").textContent = C.addrL(d, "old", LANG) || t("label.fromEmpty");
    $("lblTo").textContent = C.addrL(d, "new", LANG) || t("label.toEmpty");
    $("lblDate").textContent = C.fmtDate(d.moveDate) || t("label.whenEmpty");
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
        li.querySelector("input").onchange = function (e) { done[i.id] = e.target.checked; li.classList.toggle("is-done", e.target.checked); tally(); save(); };
        ul.appendChild(li);
      });
      sec.appendChild(ul); box.appendChild(sec);
    });
    renderBenefits(d);
    renderMoving(d);
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
  }

  function setLang(l, focus) {
    if (C.LANGS.indexOf(l) < 0 || l === LANG) return;
    var keep = data(); keep.tz = $("tz") ? $("tz").value : "";
    ["consent", "poa", "marketing", "moversConsent"].forEach(function (k) { if ($(k)) keep[k] = $(k).checked; });
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
    if (API && step === STEPS.length - 1) { submitLead(); return; }
    showStep(step + 1, true);
  });
  $("back").onclick = function () { showStep(Math.max(0, step - 1), true); };
  $("editBtn").onclick = function () { showStep(0, true); };
  $("copyDossier").onclick = function () { copy($("dossier").textContent, t("dos.copied")); };
  $("f").addEventListener("input", function (e) {
    var f = fieldById[e.target.id] || fieldById[e.target.name];
    if (f && $(f.id + "-err") && !$(f.id + "-err").hidden) setErr(f, "");
    applyShowIf(); updateLabel(); save();
  });
  $("f").addEventListener("change", function () { applyShowIf(); save(); });
  $("langSel").addEventListener("change", function (e) { setLang(e.target.value, true); });

  var armed = false;
  $("resetBtn").onclick = function () {
    if (!armed) { armed = true; $("resetBtn").textContent = t("reset.confirm"); setTimeout(function () { armed = false; $("resetBtn").textContent = t("reset.btn"); }, 4000); return; }
    try { localStorage.removeItem(KEY); } catch (e) {}
    done = {}; submittedRef = ""; moversSent = null; armed = false; $("resetBtn").textContent = t("reset.btn");
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
  } else showStep(step, false);
})();
