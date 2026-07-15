# DayLoop

**Describe your perfect day. We'll build it.**

DayLoop is an AI-flavored, location-aware day/date planner. A user picks a
city, a time window, and a mood (romantic / chill / adventurous / budget),
and the app builds a walkable itinerary — cafés, food, activities, an
evening stop — using live weather and map data, with routing, a map view,
and share/save.

Live deployment (GitHub Pages): https://dilaradamla.github.io/dayloop/dayloop.html

## Status

Single-file prototype. Everything — markup, styles, and logic — lives in
[`dayloop.html`](dayloop.html). There is no build step, package manager, or
backend; it's meant to be opened directly or served as a static file.

## Running it locally

No install required.

- Double-click `dayloop.html` to open it directly (`file://`), **or**
- Serve it so browser APIs behave consistently (recommended):
  ```
  npx serve .
  ```
  or any static file server, then open the printed local URL.

## How it works

- **Geocoding** — [Nominatim](https://nominatim.org/) (OpenStreetMap)
- **Weather** — [Open-Meteo](https://open-meteo.com/) — drives indoor/outdoor bias
- **Places** — Overpass API (OpenStreetMap) for cafes, restaurants, bars, museums, parks, etc.
- **Routing** — a public OSRM "foot" instance, with a straight-line fallback
- **Map** — Leaflet / OpenStreetMap tiles
- **Events (currently disabled)** — designed to use the Ticketmaster Discovery
  API, but no key is configured (see Security section below); every events
  surface falls back to a search link instead
- **Accounts (optional)** — Firebase Auth + Firestore, for cross-device plan sync

The itinerary engine (slot templates, vibe/weather/budget scoring, greedy
nearest-neighbor stop ordering) is plain JS, no framework.

See [`CONCEPT.md`](CONCEPT.md) for the original product reasoning and known
limitations. Note: `CONCEPT.md` describes an earlier, keyless-only version of
the plan — the shipped app has since added optional Ticketmaster events and
optional Firebase accounts on top of that foundation.

## Security

- **Firebase web config is client-visible by design.** The `apiKey` in
  `dayloop.html`'s `firebaseConfig` is not a secret — Firebase's own docs
  say it's meant to ship in public client code. It only identifies which
  Firebase project to talk to; it grants no access by itself.
- **Authorization is enforced by Firestore Security Rules, not by hiding
  the config.** See [`firestore.rules`](firestore.rules): only a signed-in
  user whose auth UID matches `{userId}` may read/write
  `users/{userId}/plans/{planId}`, and every other path is denied by
  default. **These rules are not deployed automatically** — deploy them via
  `firebase deploy --only firestore:rules` (or paste into the Firebase
  console's Rules editor) before relying on them.
- **Ticketmaster must never be called with a secret key directly from a
  public browser app.** A real Consumer Key was previously hardcoded in
  `dayloop.html`; that exposed it to every visitor and permanently in git
  history. The key has been removed from source (see the comment above
  `TICKETMASTER_API_KEY` in `dayloop.html`), and the **events integration
  stays disabled** — every events surface falls back to a search link —
  until a backend or serverless proxy is built to hold the key server-side.
- **The old exposed key must still be rotated in the Ticketmaster developer
  account.** Removing it from source does not invalidate it — it must be
  revoked/rotated at https://developer.ticketmaster.com by whoever owns
  that account. This is a manual step outside this repo.

## Contributing / working in this repo

See [`CLAUDE.md`](CLAUDE.md) for coding conventions, design principles, and
repository rules before making changes.
