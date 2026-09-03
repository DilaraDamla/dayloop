'use strict';
// Sprint 7 targeted tests — map-first data, events as candidates, vibe hard
// constraints, opening-hours-aware scheduling, same-complex detection, and
// country/cost context. Run with: node --test tests/
//
// All existing Sprint 1-6 test files are untouched (except the one Sprint 6
// cost-estimate test that literally tested the OLD, now-replaced currency
// mechanism — see discovery-quality.test.js for the fix and why it was
// necessary, not a weakening).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };
const DATE_STR = '2026-07-23';

function poi(category, { lat = CENTER.lat + 0.005, lon = CENTER.lon + 0.005, name = `Test ${category}`, opening_hours, brand, operator } = {}){
  const tags = { name };
  if(opening_hours) tags.opening_hours = opening_hours;
  if(brand) tags.brand = brand;
  if(operator) tags.operator = operator;
  return { lat, lon, tags, category, source: 'osm' };
}

function stop({ p, distFromPrev = 0.3, candidates, tierUsed = 'core', start = 12*60, end = 13*60 }){
  const thePoi = p;
  return { poi: thePoi, distFromPrev, candidates: candidates || [thePoi], altIndex: 0, tierUsed, relaxed: tierUsed !== 'core', start, end, walkFromPrev: 5 };
}

// ---------------------------------------------------------------------------
// Romantic incompatible-category exclusion (nightclub) + hard constraints
// cannot be overridden by proximity or discovery score.
// ---------------------------------------------------------------------------
test('romantic never selects nightclub even when it is by far the closest, richest-tagged candidate', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'romantic', group: 'friends', budget: 2, weather: { indoorBias: false } });
  const temptingNightclub = {
    lat: CENTER.lat + 0.0001, lon: CENTER.lon + 0.0001, category: 'nightclub', source: 'osm',
    tags: { name: 'Extremely Close Amazing Nightclub', cuisine: 'x', wheelchair: 'yes', level: '1', website: 'x', phone: 'x' },
  };
  const farBar = poi('bar', { lat: CENTER.lat + 0.02 });
  const { top } = eng.pickCandidatesForSlot([temptingNightclub, farBar], profile, 'evening', new Set(), CENTER, 20*60, DATE_STR, {});
  assert.ok(top.length > 0, 'a valid evening candidate must still be selected');
  assert.ok(top.every(p => p.category !== 'nightclub'), 'nightclub must never win, however close or richly tagged');
});

test('vibe hard constraints cannot be overridden by proximity for any vibe that excludes a category', () => {
  for(const vibe of ['romantic','chill','budget']){ // these three all exclude nightclub
    const profile = eng.buildDayIntentProfile({ vibe, group: 'friends', budget: 2, weather: { indoorBias: false } });
    const zeroDistanceNightclub = { lat: CENTER.lat, lon: CENTER.lon, category: 'nightclub', source: 'osm', tags: { name: 'Right Here Nightclub' } };
    const { top } = eng.pickCandidatesForSlot([zeroDistanceNightclub], profile, 'evening', new Set(), CENTER, 20*60, DATE_STR, {});
    assert.equal(top.length, 0, `${vibe}: an excluded category at zero distance must still never be selected`);
  }
});

test('vibe hard constraints cannot be overridden by Discovery Score for any vibe that excludes a category', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  // A nightclub is not a DISCOVERY_CATEGORY itself, so simulate the tempting
  // case with rich, non-chain tags (maximizes discoveryScore's positive
  // terms) at zero distance (maximizes rankCandidates' distance term too).
  const maximallyTemptingNightclub = {
    lat: CENTER.lat, lon: CENTER.lon, category: 'nightclub', source: 'osm',
    tags: { name: 'Unbranded Highly Tagged Nightclub', website: 'x', phone: 'x', wheelchair: 'yes', opening_hours: '24/7' },
  };
  const { top } = eng.pickCandidatesForSlot([maximallyTemptingNightclub], profile, 'evening', new Set(), CENTER, 20*60, DATE_STR, {});
  assert.equal(top.length, 0, 'no combination of proximity/discovery/tag-richness may surface an excluded category');
});

