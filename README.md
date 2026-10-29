# Lokal Lens API

Backend foundation using Node.js 22.17+, Express 5, MongoDB, Mongoose 8, JavaScript ES modules, Zod, Helmet, CORS, Morgan and express-rate-limit. Node's test runner and Supertest cover the application; mongodb-memory-server provides an isolated real MongoDB for integration checks.

## Structure

```text
Server/
  src/
    config/       Environment validation and MongoDB lifecycle
    controllers/  Health response
    middleware/   Request validation, errors and 404s
    models/       User, Category, Business and shared field rules
    routes/       /api/v1 router
    services/     Reserved for future business logic
    utils/        AppError and response helpers
    validators/   Pagination validation example
    app.js        Express configuration; no listening or DB connection
    server.js     Environment loading, DB connection, startup and shutdown
  tests/          Database-free tests, integration tests and temporary DB helper
  .env.example
  .gitignore
  package.json
  package-lock.json
```

## Install and run

```powershell
cd Server
npm install
Copy-Item .env.example .env
```

Edit `.env`: set `MONGODB_URI` to a running local MongoDB or your own MongoDB URI. Generate **two separate** secrets with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and replace both JWT placeholders. JWT variables are validated for future authentication; no JWT flows exist yet. No credentials are included in the repository.

| Variable | Meaning |
| --- | --- |
| NODE_ENV | development, test or production; default development |
| PORT | Integer 1–65535; default 5000 |
| MONGODB_URI | Required MongoDB connection URI |
| JWT_ACCESS_SECRET | Required random secret, at least 32 characters |
| JWT_REFRESH_SECRET | Required different random secret, at least 32 characters |
| CLIENT_URL | Required single HTTP(S) origin, no path or trailing slash |
| TRUST_PROXY | Optional trusted proxy hop count (for example `1`) or comma-separated trusted proxy IPs/CIDRs; default disabled |
| GOOGLE_PLACES_API_KEY | Optional server-only Places API (New) key; see [Google Places setup](./docs/google-places.md) |
| GOOGLE_PLACES_REVIEW_MODE | `rating` (default) or explicitly enabled `reviews` mode |
| GOOGLE_PLACES_RATE_LIMIT_MAX | Google reviews endpoint requests per client IP per 15 minutes; default 20 |

```powershell
npm run dev
# Or without file watching:
npm start
```

Startup validates environment configuration, connects MongoDB, then opens the HTTP port. Initial connection failure exits nonzero. SIGINT/SIGTERM drain HTTP requests and close MongoDB with a 10-second shutdown deadline. Uncaught exceptions and rejected promises also trigger shutdown with failure status. Logs never print connection URIs or raw driver errors.

## Health and responses

```powershell
Invoke-RestMethod https://directory-backend-ai6r.onrender.com/api/v1/health | ConvertTo-Json -Depth 5
```

Healthy responses use HTTP 200:

```json
{"success":true,"message":"Lokal Lens API is healthy","data":{"status":"ok","database":"connected","environment":"development","uptime":1,"timestamp":"2026-09-14T00:00:00.000Z"}}
```

Disconnected MongoDB returns HTTP 503 with `{"success":false,"message":"Database unavailable","errors":[]}`. Health checks use Mongoose connection state, not a per-request database ping. Unknown paths return 404. JSON parsing, request size, rate limit, validation, duplicate key and cast errors share the error shape. Production errors omit internal details; development adds only the error type for server failures, never raw driver messages or stacks.

Bodies are limited to 100 KB and URL-encoded requests to 100 parameters. API traffic is limited to 100 requests per client IP per 15 minutes, including health. CORS permits the configured client origin. Rate limits use a per-process memory store; a multi-instance deployment will need a shared store. Configure only the actual proxy IPs/CIDRs or known proxy hop count when deploying behind a proxy. For Render's single proxy hop, set `TRUST_PROXY=1` in the server environment; do not set it to `true` or trust all proxies.

## Admin business CSV import

