'use strict';
// Sprint 3 automated invariants — run across the real environment/scenario
// fixture matrix (tests/fixtures/*), via the real pipeline replay in
// tests/scenarioRunner.js. Run with: node --test tests/
//
// This file is the MACHINE-VERIFIABLE half of Sprint 3. It proves structural
// correctness (never empty, hard constraints held, explanations match the
// trace, determinism) — it does NOT and cannot prove a day is a good day to
// live through. That's the separate, human-reviewed half: see
// docs/validation/sprint3-scenario-review.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');
const { ENVIRONMENTS } = require('./fixtures/environments.js');
const { SCENARIOS } = require('./fixtures/scenarios.js');
const { runScenario, textHasUnsupportedClaim } = require('./scenarioRunner.js');

const eng = loadDecisionEngine();

function allCombinations(){
  const combos = [];
  for(const [scenarioKey, scenarioDef] of Object.entries(SCENARIOS)){
    const scenario = { ...scenarioDef, __key: scenarioKey };
    const envKeys = scenario.focusEnvironments || Object.keys(ENVIRONMENTS);
    for(const envKey of envKeys){
      combos.push({ envKey, environment: ENVIRONMENTS[envKey], scenario });
    }
  }
  return combos;
}

const RESULTS = allCombinations().map(({ envKey, environment, scenario }) => ({
  envKey, scenarioKey: scenario.__key,
  result: runScenario(eng, envKey, environment, scenario),
}));

// ---------------------------------------------------------------------------
// 1. No empty itinerary when valid candidates exist.
// ---------------------------------------------------------------------------
test('no scenario silently returns an empty day when the environment has candidates', () => {
  for(const { envKey, scenarioKey, result } of RESULTS){
    if(result.environment.pois.length === 0) continue;
    assert.ok(result.stops.length > 0, `${envKey}/${scenarioKey}: expected a non-empty day (pois=${result.environment.pois.length})`);
  }
});

