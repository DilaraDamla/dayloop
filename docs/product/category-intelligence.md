# Category Intelligence per Vibe (Sprint 6)

This documents the preferred / acceptable / forbidden categorization the sprint asked for. The mechanism already existed (Sprint 1's `core`/`acceptable`/`lastResort` tiers plus a hard `excluded` set in `VIBE_PROFILES`, `index.html`) — this sprint added new categories to it and a fifth vibe; this file is the readable summary, not a new system.

## Terminology mapping

| Sprint 6 term | Existing mechanism |
|---|---|
| Preferred | `core` — what the day is genuinely about for this vibe |
| Acceptable | `acceptable` — a real but secondary fit |
| Forbidden | `excluded` — a hard constraint, never selected under any relaxation, plus the universal `UNIVERSALLY_EXCLUDED_CATEGORIES` list |

## Per-vibe tables

### Romantic
- **Preferred:** cafe, bakery (coffee) · viewpoint, museum, gallery, park, arts_centre (activity) · restaurant (food) · bar, theatre (evening)
- **Acceptable:** cafe (food/evening)
- **Forbidden:** nightclub, ferry_terminal

### Chill (Calm)
- **Preferred:** cafe, bakery (coffee) · park, gallery, museum, ice_cream, bookstore (activity) · restaurant, cafe (food) · cafe (evening)
- **Acceptable:** arts_centre (activity)
- **Forbidden:** nightclub, ferry_terminal — and bar/theatre/nightclub are deliberately kept out of core/acceptable evening entirely (last-resort only), since a calm day should only ever land on nightlife-adjacent venues when nothing else exists.

### Adventurous
- **Preferred:** cafe, bakery (coffee) · viewpoint, artwork, park, shopping, escape_room (activity) · restaurant (food) · bar, nightclub (evening)
- **Acceptable:** arts_centre, theatre, bookstore (activity)
- **Forbidden:** ferry_terminal (nightclub is genuinely fine for this vibe, unlike the others)

### Budget
- **Preferred:** cafe, bakery (coffee) · park, viewpoint, artwork, ice_cream (activity) · restaurant, cafe, bakery (food) · bar (evening)
- **Acceptable:** bookstore, arts_centre (activity — frequently free/low-cost to browse)
- **Forbidden:** nightclub, ferry_terminal — escape_room and theatre are deliberately excluded from every tier for this vibe (they tend to carry a real cost, contradicting the vibe's own point)

### Creative (new, Sprint 6)
- **Preferred:** cafe, bakery (coffee) · arts_centre, theatre, gallery, museum, escape_room (activity) · restaurant, cafe (food) · theatre, arts_centre (evening)
- **Acceptable:** bookstore, artwork (activity) · bar (evening)
- **Forbidden:** nightclub, ferry_terminal

## Universally forbidden, every vibe

`ferry_terminal` is excluded for every vibe, always — it is infrastructure (a transit point), not an experience, and is only ever fetched so "Optional touches" can point out a nearby ferry route. It can never be selected as a main itinerary stop.

## Why "banks / offices / schools / hospitals / industrial buildings" were never a real risk

The sprint named these as categories Adventure should never choose. They require **no exclusion logic at all**, because `CATEGORY_TAGS` — the list of OSM tag pairs `fetchPOIs` ever queries for — has never, in any sprint, included `amenity=bank`, `office=*`, `amenity=school`, `amenity=hospital`, `landuse=industrial`, or anything similar. The planner cannot select a category it never fetches. This was true before Sprint 6 and remains true after it; the new categories added this sprint (`arts_centre`, `theatre`, `escape_room`, `bookstore`, `ferry_terminal`) were chosen specifically because they are genuine, well-established OSM tags for actual experiences, not generic buildings.