Administrators can upload the downloadable [business CSV template](../Client/public/business-upload-template.csv) from the Businesses tab. The `name`, `ownerEmail`, `category`, `description`, `services`, `phone`, `email`, `addressLine1`, `city`, and `state` columns are required. Owner email must match an active business-owner account; category and optional subcategory names must match active categories. A CSV can contain at most 500 business rows and is limited to 2 MB. Successfully validated rows are created as drafts; each failed row is returned with its CSV row number and validation reason, while valid rows are still imported.

Use `|` between multiple services, amenities, images, and highlights. Working-hours columns (`mondayHours` through `sundayHours`) accept `HH:MM-HH:MM`, `closed`, or blank. `faqs` and `offers` accept JSON arrays matching the business fields. Optional URLs, phone numbers, category relationships, and business fields are validated before each draft is saved. Replace or delete the example row before uploading the template.

## Models and assumptions

- Users require a name and at least one normalized email or phone. Contact values have partial unique indexes, so missing values can coexist. Phone format is 7–15 digits with an optional leading `+`; clients should use one canonical international format. Optional passwordHash accepts encoded bcrypt/Argon2 hashes and is excluded from default queries and serialization. Future authentication must generate secure hashes and enforce credential requirements. Never explicitly select or aggregate hashes into public responses.
- Categories require unique lowercase slugs and may reference a parent category.
- Business drafts require owner, name, slug and category. Contact, address, location and hours are optional until publication rules are introduced. Location uses `[longitude, latitude]` and a 2dsphere index. Country uses a two-letter code. Working hours use one entry per weekday, `HH:mm`, and `isClosed`; closing before opening denotes overnight hours. Time zone handling belongs with future listing APIs.
- References are ObjectIds; ownership, reference existence, category cycles and publication completeness must be checked by future services. Contact invariants should use document load/validate/save; query updates do not run cross-field document validation automatically.
- Indexes cover contacts, slugs, category, city/locality, locality, listing status and geospatial location. Production disables automatic index creation: provision indexes explicitly in a controlled database maintenance step before accepting writes (for example via each model's `createIndexes()`). Mongoose uniqueness is enforced by MongoDB indexes, not a validation rule: [Mongoose validation documentation](https://mongoosejs.com/docs/validation).

## Tests

Google Places configuration, field masks, matching, caching, response handling, and owner Place ID changes are covered with mocked provider responses. Routine tests do not send billable Google requests. See [Google Places setup and pricing](./docs/google-places.md) before configuring production.

```powershell
npm test
npm run test:integration
```

The default tests need no running MongoDB. Startup failure tests target only a closed localhost port; application tests mock connection state. Integration tests create and stop their own disposable MongoDB; they never read `MONGODB_URI`. The first integration run downloads a MongoDB binary and requires network access. They verify real unique/geospatial indexes, hash query exclusion and connected/disconnected health behavior.

For a manual isolated startup check, run `node tests/temporary-mongo.js` in one terminal. In another terminal, set `$env:MONGODB_URI = Get-Content .cache/test-mongodb-uri.txt`, configure the remaining environment variables or `.env`, run `npm start`, and call the health endpoint from a third terminal. Stop both processes afterward with Ctrl+C. The helper URI file is ignored by Git.

Validation middleware accepts a Zod object containing `body`, `params` and/or `query`. Controllers consume `req.validated`, which includes parsed defaults and coercions. See `src/validators/pagination.js` and `tests/app.test.js`; the example does not expose an extra endpoint.

Verified on 2026-09-14 with Node 22.17.0: dependency installation succeeded with zero audit findings, all 16 default tests passed, and the real MongoDB integration test passed. `npm start` connected to disposable MongoDB 8.2.6 through `MONGODB_URI`; manual HTTP requests returned health 200 and unknown-route 404. Temporary verification processes were stopped afterward. Set up your own `.env` and running MongoDB for normal development.

## Scope and Day 2

Day 1 provides configuration, persistence models, HTTP middleware, health, errors and validation. No frontend, authentication, business CRUD, search, reviews, leads, payments, uploads or deployment is included.

Next: authentication APIs with registration/login validation, password hashing, access/refresh token lifecycle, secure refresh storage and logout, authorization middleware, and tests for rejected credentials and role boundaries.
