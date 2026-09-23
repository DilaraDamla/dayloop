'use strict';
// Regression coverage for fixes found by walking the app as a first-time
// user: 24h clock in Turkish, honest "open at this time" wording, and no
// "previous stop" claim on the first stop of the day. Run with:
//   node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const setLang = (l) => vm.runInContext(`LANG = '${l}'`, eng.__context);

test('fmtTime uses a 24h clock in Turkish, matching the time pickers', () => {
  setLang('tr');
  assert.equal(eng.fmtTime(14*60), '14:00');
  assert.equal(eng.fmtTime(9*60 + 5), '09:05');
  assert.equal(eng.fmtTime(0), '00:00');
  setLang('en');
});

test('fmtTime keeps the AM/PM clock in English', () => {
  setLang('en');
  assert.equal(eng.fmtTime(14*60), '2:00 PM');
  assert.equal(eng.fmtTime(0), '12:00 AM');
});

test('the open badge describes the planned time, not "right now"', () => {
  for(const lang of ['tr', 'en']){
    const label = eng.STRINGS[lang].badge_open_now;
    assert.doesNotMatch(label, /şu an|now/i, `${lang} badge must not imply "open right now" for a future plan`);
  }
});

test('the first stop never claims to be close to a "previous stop"', () => {
  const p = { lat: 41.01, lon: 28.98, tags: { name: 'Test cafe' }, category: 'cafe' };
  const s = { slotType: 'coffee', poi: p, distFromPrev: 0.2, candidates: [p], altIndex: 0, tierUsed: 'core', relaxed: false, start: 14*60, end: 15*60, walkFromPrev: 0 };
  const profile = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const first = eng.explainStop(s, profile, [], { indoorBias: false });
  assert.notEqual(first, eng.t('explain_compact_route', { category: eng.catInSentence('cafe') }));

  const prior = { ...s, poi: { ...p, category: 'museum', tags: { name: 'Prior' } } };
  const later = eng.explainStop(s, profile, [prior], { indoorBias: false });
  assert.equal(later, eng.t('explain_compact_route', { category: eng.catInSentence('cafe') }));
});

// ---- round 2: walking the app with the default after-16:00 date (tomorrow) ----

test('plan-facing copy never says "today"/"tonight" — the plan is often for another day', () => {
  const keys = ['walk_preview', 'drive_preview', 'explain_must_include', 'explain_weather_indoor',
    'explain_intent_match_chill', 'explain_intent_match_creative', 'planexplain_weather_indoor',
    'planexplain_event_fit', 'summary_density_low', 'summary_density_high', 'summary_density_medium',
    'badge_closed_today', 'badge_unverified', 'badge_opens_at_title', 'badge_closed_today_title',
    'cost_estimate_title', 'upcoming_events_label'];
  for(const lang of ['en', 'tr']){
    for(const k of keys){
      assert.doesNotMatch(eng.STRINGS[lang][k], /today|tonight|bugün|bu akşam/i, `${lang}.${k}`);
    }
  }
});

test('Turkish plan copy addresses the user informally ("sen"), never "siz"', () => {
  for(const k of ['explain_fallback', 'explain_last_resort', 'explain_budget_low', 'popular_places_note']){
    assert.doesNotMatch(eng.STRINGS.tr[k], /[iıuü]n[iıuü]z/, k);
  }
});

test('km uses a decimal comma in Turkish and a point in English', () => {
  setLang('tr');
  assert.equal(eng.fmtKm(0.83), '0,8');
  assert.match(eng.formatWalkPreview(2.347, 41.6), /2,3 km/);
  setLang('en');
  assert.equal(eng.fmtKm(0.83), '0.8');
});

test('category names are lower-case inside sentences, Turkish-aware', () => {
  setLang('tr');
  assert.equal(eng.catInSentence('cafe'), 'kafe');
  assert.equal(eng.catInSentence('ferry_terminal'), 'vapur iskelesi');
  setLang('en');
  assert.equal(eng.catInSentence('escape_room'), 'escape room');
});

test('the vibe-exclusion reason lists only real vibe choices, not ferry terminals', () => {
  const chill = eng.buildDayIntentProfile({ vibe: 'chill', group: 'couple', budget: 2, weather: { indoorBias: false } });
  const reasons = eng.explainPlan(chill, { densityTier: 'medium', totalDistanceKm: 5 }, [], { indoorBias: false });
  const line = reasons.find(r => r.includes(eng.catInSentence('nightclub')));
  assert.ok(line, 'chill still explains that nightclubs were left out');
  assert.doesNotMatch(line, /ferry/i);

  const adventurous = eng.buildDayIntentProfile({ vibe: 'adventurous', group: 'friends', budget: 2, weather: { indoorBias: false } });
  const advReasons = eng.explainPlan(adventurous, { densityTier: 'medium', totalDistanceKm: 5 }, [], { indoorBias: false });
  assert.ok(!advReasons.some(r => /Left out/.test(r)), 'nothing vibe-specific excluded → no exclusion line at all');
});