// ---------------------------------------------------------------------------
// Event wrong-date exclusion (HARD RULE) + geographic sanity.
// ---------------------------------------------------------------------------
test('an event on a different date is never returned as a candidate, no matter how well it fits otherwise', () => {
  const wrongDateEvent = { id:'ev1', name:'Great Concert', startDate:'2026-07-24', startTime:'20:00', lat: CENTER.lat, lon: CENTER.lon, venueName:'Arena', priceMin:0, priceMax:0, priceCurrency:'TRY' };
  const candidate = eng.normalizeEventAsCandidate(wrongDateEvent, DATE_STR);
  assert.equal(candidate, null, 'an event on the wrong date must never become a candidate at all');
});

test('an event with no venue coordinates is excluded rather than guessed', () => {
  const noCoordsEvent = { id:'ev2', name:'Mystery Event', startDate: DATE_STR, startTime:'20:00', lat: null, lon: null };
  assert.equal(eng.normalizeEventAsCandidate(noCoordsEvent, DATE_STR), null);
});

test('event geographic sanity: an event far outside the plan area is filtered out even on the right date', () => {
  const farEvent = { id:'ev3', name:'Far Concert', startDate: DATE_STR, startTime:'20:00', lat: CENTER.lat + 1, lon: CENTER.lon + 1 }; // ~130km+ away
  const candidates = eng.buildEventCandidates([farEvent], CENTER, DATE_STR);
  assert.equal(candidates.length, 0, 'an event far outside a sane walking/attending radius must not become a candidate');
});

test('a same-date, nearby event with real coordinates becomes a genuine, usable candidate', () => {
  const goodEvent = { id:'ev4', name:'Local Jazz Night', startDate: DATE_STR, startTime:'21:00', lat: CENTER.lat + 0.01, lon: CENTER.lon + 0.01, venueName:'Jazz Club', priceMin: 100, priceMax: 200, priceCurrency:'TRY', url:'https://example.com/ev4' };
  const candidates = eng.buildEventCandidates([goodEvent], CENTER, DATE_STR);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].category, 'event');
  assert.equal(candidates[0].eventMeta.priceMin, 100);
});

test('a poor-fit (far/wrong-date) event loses to a good nearby POI in real ranking', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'romantic', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const goodBar = poi('bar', { lat: CENTER.lat + 0.002, name: 'Cozy Wine Bar' });
  const wrongDateEvent = { id:'ev5', name:'Someday Concert', startDate:'2099-01-01', startTime:'20:00', lat: CENTER.lat, lon: CENTER.lon };
  const eventCandidates = eng.buildEventCandidates([wrongDateEvent], CENTER, DATE_STR); // already filtered to [] by date
  const { top, tierUsed } = eng.pickCandidatesForSlot([goodBar, ...eventCandidates], profile, 'evening', new Set(), CENTER, 20*60, DATE_STR, {});
  assert.equal(top[0].category, 'bar');
  assert.equal(tierUsed, 'core');
});

// ---------------------------------------------------------------------------
// Opening-hours-aware scheduling: never intentionally leave a stop scheduled
// while confirmed closed, when a reasonable fix exists.
// ---------------------------------------------------------------------------
test('a stop scheduled 10 minutes before it opens is shifted to its real opening time', () => {
  const p = poi('museum', { opening_hours: 'Mo-Su 11:00-18:00' });
  const stops = [ stop({ p, start: 10*60+50, end: 12*60+20 }) ]; // arrival 10:50, opens 11:00 — the exact Sprint 6 real-world defect
  eng.resolveOpeningHoursConflicts(stops, DATE_STR, 23*60, CENTER);
  assert.equal(stops[0].start, 11*60, 'arrival must shift to the real opening time (11:00), not stay before it');
  assert.equal(stops[0].scheduleAdjustedForHours, true);
});