// ---------------------------------------------------------------------------
// 2. Hard constraints are never relaxed.
// ---------------------------------------------------------------------------
test('a mood-excluded category never appears in any scenario result', () => {
  for(const { envKey, scenarioKey, result } of RESULTS){
    for(const stop of result.stops){
      assert.ok(!result.profile.excluded.has(stop.poi.category),
        `${envKey}/${scenarioKey}: excluded category "${stop.poi.category}" appeared in the day`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Calm intent does not select nightlife unless explicitly unavoidable.
// ---------------------------------------------------------------------------
test('chill-vibe scenarios only use bar/nightclub via a genuine last-resort or fallback tier', () => {
  const chillResults = RESULTS.filter(r => r.result.scenario.vibe === 'chill');
  assert.ok(chillResults.length > 0, 'sanity check: at least one chill scenario ran');
  for(const { envKey, scenarioKey, result } of chillResults){
    for(const stop of result.stops){
      if(['bar','nightclub'].includes(stop.poi.category)){
        assert.ok(['lastResort','crossSlotFallback'].includes(stop.tierUsed),
          `${envKey}/${scenarioKey}: nightlife category "${stop.poi.category}" was used at tier "${stop.tierUsed}", not a genuine last resort`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Budget intent survives missing free venues (the critical combined case).
// ---------------------------------------------------------------------------
test('budget intent under rain/cold in low-density places still produces a real day', () => {
  const critical = RESULTS.filter(r => r.scenarioKey === 'criticalBudgetRainLowDensity');
  assert.equal(critical.length, 2, 'expected the critical case to run in town and village only');
  for(const { envKey, result } of critical){
    assert.ok(result.stops.length > 0, `${envKey}: critical budget+rain+low-density case must not return an empty day`);
  }
});

// ---------------------------------------------------------------------------
// 5. Low-density plans use fewer, longer stops.
// ---------------------------------------------------------------------------
test('every low-density-tier result has a stretch factor above 1 and fewer than 5 slots', () => {
  const lowDensity = RESULTS.filter(r => r.result.structure.densityTier === 'low');
  assert.ok(lowDensity.length > 0, 'sanity check: at least one low-density result exists in the matrix');
  for(const { envKey, scenarioKey, result } of lowDensity){
    assert.ok(result.structure.stretchFactor > 1, `${envKey}/${scenarioKey}: low density must stretch stop duration`);
    assert.ok(result.structure.slotTypes.length < 5, `${envKey}/${scenarioKey}: low density must not use the full 5-slot template`);
  }
});

// ---------------------------------------------------------------------------
// 6. Dense locations may produce more varied stops.
// ---------------------------------------------------------------------------
test('dense capital results keep the full slot template and avoid duplicate categories', () => {
  const capital = RESULTS.filter(r => r.envKey === 'denseCapital');
  assert.ok(capital.length > 0);
  for(const { scenarioKey, result } of capital){
    assert.equal(result.structure.densityTier, 'high', `${scenarioKey}: dense capital must be detected as high density`);
    const ev = eng.evaluateDayPlan(result.stops, result.environment.center);
    assert.equal(ev.duplicateCategoryCount, 0, `${scenarioKey}: a dense area should not need to repeat a category`);
  }
});

// ---------------------------------------------------------------------------
// 7. Wider-radius (unusually far) stop use creates an honest explanation.
// ---------------------------------------------------------------------------
test('any unusually far stop is always accompanied by a trade-off note', () => {
  for(const { envKey, scenarioKey, result } of RESULTS){
    const hasFarStop = result.stops.some(s => s.distFromPrev != null && s.distFromPrev > 1.2);
    if(hasFarStop){
      assert.ok(result.explanation && result.explanation.tradeOffNote,
        `${envKey}/${scenarioKey}: a far stop occurred with no trade-off note explaining it`);
    }
  }
});

// ---------------------------------------------------------------------------
// 8. No relaxation at all creates no compromise language.
// ---------------------------------------------------------------------------
test('when nothing was relaxed and hours are all known, there is no trade-off note', () => {
  let checkedAtLeastOne = false;
  for(const { envKey, scenarioKey, result } of RESULTS){
    const anyRelaxedTier = result.stops.some(s => ['lastResort','crossSlotFallback'].includes(s.tierUsed));
    const anyFarStop = result.stops.some(s => s.distFromPrev != null && s.distFromPrev > 1.2);
    const anyUnknownHours = result.stops.some(s => {
      const minuteOfDay = (s.start != null ? s.start : 0) % 1440;
      return eng.isLikelyOpenAt(s.poi.tags.opening_hours, result.dateStr, minuteOfDay) === null;
    });
    if(!anyRelaxedTier && !anyFarStop && !anyUnknownHours){
      checkedAtLeastOne = true;
      assert.equal(result.explanation.tradeOffNote, null,
        `${envKey}/${scenarioKey}: no relaxation occurred but a trade-off note was still shown`);
    }
  }
  assert.ok(checkedAtLeastOne, 'sanity check: at least one fully-unrelaxed scenario existed to verify against');
});

// ---------------------------------------------------------------------------
// 9. Explanations match the actual decision trace.
// ---------------------------------------------------------------------------
test('every stop reason is consistent with its own tierUsed field', () => {
  for(const { envKey, scenarioKey, result } of RESULTS){
    result.stops.forEach((stop, i) => {
      const reason = result.explanation.stopReasons[i];
      const categoryVars = { category: eng.t('cat_'+stop.poi.category) };
      if(stop.tierUsed === 'crossSlotFallback'){
        assert.equal(reason, eng.t('explain_fallback', categoryVars), `${envKey}/${scenarioKey} stop ${i}: crossSlotFallback tier must explain itself as a fallback`);
      } else if(stop.tierUsed === 'lastResort'){
        assert.equal(reason, eng.t('explain_last_resort', categoryVars), `${envKey}/${scenarioKey} stop ${i}: lastResort tier must explain itself as a last resort`);
      }
      // core/acceptable tiers can legitimately produce several different
      // honest reasons (weather/variety/budget/compactness/intent-match) —
      // only the relaxed tiers have one single correct explanation.
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Stop selection and explanations remain deterministic for fixed fixtures.
// ---------------------------------------------------------------------------
test('re-running the same environment+scenario twice yields an identical result', () => {
  for(const [scenarioKey, scenarioDef] of Object.entries(SCENARIOS)){
    const scenario = { ...scenarioDef, __key: scenarioKey };
    const envKey = (scenario.focusEnvironments || Object.keys(ENVIRONMENTS))[0];
    const environment = ENVIRONMENTS[envKey];
    const runA = runScenario(eng, envKey, environment, scenario);
    const runB = runScenario(eng, envKey, environment, scenario);
    const summarize = r => ({
      categories: r.stops.map(s => s.poi.category),
      names: r.stops.map(s => s.poi.tags.name),
      tiers: r.stops.map(s => s.tierUsed),
      reasons: r.explanation.stopReasons,
      summary: r.explanation.summary,
      tradeOffNote: r.explanation.tradeOffNote,
    });
    assert.deepEqual(summarize(runA), summarize(runB), `${envKey}/${scenarioKey}: result must be deterministic across runs`);
  }
});

// ---------------------------------------------------------------------------
// Explicit separation check: no generated text anywhere claims something this
// app cannot verify (this is machine-checkable; whether the day is *good* is
// not, and is left to the human-review artifact).
// ---------------------------------------------------------------------------
test('no unsupported claims appear anywhere across the full scenario matrix', () => {
  for(const { envKey, scenarioKey, result } of RESULTS){
    const { explanation } = result;
    if(!explanation) continue;
    explanation.stopReasons.forEach((r,i) => assert.ok(!textHasUnsupportedClaim(r), `${envKey}/${scenarioKey} stop ${i}: unsupported claim in "${r}"`));
    assert.ok(!textHasUnsupportedClaim(explanation.summary), `${envKey}/${scenarioKey}: unsupported claim in summary`);
    assert.ok(!textHasUnsupportedClaim(explanation.tradeOffNote), `${envKey}/${scenarioKey}: unsupported claim in trade-off note`);
  }
});
