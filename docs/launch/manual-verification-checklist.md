# DayLoop — Manual Verification Checklist (Sprint 5)

**None of the items below have been performed.** Every check in Sprints 1–5 was automated, offline, and Node-based against fixture data — this checklist has never been run against the live app in a real browser. Complete it before removing the "Conditional" from the Sprint 5 Go/Conditional-Go/No-Go recommendation.

Check off each box only after actually doing it. Note the date, browser, and any issue found — do not mark something done because it "should" pass.

## Desktop
- [ ] First load: page renders, no console errors, "Chill" is the pre-selected vibe (not "Romantic").
- [ ] Generate a **calm** itinerary (Chill vibe) for a real city — read every stop's explanation; confirm none repeat verbatim.
- [ ] Generate a **budget** itinerary ($ tier) — confirm no invented price claims anywhere in the text.
- [ ] Generate a **romantic** itinerary — confirm it still reads as intentional now that it isn't the default.
- [ ] Generate a **rainy-weather** itinerary (pick a date/city currently forecast rain, or note if unavailable) — confirm the weather card and any relaxed/outdoor stop don't visibly contradict each other in an obviously confusing way.
- [ ] Generate an itinerary for a **small town or rural area** — confirm a shorter itinerary (2–4 stops) reads as intentional, not broken or empty.
- [ ] Confirm the new walking-distance line appears near the top of a multi-stop plan, and the full stats strip still appears at the bottom too.
- [ ] Switch language EN → TR and back — confirm the new walk-distance line and all Sprint 4/5 explanation text actually translate (not left in English).
- [ ] Trigger a fallback/error state (e.g., a nonsense location, or a real network hiccup) — confirm the error message is plain-language, not a stack trace.
- [ ] Open the browser console throughout the above — confirm zero uncaught errors or warnings.

## Mobile (real device or emulated ~375px width)
- [ ] First load at mobile width — confirm no horizontal overflow/scroll, form is usable, chip row wraps sensibly.
- [ ] Generate any itinerary — confirm stop cards, the new walk-distance line, and the stats strip all remain readable and don't overlap or clip at mobile width.
- [ ] Confirm touch targets (vibe chips, swap/wishlist buttons) are comfortably tappable.

## Route and comprehension
- [ ] Confirm the map renders with numbered pins matching the stop order.
- [ ] Confirm per-stop walk times ("min walk to next stop") are present and look plausible against the map.
- [ ] Confirm the new early walking-distance summary matches the sum of per-leg times shown on the stop cards (sanity check, not exact-second precision).

## Family scenario (only if a Family option is added in a future sprint)
- [ ] Not applicable this sprint — no Family option exists (deliberate, documented decision; see `docs/launch/launch-readiness-report.md`).

## Sign-off
- [ ] Tester name/date recorded here: ______________________
- [ ] Any issue found is filed, not silently patched, before flipping "Conditional Go" to "Go."
