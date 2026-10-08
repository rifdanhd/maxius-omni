# Review decisions and remaining work

Every unresolved item must include evidence, attempts where applicable, and an actionable next step. No production data was changed.

## Decisions

- Session tokens stay in httpOnly cookies; API Bearer remains supported for non-browser tooling but tokens are not returned by browser login. Cookie mutations require exact trusted Origin. Business selection reissues a server-signed cookie after membership validation; query parameters no longer control data scope.
- Roles are per UserBusiness: existing bootstrap username admin becomes owner; other memberships default staff. Staff can perform operational stock/fulfillment actions; store configuration, inventory settings, price/promotion writes and OAuth require owner/admin. Review existing membership assignments before deploying.
- Rate limiter is bounded, fail-closed in-memory (no Redis present); login has global and per-username budgets, sensitive routes per-user budgets. Multi-process/replica deployments must add a shared Redis/WAF limiter before scaling. Forwarded IP headers are intentionally not trusted.

- APP_ORIGIN is the trusted public origin; production fallback is https://maxius.id. Proxy headers are never trusted. OAuth cookies use Secure in production and permit local HTTP in development only.
- Product copy retains public-domain compatibility instead of a marketplace-only allowlist. All DNS answers must be public and the connection is pinned; private/transition/documentation networks and nonstandard ports are rejected.

- Preserve masked order lists even for privileged users. Full PII is available only in audited detail/document flows.
- Database migrations are additive and are tested only against a dedicated local test database.

## Remaining items

- PAUSED at user's request. Stage 4 sibling files are modified but untracked by maxius-platform Git; capture reviewable legacy patches on resume. Native-fetch replacement for the legacy request dependency is still pending. Final route/PII bypass review, lint-warning cleanup, isolated PostgreSQL migration/integration/E2E checks, and CHANGELOG_OVERNIGHT.md remain outstanding.

- Fulfillment shipping/pickup/Shopee remote writes still need a dedicated command outbox and provider-specific reconciliation for ambiguous network results. The critical stock path is now durable: every ledger insert creates an outbox event in the same DB transaction; worker converts it into retryable/idempotent absolute-set SyncJobs. No external calls are made inside that transaction. Existing fulfillment API contract is retained; do not treat shipping retries as inherently idempotent. Before deployment, run the stock worker separately and schedule fulfillment reconciliation.

- Dependency audit: production dependencies report zero vulnerabilities after Next 16.4.0 and removal of request. Full audit retains five high dev-tool findings in braces -> micromatch -> fast-glob -> Next ESLint plugin. Attempts: non-force audit fix, registry check (latest braces 3.0.3, advisory affects all releases), force fix dry-run (proposes eslint-config-next 14 downgrade with incompatible ESLint peer). Forced downgrade was not applied. Recheck upstream patched releases before CI accepts untrusted glob patterns.

## Build decisions

- Production build uses supported Webpack mode because baseline Turbopack failed with process/port permission errors both in sandbox and escalated during the previous audit. No application behavior is changed by this build mode.
