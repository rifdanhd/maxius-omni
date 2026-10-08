import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
const require = createRequire(import.meta.url);
const { webhookGuard, seedCredentials } = require("../../backend/security/legacy-guard.js");
const reply = { code: 0, status(n: number) { this.code = n; return this; }, json() { return this; } };
const env = { ...process.env };
try {
  delete process.env.LEGACY_BACKEND_ENABLED;
  webhookGuard({ headers: {} }, reply, () => assert.fail("disabled bypass")); assert.equal(reply.code, 410);
  process.env.LEGACY_BACKEND_ENABLED = "true"; process.env.LEGACY_WEBHOOK_SECRET = "test-secret-with-more-than-32-characters";
  webhookGuard({ headers: {} }, reply, () => assert.fail("unsigned bypass")); assert.equal(reply.code, 401);
  const timestamp = String(Math.floor(Date.now() / 1000)), eventId = "event-1", rawBody = Buffer.from("{}");
  const signature = createHmac("sha256", process.env.LEGACY_WEBHOOK_SECRET).update(`${timestamp}.${eventId}.`).update(rawBody).digest("hex");
  let called = false;
  const req = { headers: { "x-legacy-timestamp": timestamp, "x-legacy-event-id": eventId, "x-legacy-signature": signature }, rawBody };
  webhookGuard(req, reply, () => { called = true; }); assert.equal(called, true);
  webhookGuard(req, reply, () => assert.fail("replay bypass")); assert.equal(reply.code, 200);
  delete process.env.LEGACY_ADMIN_PASSWORD; assert.throws(seedCredentials);
} finally { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
console.log("Legacy disabled/signature/replay/seed tests passed");
