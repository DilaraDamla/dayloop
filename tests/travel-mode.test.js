'use strict';
// Regression tests for driving mode (the planner's "🚗 By car" option
// alongside the default "🚶 On foot") — see estimateTravelMinutes,
// DISTANCE_PENALTY_PER_KM, rankCandidates, evaluateDayPlan, POI_RADII_CAR,
// fetchRoute, and buildFullPlan in index.html. Walking-mode behavior is
// covered by the many pre-existing tests across this suite; these focus on
// what changes for 'car' and on backward compatibility for callers that
// don't pass a mode at all (must keep behaving exactly like foot).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const CENTER = { lat: 41.0082, lon: 28.9784 };
const DATE_STR = '2026-07-22';

function poi(category, { lat, lon, name = `Test ${category}` } = {}){
  return { lat: lat ?? CENTER.lat + 0.01, lon: lon ?? CENTER.lon + 0.01, tags: { name }, category };
}
function noWeather(){ return { indoorBias: false }; }

// ---------------------------------------------------------------------------
// estimateTravelMinutes / walkMinutes
// ---------------------------------------------------------------------------

test('estimateTravelMinutes defaults to foot speed when no mode is given (backward compatible)', () => {
  assert.equal(eng.estimateTravelMinutes(2, undefined), eng.walkMinutes(2));
});

test('estimateTravelMinutes(km, "car") is meaningfully faster than the same distance on foot', () => {
  const footMin = eng.estimateTravelMinutes(5, 'foot');
  const carMin = eng.estimateTravelMinutes(5, 'car');
  assert.ok(carMin < footMin, `5km by car (${carMin}min) must be faster than 5km on foot (${footMin}min)`);
});

test('walkMinutes is unchanged — exactly estimateTravelMinutes(km, "foot")', () => {
  for(const km of [0.1, 1, 3.7, 10]){
    assert.equal(eng.walkMinutes(km), eng.estimateTravelMinutes(km, 'foot'));
  }
});

test('estimateTravelMinutes never returns less than the mode-specific floor, even for near-zero distance', () => {
  assert.ok(eng.estimateTravelMinutes(0.01, 'foot') >= 3);
  assert.ok(eng.estimateTravelMinutes(0.01, 'car') >= 2);
});

// ---------------------------------------------------------------------------
// rankCandidates: the distance penalty must actually change outcomes by mode
// ---------------------------------------------------------------------------

test('rankCandidates favors a nearby-but-generic place over a much better far place on foot, but flips to the far place by car', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const near = poi('cafe', { lat: CENTER.lat + 0.005, lon: CENTER.lon, name: '' }); // ~0.5km, unnamed (lower score)
  const far = poi('cafe', { lat: CENTER.lat + 0.09, lon: CENTER.lon, name: 'A Genuinely Great Named Cafe' }); // ~10km, named (higher base score)
  const usedCounts = {};

  const footOrder = eng.rankCandidates([near, far], profile, CENTER, 14*60, DATE_STR, usedCounts, 'foot');
  assert.equal(footOrder[0], near, 'on foot, 10km is expensive enough that the closer, plainer option should still win');

  const carOrder = eng.rankCandidates([near, far], profile, CENTER, 14*60, DATE_STR, usedCounts, 'car');
  assert.equal(carOrder[0], far, 'by car, the same 10km barely costs anything, so the genuinely better-scored place should win instead');
});

test('rankCandidates with no mode argument behaves exactly like "foot" (backward compatible)', () => {
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: noWeather() });
  const a = poi('cafe', { lat: CENTER.lat + 0.01, lon: CENTER.lon });
  const b = poi('cafe', { lat: CENTER.lat + 0.05, lon: CENTER.lon, name: 'Far Cafe' });
  const usedCounts = {};
  const noModeOrder = eng.rankCandidates([a, b], profile, CENTER, 14*60, DATE_STR, usedCounts, undefined);
  const footOrder = eng.rankCandidates([a, b], profile, CENTER, 14*60, DATE_STR, usedCounts, 'foot');
  assert.deepEqual(noModeOrder, footOrder);
});

// ---------------------------------------------------------------------------
// evaluateDayPlan: "long transition" means something different per mode
// ---------------------------------------------------------------------------

test('evaluateDayPlan flags a transition as "long" on foot but not by car, for the same real distance', () => {
  // ~3km apart — well over 25 walking minutes, well under 25 driving minutes.
  const stops = [
    { poi: poi('cafe', { lat: CENTER.lat, lon: CENTER.lon }) },
    { poi: poi('restaurant', { lat: CENTER.lat + 0.027, lon: CENTER.lon }) },
  ];
  const footTrace = eng.evaluateDayPlan(stops, CENTER, 'foot');
  const carTrace = eng.evaluateDayPlan(stops, CENTER, 'car');
  assert.equal(footTrace.longTransitionCount, 1, 'a ~3km gap on foot is a genuinely long walk');
  assert.equal(carTrace.longTransitionCount, 0, 'the same ~3km gap by car is a short, unremarkable drive');
});

// ---------------------------------------------------------------------------
// POI_RADII_CAR: only ever wider than the walking radii, same categories
// ---------------------------------------------------------------------------

test('POI_RADII_CAR covers every category POI_RADII does, and is never smaller for any of them', () => {
  for(const cat of Object.keys(eng.POI_RADII)){
    assert.ok(cat in eng.POI_RADII_CAR, `POI_RADII_CAR is missing category "${cat}"`);
    assert.ok(eng.POI_RADII_CAR[cat] > eng.POI_RADII[cat], `POI_RADII_CAR.${cat} must be strictly larger than the walking radius`);
  }
});

