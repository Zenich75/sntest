# Auth module — manual testing guide

Session-based auth via Passport local strategy + `express-session` backed
by Redis. The session cookie is named `connect.sid`.

Base URL below assumes the app is running on `http://localhost:3000`.

## 1. Register

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "email": "john@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

Response (201) — password/emailConfirmationToken are excluded from the JSON:

```json
{
  "id": "…",
  "username": "johndoe",
  "email": "john@example.com",
  "isEmailConfirmed": false,
  "createdAt": "…",
  "updatedAt": "…",
  "profile": { "id": "…", "firstName": "John", "lastName": "Doe", "bio": null, "avatar": null }
}
```

If `MAIL_HOST` isn't configured (dev default), the confirmation link is
logged to the app's console instead of being emailed — copy the token
from there.

## 2. Confirm email

```bash
curl "http://localhost:3000/auth/confirm-email?token=<TOKEN_FROM_CONSOLE_OR_EMAIL>"
```

Response:

```json
{ "message": "Email confirmed successfully" }
```

## 3. Login (saves the cookies to a file)

```bash
curl -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "johndoe", "password": "password123" }'
```

Response:

```json
{ "id": "…", "username": "johndoe" }
```

`cookies.txt` now holds two cookies:

- `connect.sid`: the httpOnly session cookie;
- `sn-test-csrf`: the CSRF token, readable by the frontend (not httpOnly).

Login regenerates the session, so any CSRF token fetched before logging in stops working.

## 4. Get the CSRF token

Every POST/PUT/PATCH/DELETE made while logged in must send the token in the
`X-CSRF-Token` header. The request is rejected with `403 "Invalid CSRF token"`
unless the header matches both the `sn-test-csrf` cookie and the token stored in the session.

```bash
curl -b cookies.txt -c cookies.txt http://localhost:3000/auth/csrf-token
```

Response (the same value as the `sn-test-csrf` cookie):

```json
{ "csrfToken": "5f0c…e41a" }
```

An SPA can call this once after login, or read `document.cookie` directly.
GET/HEAD/OPTIONS requests and requests without a logged-in session (register, login)
don't need the token.

## 5. State-changing request with the token

```bash
CSRF=$(curl -s -b cookies.txt -c cookies.txt http://localhost:3000/auth/csrf-token \
  | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')

curl -b cookies.txt -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{ "text": "Hello!" }'
# → 201 { "id": "…", "text": "Hello!", … }
```

Without the header:

```bash
curl -b cookies.txt -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" -d '{ "text": "Hello!" }'
# → 403 { "statusCode": 403, "message": "Invalid CSRF token", "error": "Forbidden", … }
```

## 6. Logout

Logout also needs the token while you are logged in:

```bash
curl -b cookies.txt -c cookies.txt -X POST http://localhost:3000/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

Response:

```json
{ "message": "Logged out successfully" }
```

After this, the session is destroyed server-side and both cookies are cleared.

## Rate limits

Requests are limited per client IP. Over the limit the API answers
`429 "Забагато запитів, спробуйте пізніше"` with a `Retry-After` header.
`POST /auth/login` allows 5 attempts per minute, failed ones included.
The full table is in the README.
