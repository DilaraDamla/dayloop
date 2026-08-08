'use strict';
// Sprint 6 product-quality tests — category intelligence, discovery score,
// opening-hours states, cost estimate, and optional touches. Run with:
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };
const DATE_STR = '2026-07-23'; // a Thursday

function poi(category, { lat = CENTER.lat + 0.01, lon = CENTER.lon + 0.01, name = `Test ${category}`, opening_hours, brand } = {}){
  const tags = { name };
  if(opening_hours) tags.opening_hours = opening_hours;
  if(brand) tags.brand = brand;
  return { lat, lon, tags, category };
}

// ---------------------------------------------------------------------------
// 1. Category intelligence: new discovery categories exist, and infrastructure
//    (ferry_terminal) is never selectable as a main stop for any vibe.
// ---------------------------------------------------------------------------
test('new discovery categories are real, fetchable OSM tag pairs', () => {
  for(const cat of ['arts_centre','theatre','escape_room','bookstore','ferry_terminal']){
    assert.ok(eng.CATEGORY_TAGS[cat], `${cat} must be a real fetchable category`);
  }
});

test('ferry_terminal is universally excluded — never a main-plan stop for any vibe', () => {
  for(const vibe of Object.keys(eng.VIBE_PROFILES)){
    const profile = eng.buildDayIntentProfile({ vibe, group: 'couple', budget: 2, weather: { indoorBias: false } });
    assert.ok(profile.excluded.has('ferry_terminal'), `${vibe} must exclude ferry_terminal as infrastructure, not an experience`);
  }
});

test('the new "creative" vibe resolves to a real, usable Day Intent Profile', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'creative', group: 'couple', budget: 2, weather: { indoorBias: false } });
  assert.ok(profile.slotTiers.activity.core.includes('arts_centre'));
  assert.ok(profile.slotTiers.evening.core.includes('theatre'));
  assert.ok(profile.excluded.has('nightclub'));
});

// ---------------------------------------------------------------------------
// 2. Discovery Score: rewards real experience categories and non-chain
//    places, but never overrides a hard constraint.
// ---------------------------------------------------------------------------
test('discoveryScore rewards experience categories and penalizes a real chain (brand) signal', () => {
  const artsCentre = poi('arts_centre');
  const genericShop = poi('shopping');
  assert.ok(eng.discoveryScore(artsCentre) > eng.discoveryScore(genericShop));

  const chainCafe = poi('cafe', { brand: 'Starbucks' });
  const independentCafe = poi('cafe');
  assert.ok(eng.discoveryScore(independentCafe) > eng.discoveryScore(chainCafe),
    'a place with a real OSM brand tag (a known chain) must score lower than one without');
});

test('Discovery Score can never surface an excluded category, however high it would score', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'creative', group: 'couple', budget: 2, weather: { indoorBias: false } });
  // An artificially "great discovery" nightclub — rich tags, no brand — must
  // still never appear for a vibe that excludes nightclub, because tiering
  // happens in pickCandidatesForSlot BEFORE scoring ever runs.
  const temptingNightclub = { lat: CENTER.lat+0.001, lon: CENTER.lon+0.001, category:'nightclub',
    tags: { name:'Amazing Discovery Nightclub', cuisine:'x', wheelchair:'yes', level:'1', addr_full:'x' } };
  const plainBar = poi('bar');
  const { top } = eng.pickCandidatesForSlot([temptingNightclub, plainBar], profile, 'evening', new Set(), CENTER, 20*60, DATE_STR, {});
  assert.ok(top.every(p => p.category !== 'nightclub'), 'excluded category must never appear regardless of discovery appeal');
});

// ---------------------------------------------------------------------------
// 3. Opening hours: every stop gets one of four honest, explicit states.
// ---------------------------------------------------------------------------
test('stopConfidence reports "open now" for a place open at the given time', () => {
  const p = poi('cafe', { opening_hours: 'Mo-Su 08:00-20:00' });
  const conf = eng.stopConfidence(p, DATE_STR, 12*60);
  assert.equal(conf.label, eng.t('badge_open_now'));
});

test('stopConfidence reports a real "opens at" time when closed now but opening later today', () => {
  const p = poi('restaurant', { opening_hours: 'Mo-Su 18:00-23:00' });
  const conf = eng.stopConfidence(p, DATE_STR, 12*60); // noon, opens at 18:00
  assert.equal(conf.label, eng.t('badge_opens_at', { time: '18:00' }));
});

test('stopConfidence reports "closed for the rest of today" when there is no later opening', () => {
  const p = poi('cafe', { opening_hours: 'Mo-Su 08:00-11:00' });
  const conf = eng.stopConfidence(p, DATE_STR, 12*60); // noon, already closed, nothing later today
  assert.equal(conf.label, eng.t('badge_closed_today'));
});

test('stopConfidence never hides the information — unparseable hours get an explicit "could not be verified" state', () => {
  const p = poi('museum'); // no opening_hours tag at all
  const conf = eng.stopConfidence(p, DATE_STR, 12*60);
  assert.equal(conf.label, eng.t('badge_unverified'));
  assert.notEqual(conf.label, '', 'the state must never be blank/hidden');
});

