# DayLoop Planning Architecture

**Status:** Architectural specification — target design, not a description of current code.
**Scope:** How DayLoop turns a user's request into a day. This document is the reference for every future planning-related feature; new work should be positioned against these three layers rather than added as an isolated patch.

This is a specification of *responsibilities and contracts*, not an implementation guide. It intentionally contains no code, no function names, and no library choices — those belong in implementation docs that reference this one.

---

## 1. Purpose and Framing

DayLoop's stated purpose is not "find nearby places." It is:

> Understand what the user actually wants, and create the best possible day for them.

Two failure modes follow directly from treating this as a places-retrieval problem instead:

- Optimizing for **selected categories** instead of the **intention** behind them (a "calm" request isn't a request for parks-and-cafés, it's a request for a low-stress, naturally-paced day).
- Optimizing **per-stop fit** instead of **whole-day quality** (a sequence of individually-reasonable stops can still add up to a bad day — rushed, redundant, front-loaded, or silently compromised without the user ever being told).

The architecture below exists to make both of those failure modes structurally harder to reintroduce, by separating *what the user wants* from *what reality can supply* from *how that gap gets communicated* — three concerns that today are tangled together in a single pass over candidate places.

---

## 2. Architectural Overview

Three layers, run in strict order, each consuming only the previous layer's output — never reaching back into an earlier layer's internals.

```
                  Raw user input                    Live conditions
       (mood, date-type, budget, city, time window)   (weather)
                         │                                │
                         └────────────────┬───────────────┘
                                           ▼
                              ┌─────────────────────────┐
                              │      INTENT LAYER       │
                              │  resolve what "a good    │
                              │  day" means for THIS      │
                              │  request                  │
                              └─────────────────────────┘
                                           │
                                           ▼
                                Day Intent Profile
                       (tiers, pacing target, hard constraints,
                        relaxation order — one coherent policy)
                                           │
                                           ▼
                              ┌─────────────────────────┐
        Real-world supply →  │     DECISION LAYER       │
    (places, weather, routes,│  build the best possible │
     opening hours, density) │  day given what's real    │
                              └─────────────────────────┘
                                           │
                                           ▼
                          Day Plan  +  Decision Trace
                 (ordered stops)     (factual record of every
                                      choice and every trade-off)
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │   EXPLANATION LAYER      │
                              │  say what happened,       │
                              │  honestly and only what's  │
                              │  actually known             │
                              └─────────────────────────┘
                                           │
                                           ▼
                        Final itinerary: stops + honest reasoning
```

**Why this order, specifically:**

- Intent must fully resolve *before* Decision runs, so Decision never has to arbitrate an unresolved contradiction (e.g., a romantic mood paired with a friends group) using its own improvised judgment.
- Decision must fully commit to a factual trace *before* Explanation runs, so Explanation never has to infer what happened — only report it.
- No layer skips forward or reaches backward. If a later layer seems to need something an earlier layer didn't provide, the fix is to enrich that layer's output contract — not to grant a shortcut around it.

---

## 3. Cross-Cutting Design Principles

These apply to all three layers and should be the first things checked when reviewing any new feature against this architecture.

1. **Each layer's output is a complete contract.** The next layer must never need to re-derive information the previous layer already had. If Explanation needs to know *why* a stop was picked, that fact must already exist in the Decision Layer's trace — Explanation must never re-inspect raw place data to reconstruct it.
2. **Intent is blind to supply; Decision is blind to raw user input.** The Intent Layer decides what a good day *should* look like without knowing what's actually nearby. The Decision Layer never touches the user's raw mood/group/budget selections directly — only the already-reconciled profile. This separation is what prevents two independent mechanisms from silently mutating the same decision (the historical cause of mood/group contradictions producing unwanted category leaks).
3. **Hard constraints are structurally different from soft preferences.** A hard constraint (confirmed-closed venue, unsafe weather exposure, a mood-level exclusion) must be capable of being enforced absolutely. A soft preference (category fit, distance, atmosphere, popularity) must be capable of being relaxed. The two must never share a single, blendable scoring mechanism — a system that only has "everything is a nudge" cannot guarantee it never crosses a line that must never be crossed.
4. **Every relaxation must be authorized, ordered, and visible.** The Decision Layer may only compromise in the order the Intent Layer specifies, must never invent its own compromise priority, and must never compromise silently — every relaxation used must be recorded in the trace for the Explanation Layer to surface.
5. **The day is guaranteed to exist.** A well-formed request must always produce a real day, even if that day is smaller, plainer, or more heavily caveated than hoped — never nothing.
6. **Explanation only speaks from evidence.** No layer downstream of Decision may assert a fact that isn't traceable to real, verifiable input (weather, distance, opening-hours status, which tier was matched). Confident-sounding language about anything unverifiable (quality, popularity, safety) is a defect, not a style choice.
7. **Confidence is proportionate to what's actually known.** Uncertainty (unknown opening hours, a fallback substitution, a stretched search radius) must be represented as uncertainty everywhere it appears — never silently upgraded to certainty for the sake of a cleaner-looking result.
8. **Quality is judged at the level of the whole day, not the stop.** A day is a sequence with pacing, rhythm, and a narrative shape — evaluating each stop in isolation is necessary but never sufficient.
9. **The system adapts its shape to reality, not the reverse.** A dense city and a sparse village should not be forced through an identical template; the day itself — its length, its density of stops — should flex to what a place can actually support, while still satisfying points 3–7 above.
10. **Every layer is independently reviewable.** A human reviewer should be able to audit any one layer's output against its stated responsibility without needing to understand the internals of the other two. This is a design constraint, not just a nice property — it's what makes this architecture testable by inspection rather than only by end-to-end trial and error.

