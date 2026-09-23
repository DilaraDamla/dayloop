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
  assert.notEqual(first, eng.t('explain_compact_route', { category: eng.t('cat_cafe') }));

  const prior = { ...s, poi: { ...p, category: 'museum', tags: { name: 'Prior' } } };
  const later = eng.explainStop(s, profile, [prior], { indoorBias: false });
  assert.equal(later, eng.t('explain_compact_route', { category: eng.t('cat_cafe') }));
});