test('a shift that would exceed the requested end window is not applied — an alternate candidate is used instead', () => {
  const closedNow = poi('museum', { name: 'Late Opener', opening_hours: 'Mo-Su 22:00-23:00' }); // opens WAY later than reasonable
  const openAlt = poi('gallery', { name: 'Open Gallery', opening_hours: '24/7' });
  const s = stop({ p: closedNow, candidates: [closedNow, openAlt], start: 14*60, end: 15*60 });
  eng.resolveOpeningHoursConflicts([s], DATE_STR, 18*60, CENTER);
  assert.equal(s.poi.tags.name, 'Open Gallery', 'with no reasonable shift available, an alternate that is actually open should be used');
});

test('unverified (unknown) opening hours are left exactly as scheduled — never treated as confirmed closed', () => {
  const unknownHours = poi('gallery', {}); // no opening_hours tag at all
  const s = stop({ p: unknownHours, start: 10*60, end: 11*60 });
  const originalStart = s.start;
  eng.resolveOpeningHoursConflicts([s], DATE_STR, 20*60, CENTER);
  assert.equal(s.start, originalStart, 'unknown hours must never be treated as a confirmed-closed conflict');
  assert.notEqual(s.scheduleAdjustedForHours, true);
});

test('a shifted stop cascades the delay to later stops, keeping the rest of the day consistent', () => {
  const early = poi('museum', { name:'Shifts Later', opening_hours: 'Mo-Su 11:00-18:00' });
  const later = poi('restaurant', { name:'Comes After' });
  const s1 = stop({ p: early, start: 10*60+45, end: 12*60+15 });
  const s2 = stop({ p: later, start: 12*60+20, end: 13*60+50 });
  eng.resolveOpeningHoursConflicts([s1, s2], DATE_STR, 20*60, CENTER);
  const appliedDelay = s1.start - (10*60+45);
  assert.ok(appliedDelay > 0);
  assert.equal(s2.start, 12*60+20 + appliedDelay, 'later stops must shift by the same delay to stay internally consistent');
});

// ---------------------------------------------------------------------------
// Same-complex detection.
// ---------------------------------------------------------------------------
test('two very close venues sharing a name token are detected as the same complex', () => {
  const a = poi('restaurant', { name: 'BFI Riverfront', lat: CENTER.lat, lon: CENTER.lon });
  const b = poi('cafe', { name: 'BFI Café', lat: CENTER.lat + 0.0002, lon: CENTER.lon + 0.0002 }); // ~25m away
  assert.equal(eng.isSameComplex(a, b), true);
});

// Regression test using the REAL coordinates of the exact case this detector
// was built for, fetched live from Overpass during Sprint 7's acceptance
// pass: BFI Café and BFI Riverfront (London), 121m apart, neither carrying an
// operator/brand tag. The original 80m threshold missed this real pair —
// caught directly by re-running the live acceptance pass, not assumed fixed.
test('the real-world BFI Café / BFI Riverfront pair (121m apart, no operator tag) is caught', () => {
  const a = { lat: 51.5072678, lon: -0.1155393, tags: { name: 'BFI Riverfront' }, category: 'restaurant' };
  const b = { lat: 51.5063202, lon: -0.1146766, tags: { name: 'BFI Café' }, category: 'cafe' };
  assert.equal(eng.isSameComplex(a, b), true, 'the verified real-world 121m BFI pair must be detected as the same complex');
});

test('two very close venues sharing an operator/brand tag are detected as the same complex', () => {
  const a = poi('cafe', { name: 'Museum Cafe', operator: 'City Arts Trust', lat: CENTER.lat, lon: CENTER.lon });
  const b = poi('gallery', { name: 'City Gallery', operator: 'City Arts Trust', lat: CENTER.lat + 0.0003, lon: CENTER.lon });
  assert.equal(eng.isSameComplex(a, b), true);
});

