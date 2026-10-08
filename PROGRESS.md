# Overnight security progress

Branch: `fix/overnight-security-20261008`. Scope: the five requested remediation stages; no production data, deployment, environment edits, or pushes.

## Completed findings

- 2.3: mapping creation now commits product/variant/image/INIT ledger/mapping/backfill in one transaction. Orphan-to-new-master backfill moved into its transaction. Added read-only orphan detector; PostgreSQL rollback test scheduled for stage 5.

- 2.2: zod rejects fractional/string/negative/out-of-range quantities; strict stock-in, adjustment and opname schemas; recursive quantity checks on JSON APIs; service guards prevent rounding in manual sales, orphan mapping and copied drafts. Integer-input tests passed.

- 1.1: centralized email/free-text masking; short phones and short addresses no longer reveal raw values. Order lists always masked; detail permission rechecked in DB and full access logged. PII regression test passed.
- 1.2: OAuth state is mandatory, timing-safe compared, and cookies cleared on every success/failure. Ten-minute cookies; fixed trusted app origin; TikTok authorize domain allowlist; cross-business shop takeover rejected. OAuth regression test passed.
- 1.3: safe-fetch resolves and rejects non-public addresses, pins validated DNS answers during connection, revalidates all redirects (max 3), and enforces byte/time limits. Product HTML and robots downloads use it; SSRF regression tests passed.
- 1.4: multipart request streams are bounded before parsing, file MIME/magic bytes are checked, empty/oversized files rejected (5MB images/10MB PDF). Single and batch label downloads use safe-fetch and PDF validation; label routes require PII permission. Upload tests passed.
- 1.5: every authenticated request rechecks DB user and PII permission, missing privilege claims deny access, JWT is restricted to HS256, tokenVersion revokes old sessions. Additive DB trigger increments version on password/PII changes; OAuth sessions use DB checks too. Prisma generate and auth policy tests passed.
- 1.6: Next/ESLint config upgraded to 16.4.0; deprecated request replaced across generated SDK imports by bounded native-fetch transport. Query/JSON/multipart transport tests passed; production dependency audit is zero. Remaining unpatched dev-only glob advisory recorded in TODO_REVIEW.
- 2.1: absolute stock adjustments read under SELECT FOR UPDATE. Opname finalization locks its record and applies snapshot differences to locked live stock, preserving intervening orders/restocks. Concurrent lock/ledger and snapshot regression test passed; real PostgreSQL concurrency verification scheduled for stage 5.

## Stage verification

- Stage 1: lint passes (25 existing warnings); Next 16.4 Webpack build passes; new security unit tests pass; production audit zero.

## Final verification
