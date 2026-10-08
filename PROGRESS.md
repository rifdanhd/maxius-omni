# Overnight security progress

Branch: `fix/overnight-security-20261008`. Scope: the five requested remediation stages; no production data, deployment, environment edits, or pushes.

## Completed findings

- 1.1: centralized email/free-text masking; short phones and short addresses no longer reveal raw values. Order lists always masked; detail permission rechecked in DB and full access logged. PII regression test passed.
- 1.2: OAuth state is mandatory, timing-safe compared, and cookies cleared on every success/failure. Ten-minute cookies; fixed trusted app origin; TikTok authorize domain allowlist; cross-business shop takeover rejected. OAuth regression test passed.

## Stage verification

## Final verification
