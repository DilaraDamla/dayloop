# DayLoop events proxy (Cloudflare Worker)

A minimal Cloudflare Worker that holds the Ticketmaster Discovery API key
server-side and exposes a narrow `GET /events` endpoint for the DayLoop
frontend (`index.html`) to call instead of hitting Ticketmaster directly
from the browser.

Why this exists: `index.html` is a static, keyless GitHub Pages app with no
backend. Any secret placed directly in that file ships to every visitor and
becomes permanently public in git history. This Worker is the "tiny backend
proxy" that `CLAUDE.md` and the root `README.md` call out as the prerequisite
for re-enabling real event listings.

The Worker:

- Validates and clamps all query parameters before using them.
- Reads the Ticketmaster key from a Worker **secret**, never from source.
- Calls the Ticketmaster Discovery API v2 server-side.
- Returns only the normalized fields the UI needs (never the API key).
- Restricts CORS to the deployed DayLoop origin (plus local dev origins).
- Applies short-lived edge caching to cut down on upstream API usage.

## Files

- `src/index.js` — Worker source (single file, no bundler required).
- `wrangler.toml` — Wrangler configuration (name, entry point, compat date).
- `package.json` — dev dependency on `wrangler` and `dev`/`deploy` scripts.
- `.dev.vars.example` — template for local secret testing. Copy it to
  `.dev.vars` (gitignored) and fill in a real key **only in that local,
  untracked file**. Never commit `.dev.vars`.

## API

`GET /events`

Query parameters:

| Param           | Required | Notes                                                        |
|-----------------|----------|----------------------------------------------------------------|
| `lat`           | yes      | -90..90 — the searched city's coordinates, always required     |
| `lon`           | yes      | -180..180 — the searched city's coordinates, always required   |
| `startDateTime` | no       | `YYYY-MM-DDTHH:mm:ssZ`, rejected if malformed                  |
| `endDateTime`   | no       | `YYYY-MM-DDTHH:mm:ssZ`, rejected if malformed                  |
| `locale`        | no       | e.g. `en-us`, `tr-tr`, or `*`; rejected if it doesn't match     |
| `keyword`       | no       | free text, stripped of unusual characters, capped at 80 chars  |

There is no client-supplied `radius` parameter. The Worker always searches
from the exact `lat`/`lon` it's given (no hardcoded city, market, country, or
locale) and escalates the search radius itself: 40 km, then 80 km, then
150 km, stopping at the first tier that returns at least one event. A hard
upstream failure (network/auth/rate-limit) stops the escalation immediately
and is returned as an error — a bigger radius wouldn't fix any of those.

Result count per tier is fixed server-side (20) and is not client-controlled,
to keep upstream usage bounded.

Response shape:

```json
{
  "radiusKm": 40,
  "events": [
    {
      "id": "...",
      "name": "...",
      "startDate": "2026-08-01",
      "startTime": "20:00:00",
      "venueName": "...",
      "venueCity": "...",
      "address": "...",
      "lat": 41.0,
      "lon": 28.9,
      "distanceKm": 3.2,
      "image": "https://...",
      "url": "https://...",
      "category": "Music",
      "priceMin": 100,
      "priceMax": 300,
      "priceCurrency": "TRY"
    }
  ]
}
```

`radiusKm` is the tier that was actually used (helpful for debugging distant
results). `events` is sorted by `distanceKm` ascending, then by start
date/time — closest-and-soonest first — so a widened radius still leads with
the closest matches. `distanceKm` (great-circle distance from the searched
`lat`/`lon` to the venue) and `venueCity` are included on every event
specifically so a result from a fallback radius is never shown without
context on how far away it actually is.

Errors are returned as `{ "error": "...", "message": "..." }` with an
appropriate HTTP status (400 for bad input, 502/429 for upstream problems,
503 if the secret isn't configured, 500 for anything unexpected). The
Ticketmaster key is never included in a response or in worker logs.

## Local setup

Requires Node.js and the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as a dev dependency below).

```sh
cd worker
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a real Ticketmaster Consumer Key on the right-hand
# side of TICKETMASTER_API_KEY= — this file is gitignored and must stay local
npm run dev
```

This starts a local Worker (default `http://127.0.0.1:8787`). Test it with:

```sh
curl "http://127.0.0.1:8787/events?lat=41.0082&lon=28.9784"
```

`http://localhost:*` and `http://127.0.0.1:*` are allowed CORS origins by
default so a locally-served `index.html` can call a locally-running Worker
during development.

## Deploying

1. Authenticate Wrangler once per machine:
   ```sh
   npx wrangler login
   ```
2. Set the production secret (you'll be prompted to paste the key; it is not
   echoed to the terminal and is not written anywhere in this repo):
   ```sh
   cd worker
   npx wrangler secret put TICKETMASTER_API_KEY
   ```
3. Deploy:
   ```sh
   npx wrangler deploy
   ```
4. Wrangler prints the deployed URL, typically
   `https://dayloop-events-proxy.<your-subdomain>.workers.dev`. Copy it.
5. Paste that URL into `EVENTS_PROXY_URL` near the top of `index.html`
   (see the comment above that constant). Do **not** put a key there — only
   the Worker's public URL, which is safe to ship in client code.

## Rotating the key

The Ticketmaster key that was previously hardcoded in `index.html` is
compromised (it was public in git history and on the live GitHub Pages
deployment) and must be rotated at
https://developer.ticketmaster.com regardless of this Worker's existence.
Once rotated, use the **new** key with `wrangler secret put`, never the old
one.

## CORS

Allowed origins are hardcoded in `src/index.js` (`ALLOWED_ORIGINS` plus a
regex for `localhost`/`127.0.0.1` on any port). Update `ALLOWED_ORIGINS` if
DayLoop is ever served from a different production origin.

## Caching

Successful responses are cached at the edge (Cloudflare Cache API) for 5
minutes, keyed on the normalized query parameters, to reduce Ticketmaster API
usage under repeated/duplicate requests. Error responses are never cached
(`Cache-Control: no-store`).