test('two close but genuinely unrelated neighboring businesses are NOT flagged as the same complex', () => {
  const a = poi('cafe', { name: 'Blue Bottle Coffee', lat: CENTER.lat, lon: CENTER.lon });
  const b = poi('bookstore', { name: 'Riverside Books', lat: CENTER.lat + 0.0003, lon: CENTER.lon });
  assert.equal(eng.isSameComplex(a, b), false, 'distance alone must not be enough — no shared name token or operator here');
});

test('two venues with a shared name token but far apart are NOT the same complex', () => {
  const a = poi('restaurant', { name: 'City Grill', lat: CENTER.lat, lon: CENTER.lon });
  const b = poi('restaurant', { name: 'City Grill', lat: CENTER.lat + 0.05, lon: CENTER.lon }); // ~5.5km away — a different branch
  assert.equal(eng.isSameComplex(a, b), false, 'a shared name far away is a different branch, not the same complex');
});

test('pickCandidatesForSlot avoids selecting a same-complex venue as an already-used stop', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const usedRestaurant = poi('restaurant', { name: 'BFI Riverfront', lat: CENTER.lat, lon: CENTER.lon });
  const sameComplexCafe = poi('cafe', { name: 'BFI Café', lat: CENTER.lat + 0.0002, lon: CENTER.lon + 0.0002 });
  const genuinelyDifferentCafe = poi('cafe', { name: 'Riverside Coffee House', lat: CENTER.lat + 0.01, lon: CENTER.lon + 0.01 });
  const used = new Set([usedRestaurant]);
  const { top } = eng.pickCandidatesForSlot([sameComplexCafe, genuinelyDifferentCafe], profile, 'coffee', used, usedRestaurant, 11*60, DATE_STR, {});
  assert.ok(top.every(p => p.tags.name !== 'BFI Café'), 'the same-complex cafe must be excluded once BFI Riverfront is already used');
  assert.ok(top.some(p => p.tags.name === 'Riverside Coffee House'), 'a genuinely different nearby cafe must still be selectable');
});

// ---------------------------------------------------------------------------
// Routing API failure does not destroy a valid plan (already true in the
// architecture — fetchWalkingRoute isolates its own errors — this locks that
// contract in as an explicit regression test rather than leaving it implicit).
// ---------------------------------------------------------------------------
test('buildItinerary + scheduleStops produce a full plan using straight-line fallback when no route geometry exists', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const pois = [
    poi('cafe', { lat: CENTER.lat + 0.001 }),
    poi('park', { lat: CENTER.lat + 0.005 }),
    poi('restaurant', { lat: CENTER.lat + 0.008 }),
  ];
  const { stops: rawStops } = eng.buildItinerary(pois, CENTER, { profile, dateStr: DATE_STR, startMin: 10*60, endMin: 16*60 });
  assert.ok(rawStops.length > 0, 'a plan must still be produced with no routing data at all (routing failure is simulated by simply never calling fetchWalkingRoute)');
  const scheduled = eng.scheduleStops(rawStops, 10*60, null, 1); // legDurationsMin: null == routing unavailable, the real fallback path
  assert.equal(scheduled.length, rawStops.length);
  scheduled.forEach(s => assert.ok(Number.isFinite(s.start) && Number.isFinite(s.end)));
});

// ---------------------------------------------------------------------------
// POI provider failure behavior: the never-empty and hard-constraint
// guarantees already tested in earlier sprints still hold with events mixed
// into the candidate pool (a genuinely new code path this sprint added).
// ---------------------------------------------------------------------------
test('a plan with zero POIs and zero events produces an honest empty result, never a fabricated stop', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const { stops } = eng.buildItinerary([], CENTER, { profile, dateStr: DATE_STR, startMin: 10*60, endMin: 14*60 });
  assert.equal(stops.length, 0);
});

