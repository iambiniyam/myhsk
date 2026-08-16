# MyHSK accounts

MyHSK uses Better Auth 1.6 with Cloudflare Pages Functions and a dedicated APAC D1 database. Learning remains local-first; an account adds secure sessions and synchronized progress.

## Production providers

Email/password is enabled only when `RESEND_API_KEY` is configured. Google is enabled only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured. This fail-closed behavior prevents unverified email accounts or broken OAuth buttons from being exposed.

Required Cloudflare Pages secrets:

```text
BETTER_AUTH_SECRET
RESEND_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

Non-secret production values are in `wrangler.jsonc`:

```text
BETTER_AUTH_URL=https://www.myhsk.cc
AUTH_EMAIL_FROM=MyHSK <accounts@myhsk.cc>
```

Before enabling email, verify `myhsk.cc` with Resend and create the `accounts@myhsk.cc` sender. In Google Cloud Console, create a Web OAuth client and add this authorized redirect URI exactly:

```text
https://www.myhsk.cc/api/auth/callback/google
```

Also add `https://www.myhsk.cc` as an authorized JavaScript origin.

## Database

The `AUTH_DB` D1 binding uses `migrations/auth`. Apply changes with:

```bash
npx wrangler d1 migrations apply AUTH_DB --local
npx wrangler d1 migrations apply AUTH_DB --remote
```

Authentication tables, database-backed rate limits, and the revisioned `user_progress` document are isolated from anonymous analytics. Progress writes use optimistic concurrency and merge on the client when another device changes the same account.

## Security decisions

- Email verification is required before an email/password session is issued.
- Passwords are 10–128 characters and use Better Auth's password hashing.
- Password resets revoke existing sessions.
- Session cookies are HTTP-only and handled by Better Auth.
- Login, signup, and reset routes have database-backed rate limits.
- Google is the only implicitly trusted account-linking provider.
- Progress endpoints require a valid session, same-origin writes, body validation, and a 3 MB limit.
- Account deletion cascades to sessions, providers, and synchronized progress.

