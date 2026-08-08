'use strict';
// Sprint 2 test coverage for the Explanation Layer
// (docs/architecture/planning-architecture.md, Layer 3). Run with:
//   node --test tests/
//
// Exercises the ACTUAL logic in index.html via loadDecisionEngine.js — not a
// reimplementation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };
const DATE_STR = '2026-07-22';

// Banned superlative / unverifiable-quality language the sprint explicitly
// forbids, since no data source in this app supports any of these claims.
const BANNED_PATTERNS = [
  /best in town/i, /amazing/i, /always quiet/i, /\bsafe\b/i, /popular with locals/i,
  /great food/i, /romantic ambiance/i, /low crowd/i, /you'?ll love/i, /most romantic/i,
];

function assertNoUnsupportedClaims(text){
  for(const re of BANNED_PATTERNS){
    assert.ok(!re.test(text), `explanation text contains an unsupported claim (${re}): "${text}"`);
  }
}

function poi(category, { lat = CENTER.lat + 0.01, lon = CENTER.lon + 0.01, name = `Test ${category}`, opening_hours } = {}){
  const tags = { name };
  if(opening_hours) tags.opening_hours = opening_hours;
  return { lat, lon, tags, category };
}

// Builds a minimal, already-scheduled stop the way buildFullPlan would hand
// one to the Explanation Layer (post buildItinerary + scheduleStops).
function stop({ slotType = 'activity', p, distFromPrev = 0.3, candidates, tierUsed = 'core', start = 12*60, end = 13*60 }){
  const thePoi = p || poi(slotType);
  return { slotType, poi: thePoi, distFromPrev, candidates: candidates || [thePoi], altIndex: 0, tierUsed, relaxed: tierUsed !== 'core', start, end, walkFromPrev: 5 };
}

function chillProfile(weather){
  return eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather });
}

// ---------------------------------------------------------------------------
// Every selected stop receives a non-empty explanation.
// ---------------------------------------------------------------------------
test('every stop in a multi-stop day receives a non-empty reason', () => {
  const profile = chillProfile({ indoorBias: false });
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe'), distFromPrev: 0.2 }),
    stop({ slotType: 'activity', p: poi('park', { lat: CENTER.lat + 0.05 }), distFromPrev: 2 }),
    stop({ slotType: 'food', p: poi('restaurant', { lat: CENTER.lat + 0.08 }), distFromPrev: 2 }),
  ];
  const dayTrace = { densityTier: 'medium' };
  const explanation = eng.buildExplanation({ stops, profile, dayTrace, weather: { indoorBias: false }, dateStr: DATE_STR });
  assert.equal(explanation.stopReasons.length, stops.length);
  explanation.stopReasons.forEach(reason => {
    assert.ok(typeof reason === 'string' && reason.trim().length > 0, 'every stop must get a non-empty reason');
  });
});

// ---------------------------------------------------------------------------
// No unsupported superlatives or subjective claims anywhere in the output.
// ---------------------------------------------------------------------------
test('no explanation text anywhere contains an unsupported superlative or subjective claim', () => {
  const profile = chillProfile({ indoorBias: true });
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe'), distFromPrev: 0.1, tierUsed: 'core' }),
    stop({ slotType: 'activity', p: poi('bar', { lat: CENTER.lat + 0.05 }), distFromPrev: 2, tierUsed: 'lastResort' }),
    stop({ slotType: 'food', p: poi('nightclub', { lat: CENTER.lat + 0.09 }), distFromPrev: 1.5, tierUsed: 'crossSlotFallback' }),
  ];
  const dayTrace = { densityTier: 'low' };
  const explanation = eng.buildExplanation({ stops, profile, dayTrace, weather: { indoorBias: true }, dateStr: DATE_STR });
  [...explanation.stopReasons, explanation.summary, explanation.tradeOffNote].filter(Boolean).forEach(assertNoUnsupportedClaims);
});