// ---------------------------------------------------------------------------
// 4. Daily cost estimate: always approximate, Transport always walking-only,
//    concrete currency only for a confidently-Turkey destination.
// Sprint 7: currency context now comes from a real Nominatim country code
// (center.countryCode), not a text-label regex — this is the exact fix for
// the Sprint 6 finding that coordinate input silently lost TL behavior.
// ---------------------------------------------------------------------------
test('cost estimate shows a concrete TL range when the real country code is Turkey', () => {
  const stops = [ { poi: poi('restaurant') }, { poi: poi('cafe') } ];
  const cost = eng.estimateDailyCost(stops, 2, { label: 'Istanbul, Turkey', countryCode: 'tr' });
  const fmt = eng.formatCostEstimate(cost);
  assert.match(fmt.total, /TL/);
  assert.match(fmt.food, /TL/);
});

test('cost estimate falls back to a relative budget-tier guide (no invented currency) outside Turkey', () => {
  const stops = [ { poi: poi('restaurant') }, { poi: poi('cafe') } ];
  const cost = eng.estimateDailyCost(stops, 3, { label: 'Berlin, Germany', countryCode: 'de' });
  const fmt = eng.formatCostEstimate(cost);
  assert.equal(fmt.food, null, 'must not fabricate a currency conversion for a non-Turkey destination');
  assert.equal(fmt.total, eng.t('cost_range_generic', { tier: '$$$' }));
});

test('a Turkish label with no verified country code no longer triggers TL (fixes the Sprint 6 coordinate-input gap)', () => {
  const stops = [ { poi: poi('restaurant') } ];
  const cost = eng.estimateDailyCost(stops, 2, { label: '41.0082,28.9784' }); // coordinate input, no countryCode resolved
  const fmt = eng.formatCostEstimate(cost);
  assert.equal(fmt.food, null, 'unverified country context must fall back to the generic tier, never guess currency from text');
});

// Regression test for a real bug this sprint's review surfaced: String.replace
// treats a literal "$" in its replacement STRING specially ("$$" collapses to
// a single "$"), which silently corrupted every "$$"/"$$$" budget-tier label
// t() ever substituted — not just the cost estimate, any future template
// using a value containing "$". Fixed by making t()'s substitution use a
// function replacer instead of a string one.
test('t() correctly substitutes a value containing literal "$" characters without corruption', () => {
  assert.equal(eng.t('cost_range_generic', { tier: '$$' }), '$$ per person, roughly');
  assert.equal(eng.t('cost_range_generic', { tier: '$$$' }), '$$$ per person, roughly');
  assert.equal(eng.t('cost_range_generic', { tier: '$' }), '$ per person, roughly');
});

test('cost estimate produces the correct $/$$/$$$ tier for each real budget level, non-Turkey', () => {
  const stops = [ { poi: poi('restaurant') } ];
  for(const [level, expectedTier] of [[1,'$'],[2,'$$'],[3,'$$$']]){
    const cost = eng.estimateDailyCost(stops, level, { label: 'Berlin, Germany' });
    const fmt = eng.formatCostEstimate(cost);
    assert.equal(fmt.total, eng.t('cost_range_generic', { tier: expectedTier }), `budget level ${level} must render as ${expectedTier}`);
  }
});

test('transport is always walking-only (zero cost), never a fabricated fare', () => {
  const stops = [ { poi: poi('restaurant') }, { poi: poi('museum') } ];
  const cost = eng.estimateDailyCost(stops, 2, CENTER);
  // Spread into a same-realm array first — the vm sandbox's Array is a
  // different realm than this test file's, so deepEqual's constructor check
  // can otherwise fail even when the actual values are identical.
  assert.deepEqual([...cost.breakdown.transport], [0,0]);
});

test('the estimate is always presented with an explicit approximate disclaimer available', () => {
  assert.match(eng.t('cost_estimate_approx_note'), /approximate|rough/i);
});

// ---------------------------------------------------------------------------
// 5. Optional touches: additive only, never alters the main plan.
// ---------------------------------------------------------------------------
test('optional touches never mutate the main stops array', () => {
  const chosen = poi('museum', { lat: CENTER.lat+0.001 });
  const runnerUp = poi('gallery', { lat: CENTER.lat+0.002 });
  const stops = [ { poi: chosen, candidates: [chosen, runnerUp] } ];
  const before = JSON.stringify(stops);
  eng.buildOptionalTouches(stops, [chosen, runnerUp], CENTER);
  assert.equal(JSON.stringify(stops), before, 'buildOptionalTouches must never mutate stops');
});

test('optional touches surface a real runner-up candidate as a suggestion, never the chosen stop itself', () => {
  const chosen = poi('museum', { lat: CENTER.lat+0.001, name: 'Chosen Museum' });
  const runnerUp = poi('gallery', { lat: CENTER.lat+0.002, name: 'Runner-Up Gallery' });
  const stops = [ { poi: chosen, candidates: [chosen, runnerUp] } ];
  const touches = eng.buildOptionalTouches(stops, [chosen, runnerUp], CENTER);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].name, 'Runner-Up Gallery');
  const text = eng.formatOptionalTouch(touches[0]);
  assert.match(text, /Runner-Up Gallery/);
});

test('a nearby ferry terminal becomes an optional touch, never a main-plan stop', () => {
  const chosen = poi('museum', { lat: CENTER.lat+0.001 });
  const ferry = poi('ferry_terminal', { lat: CENTER.lat+0.02, name: 'Test Ferry Pier' });
  const stops = [ { poi: chosen, candidates: [chosen] } ];
  const touches = eng.buildOptionalTouches(stops, [chosen, ferry], CENTER);
  const ferryTouch = touches.find(x => x.kind === 'ferry');
  assert.ok(ferryTouch, 'a ferry terminal in range should surface as an optional touch');
  assert.match(eng.formatOptionalTouch(ferryTouch), /ferry/i);
});
