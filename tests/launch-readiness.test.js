'use strict';
// Sprint 5 launch-readiness regression tests — protects the two small,
// justified changes made this sprint: a neutral default vibe, and an early
// walking-distance preview. Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// Default vibe is neutral, not "Romantic".
// ---------------------------------------------------------------------------
test('the default active vibe chip in the raw markup is chill, not romantic', () => {
  const vibeChipsSection = INDEX_HTML.slice(INDEX_HTML.indexOf('id="vibe-chips"'), INDEX_HTML.indexOf('</div>', INDEX_HTML.indexOf('id="vibe-chips"')) + 400);
  assert.match(vibeChipsSection, /class="chip active" data-val="chill"/, 'chill chip must carry the default "active" class');
  assert.doesNotMatch(vibeChipsSection, /class="chip active" data-val="romantic"/, 'romantic must no longer be the pre-selected default');
});

// ---------------------------------------------------------------------------
// Walking distance preview: pure formatting function, both languages.
// ---------------------------------------------------------------------------
test('formatWalkPreview renders a short, factual line with real numbers, not invented ones', () => {
  const text = eng.formatWalkPreview(2.347, 41.6);
  assert.match(text, /2\.3/, 'must show the real distance (rounded to 1 decimal), not a placeholder');
  assert.match(text, /42/, 'must show the real duration rounded to the nearest minute');
  assert.match(text, /walking/i);
});

test('formatWalkPreview is available in both languages via STRINGS', () => {
  assert.ok(eng.STRINGS.en.walk_preview, 'walk_preview key must exist in English strings');
  assert.ok(eng.STRINGS.tr.walk_preview, 'walk_preview key must exist in Turkish strings');
  assert.match(eng.STRINGS.en.walk_preview, /\{km\}/);
  assert.match(eng.STRINGS.en.walk_preview, /\{min\}/);
  assert.match(eng.STRINGS.tr.walk_preview, /\{km\}/);
  assert.match(eng.STRINGS.tr.walk_preview, /\{min\}/);
});

// ---------------------------------------------------------------------------
// Group selection still reaches the Day Intent Profile correctly (unchanged
// behavior — regression guard that the default-vibe change didn't disturb
// the group -> profile pipeline it sits right next to in the form).
// ---------------------------------------------------------------------------
test('group selection still reaches the resolved Day Intent Profile for every option the UI offers', () => {
  for(const group of ['couple', 'solo', 'friends']){
    const profile = eng.buildDayIntentProfile({ vibe: 'chill', group, budget: 2, weather: { indoorBias: false } });
    assert.ok(profile.slotTiers.evening, `group="${group}" must still produce a usable profile`);
  }
});

// ---------------------------------------------------------------------------
// No literal "Family" option was added — documented decision, not a silent
// gap. This test exists so a future change to that decision is deliberate.
// ---------------------------------------------------------------------------
test('the group selector intentionally has exactly three options (documented Sprint 5 decision, not an oversight)', () => {
  const groupSection = INDEX_HTML.slice(INDEX_HTML.indexOf('id="group"'), INDEX_HTML.indexOf('</select>', INDEX_HTML.indexOf('id="group"')));
  const optionCount = (groupSection.match(/<option/g) || []).length;
  assert.equal(optionCount, 3, 'group options are couple/solo/friends by deliberate Sprint 5 decision — see docs/launch/launch-readiness-report.md');
});
