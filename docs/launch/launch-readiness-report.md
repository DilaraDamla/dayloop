# DayLoop — Launch Readiness Report (Sprint 5)

**Status:** Product decision review, not a broad redesign. Documents deliberate decisions on the three findings carried over from Sprint 4, a default-state audit, a launch-experience classification, and the resulting go/no-go call.

---

## A. The three unresolved findings — decided

### A1. Missing "Family" group option

- **Real launch blocker?** No.
- **Who is affected?** Users planning a day for a family (parents + children).
- **How often?** Every session from this segment — there is currently no way to represent it at all.
- **User expectation violated?** Only if DayLoop is marketed as a general-purpose "day planner for anyone." Per `CONCEPT.md`, the original V1 design explicitly scoped the Group input to couple/solo/friends — family was never a promised capability, so this is a genuine gap in coverage, not a regression from something shipped or claimed.
- **Smallest safe solution?** There isn't one that's actually safe. Adding a `<option value="family">` with no supporting logic in `buildDayIntentProfile` would be cosmetic only — selecting it would silently behave identically to "Couple," which is arguably worse than not offering it at all (it implies family-aware curation that doesn't exist). A real fix requires deciding what "family" should actually change (pacing, category exclusions beyond nightlife, kid-appropriateness signals OSM doesn't reliably carry) — a design decision, not a patch.
- **Risk of changing now?** Low code risk, high *trust* risk if done half-measure (implying a capability the product doesn't have).
- **Decision: Deferred.** Documented as a real, scoped-out gap for a deliberate future decision — not fixed this sprint, not treated as a blocker.

### A2. Romantic as the default vibe

- **Real launch blocker?** Borderline — not a functional blocker, but a first-impression/positioning problem confirmed directly in Sprint 4's walkthrough.
- **Who is affected?** Every first-time user, every session, until they notice and change it.
- **How often?** 100% of first loads.
- **User expectation violated?** The product tagline ("Describe your perfect day. We'll build it.") and the general "day planner" framing is undercut by a visually prominent, unexplained, pre-selected "Romantic" default — the first thing a skeptical evaluator sees, before touching any input, positions the product as a date-night app specifically.
- **Smallest safe solution:** Move the default `active` class from the "Romantic" chip to "Chill" — the most broadly neutral of the four vibes (doesn't imply relationship status like romantic, cost sensitivity like budget, or energy level like adventurous).
- **Risk of changing now:** Very low. Confirmed by direct code inspection: nothing in `buildShareURL`, URL-param prefill, or any Decision Layer logic hardcodes an assumption that "romantic" is the default — every function reads the *currently selected* vibe, never assumes a specific one.
- **Decision: Fixed before launch.** Implemented this sprint; regression test added.

### A3. Walking-distance information placement and visibility

- **Real launch blocker?** No — the information was never missing, only poorly sequenced (bottom of the page, after the itinerary, map, planning summary, and weather card).
- **Who is affected?** Any user deciding whether to actually commit to a plan before reading the whole thing.
- **How often?** Every generated plan.
- **User expectation violated?** "Would I actually do this much walking" is one of the most decision-relevant facts in the whole plan; disclosing it last means the user has already invested reading time before learning it.
- **Smallest safe solution:** The existing stats-strip placement is a *deliberate* prior design choice (explicitly commented in the code: "the plan is the product, not this"). Rather than override that decision by relocating the whole strip, add one short, additive line — total walking distance/time only — directly under the hero title. The original full stats strip is untouched.
- **Risk of changing now:** Low. Purely additive (no existing markup removed or reordered), reuses an existing CSS class (`.mood-hint`), and only renders when there's more than one stop (so a single-stop day never shows a meaningless "0.0 km").
- **Decision: Fixed before launch.** Implemented this sprint; regression test added.

---

## B. Default state review

- **What does a first-time user assume DayLoop is for?** Before this sprint's fix: a date-night planner (Romantic pre-selected, evening-leaning 14:00–22:00 default window). After the fix: a general day planner with a calm/flexible default, consistent with the tagline.
- **Did the default state unintentionally position the product as a dating planner?** Yes, prior to this sprint. The combination of a visually prominent "Romantic" chip plus an afternoon-to-night default time window compounded the effect. The vibe default is now corrected; the time-window default is a separate, smaller, and lower-severity issue (see Section D, deferred).
- **Is the first generated plan representative of the full product?** Previously no — an untouched first plan was always a date-night itinerary, understating the chill/adventurous/budget breadth the product actually has. Now yes, by default.
- **Are city/date/group/vibe/budget defaults neutral and understandable?** City: empty, neutral. Date: defaults to today or (after ~4pm) tomorrow with a visible explanatory hint — good. Group: defaults to "Couple / date" (the first `<select>` option, no explicit `selected`) — mildly narrow but far less presumptuous than the vibe chip was, and not changed this sprint (see rationale below). Budget: explicitly defaults to "$$ — normal," the neutral middle tier — good, no change needed. Vibe: fixed this sprint.
- **Is any default likely to confuse or exclude users?** The Group default leaning "Couple" is a minor residual concern, but changing it wasn't judged necessary: it's a plain, unstyled dropdown default (not a colored, pre-clicked chip), and pairing it with the new "Chill" vibe default reads as neutral rather than date-coded. Left as-is to keep this sprint's change surface minimal and well-justified.

---

## C. Launch experience review

| Area | Classification | Notes |
|---|---|---|
| Clarity of product promise | Acceptable for MVP | Tagline is clear; default-state fix now supports it instead of undercutting it. |
| Input friction | Post-launch improvement | Fixed 14:00–22:00 time window regardless of when the app is opened; dead "quick time preset" strings (`time_now2`, `time_nowday`, `time_custom`) suggest a friendlier flow was planned and never shipped. Real, but a feature restoration, not a small fix. |
| Trust in the generated plan | Should fix before launch → largely done | Sprint 4's fix (distinct per-stop explanations) was the single highest-leverage trust fix available; implemented. |
| Usefulness of explanations | Acceptable for MVP | Bounded, factual, non-repetitive after Sprint 4. Known gap: a relaxed/outdoor pick during a weather-driven indoor-lean day doesn't explicitly name the weather contradiction — Post-launch improvement (needs a new template-priority rule, not a smallest-safe patch). |
| Route comprehension | Should fix before launch → done | Total walking distance now surfaced early; per-leg walk times were already shown on every stop card. |
| Weather comprehension | Acceptable for MVP | Weathercard states temperature, condition, and an indoor/outdoor leaning note in plain language. |
| Budget comprehension | Acceptable for MVP | No invented price claims (verified by Sprint 2/3 tests); budget-tier language is honest about being a category-based nudge, not real price filtering (consistent with `CONCEPT.md`'s own documented limitation). |
| Visibility of trade-offs | Acceptable for MVP | One restrained, honest, whole-day trade-off note when a real relaxation occurred; verified to stay silent when nothing was relaxed (Sprint 2/3 tests). |
| Understanding "what happens next" | Acceptable for MVP | Swap/wishlist/share/"plan a different day" actions are present and labeled plainly. |
| Mobile usability | **Requires manual verification** | CSS breakpoints exist (480px/640px per `CLAUDE.md`) but have not been visually confirmed in a real browser during any sprint in this project — see manual checklist. |
| Empty/error/fallback states | Acceptable for MVP | Never-empty guarantee verified across 22 realistic scenario combinations (Sprint 3); error copy (`error_no_places`, `error_no_matches`) is plain-language and non-technical. |

---

## D. The 10-point launch readiness summary

**1. Current product promise:** "Describe your perfect day. We'll build it." — a free, keyless, real-data day/date planner covering romantic, chill, adventurous, and budget vibes for couples, solo travelers, and friend groups, anywhere with reasonable OpenStreetMap coverage.

**2. Target first-use scenario:** A curious first-time visitor enters a city and a rough time window, accepts the (now neutral) defaults, and generates one plan to evaluate whether the product understood a general, non-romantic day — not a couple specifically testing a date-night feature.

**3. Launch blockers:** **None identified.** No finding across Sprints 1–5 rose to "the product fails, crashes, or produces an actively broken result" — the closest candidates (repetitive explanations, presumptuous default) were UX-severity, not functional, and both are now fixed.

**4. Pre-launch fixes completed (this sprint):**
- Default vibe changed from "Romantic" to "Chill."
- Total walking distance/time now surfaced early in the plan view, additively, without altering the existing detailed stats strip.
- (Carried in from Sprint 4:) per-stop explanation text no longer repeats verbatim across stops sharing the same reason.

**5. Accepted MVP limitations (explicitly not blocking):**
- No Family group option.
- Fixed default time window; no "plan for right now" quick preset.
- Budget is a category-based nudge, never a real price filter (no price data source exists anywhere in the pipeline — documented since `CONCEPT.md`).
- Opening-hours confidence is a common-cases heuristic, not full RFC `opening_hours` parsing.
- No return-trip distance/time is ever shown.
- Weather-driven relaxations don't always name the weather explicitly in their explanation.

**6. Deferred improvements (candidates for the next cycle, in rough priority order):**
1. A deliberate Family option, with real category/pacing logic behind it.
2. Restoring a quick "right now" time-window flow (dead strings already exist for this).
3. Explanation logic that names weather explicitly when a relaxation and a weather bias coincide.
4. Consolidating stacked per-stop caveats (badge + note + reason) in low-tagging environments.
5. Surfacing return-trip distance.

**7. Known risks:**
- **Real-world data reliability is the single largest risk category, and it is structural, not something this or any prior sprint can resolve.** Per `CONCEPT.md`: Nominatim's public instance is licensed for light personal use only, not real production traffic; the CORS-proxy Overpass fallback is explicitly a prototype-only patch; OSRM/Overpass/Open-Meteo are all free, unauthenticated, third-party services with no SLA. A technically perfect planner is only as good as whether these services respond at the moment a real user tries it.
- Explanation and trade-off language, while now non-repetitive, is still a fixed, hand-authored template set — it will not generalize perfectly to every real place name or category combination in the wild the way a human reviewer would catch in testing.
- No production traffic has ever hit this app; behavior under concurrent real users against the shared free APIs above is unverified.

**8. Manual checks still required:** See the companion checklist — `docs/launch/manual-verification-checklist.md`. **None of these have been performed as part of this review**; everything validated in Sprints 1–5 was validated through Node-based logic tests against offline fixtures, never a real browser.

**9. Recommendation: Conditional Go.**

**10. Rationale:**
- **Technical readiness: Strong.** 37/37 automated tests pass across all five sprints' suites; the full inline script passes a syntax check; behavior is deterministic and verified against 22 realistic environment/scenario combinations; hard constraints (mood exclusions, confirmed-closed venues) are structurally enforced, not just scored.
- **Product readiness: Ready for its actual, documented scope** (couple/solo/friends, romantic/chill/adventurous/budget) — **not ready** if launch messaging implies general family support, which was never built.
- **UX readiness: Good**, materially improved by this sprint and Sprint 4's fix; several real but non-blocking gaps are explicitly documented above rather than hidden.
- **Real-world data reliability: The genuine open risk.** This is a structural property of building on free, unauthenticated third-party APIs, honestly documented since the project's own `CONCEPT.md`, and is the main reason this isn't an unconditional Go: the code is ready, but nobody has confirmed the underlying data sources behave acceptably under real, unrehearsed conditions in a real browser.

The condition on "Conditional Go" is exactly the manual verification checklist below being run by an actual person, in an actual browser, before flipping this live — not further code work.

---

*This document should be updated, not replaced, as manual checks are completed and as the deferred items above are scheduled.*
