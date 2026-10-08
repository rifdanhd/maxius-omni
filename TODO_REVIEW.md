# Review decisions and remaining work

Every unresolved item must include evidence, attempts where applicable, and an actionable next step. No production data was changed.

## Decisions

- APP_ORIGIN is the trusted public origin; production fallback is https://maxius.id. Proxy headers are never trusted. OAuth cookies use Secure in production and permit local HTTP in development only.
- Product copy retains public-domain compatibility instead of a marketplace-only allowlist. All DNS answers must be public and the connection is pinned; private/transition/documentation networks and nonstandard ports are rejected.

- Preserve masked order lists even for privileged users. Full PII is available only in audited detail/document flows.
- Database migrations are additive and are tested only against a dedicated local test database.

## Remaining items

- Dependency audit: production dependencies report zero vulnerabilities after Next 16.4.0 and removal of request. Full audit retains five high dev-tool findings in braces -> micromatch -> fast-glob -> Next ESLint plugin. Attempts: non-force audit fix, registry check (latest braces 3.0.3, advisory affects all releases), force fix dry-run (proposes eslint-config-next 14 downgrade with incompatible ESLint peer). Forced downgrade was not applied. Recheck upstream patched releases before CI accepts untrusted glob patterns.

## Build decisions

- Production build uses supported Webpack mode because baseline Turbopack failed with process/port permission errors both in sandbox and escalated during the previous audit. No application behavior is changed by this build mode.
