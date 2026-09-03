'use strict';
// Regression tests for the "Ardanuç" real-world finding: geocoding a small
// town while on a patchy rural mobile connection surfaced a raw, unlocalized
// English network/timeout error that looked identical to a genuine
// "no such place" result. Covers geocodeCity's retry-once resilience (the
// same bounded pattern already used for Overpass — see queryOverpass in
// index.html) and that every failure path returns a real, localized message
// (never raw fetch/HTTP text) — see geocodeCity in index.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const NOMINATIM_HIT = [{
  lat: '41.1222881', lon: '42.0681796', display_name: 'Ardanuç, Artvin, Black Sea Region, Turkey',
  address: { country_code: 'tr' },
}];

function okResponse(json){
  return { ok: true, status: 200, json: async () => json };
}
function failResponse(status){
  return { ok: false, status, json: async () => { throw new Error('should not parse a failed response'); } };
}

test('geocodeCity succeeds on the first try when Nominatim responds normally', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  eng.__context.fetch = async () => { calls++; return okResponse(NOMINATIM_HIT); };
  const result = await eng.geocodeCity('Ardanuç');
  assert.equal(calls, 1, 'no retry should happen on a clean first success');
  assert.equal(result.label, 'Ardanuç, Artvin, Black Sea Region, Turkey');
  assert.equal(result.countryCode, 'tr');
});

test('geocodeCity retries once and recovers from a transient network failure (e.g. a rural mobile blip)', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  eng.__context.fetch = async () => {
    calls++;
    if(calls === 1) throw new Error('network request failed');
    return okResponse(NOMINATIM_HIT);
  };
  const result = await eng.geocodeCity('Ardanuç');
  assert.equal(calls, 2, 'exactly one retry should have been made');
  assert.equal(result.label, 'Ardanuç, Artvin, Black Sea Region, Turkey');
});

test('geocodeCity retries once and recovers from a non-ok HTTP response (e.g. a 429 rate limit)', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  eng.__context.fetch = async () => {
    calls++;
    if(calls === 1) return failResponse(429);
    return okResponse(NOMINATIM_HIT);
  };
  const result = await eng.geocodeCity('Ardanuç');
  assert.equal(calls, 2);
  assert.equal(result.label, 'Ardanuç, Artvin, Black Sea Region, Turkey');
});

test('geocodeCity throws a real, localized network error (never raw fetch/HTTP text) after both attempts fail', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  eng.__context.fetch = async () => { calls++; throw new Error('getaddrinfo ENOTFOUND nominatim.openstreetmap.org'); };
  await assert.rejects(
    () => eng.geocodeCity('Ardanuç'),
    (err) => {
      assert.equal(calls, 2, 'both the first attempt and the one retry must have been used before giving up');
      assert.equal(err.message, eng.t('autherr_network'), 'the user must see the same localized network-error copy used elsewhere in the app, never a raw fetch/HTTP message');
      assert.doesNotMatch(err.message, /ENOTFOUND|fetch|TypeError/i, 'no raw network/technical text should leak into the user-facing message');
      return true;
    }
  );
});

test('geocodeCity throws a real, localized "not found" error naming the query — and does not retry a genuine zero-result response', async () => {
  const eng = loadDecisionEngine();
  let calls = 0;
  eng.__context.fetch = async () => { calls++; return okResponse([]); };
  await assert.rejects(
    () => eng.geocodeCity('Xyzzyplonk'),
    (err) => {
      assert.equal(calls, 1, 'retrying the exact same query after a genuine empty result cannot help, so it must not be attempted');
      assert.equal(err.message, eng.t('error_city_not_found', { city: 'Xyzzyplonk' }));
      assert.match(err.message, /Xyzzyplonk/, 'the error must name the actual place the user searched for');
      return true;
    }
  );
});

test('error_city_not_found and autherr_network are both defined in every supported language', () => {
  const eng = loadDecisionEngine();
  for(const lang of Object.keys(eng.STRINGS)){
    assert.ok(eng.STRINGS[lang].error_city_not_found, `error_city_not_found missing for "${lang}"`);
    assert.match(eng.STRINGS[lang].error_city_not_found, /\{city\}/, `error_city_not_found for "${lang}" must interpolate the searched place name`);
    assert.ok(eng.STRINGS[lang].autherr_network, `autherr_network missing for "${lang}"`);
  }
});
