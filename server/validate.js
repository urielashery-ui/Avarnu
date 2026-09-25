// בדיקת הפנייה בשרת. לא סומכים על הדפדפן: בודקים הכול מחדש, ובונים את רשימת הגופים מחדש.
import "../src/i18n/he.js";
import "../src/i18n/en.js";
import "../src/i18n/ru.js";
import "../src/i18n/ar.js";
import "../src/catalog.js";
const C = globalThis.MoversCatalog;

const TEXT = ["firstName", "lastName", "tz", "phone", "email", "people", "newStreet", "newNum", "newApt", "newCity", "zip", "floor",
  "oldStreet", "oldApt", "oldCity", "moveDate", "landlord", "elecContract", "elecMeter", "elecRead", "elecSupplier",
  "waterMeter", "waterRead", "gas", "gasRead", "isp", "tv", "mobile", "hmo", "bank", "card", "tenure", "service", "kidsCount",
  "moveStatus", "rooms", "oldFloor", "dateFlex", "specialItems", "lang",
  "supplies", "suppliesFrom", "suppliesDate", "suppliesTo"].concat(C.KIT);
const BOOL = ["xCar", "xKids", "xInsurance", "xPension", "xEmployer", "xPost", "consent", "poa", "marketing",
  "oldElevator", "newElevator", "packing", "assembly", "storage", "moversConsent", "suppliesConsent"].concat(Object.keys(C.householdLabels));
const ENUMS = {
  tenure: ["rent", "own"], service: ["self", "concierge"], elecSupplier: ["", "iec", "private"],
  gas: ["", "אמישראגז", "פזגז", "סופרגז", "central", "אחר"],
  isp: ["", "בזק", "HOT", "פרטנר", "סלקום", "אחר"], tv: ["", "yes", "HOT", "פרטנר", "סלקום", "אחר"],
  lang: ["", "he", "en", "ru", "ar"], moveStatus: ["", "quotes", "booked", "self"], rooms: ["", "1", "2", "3", "4", "5", "6"], dateFlex: ["", "exact", "flex"],
  supplies: ["", "none", "need"], suppliesFrom: ["", "movers", "delivery", "self"], suppliesTo: ["", "old", "new"],
  mobile: ["", "פלאפון", "סלקום", "פרטנר", "הוט מובייל", "גולן טלקום", "אחר"], hmo: ["", "כללית", "מכבי", "מאוחדת", "לאומית"]
};
const REQUIRED = {
  firstName: "חסר שם פרטי", lastName: "חסר שם משפחה", phone: "חסר מספר טלפון",
  newStreet: "חסר רחוב חדש", newNum: "חסר מספר בית", newCity: "חסרה עיר חדשה", moveDate: "חסר תאריך מעבר",
  tenure: "חסר סוג מגורים", service: "חסרה בחירת שירות"
};

export function validateLead(input) {
  const src = (input && typeof input === "object" && input.lead && typeof input.lead === "object") ? input.lead : null;
  if (!src) return { ok: false, errors: { _: "הבקשה ריקה" } };
  const lead = {}, errors = {};
  for (const k of TEXT) {
    const v = src[k];
    lead[k] = typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, 120) : "";
  }
  for (const k of BOOL) lead[k] = src[k] === true;
  for (const [k, msg] of Object.entries(REQUIRED)) if (!lead[k]) errors[k] = msg;
  for (const [k, list] of Object.entries(ENUMS)) if (lead[k] && !list.includes(lead[k])) errors[k] = "ערך לא מוכר";
  if (lead.tz && !C.validTz(lead.tz)) errors.tz = "מספר תעודת זהות לא תקין";
  if (lead.phone && !C.validPhone(lead.phone)) errors.phone = "מספר טלפון לא תקין";
  if (lead.email && !C.validEmail(lead.email)) errors.email = "כתובת מייל לא תקינה";
  if (lead.zip && !C.validZip(lead.zip)) errors.zip = "מיקוד לא תקין";
  if (lead.moveDate && !C.validDate(lead.moveDate)) errors.moveDate = "תאריך לא תקין";
  if (lead.moveStatus === "quotes") {
    if (!lead.rooms) errors.rooms = "חסר מספר חדרים";
    if (!lead.moversConsent) errors.moversConsent = "חסרה הסכמה להעביר את הפרטים למובילים";
  } else lead.moversConsent = false;
  // קרטונים וחומרי אריזה
  if (lead.supplies === "need") {
    if (!lead.rooms) errors.rooms = "חסר מספר חדרים";
    for (const k of C.KIT) if (lead[k] && !/^\d{1,3}$/.test(lead[k])) errors[k] = "כמות לא תקינה";
    lead.suppliesFrom = lead.suppliesFrom || "self";
    if (lead.suppliesFrom === "movers" && lead.moveStatus !== "quotes") errors.suppliesFrom = "המובילים יביאו קרטונים רק אם ביקשתם הצעות ממובילים";
    if (lead.suppliesFrom === "delivery") {
      if (!C.validDate(lead.suppliesDate)) errors.suppliesDate = "תאריך משלוח לא תקין";
      else if (lead.moveDate && lead.suppliesDate > lead.moveDate) errors.suppliesDate = "המשלוח צריך להגיע לפני יום המעבר";
      lead.suppliesTo = lead.suppliesTo || "old";
      if (lead.suppliesTo === "old" && !(lead.oldStreet && lead.oldCity)) errors.suppliesTo = "חסרה הכתובת הנוכחית למשלוח";
      if (!lead.suppliesConsent) errors.suppliesConsent = "חסרה הסכמה להעביר את הפרטים לספק האריזות";
    } else { lead.suppliesConsent = false; lead.suppliesDate = ""; lead.suppliesTo = ""; }
  } else {
    lead.supplies = lead.supplies || "none"; lead.suppliesFrom = ""; lead.suppliesDate = ""; lead.suppliesTo = ""; lead.suppliesConsent = false;
    for (const k of C.KIT) lead[k] = "";
  }
  for (const k of ["people", "kidsCount", "oldFloor", "floor"]) if (lead[k] && !/^\d{1,2}$/.test(lead[k])) errors[k] = "מספר לא תקין";
  if (!lead.consent) errors.consent = "חסרה הסכמה לשמירת הפרטים";
  if (lead.service === "concierge" && !lead.poa) errors.poa = "חסרה הסכמה לפנייה בשמכם";
  // תעודת זהות: רק למי שביקש שנעדכן בשבילו (הגופים מבקשים אותה). מי שמעדכן לבד — לא צריך למסור.
  if (lead.service === "concierge" && !lead.tz) errors.tz = "חסר מספר תעודת זהות";
  if (lead.service === "self" && !lead.email) errors.email = "כדי שנשלח לכם את הרשימה, צריך מייל";
  lead.tz = lead.tz ? C.digits(lead.tz).padStart(9, "0") : "";
  lead.lang = lead.lang || "he";
  // עיר בכל שפה (Haifa / Хайфа / حيفا) נשמרת בשם הקנוני בעברית — בשביל התאמת מובילים וקישורים
  lead.newCity = C.canonCity(lead.newCity); lead.oldCity = C.canonCity(lead.oldCity);
  if (!Object.keys(errors).length) {
    lead.checklist = C.build(lead).map((i) => ({ id: i.id, title: i.t, auto: !!i.auto }));
    lead.benefits = C.benefits(lead).map((b) => ({ id: "b:" + b.id, title: "הנחה: " + b.t, sure: b.sure, amount: b.amount }));
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, lead };
}

export { C as catalog };
