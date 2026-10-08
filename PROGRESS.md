# Overnight security progress

Branch: `fix/overnight-security-20261008`. Scope: the five requested remediation stages; no production data, deployment, environment edits, or pushes.

## Completed findings

- 1.1: centralized email/free-text masking; short phones and short addresses no longer reveal raw values. Order lists always masked; detail permission rechecked in DB and full access logged. PII regression test passed.
- 1.2: OAuth state is mandatory, timing-safe compared, and cookies cleared on every success/failure. Ten-minute cookies; fixed trusted app origin; TikTok authorize domain allowlist; cross-business shop takeover rejected. OAuth regression test passed.
- 1.3: safe-fetch resolves and rejects non-public addresses, pins validated DNS answers during connection, revalidates all redirects (max 3), and enforces byte/time limits. Product HTML and robots downloads use it; SSRF regression tests passed.
- 1.4: multipart request streams are bounded before parsing, file MIME/magic bytes are checked, empty/oversized files rejected (5MB images/10MB PDF). Single and batch label downloads use safe-fetch and PDF validation; label routes require PII permission. Upload tests passed.
- 1.5: every authenticated request rechecks DB user and PII permission, missing privilege claims deny access, JWT is restricted to HS256, tokenVersion revokes old sessions. Additive DB trigger increments version on password/PII changes; OAuth sessions use DB checks too. Prisma generate and auth policy tests passed.

## Stage verification

## Final verification
