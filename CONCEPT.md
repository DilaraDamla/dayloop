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

- No live "table available" / "sold out" / real opening-hours guarantee — OSM opening_hours data exists but isn't always current. Every stop links out to Maps so the user can double check before committing.
- Walking time is straight-line distance × a walking-speed estimate, not a real routing engine (a routing API would fix this but adds a dependency).
- No ticketed-events layer yet (concerts, shows) — biggest planned V2 addition, likely via a paid events API once there's a reason to pay for one.
- Price/budget filtering is approximate — OSM rarely has reliable price data, so "budget" mode currently biases toward free/outdoor options rather than filtering by price.

## Next steps if this goes further

1. Real routing (OSRM or a mapping SDK) instead of straight-line estimates.
2. A curated or partner events layer per major market.
3. Save/share a plan (currently a single-session prototype, nothing persists).
4. Native geolocation flow tightened for mobile.
