// הצפנת פרטי הלקוח (AES-256-GCM). כל פנייה נשמרת מוצפנת בשלמותה.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export function makeCrypto(hexKey) {
  const key = Buffer.from(hexKey, "hex");
  return {
    encrypt(obj) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
      return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
    },
    decrypt(s) {
      if (!s || !s.startsWith("v1:")) throw new Error("פורמט הצפנה לא מוכר");
      const b = Buffer.from(s.slice(3), "base64");
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
    }
  };
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sign(secret, body) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newRef() {
  const b = randomBytes(6);
  return "MV-" + Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
}