// ---------------------------------------------------------------------------
// Coordinate country/cost behavior (Phase 8).
// ---------------------------------------------------------------------------
test('cost estimate uses the real country code, not a text-label guess, for coordinate-style input', () => {
  const stops = [ { poi: poi('restaurant') } ];
  // A label that LOOKS like it could be anywhere — the point is that only
  // countryCode (real Nominatim data) decides currency now, never the text.
  const costWithVerifiedTurkey = eng.estimateDailyCost(stops, 2, { label: '41.0082,28.9784', countryCode: 'tr' });
  const costWithoutVerification = eng.estimateDailyCost(stops, 2, { label: '41.0082,28.9784' });
  assert.equal(costWithVerifiedTurkey.currency, 'TL');
  assert.match(eng.formatCostEstimate(costWithVerifiedTurkey).total, /TL/);
  assert.doesNotMatch(eng.formatCostEstimate(costWithoutVerification).total, /TL/);
});

// ---------------------------------------------------------------------------
// Explanation statements remain evidence-backed (whole-day explainPlan).
// ---------------------------------------------------------------------------
const BANNED_PATTERNS = [/best in town/i, /amazing/i, /always quiet/i, /\bsafe\b/i, /popular with locals/i, /highly rated/i, /local favorite/i, /hidden gem/i];
test('explainPlan never produces unsupported marketing language', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'creative', group: 'couple', budget: 2, weather: { indoorBias: true } });
  const stops = [
    stop({ p: poi('gallery', { lat: CENTER.lat + 0.001 }), start: 10*60, end: 11*60 }),
    stop({ p: poi('restaurant', { lat: CENTER.lat + 0.002 }), start: 11*60+10, end: 12*60+40 }),
  ];
  const dayTrace = { densityTier: 'medium', totalDistanceKm: 0.4 };
  const reasons = eng.explainPlan(profile, dayTrace, stops, { indoorBias: true });
  assert.ok(reasons.length > 0, 'at least one real, evidence-backed reason should be produced for this fixture');
  reasons.forEach(r => BANNED_PATTERNS.forEach(re => assert.ok(!re.test(r), `explainPlan produced unsupported language: "${r}"`)));
});

test('explainPlan only claims a schedule shift happened when scheduleAdjustedForHours is actually true', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const stops = [ stop({ p: poi('cafe'), start: 10*60, end: 11*60 }) ]; // no scheduleAdjustedForHours flag at all
  const reasons = eng.explainPlan(profile, { densityTier:'medium', totalDistanceKm: 5 }, stops, { indoorBias: false });
  assert.ok(!reasons.includes(eng.t('planexplain_schedule_shifted')), 'must not claim a schedule adjustment that never happened');
});

test('explainPlan only claims vibe-based exclusions when the resolved profile actually excludes something', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'adventurous', group: 'friends', budget: 2, weather: { indoorBias: false } }); // adventurous excludes nothing but ferry_terminal
  const stops = [ stop({ p: poi('bar'), start: 20*60, end: 21*60 }) ];
  const reasons = eng.explainPlan(profile, { densityTier:'medium', totalDistanceKm: 5 }, stops, { indoorBias: false });
  const exclusionLine = reasons.find(r => r.includes(eng.t('cat_ferry_terminal')));
  if(exclusionLine){
    assert.ok(profile.excluded.has('ferry_terminal'), 'if an exclusion is named, it must be a real, resolved exclusion');
  }
});

// ---------------------------------------------------------------------------
// Sprint 7.1: event start-time anchoring. A selected event candidate carries
// its own real, verified startTime — the generic walking-time scheduler must
// never invent a different one for it, and the rest of the day must be
// arranged around that fixed point without corrupting the schedule.
// ---------------------------------------------------------------------------

