'use strict';
// Sprint 3 offline user scenarios — paired with tests/fixtures/environments.js
// and run through tests/scenarioRunner.js. `weatherKey` selects which of an
// environment's two weather states (clear / rainyOrCold) applies.

const SCENARIOS = {
  calmDay: {
    label: 'Calm day',
    vibe: 'chill', group: 'couple', budget: 2,
    weatherKey: 'clear', durationHours: 7, startMin: 10 * 60,
  },
  budgetDay: {
    label: 'Budget day',
    vibe: 'budget', group: 'couple', budget: 1,
    weatherKey: 'clear', durationHours: 7, startMin: 10 * 60,
  },
  romanticDate: {
    label: 'Romantic date',
    vibe: 'romantic', group: 'couple', budget: 2,
    weatherKey: 'clear', durationHours: 5, startMin: 17 * 60,
  },
  rainyOrColdDay: {
    label: 'Rainy or cold day',
    vibe: 'chill', group: 'couple', budget: 2,
    weatherKey: 'rainyOrCold', durationHours: 6, startMin: 10 * 60,
  },
  sparseFallback: {
    label: 'Sparse-location fallback case',
    // A vibe with no special-casing (adventurous) run everywhere, including
    // the two genuinely sparse environments — the interesting result is
    // whether it still produces a real day in town/village, not a specific
    // vibe match.
    vibe: 'adventurous', group: 'solo', budget: 2,
    weatherKey: 'clear', durationHours: 6, startMin: 11 * 60,
  },
  // The previously identified critical case: budget intent + rainy/cold
  // weather + a low-density place. Most interesting in town/village, run
  // everywhere as a control (capital/suburb are expected to trivially pass).
  criticalBudgetRainLowDensity: {
    label: 'Budget + rainy/cold + low-density (critical case)',
    vibe: 'budget', group: 'couple', budget: 1,
    weatherKey: 'rainyOrCold', durationHours: 6, startMin: 10 * 60,
    focusEnvironments: ['town', 'village'],
  },
};

module.exports = { SCENARIOS };
