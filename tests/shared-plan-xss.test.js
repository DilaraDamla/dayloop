'use strict';
// Security regression tests for a stored-XSS vulnerability found by a
// dedicated security review of this session's shared-plans feature: a
// sharedPlans/{shareId} Firestore document can be written directly by ANY
// signed-in user via the Firebase SDK (bypassing index.html's own
// buildSharedPlanDoc entirely — firestore.rules' isValidSharedPlan can only
// validate that `stops` is a list under a size cap and `weather`/`center`
// are maps; the rules language has no construct to iterate a variable-
// length list and validate each item's own nested field types). Without
// these fixes, a crafted document's stops[i].poi.lat/lon, stops[i].
// walkFromPrev, or weather.avgTemp reached render() unescaped, producing a
// stored XSS the moment a victim opened the malicious `?shared=` link — no
// click beyond opening the link required.
//
// See mapLink/sanitizeSharedPlanStop/sanitizeSharedPlanStops/
// sanitizeSharedPlanWeather/sanitizeSharedPlanCenter in index.html for the
// fix: every numeric field a crafted document could poison is individually
// type/finite-checked with a safe default, both at the specific render()
// sinks that were vulnerable and again at the shared-plan load boundary
// (loadSharedPlanFromURL) so every future consumer of a loaded shared plan
// gets already-well-typed data.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();

const XSS_PAYLOAD = '"><img src=x onerror=alert(document.cookie)>';

// ---------------------------------------------------------------------------
// mapLink: the actual href-building function
// ---------------------------------------------------------------------------

test('mapLink coerces a non-numeric lat/lon to a safe number instead of passing an XSS payload through', () => {
  const url = eng.mapLink(XSS_PAYLOAD, XSS_PAYLOAD);
  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=0,0');
  assert.ok(!url.includes('<'), 'no HTML-special character from a crafted lat/lon may ever appear in the URL');
});

test('mapLink still works correctly for real, legitimate coordinates (no regression)', () => {
  const url = eng.mapLink(41.0082, 28.9784);
  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=41.0082,28.9784');
});

test('mapLink rejects Infinity/NaN just like a string — a finite check, not just typeof', () => {
  assert.equal(eng.mapLink(Infinity, NaN), 'https://www.google.com/maps/search/?api=1&query=0,0');
});

// ---------------------------------------------------------------------------
// sanitizeSharedPlanStop / sanitizeSharedPlanStops
// ---------------------------------------------------------------------------

test('sanitizeSharedPlanStop neutralizes an XSS payload injected into poi.lat/lon', () => {
  const malicious = { poi: { lat: XSS_PAYLOAD, lon: XSS_PAYLOAD, category: 'cafe', tags: { name: 'x' } }, walkFromPrev: 5 };
  const clean = eng.sanitizeSharedPlanStop(malicious);
  assert.equal(clean.poi.lat, 0);
  assert.equal(clean.poi.lon, 0);
  assert.equal(typeof clean.poi.lat, 'number');
  assert.equal(typeof clean.poi.lon, 'number');
});

test('sanitizeSharedPlanStop neutralizes an XSS payload injected into walkFromPrev/distFromPrev/start/end', () => {
  const malicious = { poi: { lat: 41, lon: 29 }, walkFromPrev: XSS_PAYLOAD, distFromPrev: XSS_PAYLOAD, start: XSS_PAYLOAD, end: XSS_PAYLOAD };
  const clean = eng.sanitizeSharedPlanStop(malicious);
  assert.equal(clean.walkFromPrev, 0);
  assert.equal(clean.distFromPrev, 0);
  assert.equal(clean.start, 0);
  assert.equal(clean.end, 0);
});

test('sanitizeSharedPlanStop passes through genuinely legitimate numeric fields unchanged', () => {
  const legit = { poi: { lat: 41.01, lon: 28.98, category: 'museum', tags: { name: 'Real Museum' } }, walkFromPrev: 12, distFromPrev: 0.8, start: 600, end: 690, slotType: 'activity', tierUsed: 'core' };
  const clean = eng.sanitizeSharedPlanStop(legit);
  assert.equal(clean.poi.lat, 41.01);
  assert.equal(clean.poi.lon, 28.98);
  assert.equal(clean.walkFromPrev, 12);
  assert.equal(clean.poi.category, 'museum');
  assert.equal(clean.slotType, 'activity');
});

