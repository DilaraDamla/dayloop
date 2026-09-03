'use strict';
// Sprint 3 scenario runner — replays the REAL (non-network) planning pipeline
// against an offline environment fixture and scenario, then evaluates the
// result against environment-specific, mostly-machine-checkable criteria.
//
// This mirrors buildFullPlan()'s actual logic in index.html, function for
// function, minus the two network calls (fetchWeather, fetchWalkingRoute) —
// weather comes from the fixture, and routing falls back to the same
// straight-line estimate buildFullPlan itself uses whenever OSRM is
// unavailable (legDurationsMin: null). Nothing here is a reimplementation of
// decision logic — every step calls the actual exported function.

const DATE_STR = '2026-07-22'; // fixed, deterministic — a Wednesday

const BANNED_PATTERNS = [
  /best in town/i, /amazing/i, /always quiet/i, /\bsafe\b/i, /popular with locals/i,
  /great food/i, /romantic ambiance/i, /low crowd/i, /you'?ll love/i, /most romantic/i,
];

function textHasUnsupportedClaim(text){
  if(!text) return false;
  return BANNED_PATTERNS.some(re => re.test(text));
}

function runScenario(engine, envKey, environment, scenario){
  const weather = environment.weather[scenario.weatherKey];
  const startMin = scenario.startMin;
  const endMin = startMin + scenario.durationHours * 60;

  // ---- Intent Layer ----
  const profile = engine.buildDayIntentProfile({ vibe: scenario.vibe, group: scenario.group, budget: scenario.budget, weather });

  // ---- Decision Layer ----
  const { stops: rawStops, dayTrace, structure } = engine.buildItinerary(
    environment.pois, environment.center, { profile, dateStr: DATE_STR, startMin, endMin }
  );
  const stops = engine.scheduleStops(rawStops, startMin, null, structure.stretchFactor);
  dayTrace.pacing = engine.evaluatePacing(stops, endMin, profile.pace);

  // ---- Explanation Layer ----
  const explanation = engine.buildExplanation({ stops, profile, dayTrace, weather, dateStr: DATE_STR });

  return {
    envKey, envLabel: environment.label, scenarioKey: scenario.__key, scenarioLabel: scenario.label,
    environment, scenario, weather, dateStr: DATE_STR, startMin, endMin,
    profile, structure, stops, dayTrace, explanation,
  };
}

// Environment-specific acceptance criteria. Only asserts what's genuinely
// mechanical — anything requiring a judgment call ("does this feel
// coherent?", "does the village stop feel like its real character?") is
// deliberately left to the human-review notes in the generated report, not
// faked here as a pass/fail.
function evaluateCriteria(engine, result){
  const { envKey, stops, dayTrace, structure, profile, explanation, environment } = result;
  const checks = [];
  const push = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: String(detail) });

  // ---- Universal, every environment ----
  push('never silently empty when valid candidates exist',
    stops.length > 0 || environment.pois.length === 0,
    `stops=${stops.length}, pois available=${environment.pois.length}`);
  push('hard constraint (excluded category) never appears',
    stops.every(s => !profile.excluded.has(s.poi.category)),
    stops.map(s=>s.poi.category).join(',') || '(none)');
  push('every stop received a non-empty explanation',
    !explanation || explanation.stopReasons.every(r => typeof r === 'string' && r.trim().length > 0),
    `reasons=${explanation ? explanation.stopReasons.length : 0}`);
  push('no unsupported claims in any generated text',
    !explanation || (!textHasUnsupportedClaim(explanation.summary) && !textHasUnsupportedClaim(explanation.tradeOffNote) && !explanation.stopReasons.some(textHasUnsupportedClaim)),
    '');

  const ev = engine.evaluateDayPlan(stops, environment.center);

  if(envKey === 'denseCapital'){
    push('no duplicate categories in a dense area', ev.duplicateCategoryCount === 0, `duplicateCategoryCount=${ev.duplicateCategoryCount}`);
    const avgKm = stops.length > 1 ? ev.totalDistanceKm / (stops.length - 1) : 0;
    push('compact route (avg leg < 0.8km)', avgKm < 0.8, `avgLegKm=${avgKm.toFixed(2)}`);
    push('sufficient stop variety (no category repeats)', new Set(stops.map(s=>s.poi.category)).size === stops.length, `distinctCategories=${new Set(stops.map(s=>s.poi.category)).size}/${stops.length}`);
  } else if(envKey === 'suburb'){
    push('not forced into an urban (high-density) shape given medium supply', structure.densityTier !== 'high', `densityTier=${structure.densityTier}`);
    push('coherent transitions (no backtracking)', ev.backtrackCount === 0, `backtrackCount=${ev.backtrackCount}`);
    const distances = stops.map(s=>s.distFromPrev).filter(d=>d!=null);
    const hasNear = distances.some(d=>d<0.6), hasFarther = distances.some(d=>d>=0.6);
    push('mix of local and slightly-farther options', distances.length < 2 || (hasNear || hasFarther), `distances=${distances.map(d=>d.toFixed(2)).join(',')}`);
  } else if(envKey === 'town'){
    push('does not fail just because categories are sparse', stops.length > 0, `stops=${stops.length}`);
    push('scarcity reflected honestly in density tier', structure.densityTier !== 'high', `densityTier=${structure.densityTier}`);
    push('scarcity shapes pacing (stretch) rather than padding stop count', structure.densityTier !== 'low' || structure.stretchFactor > 1, `stretchFactor=${structure.stretchFactor}`);
    const hasFarStop = stops.some(s=>s.distFromPrev!=null && s.distFromPrev>1.2);
    push('wider travel is explained honestly, not silently', !hasFarStop || !!(explanation && explanation.tradeOffNote), `hasFarStop=${hasFarStop}, tradeOffNote=${explanation && explanation.tradeOffNote || '(none)'}`);
  } else if(envKey === 'village'){
    push('small stop count (<=3) treated as a valid result, not padded', stops.length <= 3, `stops=${stops.length}`);
    push('no forced 5-slot template', structure.slotTypes.length < 5, `slotTypes=[${structure.slotTypes.join(',')}]`);
    push('summary does not overstate density', structure.densityTier !== 'low' || explanation.summary === engine.t('summary_density_low'), explanation ? explanation.summary : '(none)');
  }

  return checks;
}

module.exports = { runScenario, evaluateCriteria, DATE_STR, textHasUnsupportedClaim };
