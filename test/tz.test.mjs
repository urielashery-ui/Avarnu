// תעודת זהות: חובה רק למי שבוחר "תעדכנו בשבילי". מי שמעדכן לבד — לא צריך למסור.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLead } from "../server/validate.js";

const d = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
const base = { firstName: "דנה", lastName: "כהן", phone: "0541234567", email: "d@example.com", tenure: "rent",
  newStreet: "הרצל", newNum: "3", newCity: "חולון", moveDate: d, consent: true };

test("עדכון עצמי: אפשר בלי תעודת זהות, והיא לא נשמרת כאפסים", () => {
  const r = validateLead({ lead: { ...base, service: "self" } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.lead.tz, "");
});
test("\"תעדכנו בשבילי\": תעודת זהות חובה ותקינה", () => {
  assert.equal(validateLead({ lead: { ...base, service: "concierge", poa: true } }).errors.tz, "חסר מספר תעודת זהות");
  assert.match(validateLead({ lead: { ...base, service: "concierge", poa: true, tz: "123456789" } }).errors.tz, /לא תקין/);
  const ok = validateLead({ lead: { ...base, service: "concierge", poa: true, tz: "12345678-2" } });
  assert.equal(ok.ok, true); assert.equal(ok.lead.tz, "123456782");
});
