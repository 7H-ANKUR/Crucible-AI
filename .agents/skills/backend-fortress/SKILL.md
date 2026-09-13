---
name: backend-fortress
description: Use when creating or reviewing ANY backend code — APIs, services, controllers, middleware, auth, webhooks, jobs, server config, deployment. Enforces layered architecture, strict schema validation of every input, OWASP Top 10 hardening, secure authentication and authorization, safe error handling, structured observability, and dependency hygiene. A feature is never "done" until it passes this skill's security checklist. Works for Node/Express, NestJS, Fastify, FastAPI, Django, Flask, Go, Spring.
---

# Backend Fortress — Secure-by-Default Manual

You are a senior backend engineer AND an adversarial security reviewer. Treat every endpoint as an attack surface and every input as hostile. You ship features complete and hardened — never complete-but-soft.

## 0. Prime Directives

1. **Validate everything.** Body, query, params, headers, cookies, files, webhook payloads, queue messages — schema-validated, whitelisted, strict.
2. **Authorize every access.** Authentication ≠ authorization. Every resource access proves the caller owns it. Deny by default.
3. **Never trust the client.** userId, price, role, tenant, plan, "is admin" flags — all derived server-side from the verified session.
4. **Fail closed.** On error, ambiguity, or missing config → deny, not allow.
5. **Secrets never exist in code, logs, responses, or error messages.**
6. **Observability from day one** — you can't secure what you can't see.

---

## 1. Layered Architecture (enforced structure)

```
src/
  routes/        # HTTP wiring only — verbs, paths, middleware chains
  controllers/   # parse → validate → call ONE service → shape response
  services/      # business logic, transactions, AUTHORIZATION decisions
  repositories/  # data access ONLY — parameterized queries, no logic
  models/        # schemas, entities, constraints
  middleware/    # auth, rate limit, request-id, error handler
  lib/           # clients (email, payments, storage), utils
  config/        # env parsing & validation (fails boot if invalid)
```
Hard rules: no SQL in controllers; no business logic in routes; no `req`/`res` in services; services throw typed domain errors; one global error handler translates them to HTTP. A service must be callable from a job/queue/CLI with the same authorization semantics.

---

## 2. Input Validation — the absolute law

- **Library per stack:** Zod (TS), Pydantic v2 (Python), Joi/Fastify schema, class-validator (Nest), validator + Echo binding (Go), Bean Validation (Spring).
- Validate at the boundary. Reject unknown fields (`.strict()` / forbid extra). Validate: type, format (uuid/email/url/date), length bounds, numeric range + int-ness, enum membership, array size, nesting depth.
- Query params and path params too — `?sort=;DROP TABLE` and `/users/1;--` are inputs.
- Files: validate size, MIME by content sniffing, extension allow-list — see section 8.
- Pagination params: page/limit clamped (limit ≤ 100), sort whitelisted against a column allow-list — never interpolate `sort` into SQL.
- On failure: 400/422 with `{ "error": { "code": "VALIDATION_FAILED", "details": [{ "field": "items[0].quantity", "message": "must be >= 1" }] } }`.

```ts
// TS reference shape
const CreateOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
  })).min(1).max(50),
  coupon: z.string().regex(/^[A-Z0-9]{4,20}$/).optional(),
}).strict();
```

---

## 3. Authentication

### Passwords
- **argon2id** (preferred) or bcrypt cost ≥ 12. Never MD5/SHA1/SHA256-alone.
- Policy: min 8–12 chars, check against breached-password list, no forced rotation, no composition rules theatre.
- Login errors always generic: `Invalid email or password` — never reveal which. Same latency for unknown user vs wrong password (hash a dummy on unknown user).
- **Login brute-force:** rate limit per-IP (e.g. 5/5min) AND per-account with exponential backoff/lockout + notify user. CAPTCHA after repeated failures.

### Sessions (preferred for web apps)
- httpOnly + Secure + SameSite=Lax (Strict if no cross-site entry) cookies, server-side session store, rotation on login/privilege change, absolute expiry (days) + idle expiry, server-side revoke all on password change/reset. Session ID ≥ 128 bits random.

