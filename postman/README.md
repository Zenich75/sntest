# Postman collection

`sn-test.postman_collection.json` checks the whole API (all 25 operations) against the running
`docker compose` stack: it creates its own data, chains ids between requests and asserts every
response. Nothing is mocked: files go to `./uploads`, rows to the dev `sn_test` database, and the
confirmation emails are read from [Mailpit](https://mailpit.axllent.org/).

## Requirements

- `docker compose up -d` with the `mailpit` service, and in `.env`:
  `MAIL_HOST=mailpit`, `MAIL_PORT=1025`, `MAIL_USER=` (empty), `STORAGE_DRIVER=local`.
  Mailpit UI and API: http://localhost:8026.
- Migrations applied (`DB_HOST=localhost npm run migration:run`).

## Run

```bash
npm run test:postman
```

This runs [newman](https://github.com/postmanlabs/newman) through `npx`, so nothing extra is installed.
It exits non-zero if any assertion fails.

CI runs the same command in the `postman-tests` job of `.github/workflows/ci.yml`. The job brings up
the stack with `docker compose` and a test `.env`, applies migrations, and prints the app and Mailpit
logs if the run fails.

In the Postman app: import the collection and `local.postman_environment.json`, select the
**sn-test local** environment, and set *Settings → General → Working directory* to the repository
root: the upload requests attach `scripts/fixtures/*` by relative path. Then run the whole collection
in order with the Collection Runner. Single requests depend on variables set by earlier ones.

**Wait a minute between runs.** A run uses all 3 `POST /auth/register` requests that the rate
limit allows per minute (Alice, Bob and the duplicate check), so an earlier rerun gets `429`.

## How it works

- **Two users, two sessions.** Alice talks to `{{baseUrl}}` (`localhost`) and Bob to `{{bobUrl}}`
  (`127.0.0.1`). Cookies are stored per host, so both sessions coexist in one cookie jar. Anonymous
  requests have cookies disabled (`protocolProfileBehavior.disableCookies`).
- **Data.** The first request generates a `runId`. Users are `pm_alice_<runId>` and `pm_bob_<runId>`,
  and every id (users, posts, comments, likes, file URLs) is saved to collection variables.
- **Email confirmation.** The token is taken from the email in Mailpit (`/api/v1/search?query=to:…`
  → `/api/v1/message/:id`).
- **CSRF.** After login, `GET /auth/csrf-token` stores `aliceCsrf` / `bobCsrf`, which is sent as
  `X-CSRF-Token` on every state-changing request.
- **Leak check.** A collection-level test fails any API response that contains `password` or
  `emailConfirmationToken`. Public responses (profiles, followers, search, post authors, comments) are
  also checked for `email` / `isEmailConfirmed`.
- **Cleanup.** Posts, files, comments, likes and follows are deleted through the API at the end, and
  the run checks that the file URLs return `404` afterwards. The API has no endpoint for deleting a
  user, so the `pm_*` users stay in the database. To remove them:

  ```bash
  docker compose exec postgres psql -U postgres -d sn_test \
    -c "DELETE FROM \"user\" WHERE username LIKE 'pm\_%'"
  ```

Not covered here: rate limits returning `429` (hitting them would block the rest of the run; see
`test/rate-limit.e2e-spec.ts`) and request validation beyond a few cases (see the e2e tests).

To change the collection, edit it in Postman and export it back over this file (Collection v2.1).
Keep the request order: later requests use variables set by earlier ones.