---

## 4. Layer 1 — Intent Layer

### Responsibility
Resolve everything known about the request — the user's stated mood, who they're with, their budget, the time available, and the conditions of the day — into a single, internally consistent specification of what a good day means *for this specific request*. This is where contradictions between inputs get reconciled by an explicit, named policy, rather than by two independent mechanisms each partially mutating the outcome.

### Inputs
- Stated preferences: mood/vibe, date-type/group, budget level, trip duration, time window
- Day conditions: weather forecast for the requested window
- Optional personalization signal, where available: prior saves, prior swaps-away (not required for the layer to function)

### Outputs — the Day Intent Profile
- A pacing target for the day (e.g., relaxed, moderate, energetic)
- Category guidance per part of the day, expressed in tiers: what the day is *actually about*, what's an *acceptable* substitute, and what must *never* appear regardless of what's available
- An atmosphere goal where relevant (e.g., a quieter start, a livelier evening)
- A cost posture with real weight behind it — not a cosmetic nudge
- The day's hard constraints (safety-relevant weather limits, any exclusion that must never be crossed)
- An explicit, ordered list of what may be relaxed, and in what sequence, if reality can't fully satisfy the profile

### Data Required
- A mood × date-type × budget interaction policy — the authoritative reconciliation rules for combinations of inputs
- The current weather forecast for the request window
- No place-specific data of any kind — this layer must remain blind to what's actually nearby

### Failure Modes
- **Unanticipated input combinations.** A pairing nobody designed a policy for must fall back to a documented default resolution, never to unmanaged behavior.
- **Cultural or regional mismatch.** A single fixed interaction policy encodes one set of cultural assumptions about what "calm" or "romantic" mean; this must be treated as a known, tracked limitation.
- **Missing or unreliable weather data.** Must default to a neutral posture — never silently assume favorable or unfavorable conditions.
- **Incomplete relaxation guidance.** If this layer fails to specify an order for what can bend, the Decision Layer is left to improvise its own priorities, reopening the exact class of problem this architecture exists to close.

### Interaction With Other Layers
Produces the Day Intent Profile as its entire interface to the Decision Layer. Receives nothing back in the base design. A future personalization loop — learning from which parts of past profiles required relaxation, and how the user reacted — would attach here without changing this layer's external contract.

---

## 5. Layer 2 — Decision Layer

### Responsibility
Given the Day Intent Profile and the real world, assemble the actual best possible day: detect how much the surrounding area can realistically support, apply hard constraints absolutely, apply the authorized relaxation order when supply falls short, and evaluate the result as a whole sequence — pacing, variety, and the quality of transitions between stops — not only as a set of independently-scored candidates.

### Inputs
- The Day Intent Profile (tiers, pacing target, hard constraints, relaxation order)
- Real-world supply data: candidate places, live weather, opening-hours information, walking/travel routing, and a signal for how dense or sparse the surrounding area actually is

### Outputs
- The Day Plan: an ordered sequence of stops with timing
- The Decision Trace: a factual, structured record — for each stop, which tier of the profile it satisfied, whether it required relaxation and of what kind, what the real alternatives were and why this one was chosen, and a confidence marker on anything uncertain; for the day as a whole, whether its shape was adapted to local density and why

The Decision Layer never produces user-facing language. Its output is a factual record, not prose.

### Data Required
- Live place data for the surrounding area
- Live weather
- Opening-hours information (with its inherent uncertainty preserved, not resolved into a false certainty)
- Real travel/routing data between candidate stops
- A density or place-type signal for the area being planned in

