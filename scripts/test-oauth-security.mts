import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { validOAuthState, clearOAuthCookies } from "../lib/security/oauth";
import { appOrigin } from "../lib/utils/request-origin";

assert.equal(validOAuthState(undefined, "evil"), false);
assert.equal(validOAuthState("good", null), false);
assert.equal(validOAuthState("good", "evil"), false);
assert.equal(validOAuthState("good", "good"), true);
const res = clearOAuthCookies(NextResponse.json({}), "shopee");
assert.equal(res.cookies.get("shopee_oauth_state")?.value, "");
const req = new NextRequest("http://localhost:3000/callback", { headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } });
assert.equal(appOrigin(req), "http://localhost:3000");
console.log("OAuth security tests passed");
