'use strict';
// Sprint 1 test coverage for the Intent/Decision Layer refactor
// (docs/architecture/planning-architecture.md). Run with: node --test tests/
//
// These tests exercise the ACTUAL logic in index.html via loadDecisionEngine.js
// (a vm sandbox around the real inline <script>), not a reimplementation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };
const DATE_STR = '2026-07-22';
const EST_MINUTE = 20 * 60; // 8pm, an "evening" slot estimate

function poi(category, { lat = CENTER.lat + 0.01, lon = CENTER.lon + 0.01, name = `Test ${category}` } = {}){
  return { lat, lon, tags: { name }, category };
}

function noWeather(){ return { indoorBias: false }; }

// ---------------------------------------------------------------------------
// 1. Calm intent must not select nightlife or bar venues unless no viable
//    alternative exists.
// ---------------------------------------------------------------------------
test('chill evening prefers cafe over bar when both are available', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const pois = [poi('cafe'), poi('bar')];
  const { top, tierUsed } = eng.pickCandidatesForSlot(pois, profile, 'evening', new Set(), CENTER, EST_MINUTE, DATE_STR, {});
  assert.equal(top[0].category, 'cafe');
  assert.equal(tierUsed, 'core');
});

test('chill evening falls back to bar only when no calmer option exists', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const pois = [poi('bar')]; // no cafe anywhere
  const { top, tierUsed } = eng.pickCandidatesForSlot(pois, profile, 'evening', new Set(), CENTER, EST_MINUTE, DATE_STR, {});
  assert.equal(top[0].category, 'bar');
  assert.equal(tierUsed, 'lastResort');
});

test('chill evening never selects nightclub, even as an absolute last resort', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const pois = [poi('nightclub')]; // the only thing anywhere nearby
  const { top } = eng.pickCandidatesForSlot(pois, profile, 'evening', new Set(), CENTER, EST_MINUTE, DATE_STR, {});
  assert.equal(top.length, 0, 'a hard-excluded category must never be selected, not even to avoid an empty slot');
});

test('romantic + friends must not reopen the nightclub exclusion romantic itself set', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'romantic', group: 'friends', budget: 2, weather: noWeather() });
  assert.ok(profile.excluded.has('nightclub'), 'group must never override a mood-level exclusion');
  assert.ok(!profile.slotTiers.evening.core.includes('nightclub'));
  assert.ok(!profile.slotTiers.evening.acceptable.includes('nightclub'));
  assert.ok(!profile.slotTiers.evening.lastResort.includes('nightclub'));
});

// ---------------------------------------------------------------------------
// 2. Budget intent must not fail only because free venues are unavailable.
// ---------------------------------------------------------------------------
test('budget vibe still produces a day when no free-leaning venues exist nearby', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'budget', group: 'couple', budget: 1, weather: noWeather() });
  // No park/viewpoint/artwork/ice_cream anywhere — only paid categories.
  const pois = [
    poi('cafe', { lat: CENTER.lat + 0.002 }),
    poi('restaurant', { lat: CENTER.lat + 0.004 }),
    poi('bar', { lat: CENTER.lat + 0.006 }),
  ];
  const { stops, dayTrace } = eng.buildItinerary(pois, CENTER, {
    profile, dateStr: DATE_STR, startMin: 10 * 60, endMin: 12 * 60, // 2h window -> ['activity','food']
  });
  assert.ok(stops.length > 0, 'budget must not return an empty day just because free venues are unavailable');
  assert.ok(dayTrace.tierBreakdown, 'the trace must record which tier every stop actually came from');
});

// ---------------------------------------------------------------------------
// 3 & 4. Density-adaptive day structure.
// ---------------------------------------------------------------------------
test('low-density areas produce fewer, longer stops', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const sparsePois = [poi('cafe'), poi('cafe'), poi('restaurant')]; // 2 categories, 3 places total
  const structure = eng.planDayStructure(sparsePois, profile, 9); // a long day that would normally get 5 slots
  assert.equal(structure.densityTier, 'low');
  assert.ok(structure.slotTypes.length < 5, 'a sparse area should not be forced into the full 5-slot template');
  assert.ok(structure.stretchFactor > 1, 'remaining stops should run longer to fill a sparse day meaningfully');
});

test('dense areas keep the full slot template at normal pacing', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const categories = ['cafe','restaurant','bar','museum','gallery','park','bakery','ice_cream'];
  const densePois = [];
  categories.forEach((cat, ci) => {
    for(let i=0;i<5;i++) densePois.push(poi(cat, { lat: CENTER.lat + ci*0.001 + i*0.0001 }));
  });
  const structure = eng.planDayStructure(densePois, profile, 9);
  assert.equal(structure.densityTier, 'high');
  assert.equal(structure.slotTypes.length, 5, 'a dense area should support the full requested-duration template');
  assert.equal(structure.stretchFactor, 1);
});

// ---------------------------------------------------------------------------
// 5. Duplicate or near-duplicate experiences should be penalized.
// ---------------------------------------------------------------------------
test('scorePOI penalizes a category that has already been used earlier in the day', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const candidate = poi('cafe');
  const freshScore = eng.scorePOI(candidate, profile, EST_MINUTE, DATE_STR, {});
  const repeatScore = eng.scorePOI(candidate, profile, EST_MINUTE, DATE_STR, { cafe: 1 });
  assert.ok(repeatScore < freshScore, 'a repeated category must score lower than the identical fresh one');
});

// ---------------------------------------------------------------------------
// 6. The planner should not silently return an empty itinerary when valid
//    places exist.
// ---------------------------------------------------------------------------
test('a valid but unusual candidate is used rather than returning an empty day', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: true } });
  // Nothing chill's own tiers would normally choose for any slot — only a
  // shopping mall exists nearby. Not excluded, not confirmed-closed: valid.
  const pois = [poi('shopping')];
  const { stops } = eng.buildItinerary(pois, CENTER, {
    profile, dateStr: DATE_STR, startMin: 14 * 60, endMin: 16 * 60,
  });
  assert.ok(stops.length > 0, 'a valid place existed and must not be silently discarded in favor of an empty itinerary');
});

test('genuinely no places at all still yields an empty (not fabricated) itinerary', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const { stops } = eng.buildItinerary([], CENTER, {
    profile, dateStr: DATE_STR, startMin: 14 * 60, endMin: 16 * 60,
  });
  assert.equal(stops.length, 0, 'with zero real candidates, an honest empty result is correct — never fabricate a stop');
});
