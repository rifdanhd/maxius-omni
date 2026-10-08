import assert from "node:assert/strict";
import { isPublicIp, validateFetchUrl, safeFetch } from "../lib/security/safe-fetch";
for (const ip of ["0.0.0.0", "127.0.0.1", "10.1.1.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
  assert.equal(isPublicIp(ip), false, ip);
}
assert.equal(isPublicIp("8.8.8.8"), true);
assert.equal(isPublicIp("2606:4700:4700::1111"), true);
for (const url of ["file:///etc/passwd", "http://127.1", "http://2130706433", "http://169.254.169.254", "http://[::1]", "http://user:pass@example.com", "http://example.com:5432"]) assert.throws(() => validateFetchUrl(url));
await assert.rejects(safeFetch("http://127.0.0.1"));
assert.throws(() => validateFetchUrl("https://shopee.co.id.evil.com", ["shopee.co.id"]));
console.log("Safe fetch SSRF tests passed");