// ---------------------------------------------------------------------------
// Rainy-weather indoor selection produces a weather-based reason.
// ---------------------------------------------------------------------------
test('an indoor stop chosen under weather bias explains itself by the weather', () => {
  const profile = chillProfile({ indoorBias: true });
  const s = stop({ slotType: 'activity', p: poi('museum'), distFromPrev: 2, tierUsed: 'core' });
  const reason = eng.explainStop(s, profile, [], { indoorBias: true });
  assert.equal(reason, eng.t('explain_weather_indoor', { category: eng.t('cat_museum') }));
});

// ---------------------------------------------------------------------------
// Wider-radius (unusually far) selection produces a natural trade-off note.
// ---------------------------------------------------------------------------
test('an unusually far stop produces a natural-language trade-off note, not internal terms', () => {
  const profile = chillProfile({ indoorBias: false });
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe'), distFromPrev: 0.2, tierUsed: 'core' }),
    stop({ slotType: 'food', p: poi('restaurant', { lat: CENTER.lat + 0.2 }), distFromPrev: 1.8, tierUsed: 'core' }),
  ];
  const note = eng.explainTradeOff(stops, DATE_STR);
  assert.ok(note, 'a stop far beyond the usual distance should surface a trade-off note');
  assert.equal(note, eng.t('tradeoff_far_stop'));
  for(const banned of ['tier 2','tier 3','scoring penalty','fallback bucket','cross-vibe','crossSlotFallback','lastResort']){
    assert.ok(!note.toLowerCase().includes(banned.toLowerCase()), `trade-off note must not leak internal term "${banned}"`);
  }
});

// ---------------------------------------------------------------------------
// No relaxation at all means no apology or compromise note.
// ---------------------------------------------------------------------------
test('a day with no relaxation, normal distances, and known hours produces no trade-off note', () => {
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe', { opening_hours: '24/7' }), distFromPrev: 0.2, tierUsed: 'core' }),
    stop({ slotType: 'food', p: poi('restaurant', { lat: CENTER.lat + 0.005, opening_hours: '24/7' }), distFromPrev: 0.3, tierUsed: 'core' }),
  ];
  const note = eng.explainTradeOff(stops, DATE_STR);
  assert.equal(note, null, 'nothing was relaxed — there must be no compromise/apology note at all');
});

// ---------------------------------------------------------------------------
// Low-density plans explain the smaller stop count positively.
// ---------------------------------------------------------------------------
test('a low-density day summary explains fewer stops without apologizing', () => {
  const summary = eng.explainSummary({ densityTier: 'low' });
  assert.equal(summary, eng.t('summary_density_low'));
  assertNoUnsupportedClaims(summary);
  assert.ok(!/sorry|unfortunately|couldn'?t/i.test(summary), 'a smaller day should be framed as a deliberate choice, not an apology');
});

// ---------------------------------------------------------------------------
// Calm intent explanations reflect calm-day goals.
// ---------------------------------------------------------------------------
test('a plain chill-vibe match explains itself in terms of a calm, unhurried pace', () => {
  const profile = chillProfile({ indoorBias: false });
  // Deliberately no weather bias, no variety trigger, not budget-low, and far
  // enough from the previous stop to fall through every other rule — isolates
  // the default intent-match branch.
  const s = stop({ slotType: 'food', p: poi('restaurant'), distFromPrev: 5, tierUsed: 'core' });
  const reason = eng.explainStop(s, profile, [], { indoorBias: false });
  assert.equal(reason, eng.t('explain_intent_match_chill', { category: eng.t('cat_restaurant') }));
  assert.match(reason, /calm|unhurried/i);
});

// ---------------------------------------------------------------------------
// Budget explanations do not claim exact affordability unless price data exists.
// ---------------------------------------------------------------------------
test('a budget-low pick explains itself via category fit, never an invented exact price', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'budget', group: 'couple', budget: 1, weather: { indoorBias: false } });
  const s = stop({ slotType: 'activity', p: poi('park'), distFromPrev: 5, tierUsed: 'core' });
  const reason = eng.explainStop(s, profile, [], { indoorBias: false });
  assert.equal(reason, eng.t('explain_budget_low', { category: eng.t('cat_park') }));
  assert.doesNotMatch(reason, /\$|€|₺|cheapest|exact/i, 'must never assert a specific price this app has no data for');
});