test('sanitizeSharedPlanStop never throws on completely malformed input (null poi, missing fields, wrong types entirely)', () => {
  assert.doesNotThrow(() => eng.sanitizeSharedPlanStop({}));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanStop({ poi: null }));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanStop({ poi: 'not an object' }));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanStop(null));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanStop('not an object at all'));
});

test('sanitizeSharedPlanStop always produces exactly one candidate (itself) — never swappable, consistent with a shared view', () => {
  const clean = eng.sanitizeSharedPlanStop({ poi: { lat: 41, lon: 29 }, candidates: [{lat:1,lon:1},{lat:2,lon:2},{lat:3,lon:3}] });
  assert.equal(clean.candidates.length, 1, 'a shared-plan stop must never appear swappable, regardless of what a crafted document claims its candidates are');
});

test('sanitizeSharedPlanStops handles a non-array (e.g. an attacker sending a string or object instead of a list) without throwing', () => {
  assert.equal(eng.sanitizeSharedPlanStops('not an array').length, 0);
  assert.equal(eng.sanitizeSharedPlanStops(null).length, 0);
  assert.equal(eng.sanitizeSharedPlanStops(undefined).length, 0);
});

test('sanitizeSharedPlanStops sanitizes every item in a mixed legitimate/malicious list', () => {
  const result = eng.sanitizeSharedPlanStops([
    { poi: { lat: 41, lon: 29, category: 'cafe' }, walkFromPrev: 5 },
    { poi: { lat: XSS_PAYLOAD, lon: XSS_PAYLOAD }, walkFromPrev: XSS_PAYLOAD },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].poi.lat, 41);
  assert.equal(result[1].poi.lat, 0);
});

// ---------------------------------------------------------------------------
// sanitizeSharedPlanWeather
// ---------------------------------------------------------------------------

test('sanitizeSharedPlanWeather neutralizes an XSS payload injected into avgTemp', () => {
  const clean = eng.sanitizeSharedPlanWeather({ avgTemp: XSS_PAYLOAD, codeKey: 'clear' });
  assert.equal(clean.avgTemp, null, 'a non-numeric avgTemp must become null (renders as "—"), never pass the raw string through');
});

test('sanitizeSharedPlanWeather only accepts a codeKey that actually maps to a real translated weather string', () => {
  const clean = eng.sanitizeSharedPlanWeather({ codeKey: XSS_PAYLOAD });
  assert.equal(clean.codeKey, 'clear', 'an unrecognized/malicious codeKey must fall back to a safe known value, never be used to probe or inject via the STRINGS lookup');
  const legit = eng.sanitizeSharedPlanWeather({ codeKey: 'rain', avgTemp: 12 });
  assert.equal(legit.codeKey, 'rain');
  assert.equal(legit.avgTemp, 12);
});

test('sanitizeSharedPlanWeather never throws on malformed input', () => {
  assert.doesNotThrow(() => eng.sanitizeSharedPlanWeather(null));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanWeather('not an object'));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanWeather(undefined));
});

// ---------------------------------------------------------------------------
// sanitizeSharedPlanCenter
// ---------------------------------------------------------------------------

test('sanitizeSharedPlanCenter neutralizes an XSS payload injected into lat/lon', () => {
  const clean = eng.sanitizeSharedPlanCenter({ lat: XSS_PAYLOAD, lon: XSS_PAYLOAD });
  assert.equal(clean.lat, 0);
  assert.equal(clean.lon, 0);
});

test('sanitizeSharedPlanCenter caps an oversized label rather than passing it through unbounded', () => {
  const clean = eng.sanitizeSharedPlanCenter({ lat: 41, lon: 29, label: 'x'.repeat(5000) });
  assert.ok(clean.label.length <= 300);
});

test('sanitizeSharedPlanCenter never throws on malformed input', () => {
  assert.doesNotThrow(() => eng.sanitizeSharedPlanCenter(null));
  assert.doesNotThrow(() => eng.sanitizeSharedPlanCenter('not an object'));
});
