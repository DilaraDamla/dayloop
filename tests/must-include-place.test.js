'use strict';
// Regression tests for guaranteeing a shared/imported place actually becomes
// a stop in the generated itinerary — see insertMustIncludeStop and its use
// in buildFullPlan/planDay/importSharedPlace in index.html.
//
// Real-world report: "günü oluşturuyorda yapıştırdığım mekanı plana almıyo"
// ("it builds the day but doesn't include the place I pasted"). Root cause:
// importing a shared place only ever set it as the day's geographic center
// and saved it to the Wish List — it never actually became a stop in
// currentPlan.stops, so "building a day around it" quietly meant "somewhere
// near it," never "including it."

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };

function poi(category, { lat, lon, name = `Test ${category}` } = {}){
  return { lat: lat ?? CENTER.lat + 0.01, lon: lon ?? CENTER.lon + 0.01, tags: { name }, category };
}
function sharedPlace(){
  return { lat: CENTER.lat + 0.002, lon: CENTER.lon + 0.002, tags: { name: 'The Shared Spot' }, category: 'place' };
}

// ---------------------------------------------------------------------------
// insertMustIncludeStop (pure)
// ---------------------------------------------------------------------------

test('insertMustIncludeStop puts the shared place first in the stop list', () => {
  const existing = [
    { poi: poi('cafe'), distFromPrev: 0.3, candidates: [poi('cafe')], altIndex: 0, tierUsed: 'core' },
    { poi: poi('museum'), distFromPrev: 0.5, candidates: [poi('museum')], altIndex: 0, tierUsed: 'core' },
  ];
  const place = sharedPlace();
  const result = eng.insertMustIncludeStop(existing, place, CENTER);
  assert.equal(result.length, 3);
  assert.equal(result[0].poi, place);
  assert.equal(result[0].tierUsed, 'mustInclude');
});

test('insertMustIncludeStop\'s inserted stop has no alternate candidates — it is not a competitive/swappable pick', () => {
  const result = eng.insertMustIncludeStop([], sharedPlace(), CENTER);
  assert.equal(result[0].candidates.length, 1);
  assert.equal(result[0].candidates[0], result[0].poi);
});

test('insertMustIncludeStop computes a real distFromPrev from the actual center coordinates', () => {
  const place = sharedPlace();
  const result = eng.insertMustIncludeStop([], place, CENTER);
  const expected = eng.haversineKm(CENTER, place);
  assert.equal(result[0].distFromPrev, expected);
});

test('insertMustIncludeStop never inserts a duplicate when the auto-generated day already includes this same real-world spot', () => {
  const samePlaceAgain = { lat: CENTER.lat + 0.0021, lon: CENTER.lon + 0.0021, tags: { name: 'The Shared Spot' }, category: 'cafe' };
  const existing = [{ poi: samePlaceAgain, distFromPrev: 0.3, candidates: [samePlaceAgain], altIndex: 0, tierUsed: 'core' }];
  const result = eng.insertMustIncludeStop(existing, sharedPlace(), CENTER);
  assert.equal(result.length, 1, 'must not add a second stop at essentially the same real place (isSameComplex match)');
});

test('insertMustIncludeStop on an empty day still produces exactly the one requested stop', () => {
  const result = eng.insertMustIncludeStop([], sharedPlace(), CENTER);
  assert.equal(result.length, 1);
  assert.equal(result[0].tierUsed, 'mustInclude');
});

// ---------------------------------------------------------------------------
// buildFullPlan end-to-end: the shared place actually ends up in plan.stops
// ---------------------------------------------------------------------------

test('buildFullPlan with mustIncludePoi always includes that exact place as stops[0]', async () => {
  const pois = [
    poi('cafe', { lat: CENTER.lat + 0.01, lon: CENTER.lon }),
    poi('restaurant', { lat: CENTER.lat + 0.02, lon: CENTER.lon + 0.01 }),
  ];
  eng.__context.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) }); // force straight-line fallback
  const place = sharedPlace();
  const plan = await eng.buildFullPlan(pois, CENTER, { indoorBias: false }, '2026-07-22', 14*60, 20*60, 'chill', 'couple', 2, 'foot', place);
  assert.ok(plan);
  assert.equal(plan.stops[0].poi, place, 'the shared place must be the actual first stop, not just an influence on where other stops were picked from');
  assert.equal(plan.stops[0].tierUsed, 'mustInclude');
  assert.ok(plan.stops.length >= 2, 'the normally-generated stops must still be present alongside it');
});

test('buildFullPlan with no mustIncludePoi behaves exactly as before (backward compatible)', async () => {
  const pois = [poi('cafe', { lat: CENTER.lat + 0.01, lon: CENTER.lon })];
  eng.__context.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const plan = await eng.buildFullPlan(pois, CENTER, { indoorBias: false }, '2026-07-22', 14*60, 20*60, 'chill', 'couple', 2, 'foot', undefined);
  assert.ok(plan);
  assert.notEqual(plan.stops[0].tierUsed, 'mustInclude');
});

test('buildFullPlan still returns a plan built around JUST the shared place when nothing else is nearby', async () => {
  eng.__context.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const place = sharedPlace();
  const plan = await eng.buildFullPlan([], CENTER, { indoorBias: false }, '2026-07-22', 14*60, 20*60, 'chill', 'couple', 2, 'foot', place);
  assert.ok(plan, 'a day containing only the explicitly-requested place is still a valid, non-null plan');
  assert.equal(plan.stops.length, 1);
  assert.equal(plan.stops[0].poi, place);
});

// ---------------------------------------------------------------------------
// explainStop: the reason given must be honest about WHY this stop is there
// ---------------------------------------------------------------------------

test('explainStop gives the real, specific reason for a mustInclude stop rather than a generic intent-match line', () => {
  const stop = { poi: sharedPlace(), tierUsed: 'mustInclude', distFromPrev: 0.2, candidates: [sharedPlace()] };
  const profile = { primaryIntent: 'chill', budgetPriority: 'normal' };
  const reason = eng.explainStop(stop, profile, [], { indoorBias: false });
  assert.equal(reason, eng.t('explain_must_include'));
});

test('every language defines explain_must_include', () => {
  for(const lang of Object.keys(eng.STRINGS)){
    assert.ok(eng.STRINGS[lang].explain_must_include, `explain_must_include missing for "${lang}"`);
  }
});