test('a selected event is scheduled at its own real, verified start time — not the generic slot estimate', () => {
  const rawEvent = { id:'ev10', name:'Real Jazz Night', startDate: DATE_STR, startTime:'19:30:00', lat: CENTER.lat+0.001, lon: CENTER.lon+0.001, venueName:'Jazz Club' };
  const eventCand = eng.normalizeEventAsCandidate(rawEvent, DATE_STR, 10*60, 23*60);
  assert.ok(eventCand, 'a same-date event with real coordinates and a verified time inside the window must be a valid candidate');
  const early = poi('cafe', { lat: CENTER.lat, lon: CENTER.lon });
  const stops = [
    stop({ p: early, candidates: [early], start: 10*60, end: 10*60+45 }),
    // deliberately gives it a naive estimate nowhere near the real time, the
    // way a generic evening slot estimate would
    stop({ p: eventCand, candidates: [eventCand], start: 11*60, end: 12*60+45 }),
  ];
  eng.anchorEventTimes(stops, 10*60, CENTER, 1);
  assert.equal(stops[1].start, 19*60+30, 'the event stop must be scheduled at its own real start time, not the naive estimate');
  assert.equal(stops[1].eventAnchored, true);
});

test('an event outside the requested day window is never selected, even though its date matches', () => {
  const tooEarly = { id:'ev11', name:'Breakfast Rave', startDate: DATE_STR, startTime:'07:00:00', lat: CENTER.lat, lon: CENTER.lon };
  assert.equal(eng.normalizeEventAsCandidate(tooEarly, DATE_STR, 10*60, 20*60), null, 'an event starting before the requested window must not become a candidate');

  const tooLate = { id:'ev12', name:'Closing Set', startDate: DATE_STR, startTime:'23:30:00', lat: CENTER.lat, lon: CENTER.lon };
  assert.equal(eng.normalizeEventAsCandidate(tooLate, DATE_STR, 10*60, 20*60), null, 'an event that would still be running past the requested end time must not become a candidate');

  const inWindow = { id:'ev13', name:'Afternoon Show', startDate: DATE_STR, startTime:'14:00:00', lat: CENTER.lat, lon: CENTER.lon };
  assert.ok(eng.normalizeEventAsCandidate(inWindow, DATE_STR, 10*60, 20*60), 'an event that starts and finishes inside the requested window must still be a valid candidate');
});

test('an event with no verified start time is never selected, even with a matching date and real coordinates', () => {
  const noTime = { id:'ev14', name:'Mystery Timing Event', startDate: DATE_STR, startTime: null, lat: CENTER.lat, lon: CENTER.lon };
  assert.equal(eng.normalizeEventAsCandidate(noTime, DATE_STR), null, 'an event with no verified start time can never be anchored, so it must not become a candidate at all');
});

test('stops after an anchored event start only once the event has actually ended, and stops before it do not overlap it either', () => {
  const rawEvent = { id:'ev15', name:'Anchor Show', startDate: DATE_STR, startTime:'14:00:00', lat: CENTER.lat+0.002, lon: CENTER.lon+0.002 };
  const eventCand = eng.normalizeEventAsCandidate(rawEvent, DATE_STR, 10*60, 20*60);
  const before = poi('cafe', { lat: CENTER.lat, lon: CENTER.lon });
  const after = poi('restaurant', { lat: CENTER.lat+0.003, lon: CENTER.lon+0.003 });
  const stops = [
    stop({ p: before, candidates: [before], start: 10*60, end: 10*60+45 }),
    stop({ p: eventCand, candidates: [eventCand], start: 11*60, end: 11*60+45 }),
    stop({ p: after, candidates: [after], start: 12*60, end: 13*60 }),
  ];
  eng.anchorEventTimes(stops, 10*60, CENTER, 1);
  const [s0, s1, s2] = stops;
  assert.equal(s1.start, 14*60);
  assert.ok(s0.end <= s1.start, 'the stop before the event must not overlap it');
  assert.ok(s2.start >= s1.end, `the stop after the event must not start before the event ends (event ends ${s1.end}, next starts ${s2.start})`);
});

