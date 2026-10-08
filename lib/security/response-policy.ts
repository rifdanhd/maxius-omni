import { maskEmail, maskPii } from "@/lib/utils/pii";

const secretKeys = new Set(["accessToken", "refreshToken", "clientSecret", "appSecret", "passwordHash", "rawPayload", "rawJson", "rawBody", "stack", "stackTrace"]);
const piiKeys = new Set(["buyerName", "buyerEmail", "recipientName", "recipientPhone", "recipientAddress", "buyerNote", "sellerNote", "buyerEvidence", "negotiation", "reasonText"]);

export function sanitizeApiPayload(value: unknown, allowPii: boolean): { value: unknown; fullPii: boolean } {
  let fullPii = false;
  function walk(item: unknown, inBuyer = false): unknown {
    if (Array.isArray(item)) return item.map(v => walk(v, inBuyer));
    if (!item || typeof item !== "object") return item;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(item)) {
      if (secretKeys.has(key)) continue;
      if (key === "docUrl") { out[key] = null; continue; }
      const pii = piiKeys.has(key) || (inBuyer && ["name", "email", "phone", "address"].includes(key));
      if (key === "pdfBase64" && raw) {
        if (!allowPii) { out[key] = null; continue; }
        fullPii = true;
      }
      if (pii && typeof raw === "string" && raw) {
        if (allowPii) { fullPii = true; out[key] = raw; }
        else out[key] = /email/i.test(key) ? maskEmail(raw) : maskPii(raw);
      } else out[key] = walk(raw, inBuyer || ["buyer", "recipient", "customer"].includes(key));
    }
    return out;
  }
  return { value: walk(value), fullPii };
}
