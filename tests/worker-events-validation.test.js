'use strict';
// Sprint 1 security hardening — regression tests for the events proxy
// Worker's own input validation (worker/src/index.js). These import the
// Worker module's named exports directly (added purely for this test file —
// Wrangler still only uses the default export as the real entrypoint) rather
// than re-implementing the same regexes/checks here, so a real change to the
// Worker's validation is what these tests actually exercise.
//
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let worker;
test.before(async () => {
  const workerPath = path.join(__dirname, '..', 'worker', 'src', 'index.js');
  worker = await import(pathToFileURL(workerPath).href);
});

test('parseLat/parseLon accept real-world coordinates', async () => {
  assert.equal(worker.parseLat('41.0082'), 41.0082);
  assert.equal(worker.parseLon('28.9784'), 28.9784);
  assert.equal(worker.parseLat('-33.8688'), -33.8688); // Sydney — negative latitude must not be rejected
  assert.equal(worker.parseLon('-74.0060'), -74.0060); // NYC — negative longitude must not be rejected
});

test('parseLat/parseLon reject out-of-range and malformed coordinates', () => {
  assert.equal(worker.parseLat('91'), null, 'latitude cannot exceed 90');
  assert.equal(worker.parseLat('-91'), null, 'latitude cannot be below -90');
  assert.equal(worker.parseLon('181'), null, 'longitude cannot exceed 180');
  assert.equal(worker.parseLon('-181'), null, 'longitude cannot be below -180');
  assert.equal(worker.parseLat('not-a-number'), null);
  assert.equal(worker.parseLat('NaN'), null);
  assert.equal(worker.parseLat('Infinity'), null);
  assert.equal(worker.parseLat(''), null);
  assert.equal(worker.parseLat(null), null);
});

test('parseLat/parseLon reject injection-shaped junk instead of coercing it', () => {
  assert.equal(worker.parseLat('41.0082; DROP TABLE events'), null);
  assert.equal(worker.parseLon('<script>alert(1)</script>'), null);
});

test('parseDateTime accepts only the exact Ticketmaster-compatible format', () => {
  assert.equal(worker.parseDateTime('2026-08-08T09:00:00Z'), '2026-08-08T09:00:00Z');
});

test('parseDateTime rejects malformed dates rather than forwarding them upstream', () => {
  assert.equal(worker.parseDateTime('2026-08-08'), undefined, 'date-only, no time component, must be rejected');
  assert.equal(worker.parseDateTime('08/08/2026'), undefined);
  assert.equal(worker.parseDateTime("2026-08-08T09:00:00Z'; DROP TABLE events;--"), undefined);
  assert.equal(worker.parseDateTime(null), null, 'a missing date is a valid "not provided" state, not an error');
});

test('parseDateTime checks FORMAT only, not calendar validity — a documented, low-risk gap', () => {
  // "2026-13-40T99:99:99Z" matches the digit-position pattern even though
  // month 13 / day 40 / hour 99 are not real calendar values. This is
  // intentional-by-omission, not a security gap: an out-of-range value like
  // this is still only ever forwarded as an opaque query-string value to
  // Ticketmaster (never parsed as a real Date or interpolated into anything
  // executable here), so the worst case is Ticketmaster itself rejecting or
  // ignoring it — not a crash or injection in this Worker.
  assert.equal(worker.parseDateTime('2026-13-40T99:99:99Z'), '2026-13-40T99:99:99Z');
});

test('parseLocale accepts real locale tags and rejects everything else', () => {
  assert.equal(worker.parseLocale('en-us'), 'en-us');
  assert.equal(worker.parseLocale('TR'), 'tr');
  assert.equal(worker.parseLocale('*'), '*');
  assert.equal(worker.parseLocale('en-us; DROP TABLE'), undefined);
  assert.equal(worker.parseLocale('<script>'), undefined);
});

test('sanitizeKeyword strips unsafe characters and enforces a length cap', () => {
  assert.equal(worker.sanitizeKeyword('jazz night'), 'jazz night');
  assert.equal(worker.sanitizeKeyword('<script>alert(1)</script>'), 'scriptalert1script');
  const long = 'a'.repeat(500);
  assert.ok(worker.sanitizeKeyword(long).length <= 80, 'an oversized keyword must be capped, not forwarded as-is');
});

test('isAllowedOrigin only allows the production origin and local dev origins', () => {
  assert.equal(worker.isAllowedOrigin('https://dilaradamla.github.io'), true);
  assert.equal(worker.isAllowedOrigin('http://localhost:5000'), true);
  assert.equal(worker.isAllowedOrigin('http://127.0.0.1:8080'), true);
  assert.equal(worker.isAllowedOrigin('https://evil.example.com'), false);
  assert.equal(worker.isAllowedOrigin(null), false);
});

test('haversineKm returns 0 for identical points and a sane positive value for real cities', () => {
  assert.equal(worker.haversineKm(41.0082, 28.9784, 41.0082, 28.9784), 0);
  const istanbulToAnkara = worker.haversineKm(41.0082, 28.9784, 39.9334, 32.8597);
  assert.ok(istanbulToAnkara > 300 && istanbulToAnkara < 400, `expected roughly 350km, got ${istanbulToAnkara}`);
});