### JWT (if stateless required)
- Access token TTL ≤ 15 min. Refresh tokens: stored httpOnly, **rotated on use with reuse detection** (presented-but-already-used refresh ⇒ revoke the whole family — it's theft). Audience + issuer + algorithm pinned server-side (alg-confusion is a classic vuln — never trust header `alg`, allow-list `RS256`/`ES256`). Never localStorage. Claims minimal — authorization re-checked server-side per request, not baked into a long-lived role claim.

### Password reset
- Token: single-use, ≥ 128-bit random, hashed at rest, expires ≤ 30 min, invalidates all sessions on success, response identical whether email exists (no enumeration). Rate-limit requests. Invalidate old token on new request.

### Email verification / MFA / OAuth
- Verification: signed, expiring links; don't lock login behind it silently — restrict sensitive actions instead.
- MFA: TOTP with QR + backup codes shown once, stored hashed. MFA code attempts rate-limited.
- OAuth: Authorization Code + PKCE only. Validate `state`, exact redirect URI (no wildcard), `nonce` for OIDC. Never the implicit flow. Store provider IDs, don't auto-link accounts by email (account takeover vector).

---

## 4. Authorization

- **RBAC baseline** (roles: admin/member/viewer...), **ABAC/policy where needed** (ownership, tenant, plan limits). Enforce in services via a `can(user, action, resource)` check — never only in the route (route-level is defense-in-depth, service-level is the law).
- Maintain an explicit permission matrix: role × action × resource. Review every new endpoint against it.
- **IDOR — the #1 killer.** Every fetch/mutation is scoped:
```ts
// WRONG
const invoice = await repo.findInvoice(req.params.id);
// RIGHT
const invoice = await repo.findInvoice({ id: req.params.id, orgId: user.orgId });
if (!invoice) throw new NotFound();  // 404, not 403 — don't confirm existence
```
- UUIDs make enumeration hard, they are NOT access control.
- Admin checks on admin routes AND in the service. Horizontal (same role, other user) AND vertical (role escalation) both tested.
- Mass assignment: whitelist fields — `role`, `plan`, `balance`, `verified` never accepted from client payloads.

---

## 5. OWASP Hardening Catalog — run through ALL of it

| Threat | Rule |
|---|---|
| SQL/NoSQL injection | Parameterized only. One string-concatenated query = critical. NoSQL: operators in body (`{"$gt":""}`) stripped by strict schemas. ORM `raw()` audited. |
| Broken auth | Section 3 entirely. |
| Sensitive data exposure | TLS everywhere (HSTS), encrypt PII at rest (field-level for crown jewels), never return secrets/tokens/hidden fields, log redaction. |
| XXE | Disable XML external entity parsing. Prefer JSON. |
| Broken access control | Section 4. Default deny. 404 vs 403 semantics. |
| Security misconfig | helmet-equivalent headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` / `frame-ancestors`, `Referrer-Policy`, CSP. Disable debug/stack in prod. CORS: explicit origin allow-list, credentials never with `*`. |
| XSS (server side) | If the API returns HTML anywhere: context-aware escaping. Otherwise set `Content-Type: application/json` and never `text/html` for user data. |
| Insecure deserialization | Never `eval`/`pickle`/`Function()` on external data. JSON.parse only. Signed + versioned payloads for anything privileged. |
| Known vulnerable deps | Lockfiles committed; `npm audit`/`pip-audit`/`govulncheck` in CI; Dependabot/Renovate; pin versions. |
| Insufficient logging | Section 6 — log auth events, permission denials, rate-limit hits, with request IDs. |

Plus:
- **CSRF** (cookie auth): double-submit token or synchronizer pattern; SameSite as extra, not the only defense. Exempted only header-token APIs.
- **SSRF:** outbound fetch allow-list (scheme https only, resolved IP must not be private/link-local/loopback — check AFTER DNS resolution), no redirects to arbitrary hosts, no user-supplied URLs to internal services, timeouts.
- **Open redirects:** `redirect` params validated against allow-list.
- **Mass email/invite abuse:** per-sender quotas.
- **GraphQL:** depth/complexity limits, disable introspection in prod, persisted queries for public APIs, auth in resolvers not just gateway.
- **Webhooks (inbound):** verify HMAC-SHA256 signature (constant-time compare), timestamp window (±5 min) against replay, raw-body parsing before JSON decode, idempotent handlers.
- **Webhooks (outbound):** sign with secret, include event id + timestamp, retry with backoff, dead-letter after N attempts.
- **Rate limiting:** token bucket / sliding window, Redis-backed for multi-instance. Tiers: login 5/5min/IP+account, auth-adjacent (reset, MFA) 3–10/min, writes 30–60/min/user, reads 100–300/min/user, expensive (export, search) 10/min. Respond 429 + `Retry-After`.

---

## 6. Error Handling & Observability

- One global error handler. Typed domain errors → codes + HTTP status. Anything unhandled → 500 with opaque body; full detail to logs keyed by request id echoed in response (`"error": {"code": "INTERNAL", "requestId": "..."}`).
- Response shape everywhere: `{ "error": { "code": "MACHINE_READABLE_CODE", "message": "human message", "details"?: [...] } }`. Never: stack traces, file paths, SQL, driver errors, library names in prod.
- **Logging:** structured JSON (level, time, request-id, route, user-id, org-id, latency, status). PII redacted (emails masked `p***@x.com`). Security events logged as their own category: login success/fail, password change, MFA changes, permission denied, rate limit trips, webhook signature failures.
- **Audit log** (DB table) for sensitive mutations: who, what, when, before/after, IP. Append-only.
- Request ID middleware: generate/propagate `x-request-id` through service calls and logs. Health endpoints: `/healthz` (liveness) and `/readyz` (readiness — actually pings DB/queue).

---

## 7. API Craft

- Status codes exactly: 200 read, 201 create (+`Location`), 204 delete, 400 malformed, 401 unauthenticated, 403 forbidden, 404 not found (also for "exists but not yours"), 409 conflict, 422 semantically invalid, 429 throttled, 500 us.
- REST resource naming: plural nouns, nesting ≤ 2 (`/orgs/:orgId/invoices/:id`). Versioned: `/api/v1`. Breaking changes ⇒ new version.
- **Idempotency:** mutations with side effects (payments, orders) accept `Idempotency-Key` header; store key + request hash + response; same key + same body ⇒ replay stored response; same key + different body ⇒ 409.
- Pagination default on all lists: cursor/keyset for big tables. Filtering via whitelisted params only.
- Timeouts: inbound body limit (1–10MB), request timeout; outbound clients (HTTP, DB, Redis) each with connect+read timeouts and retry-with-jitter (retries only idempotent calls).
- Background jobs: idempotent handlers, at-least-once assumed, poison messages to DLQ, no secrets in payloads.

---

## 8. File Uploads (full hardening path)

1. Size cap enforced BEFORE full read (stream + abort).
2. Extension allow-list → MIME sniffed from content (file-type/magic), never trust client MIME.
3. Randomize stored name (UUID + safe ext); store outside web root / object storage with no exec permission.
4. Strip/validate metadata; guard against decompression bombs (zip: entry count + total uncompressed size caps; images: re-encode).
5. Serve with `Content-Disposition: attachment` or from a separate cookieless domain; `X-Content-Type-Options: nosniff`.
6. Antivirus hook if user-facing; async scan then mark clean.
7. Per-user quota + rate limit on uploads.

---

## 9. Secrets & Configuration

- Boot-time env validation (fail fast, list all missing at once). `.env` gitignored; `.env.example` with every var documented, no real values. 12-factor config.
- Secret rotation supported (read from env/vault at runtime; dual-valid window for keys).
- Never in: code, git history (pre-commit secret scanner), logs, error reporters, client bundles. Grep for `sk_live`, `-----BEGIN`, `password =` before every commit claim.

---

## 10. Infrastructure & Supply Chain

- Docker: non-root user, read-only rootfs, dropped capabilities, pinned base image digests, multi-stage builds, no secrets in build args/layer history, healthcheck defined.
- CI runs: lint, typecheck, tests, `npm audit`/`pip-audit`, secret scan, SAST if available.
- Dependency rule: official registry only, lockfile committed, no `latest`, review anything with known advisories.

---

## 11. Self-Attack Probes (run mentally/write tests for every endpoint)

```
# IDOR — does this return someone else's data?
curl -H "Authorization: Bearer $USER_A_TOKEN" /api/v1/invoices/{B_INVOICE_ID}   → expect 404
# Role escalation
curl -H "..." -X PATCH /api/v1/users/me -d '{"role":"admin"}'                    → expect 422/400
# Injection
POST /api/v1/search -d '{"q": "'; DROP TABLE users; --"}'                        → expect 400 or safe result
POST /api/v1/search -d '{"q": {"$ne": null}}'                                    → expect 400 (NoSQL operator)
# Unauthenticated
curl /api/v1/admin/users                                                           → expect 401
# Rate limit
for i in $(seq 1 10); do curl -X POST /api/v1/auth/login ...; done               → expect 429 by #6
# Oversize / malformed
Content-Length: 999999999 / body: "not json" / depth-1000 nested JSON             → expect 413/400, never 500
```
Every probe should produce a clean 4xx + a log line — never a 500, never another user's data.

---

## 12. Pre-Done Security Checklist — all boxes before "done"

- [ ] Every input (body/query/params/headers/files) schema-validated, strict, bounded
- [ ] Zero interpolated queries (grep: `raw(`, `+ "`, f-strings with SQL)
- [ ] Ownership/tenant checked on every read + write of every resource
- [ ] Permission matrix updated; new endpoint listed with roles
- [ ] Auth: strong hashing, rate-limited, generic errors, no enumeration, secure cookies/rotating tokens
- [ ] Password reset: single-use, expiring, session-invalidation, enumeration-safe
- [ ] Security headers set; CORS allow-listed; CSRF protection if cookies
- [ ] Rate limits on auth + writes + expensive endpoints, 429 + Retry-After
- [ ] Uploads: capped, sniffed, renamed, stored safely, served safely
- [ ] Webhooks: HMAC-verified, replay-protected, idempotent
- [ ] Idempotency keys on payment/order-class mutations
- [ ] Global error handler: typed errors, no stacks/paths/SQL in responses
- [ ] Structured logs + request IDs + security-event logging + audit table
- [ ] Secrets: env-only, boot-validated, absent from code/logs/history
- [ ] Outbound HTTP: allow-listed/SSRF-guarded, timeouts, safe retries
- [ ] Dependencies: lockfile, audit clean, no unpinned
- [ ] Docker: non-root, pinned, healthchecked
- [ ] The section-11 probes all return clean denials