test('POI_RADII_CAR_WIDE is never smaller than POI_RADII_CAR for any category', () => {
  for(const cat of Object.keys(eng.POI_RADII_CAR)){
    assert.ok(eng.POI_RADII_CAR_WIDE[cat] >= eng.POI_RADII_CAR[cat]);
  }
});

// ---------------------------------------------------------------------------
// fetchPOIs actually queries the wider car radius, not just the constant
// existing in isolation
// ---------------------------------------------------------------------------

// An empty Overpass result is legitimately "sparse" (see isSparsePOIResult),
// which would trigger fetchPOIs' own widened-radius follow-up query and
// overwrite whatever the first call's body was — only the FIRST call is
// under test here, so it's captured explicitly rather than relying on there
// being exactly one call.
test('fetchPOIs mode="car" queries Overpass with the car radius for a category, not the walking radius', async () => {
  let firstBody = null;
  eng.__context.fetch = async (url, opts) => {
    if(firstBody === null) firstBody = decodeURIComponent(opts.body);
    return { ok: true, status: 200, json: async () => ({ elements: [] }) };
  };
  await eng.fetchPOIs(41.0, 29.0, undefined, 'car');
  assert.ok(firstBody.includes(`around:${eng.POI_RADII_CAR.cafe}`), 'the query sent to Overpass must use the car cafe radius');
  assert.ok(!firstBody.includes(`around:${eng.POI_RADII.cafe},`), 'the query must NOT use the walking cafe radius when mode is car');
});

test('fetchPOIs with no mode still queries the walking radius (backward compatible default)', async () => {
  let firstBody = null;
  eng.__context.fetch = async (url, opts) => {
    if(firstBody === null) firstBody = decodeURIComponent(opts.body);
    return { ok: true, status: 200, json: async () => ({ elements: [] }) };
  };
  await eng.fetchPOIs(41.0, 29.0);
  assert.ok(firstBody.includes(`around:${eng.POI_RADII.cafe},`));
});

// ---------------------------------------------------------------------------
// fetchRoute: mode selects the real OSRM endpoint
// ---------------------------------------------------------------------------

test('fetchRoute mode="car" calls the driving OSRM endpoint, not the foot one', async () => {
  let capturedUrl = null;
  eng.__context.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [] }, legs: [] }] }) };
  };
  await eng.fetchRoute([{ lat: 41, lon: 29 }, { lat: 41.01, lon: 29.01 }], 'car');
  assert.ok(capturedUrl.startsWith(eng.OSRM_CAR_URL), `expected the car OSRM base URL, got: ${capturedUrl}`);
});

test('fetchRoute mode="foot" (and the default) calls the dedicated foot OSRM endpoint', async () => {
  let capturedUrl = null;
  eng.__context.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [] }, legs: [] }] }) };
  };
  await eng.fetchRoute([{ lat: 41, lon: 29 }, { lat: 41.01, lon: 29.01 }], 'foot');
  assert.ok(capturedUrl.startsWith(eng.OSRM_FOOT_URL));
});

// ---------------------------------------------------------------------------
// buildFullPlan end-to-end: travelMode is recorded and real routing uses the
// right profile
// ---------------------------------------------------------------------------

test('buildFullPlan records travelMode:"car" on the returned plan and calls the driving OSRM endpoint', async () => {
  const pois = [
    poi('cafe', { lat: CENTER.lat + 0.01, lon: CENTER.lon }),
    poi('restaurant', { lat: CENTER.lat + 0.02, lon: CENTER.lon + 0.01 }),
  ];
  const routeUrls = [];
  eng.__context.fetch = async (url) => {
    routeUrls.push(url);
    return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[29,41],[29.01,41.01]] }, legs: [{ distance: 500, duration: 120 }] }] }) };
  };
  const weather = noWeather();
  const plan = await eng.buildFullPlan(pois, CENTER, weather, DATE_STR, 14*60, 20*60, 'chill', 'couple', 2, 'car');
  assert.ok(plan, 'a valid plan should be produced');
  assert.equal(plan.travelMode, 'car');
  assert.ok(routeUrls.some(u => u.startsWith(eng.OSRM_CAR_URL)), 'buildFullPlan must route the plan itself through the car OSRM endpoint');
});

test('buildFullPlan defaults travelMode to "foot" when no mode is passed (backward compatible)', async () => {
  const pois = [poi('cafe', { lat: CENTER.lat + 0.01, lon: CENTER.lon })];
  eng.__context.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) }); // force straight-line fallback, still must not throw
  const weather = noWeather();
  const plan = await eng.buildFullPlan(pois, CENTER, weather, DATE_STR, 14*60, 20*60, 'chill', 'couple', 2, undefined);
  assert.ok(plan);
  assert.equal(plan.travelMode, 'foot');
});

// ---------------------------------------------------------------------------
// formatWalkPreview / i18n
// ---------------------------------------------------------------------------

test('formatWalkPreview uses the driving copy for mode="car" and the walking copy otherwise', () => {
  const footLine = eng.formatWalkPreview(3.2, 40, 'foot');
  const carLine = eng.formatWalkPreview(3.2, 40, 'car');
  const defaultLine = eng.formatWalkPreview(3.2, 40);
  assert.notEqual(footLine, carLine);
  assert.equal(defaultLine, footLine, 'omitting mode must behave exactly like "foot"');
});

test('every language defines the travel-mode UI strings used by the planner form and render()', () => {
  const requiredKeys = [
    'travel_mode_label', 'travel_mode_foot', 'travel_mode_car',
    'travel_mode_foot_hint', 'travel_mode_car_hint',
    'drive_preview', 'summary_drive', 'min_drive_to_next',
  ];
  for(const lang of Object.keys(eng.STRINGS)){
    for(const key of requiredKeys){
      assert.ok(eng.STRINGS[lang][key], `${key} missing for "${lang}"`);
    }
  }
});