// ---------------------------------------------------------------------------
// Uncertain opening hours produce a clear verification note.
// ---------------------------------------------------------------------------
test('unknown opening hours anywhere in the day produce a clear verification trade-off note', () => {
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe'), distFromPrev: 0.2, tierUsed: 'core' }), // no opening_hours tag -> unknown
  ];
  const note = eng.explainTradeOff(stops, DATE_STR);
  assert.equal(note, eng.t('tradeoff_verify_hours'));
  assert.match(note, /check/i);
});

// ---------------------------------------------------------------------------
// The Explanation Layer must not alter selected stops or their order.
// ---------------------------------------------------------------------------
test('buildExplanation never mutates stops, their order, or their contents', () => {
  const profile = chillProfile({ indoorBias: false });
  const stops = [
    stop({ slotType: 'coffee', p: poi('cafe'), distFromPrev: 0.2 }),
    stop({ slotType: 'activity', p: poi('park', { lat: CENTER.lat + 0.05 }), distFromPrev: 2 }),
    stop({ slotType: 'food', p: poi('restaurant', { lat: CENTER.lat + 0.08 }), distFromPrev: 2 }),
  ];
  const before = stops.map(s => ({ category: s.poi.category, poi: s.poi, order: s.slotType }));
  eng.buildExplanation({ stops, profile, dayTrace: { densityTier: 'medium' }, weather: { indoorBias: false }, dateStr: DATE_STR });
  const after = stops.map(s => ({ category: s.poi.category, poi: s.poi, order: s.slotType }));
  assert.deepEqual(after, before, 'stops array (contents, order, identity) must be unchanged after building an explanation');
});

// ---------------------------------------------------------------------------
// Sprint 4 UX review regression: multiple stops landing in the same reason
// bucket on the same day must not read as byte-identical text. Confirmed as
// a real defect via the Sprint 3 scenario fixtures — e.g. three stops in one
// real generated itinerary all reading exactly "Fits your calm, unhurried
// pace for today." with no distinction between them.
// ---------------------------------------------------------------------------
test('multiple stops sharing the same reason bucket produce distinct, category-specific text', () => {
  const profile = chillProfile({ indoorBias: false });
  // All three deliberately fall through to the default intent-match branch:
  // core tier, no weather bias, no variety trigger, not budget-low, and far
  // enough apart to skip the compact-route rule — exactly the conditions
  // that produced identical text before the fix.
  // Deliberately avoids any Sprint 6 "discovery" category (museum, gallery,
  // etc.) here — this test isolates the plain intent-match branch, which a
  // discovery-category pick would legitimately bypass (see the dedicated
  // discovery-explanation test instead).
  const s1 = stop({ slotType: 'activity', p: poi('park'), distFromPrev: 5, tierUsed: 'core' });
  const s2 = stop({ slotType: 'food', p: poi('restaurant'), distFromPrev: 5, tierUsed: 'core' });
  const s3 = stop({ slotType: 'coffee', p: poi('ice_cream'), distFromPrev: 5, tierUsed: 'core' });
  const reasons = [s1, s2, s3].map(s => eng.explainStop(s, profile, [], { indoorBias: false }));

  assert.equal(new Set(reasons).size, 3, `expected 3 distinct reasons, got: ${JSON.stringify(reasons)}`);
  assert.match(reasons[0], /park/i);
  assert.match(reasons[1], /restaurant/i);
  assert.match(reasons[2], /ice cream/i);
  // Still the same underlying template family (calm/unhurried), just no
  // longer verbatim-identical across different places.
  reasons.forEach(r => assert.match(r, /calm|unhurried/i));
});
