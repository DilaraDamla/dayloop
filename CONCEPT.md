# DayLoop — a day/date planner that plans itself

One-line pitch: tell it where you are, how much time you have, and what kind of day you want — it builds a real, walkable, weather-aware itinerary using live public data, anywhere in the world.

## Why the original idea needed work

**1. Event data is the wrong foundation to start with.**
Concert/ticketing APIs (Ticketmaster, Eventbrite) require paid keys, per-market licensing deals, and patchy international coverage — a real product could spend months just on data partnerships before shipping anything. Fix: V1 is built entirely on free, keyless, genuinely global data — OpenStreetMap (places) and Open-Meteo (weather). No account, no key, works in Tokyo and Barcelona on day one. Ticketed events become a V2 layer once there's traction to justify partner integrations.

**2. "Most efficient day" was undefined.**
Efficient for whom, by what measure? Fix: the plan is now driven by four explicit inputs — vibe (romantic / chill / adventurous / budget), time window, budget tier, and group type — so "efficient" means a concrete, scoreable thing: minimal backtracking, weather-appropriate choices, and stops that match the stated vibe.

**3. Straight-line routing lies about how a day actually feels.**
Fix: stops are ordered with a greedy nearest-neighbor pass (pick the best-scoring option closest to the previous stop, not just the best-scoring option overall), and walking time between stops is shown on every card — so a plan doesn't send you across town and back.

**4. Data quality varies a lot by city, and the plan needs to admit that.**
Fix: if a location doesn't have enough OSM data for a given category (common in smaller towns), the app drops that slot rather than inventing a placeholder, and says so.

**5. International ≠ translated — it means "works without local knowledge."**
Fix: category logic (cafe/restaurant/bar/museum/park/etc.) is based on universal OSM tags, not a curated per-city list, so the same code path works for any city with reasonable map coverage. Currency/units are left generic in v1 (no price data reliably available from OSM).

## How it works technically (all free, no API keys)

- **Geocoding** — Nominatim (OpenStreetMap): turns a typed city/address into coordinates. *Usage note: Nominatim's public instance is for light, user-triggered, personal-scale use only — fine for this prototype and for one person's use, but a real product with real traffic must move to a paid geocoder (Google/Mapbox/HERE) or a self-hosted Nominatim instance per their policy.*
- **Weather** — Open-Meteo: free forecast API, drives the indoor/outdoor bias (rain or cold pushes the plan toward museums, cafes, bars over parks and viewpoints).
- **Places** — Overpass API (OpenStreetMap): pulls nearby cafes, restaurants, bars, museums, parks, viewpoints, cinemas, art, nightlife within a radius of the location.
- **Itinerary engine** — pure JS, runs in-browser: slot templates by available time (2 stops for a short window, up to 5 for a full day), vibe-based category weighting, weather bias, and nearest-neighbor ordering.

## A real bug found while testing (fixed)

Opening the file directly (double-click, `file://`) gives the page a "null" origin. Nominatim and Open-Meteo tolerate that, but the main Overpass mirror does not — it silently drops the CORS header for null-origin requests, which showed up as a `Failed to fetch` error. Fixed by trying multiple Overpass mirrors in sequence, then falling back to a public CORS proxy as a last resort, so the page works when just double-clicked. That proxy fallback is a prototype-only patch — a real product should run its own small backend (or at least serve the page over `http://`/`https://` instead of `file://`) rather than depend on a third-party CORS proxy staying up.

## Known limitations (honest, not fixed yet)

- No live "table available" / "sold out" / real opening-hours guarantee — the opening_hours heuristic (see V1.1 additions) catches common cases but OSM data isn't always current. Every stop links out to Maps so the user can double check before committing.
- Walking times use a real routing engine (OSRM) when it responds in time, but silently fall back to a straight-line estimate if that request fails — no visible indicator of which one a given plan used.
- No ticketed-events layer yet (concerts, shows) — biggest planned V2 addition, likely via a paid events API once there's a reason to pay for one.
- Price/budget filtering is approximate — OSM rarely has reliable price data, so "budget" mode currently biases toward free/outdoor options rather than filtering by price.

## V1.1 additions

- **Group and budget now actually affect the plan.** Previously the "Group" and "Budget level" fields were collected but never read — the biggest gap from V1. Now: `friends` biases the evening slot toward bars/nightclubs, `solo` biases away from nightclubs; the $/$$/$$$ budget level nudges scoring toward free/cheap categories (parks, bakeries) or toward restaurants/bars/nightlife.
- **Real walking routes.** Stop order is still chosen by the same greedy nearest-neighbor pass, but travel times between stops now come from a real routing engine — a public OSRM instance with the "foot" profile (`routing.openstreetmap.de`) — instead of straight-line distance × walking speed. Falls back to the old estimate if the routing call fails.
- **Map view.** Each generated plan renders on a Leaflet/OpenStreetMap map with numbered pins and the actual walking route traced (or a dashed straight line when the route fetch failed).
- **Opening-hours awareness (soft).** OSM's `opening_hours` tag is parsed for the common cases (`Mo-Fr 09:00-18:00`, `24/7`, multi-range/lunch-break splits) and used as a scoring nudge — a place that looks closed at its estimated visit time is heavily deprioritized but never hard-excluded, since the parser only covers common formats and unparseable tags are treated as "unknown," not "closed."
- **Swap a stop.** Each stop card has a "suggest another" button that cycles through the next-best-scored alternative for that slot, recalculating downstream timing. After a manual swap, travel times for the edited legs revert to the straight-line estimate (re-querying the router on every click wasn't worth the latency).
- **Share a plan.** Generates a URL with the form inputs encoded as query params; opening that link pre-fills the form and re-runs the plan automatically. It reproduces the *inputs*, not the exact output — if OSM/weather data changed since the link was made, the regenerated plan can differ.
- **Saved plans (local only).** Every generated plan is saved to `localStorage` (last 20) and browsable from a side panel — no account, no server, so it's per-browser and lost if site data is cleared. Loading a saved plan skips the network calls entirely (weather/places/route are all snapshotted), but the "suggest another" swap button is disabled on saved plans since alternate candidates aren't persisted.
- **More categories.** Added bakery, ice cream, and shopping (mall/department store) as additional stop types feeding into the existing vibe/budget logic.
- **Turkish / English toggle.** UI language auto-detects from the browser and can be switched manually; covers all static UI text plus dynamically rendered content (category names, status/error messages, weather labels).
- **XSS hardening.** Place names and addresses come from OpenStreetMap, which anyone can edit — they're now HTML-escaped before being inserted into the page instead of interpolated raw.

## Next steps if this goes further

1. A curated or partner events layer per major market.
2. Full RFC opening_hours parsing (seasonal rules, public holidays) instead of the common-cases heuristic.
3. Server-side plan storage so a saved/shared plan survives across devices and browsers.
4. Native geolocation flow tightened for mobile.