test('an opening-hours shift earlier in the day never moves an already-anchored event', () => {
  const shiftsLater = poi('museum', { name:'Opens Late', opening_hours:'Mo-Su 11:00-18:00' });
  const rawEvent = { id:'ev16', name:'Fixed Show', startDate: DATE_STR, startTime:'14:00:00', lat: CENTER.lat+0.001, lon: CENTER.lon+0.001 };
  const eventCand = eng.normalizeEventAsCandidate(rawEvent, DATE_STR, 10*60, 20*60);
  const stops = [
    stop({ p: shiftsLater, start: 10*60+50, end: 12*60+20 }), // arrives 10 min before opening — will be shifted later
    { poi: eventCand, distFromPrev: 0.3, candidates: [eventCand], altIndex: 0, tierUsed: 'acceptable', relaxed: true,
      start: 14*60, end: 16*60, walkFromPrev: 5, eventAnchored: true },
  ];
  eng.resolveOpeningHoursConflicts(stops, DATE_STR, 20*60, CENTER);
  assert.equal(stops[0].scheduleAdjustedForHours, true, 'sanity check: the earlier stop really was shifted for its own opening hours');
  assert.equal(stops[1].start, 14*60, 'the anchored event must keep its real start time despite an earlier stop\'s shift');
  assert.equal(stops[1].end, 16*60, 'the anchored event end must also stay untouched');
});

test('when an event cannot be reached in time and no alternate exists, it is dropped rather than corrupting the schedule', () => {
  const rawEvent = { id:'ev17', name:'Impossible Timing Show', startDate: DATE_STR, startTime:'09:50:00', lat: CENTER.lat+0.05, lon: CENTER.lon+0.05 };
  const eventCand = eng.normalizeEventAsCandidate(rawEvent, DATE_STR, 9*60, 20*60);
  const before = poi('cafe', { lat: CENTER.lat, lon: CENTER.lon });
  const after = poi('restaurant', { lat: CENTER.lat+0.06, lon: CENTER.lon+0.06 });
  const stops = [
    stop({ p: before, candidates: [before], start: 9*60, end: 9*60+45 }), // ends 09:45 — far too late to reach a 5.5km-away 09:50 event
    stop({ p: eventCand, candidates: [eventCand], start: 10*60, end: 10*60+45 }),
    stop({ p: after, candidates: [after], start: 11*60, end: 12*60 }),
  ];
  const result = eng.anchorEventTimes(stops, 9*60, CENTER, 1);
  assert.ok(result.every(s => s.poi.category !== 'event'), 'an unreachable event must not remain in the itinerary');
  assert.equal(result.length, 2, 'the day shrinks honestly rather than keeping a corrupted stop');
  for(let i=1;i<result.length;i++){
    assert.ok(result[i].start >= result[i-1].end, `stop ${i} must not start before stop ${i-1} ends (no overlap)`);
  }
  result.forEach(s => assert.ok(s.start < s.end, 'every remaining stop must have a valid, positive duration'));
});

test('when an event cannot be reached in time but a non-event alternate exists in the same slot, the alternate is used instead', () => {
  const rawEvent = { id:'ev18', name:'Impossible Timing Show 2', startDate: DATE_STR, startTime:'09:50:00', lat: CENTER.lat+0.05, lon: CENTER.lon+0.05 };
  const eventCand = eng.normalizeEventAsCandidate(rawEvent, DATE_STR, 9*60, 20*60);
  const altBar = poi('bar', { name:'Nearby Bar', lat: CENTER.lat+0.001, lon: CENTER.lon+0.001 });
  const before = poi('cafe', { lat: CENTER.lat, lon: CENTER.lon });
  const stops = [
    stop({ p: before, candidates: [before], start: 9*60, end: 9*60+45 }),
    stop({ p: eventCand, candidates: [eventCand, altBar], start: 10*60, end: 10*60+45 }),
  ];
  const result = eng.anchorEventTimes(stops, 9*60, CENTER, 1);
  assert.equal(result.length, 2, 'no stop should be dropped when a usable non-event alternate exists');
  assert.equal(result[1].poi.tags.name, 'Nearby Bar', 'an unreachable event falls back to its own already-ranked non-event alternate');
  assert.ok(result[1].start >= result[0].end, 'the substituted stop must still not overlap the previous one');
});
