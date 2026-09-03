'use strict';
// Regression tests for the wheelchair-accessibility feature: a per-stop
// badge (accessibilityBadge) built only from OSM's own wheelchair=yes/
// limited/no tag, plus a hard candidate-pool filter (filterAccessiblePOIs)
// for the planner's "only show wheelchair-accessible places" toggle. See
// index.html for both.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();

function poi(wheelchair){
  return { lat: 41, lon: 29, category: 'cafe', tags: wheelchair!=null ? { wheelchair } : {} };
}

test('accessibilityBadge returns a real badge for wheelchair=yes', () => {
  const badge = eng.accessibilityBadge({ wheelchair: 'yes' });
  assert.ok(badge);
  assert.equal(badge.cls, 'access-yes');
});

test('accessibilityBadge returns a distinct badge for wheelchair=limited', () => {
  const badge = eng.accessibilityBadge({ wheelchair: 'limited' });
  assert.ok(badge);
  assert.equal(badge.cls, 'access-limited');
  assert.notEqual(badge.label, eng.accessibilityBadge({ wheelchair: 'yes' }).label, '"limited" must never read the same as a confirmed "yes" — the two mean very different things for someone relying on this');
});

test('accessibilityBadge returns a distinct badge for wheelchair=no', () => {
  const badge = eng.accessibilityBadge({ wheelchair: 'no' });
  assert.ok(badge);
  assert.equal(badge.cls, 'access-no');
});

test('accessibilityBadge returns null (never an invented "no") when the tag is simply absent', () => {
  assert.equal(eng.accessibilityBadge({}), null);
  assert.equal(eng.accessibilityBadge(undefined), null);
});

test('accessibilityBadge ignores an unrecognized/non-standard wheelchair tag value rather than guessing', () => {
  assert.equal(eng.accessibilityBadge({ wheelchair: 'designated' }), null, 'only the three real OSM values (yes/limited/no) this app actually understands should produce a badge — anything else must not be silently coerced into one of them');
});

test('filterAccessiblePOIs keeps only wheelchair=yes — "limited" is excluded, not treated as good enough', () => {
  const pois = [poi('yes'), poi('limited'), poi('no'), poi(null)];
  const result = eng.filterAccessiblePOIs(pois);
  assert.equal(result.length, 1);
  assert.equal(result[0].tags.wheelchair, 'yes');
});

test('filterAccessiblePOIs returns an empty list (never falls back to unfiltered) when nothing is confirmed accessible', () => {
  const pois = [poi('limited'), poi('no'), poi(null)];
  assert.deepEqual(eng.filterAccessiblePOIs(pois), []);
});

test('filterAccessiblePOIs does not mutate the input array or its POI objects', () => {
  const pois = [poi('yes'), poi('no')];
  const snapshot = JSON.stringify(pois);
  eng.filterAccessiblePOIs(pois);
  assert.equal(JSON.stringify(pois), snapshot);
});

test('every language defines the accessibility UI strings used by the planner form and stop badges', () => {
  const requiredKeys = [
    'badge_wheelchair_yes', 'badge_wheelchair_limited', 'badge_wheelchair_no',
    'badge_wheelchair_yes_title', 'badge_wheelchair_limited_title', 'badge_wheelchair_no_title',
    'wheelchair_only_label', 'wheelchair_only_hint', 'error_no_accessible_places',
  ];
  for(const lang of Object.keys(eng.STRINGS)){
    for(const key of requiredKeys){
      assert.ok(eng.STRINGS[lang][key], `${key} missing for "${lang}"`);
    }
  }
});
