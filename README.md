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
- **Events (optional)** — Ticketmaster Discovery API, when a key is configured
- **Accounts (optional)** — Firebase Auth + Firestore, for cross-device plan sync

The itinerary engine (slot templates, vibe/weather/budget scoring, greedy
nearest-neighbor stop ordering) is plain JS, no framework.

See [`CONCEPT.md`](CONCEPT.md) for the original product reasoning and known
limitations. Note: `CONCEPT.md` describes an earlier, keyless-only version of
the plan — the shipped app has since added optional Ticketmaster events and
optional Firebase accounts on top of that foundation.

## ⚠️ Known issue: exposed API keys

`dayloop.html` currently hardcodes a **Ticketmaster API key** and a
**Firebase web config** directly in client-side JS, and both are committed
to this public repository and live on the deployed GitHub Pages site. See
`CLAUDE.md` for details and required next steps before doing further work
that touches either integration.

## Contributing / working in this repo

See [`CLAUDE.md`](CLAUDE.md) for coding conventions, design principles, and
repository rules before making changes.
