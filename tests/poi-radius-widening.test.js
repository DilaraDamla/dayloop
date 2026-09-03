'use strict';
// Regression tests for the small-town POI search radius widening (same
// Ardanuç, Artvin field report as tests/geocoding-resilience.test.js): the
// normal, fixed per-category radii (POI_RADII) genuinely miss real places in
// a small, spread-out town. fetchPOIs now issues one extra widened-radius
// Overpass query (POI_RADII_WIDE), merged in, but only when the first,
// narrow-radius result is sparse — see isSparsePOIResult in index.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

function overpassJSON(elements){
  return { ok: true, status: 200, json: async () => ({ elements }) };
}
function cafeNode(id, name){
  return { type: 'node', id, lat: 41.12, lon: 42.07, tags: { amenity: 'cafe', name } };
}
function restaurantNode(id, name){
  return { type: 'node', id, lat: 41.12, lon: 42.07, tags: { amenity: 'restaurant', name } };
}

test('isSparsePOIResult flags a low total count as sparse, even with several distinct categories', () => {
  const eng = loadDecisionEngine();
  const pois = [
    { category: 'restaurant' }, { category: 'bakery' }, { category: 'viewpoint' }, { category: 'park' },
  ];
  assert.equal(pois.length < eng.SPARSE_TOTAL_THRESHOLD, true, 'sanity check on the fixture');
  assert.equal(eng.isSparsePOIResult(pois), true);
});

test('isSparsePOIResult flags a dense-looking count of only 1-2 categories as sparse', () => {
  const eng = loadDecisionEngine();
  const pois = Array.from({length: 20}, () => ({ category: 'cafe' }));
  assert.equal(eng.isSparsePOIResult(pois), true, 'lots of one thing is not real variety — must still count as sparse');
});

test('isSparsePOIResult does not flag a genuinely well-covered area', () => {
  const eng = loadDecisionEngine();
  const cats = ['cafe','restaurant','bar','museum','park','bookstore'];
  const pois = Array.from({length: 20}, (_, i) => ({ category: cats[i % cats.length] }));
  assert.equal(eng.isSparsePOIResult(pois), false);
});

test('fetchPOIs does NOT issue a second query when the first pass is already dense (no wasted round-trip)', async () => {
  const eng = loadDecisionEngine();
  const cats = ['cafe','restaurant','bar','museum','park','bookstore'];
  const realElements = Array.from({length: 20}, (_, i) => {
    const cat = cats[i % cats.length];
    const [k, v] = eng.CATEGORY_TAGS[cat][0];
    return { type: 'node', id: 2000 + i, lat: 41.1, lon: 42.1, tags: { [k]: v, name: `Place ${i}` } };
  });
  let calls = 0;
  eng.__context.fetch = async () => { calls++; return overpassJSON(realElements); };
  const pois = await eng.fetchPOIs(41.1, 42.1);
  assert.equal(calls, 1, 'a dense first pass must not trigger the widened-radius fallback query');
  assert.equal(pois.length, 20);
});

test('fetchPOIs issues a widened-radius fallback query and merges new POIs when the first pass is sparse', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  const narrow = [restaurantNode(1, 'Yildiz restaurant'), restaurantNode(2, 'Emelin Mutfagi')];
  const wide = [restaurantNode(1, 'Yildiz restaurant'), restaurantNode(2, 'Emelin Mutfagi'), cafeNode(3, 'A Real Cafe Just Outside The Normal Radius')];
  eng.__context.fetch = async () => {
    calls++;
    return calls === 1 ? overpassJSON(narrow) : overpassJSON(wide);
  };
  const pois = await eng.fetchPOIs(41.1222881, 42.0681796);
  assert.equal(calls, 2, 'a sparse first pass must trigger exactly one widened-radius follow-up query');
  assert.equal(pois.length, 3, 'the new cafe found only in the widened pass must be merged in');
  assert.ok(pois.some(p => p.category === 'cafe'), 'the previously-missing category must now be represented');
});

test('fetchPOIs never returns a duplicate for a POI found in both the narrow and widened pass', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  const narrow = [restaurantNode(1, 'Yildiz restaurant')]; // sparse on its own
  const wide = [restaurantNode(1, 'Yildiz restaurant'), restaurantNode(2, 'A second restaurant')];
  eng.__context.fetch = async () => {
    calls++;
    return calls === 1 ? overpassJSON(narrow) : overpassJSON(wide);
  };
  const pois = await eng.fetchPOIs(41.1, 42.1);
  const ids = pois.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no OSM id should appear twice in the merged result');
  assert.equal(pois.length, 2);
});

test('fetchPOIs still returns the narrow-radius result honestly when the widened fallback query itself fails', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  const narrow = [restaurantNode(1, 'Yildiz restaurant')];
  eng.__context.fetch = async () => {
    calls++;
    if(calls === 1) return overpassJSON(narrow);
    throw new Error('network down for the follow-up query');
  };
  const pois = await eng.fetchPOIs(41.1, 42.1);
  assert.equal(pois.length, 1, 'a failed widening attempt must not wipe out the successful narrow-radius result');
  assert.equal(pois[0].id, 1);
});

test('POI_RADII_WIDE is never smaller than POI_RADII for any category (the fallback must only ever widen, never narrow)', () => {
  const eng = loadDecisionEngine();
  for(const cat of Object.keys(eng.POI_RADII)){
    assert.ok(eng.POI_RADII_WIDE[cat] >= eng.POI_RADII[cat], `POI_RADII_WIDE.${cat} must be >= POI_RADII.${cat}`);
  }
});
