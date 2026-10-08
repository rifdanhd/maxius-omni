# Review decisions and remaining work

Every unresolved item must include evidence, attempts where applicable, and an actionable next step. No production data was changed.

## Decisions

- APP_ORIGIN is the trusted public origin; production fallback is https://maxius.id. Proxy headers are never trusted. OAuth cookies use Secure in production and permit local HTTP in development only.
- Product copy retains public-domain compatibility instead of a marketplace-only allowlist. All DNS answers must be public and the connection is pinned; private/transition/documentation networks and nonstandard ports are rejected.

- Preserve masked order lists even for privileged users. Full PII is available only in audited detail/document flows.
- Database migrations are additive and are tested only against a dedicated local test database.

## Remaining items
