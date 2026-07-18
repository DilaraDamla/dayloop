# DayLoop

**Describe your perfect day. We'll build it.**

DayLoop is an AI-flavored, location-aware day/date planner. A user picks a
city, a time window, and a mood (romantic / chill / adventurous / budget),
and the app builds a walkable itinerary — cafés, food, activities, an
evening stop — using live weather and map data, with routing, a map view,
and share/save.

Live deployment (GitHub Pages): https://dilaradamla.github.io/dayloop/

## Status

Single-file prototype. Everything — markup, styles, and logic — lives in
[`index.html`](index.html). There is no build step, package manager, or
backend; it's meant to be opened directly or served as a static file.

`dayloop.html` still exists as a thin redirect stub (see the comment at the
top of that file) so old bookmarks/share links built before the app moved to
`index.html` keep working — it forwards to `index.html` (preserving any query
string) and contains no app logic. Don't add functionality there; the app is
`index.html`.

## Running it locally

No install required.

- Double-click `index.html` to open it directly (`file://`), **or**
- Serve it so browser APIs behave consistently (recommended):
  ```
  npx serve .
  ```
  or any static file server, then open the printed local URL — the root
  (`/`) resolves to `index.html` automatically, matching the GitHub Pages
  deployment.

## How it works

- **Geocoding** — [Nominatim](https://nominatim.org/) (OpenStreetMap)
- **Weather** — [Open-Meteo](https://open-meteo.com/) — drives indoor/outdoor bias
- **Places** — Overpass API (OpenStreetMap) for cafes, restaurants, bars, museums, parks, etc.
- **Routing** — a public OSRM "foot" instance, with a straight-line fallback
- **Map** — Leaflet / OpenStreetMap tiles
- **Events** — real listings via the [Ticketmaster Discovery
  API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/),
  called through a small Cloudflare Worker proxy (see
  [`worker/`](worker/)) so the API key never ships to the browser. If the
  proxy URL isn't configured yet or is unreachable, every events surface
  falls back to a search link instead (see Security section below)
- **Accounts (optional)** — Firebase Auth + Firestore, for cross-device plan sync

The itinerary engine (slot templates, vibe/weather/budget scoring, greedy
nearest-neighbor stop ordering) is plain JS, no framework.

See [`CONCEPT.md`](CONCEPT.md) for the original product reasoning and known
limitations. Note: `CONCEPT.md` describes an earlier, keyless-only version of
the plan — the shipped app has since added optional Ticketmaster events and
optional Firebase accounts on top of that foundation.

## Security

- **Firebase web config is client-visible by design.** The `apiKey` in
  `index.html`'s `firebaseConfig` is not a secret — Firebase's own docs
  say it's meant to ship in public client code. It only identifies which
  Firebase project to talk to; it grants no access by itself.
- **Authorization is enforced by Firestore Security Rules, not by hiding
  the config.** See [`firestore.rules`](firestore.rules): only a signed-in
  user whose auth UID matches `{userId}` may read/write
  `users/{userId}/plans/{planId}` and `users/{userId}/wishlist/{placeKey}`,
  and every other path is denied by default. **These rules are not
  deployed automatically** — deploy them via
  `firebase deploy --only firestore:rules` (or paste into the Firebase
  console's Rules editor) before relying on them.
- **Ticketmaster must never be called with a secret key directly from a
  public browser app.** A real Consumer Key was previously hardcoded in
  `index.html`; that exposed it to every visitor and permanently in git
  history. Real event listings are restored through a small **Cloudflare
  Worker proxy** (see [`worker/`](worker/)) that holds the key as a Worker
  secret and calls the Discovery API server-side — the key never appears in
  `index.html`, any JavaScript sent to the browser, git history, or this
  README. `index.html` only ever talks to the Worker's public URL
  (`EVENTS_PROXY_URL` near the top of the `<script>` block), which is safe
  to ship in client code.
- **⚠️ The previously exposed key is still compromised and must be
  rotated.** Removing it from source, or standing up this proxy, does not
  invalidate it — it must be revoked/rotated at
  https://developer.ticketmaster.com by whoever owns that account, and only
  the **new** key should ever be given to the Worker (via `wrangler secret
  put`, never committed to source). This is a manual step outside this repo.
- **If the Worker isn't deployed yet**, `EVENTS_PROXY_URL` in `index.html`
  is left as a placeholder and every events surface automatically falls back
  to a search link — the rest of the app (weather, places, routing,
  itinerary generation) is unaffected either way.

### Secure events architecture

```
browser (index.html)    --GET /events-->  Cloudflare Worker  --Discovery API-->  Ticketmaster
                         <--JSON, no key--                    <--apikey secret--
```

- `index.html` calls `${EVENTS_PROXY_URL}/events?lat=...&lon=...&...` —
  no API key is ever present client-side.
- The Worker validates/clamps every query parameter, reads the Ticketmaster
  key from the `TICKETMASTER_API_KEY` Worker secret, calls the Discovery API
  server-side, and returns only the normalized fields the UI needs (id,
  name, start date/time, venue, venue city, distance from the searched city,
  address, coordinates, image, ticket URL, category, price).
- Every search uses the exact coordinates of whichever city the user just
  searched — nothing is hardcoded to a fixed market/country. The Worker
  starts at a 40 km radius and only widens to 80 km then 150 km if that
  returns zero events, so smaller destinations still find something without
  every search defaulting to a wide net. Results are sorted by distance from
  the searched city, then by date/time.
- CORS on the Worker is restricted to `https://dilaradamla.github.io` plus
  local dev origins.
- See [`worker/README.md`](worker/README.md) for the full API contract,
  local dev setup, and deployment steps.

#### Deploying the Worker

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put TICKETMASTER_API_KEY   # paste the *new*, rotated key when prompted
npx wrangler deploy
```

Wrangler prints the deployed URL (e.g.
`https://dayloop-events-proxy.<subdomain>.workers.dev`). Paste that URL into
`EVENTS_PROXY_URL` near the top of the `<script>` block in `index.html`,
replacing the placeholder.

#### Local testing

```sh
cd worker
cp .dev.vars.example .dev.vars   # gitignored; put a real key only in this local file
npm run dev
```

This runs the Worker locally (default `http://127.0.0.1:8787`), which the
local dev origins allowed by the Worker's CORS config can reach. Point
`EVENTS_PROXY_URL` at that local URL temporarily to test end-to-end, or curl
it directly:

```sh
curl "http://127.0.0.1:8787/events?lat=41.0082&lon=28.9784"
```

## Contributing / working in this repo

See [`CLAUDE.md`](CLAUDE.md) for coding conventions, design principles, and
repository rules before making changes.
