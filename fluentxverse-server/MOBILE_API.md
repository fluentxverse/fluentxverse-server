# Mobile Student API

Dedicated bearer-token authentication for the Kotlin Multiplatform student app.
These routes reuse existing student accounts and password verification. They
never authenticate through `studentAuth` cookies or emit `Set-Cookie` headers.
The existing browser auth routes and origin policy remain unchanged.

## Configuration

Set `MOBILE_JWT_SECRET` to a new cryptographically random secret of at least 32
bytes, different from `JWT_SECRET`, on every server replica. Generate one with
`openssl rand -hex 32` and store it in the backend secret configuration. Do not
put it in the mobile app, source control, or public frontend settings. Requests
return 503 when the signing key is missing, too short, or reused from web auth.

The module uses the existing `DATABASE_URL` PostgreSQL connection and Memgraph
student records. It creates `mobile_student_sessions` and
`mobile_student_refresh_tokens` on first use, following the server's lazy-schema
pattern. The database role needs schema-creation rights, or the tables and
indexes must be provisioned before enabling mobile login. No databases are
changed simply by importing the auth module.

The new routes are registered in `src/index.ts`. Rebuild/restart or deploy the
updated server before configuring the mobile client. Require HTTPS outside
local development. Native clients send no fabricated browser Origin.

## Endpoints

| Method | Path | Authorization |
| --- | --- | --- |
| POST | `/mobile/student/auth/login` | Email and password body |
| POST | `/mobile/student/auth/refresh` | Refresh-token body |
| POST | `/mobile/student/auth/logout` | Refresh-token body |
| GET | `/mobile/student/me` | Access JWT in `Authorization: Bearer ...` |
| GET | `/mobile/student/profile` | Access JWT |
| GET | `/mobile/student/stats` | Access JWT |
| GET | `/mobile/student/bookings` | Access JWT |

Login body:

```json
{ "email": "student@example.com", "password": "student-password" }
```

Login and refresh response:

```json
{
  "success": true,
  "tokenType": "Bearer",
  "accessToken": "signed-access-jwt",
  "refreshToken": "64-character-opaque-refresh-token",
  "expiresIn": 900,
  "refreshExpiresAt": 1794571200000,
  "user": {
    "userId": "student-id",
    "role": "student",
    "email": "student@example.com",
    "givenName": "Alex",
    "familyName": "Student"
  }
}
```

Refresh and logout body:

```json
{ "refreshToken": "current-refresh-token" }
```

`me` returns `{ "user": ... }`. Profile, statistics, and bookings return
`{ "success": true, "data": ... }` using existing student service contracts.
The owner ID always comes from the verified session, never a client query or
body field. Logout is idempotent and returns `{ "success": true }`. All mobile
responses use `Cache-Control: no-store`, including failures and rate limits.

## Session Policy

- Access JWTs last 15 minutes. Verification requires HS256, `at+jwt`, issuer
  `fluentxverse-mobile`, audience `fluentxverse-student-mobile`, a student role,
  and the mobile access purpose. Browser/provider/tutor tokens are rejected.
- Refresh tokens are 32 random bytes. Only SHA-256 hashes are stored. Sessions
  expire 30 days after login; refresh does not extend that limit.
- Refresh rotates a token in a PostgreSQL transaction that locks the session
  and token rows. Used-token history is retained. Reuse revokes the entire
  session, including newly issued tokens. Clients must serialize refresh;
  the shared Kotlin client does this and persists the rotated pair before retry.
- Protected reads check the persisted session and current student record.
  Logout, account deletion, password changes through `signUpdate`, role changes,
  and suspension invalidate access before JWT expiry. Database failures return
  503 and do not bypass authorization.
  Each session records the credential version at password verification, so a
  concurrent password change invalidates it even if the session is created later.
- Login uses the existing auth rate limit. Other mobile endpoints use the
  general limit with a mobile namespace. Error handling redacts request bodies
  and tokens, including when the parent server error handler runs first.
- Expired session records can be removed by a scheduled maintenance query;
  associated refresh hashes are removed through the foreign-key cascade.

Android encrypts saved sessions with a device Keystore key; iOS uses Keychain
with device-only accessibility. Passwords are never saved. Offline logout
clears local credentials but cannot promise remote revocation. An interrupted
refresh may require signing in again; never reuse a refresh token after its
successor has been received.

## Verification

```bash
bun test tests/mobileStudentAuth.test.ts tests/authOriginCookie.test.ts tests/studentSession.test.ts
```

PostgreSQL integration tests are opt-in and require an isolated localhost
database named `fxv_mobile_auth_test`. They never use the configured student DB:

```bash
MOBILE_AUTH_TEST_DATABASE_URL=postgresql://test-user:test-password@127.0.0.1:5433/fxv_mobile_auth_test \
  bun test tests/mobileStudentSessions.integration.test.ts
```

They verify durable sessions, atomic concurrent rotations, replay revocation,
logout after rotation, and expiry against real PostgreSQL. Ordinary test runs
skip this suite unless its dedicated URL is supplied. These tests do not
deploy a server or log into real accounts.

Mobile registration, identity-provider exchanges, tutor accounts, live booking,
wallet payments, and classroom signaling are later integration milestones.
