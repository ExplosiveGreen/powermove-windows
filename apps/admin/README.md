# Powermove Admin

The admin panel at `admin.trypowermove.com`: SvelteKit on Cloudflare Workers
(`@sveltejs/adapter-cloudflare`), styled like the desktop's Settings screen
from `@powermove/tokens`.

Only users with an `admins` row can use it (see `apps/cloud/README.md` › Admins).
The server keeps the Powermove session token in an httpOnly cookie on this
origin and calls the API server-to-server: the `CLOUD` service binding in
production, a plain fetch to `API_ORIGIN` locally. The browser only visits the
API for Google sign-in (`/v1/auth/web`) and the email-code verification page.
Every non-GET request must come from this origin.

## Users

Users lists every account, whether or not it has claimed a publisher handle.
Admins are ordinary users with a separate admin grant. Search covers name,
email, handle and user ID; filters and pagination retain access to every result.
Account details show email verification, publisher verification, admin status,
account dates, linked provider names, extension and saved-library metadata,
and the latest 20 active sessions. Session dates are retained-session metadata,
not an audit of every login. Extension and library previews are capped at 100.
No session tokens, provider tokens or passwords are returned by these routes.
Old publisher URLs continue to work, with the list redirecting into Users.

## Local

With the local cloud stack running (`apps/cloud`: `bun run local:up`,
`bun run dev:local`, `bun run local:seed`, which makes `jude@localhost` an admin):

```sh
cd apps/admin
bun run dev          # http://localhost:5174, API at http://localhost:8787
```

`vite dev` takes its bindings from the `local` environment in `wrangler.jsonc`;
a gitignored `.dev.vars` (`API_ORIGIN=…`) overrides it. The cloud's
`ADMIN_ORIGIN` must be this panel's origin for Google sign-in to return here.
Email codes print in the `dev:local` terminal; the Turnstile check opens in a
new tab and passes with the local test keys.

```sh
bun run check        # svelte-check
bun run build        # .svelte-kit/cloudflare
```