### Failure Modes
- **Exhausted relaxation with nothing left to offer.** Must still produce a genuine day — smaller or plainer if necessary — never an empty result.
- **Relaxation overreach.** Must never cross a hard constraint even when nothing else is available; the correct response to an impossible request is a smaller day, never a broken guarantee.
- **Unvalidated whole-day judgment.** There is no ground truth for "this day flows well" — this must be treated as a known, named limitation rather than presented with false confidence.
- **Stale or incomplete data mistaken for certainty.** Any uncertainty in the underlying data must be preserved as uncertainty in the trace, not silently resolved in either direction.
- **Regional mismatch.** Even with density-adaptive shape, a policy tuned against one kind of place may still misjudge another's actual character — a residual risk to monitor, not something this layer can fully eliminate alone.

### Interaction With Other Layers
Consumes the Day Intent Profile as its entire interface to the Intent Layer — it never reaches back to raw user input. Produces the Decision Trace as its entire interface to the Explanation Layer — it never writes explanatory language itself. This boundary is what keeps the Explanation Layer from ever needing (or being tempted to take) direct access to raw place or scoring data.

---

## 6. Layer 3 — Explanation Layer

### Responsibility
Translate the Decision Trace, read against the Day Intent Profile it was measured by, into honest, plain-language explanation: why each stop was chosen, how confident the plan is in what it's telling the user, and — when a compromise happened — saying so plainly instead of presenting a stretched result with unearned confidence.

### Inputs
- The Decision Trace (factual, structured)
- The Day Intent Profile (what was originally wanted, so explanations can reference it — "matches the relaxed pace you asked for")

### Outputs
- One factual reason per stop, drawn only from the trace — never invented
- Confidence signals covering more than a single dimension: category-match strength, opening-hours certainty, and whether a relaxation occurred
- Honest whole-day framing that names any compromise made, rather than defaulting to generic reassurance language regardless of what actually happened

### Data Required
- Nothing beyond the Decision Trace and the Day Intent Profile — this layer must not have independent access to raw place data, scoring internals, or any external source
- A bounded set of explanation templates keyed to specific trace fields, rather than open-ended generation — this is what makes it structurally impossible for this layer to turn a proxy signal into an unverifiable claim

### Failure Modes
- **Overclaiming.** The central risk of this layer: rendering a proxy signal (e.g., how much data exists about a place) as if it were a verified quality claim (e.g., "highly rated"). Must be prevented structurally, not just by tone — the layer should have no path to say anything the trace doesn't support.
- **Alert fatigue.** Flagging every stop with a caveat, regardless of whether one is warranted, produces its own trust failure — an apologetic-feeling plan erodes confidence the same way an overconfident one does. Caveats should appear only where the trace records a real compromise.
- **Repetition that reads as robotic.** Identical template language across every stop undermines the sense that the explanation is actually specific to that stop.
- **Silence by omission.** If the Decision Trace doesn't capture something decision-relevant, this layer has nothing to draw on and will look more confident than it should — meaning most failures at this layer are actually failures in how complete the Decision Layer's trace is. The contract between the two must be specified precisely enough that nothing that matters is left out.

### Interaction With Other Layers
Strictly downstream of both other layers. Reads the Day Intent Profile and the Decision Trace; produces the final user-facing itinerary text. Feeds nothing back in the base design. A future extension — using signals about which explanations users found useful as feedback toward the Intent or Decision layers — is a natural next seam but is explicitly out of scope here.

---

## 7. Future Extension Points

These are the seams this architecture is deliberately designed to accept without restructuring:

- **Personalization / learning loop.** Feeding outcomes — which relaxations occurred, which explanations users responded well to, what got swapped away from — back into the Intent Layer's interaction policy over time. Attaches at the Intent Layer's input boundary; does not change any layer's output contract.
- **Multi-day or repeat-visit awareness.** Avoiding staleness for a returning user (the same top pick every time) is a concern that belongs in the Intent Layer (as an added input signal) and the Decision Layer (as an added soft preference for novelty) — not a new layer.
- **Richer atmosphere and quality signal**, if a future data source provides it (reviews, richer venue metadata). This slots into the Decision Layer's supply data and the Explanation Layer's evidence base without changing either layer's responsibilities — it only enriches what they have to work with.
- **Regional/cultural policy variants.** The Intent Layer's interaction-policy table and the Decision Layer's density norms are both named as single global tables in this document for simplicity; a natural extension is making either regionally aware, without changing what each layer is responsible for.
- **User-facing trade-off controls.** Letting a user see and adjust the Intent Layer's relaxation order directly (e.g., "prefer a shorter day over a compromised category") is a natural UI extension that only requires exposing an existing internal contract, not building a new one.
- **Explanation feedback loop.** Treating "was this reason helpful" as its own signal back toward the Decision Layer's trace design and the Intent Layer's policy table, closing the loop between what was explained and what was subsequently trusted or rejected.

Each of these extends an existing layer's inputs or data sources. None of them should require collapsing the boundary between layers, adding a shortcut around one, or a layer beginning to assume responsibilities that belong to another. If a proposed feature seems to require that, it is a signal to revisit this document before implementing it, not to make an exception.
