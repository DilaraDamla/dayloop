'use strict';
// Loads the real Decision/Intent Layer logic straight out of index.html — no
// reimplementation, no build step, no dependency. DayLoop is deliberately a
// single static file (see CLAUDE.md); this harness respects that by evaluating
// the actual inline <script> content in a minimal sandboxed context instead of
// extracting the logic into a second source file.
//
// Only the portion of the script BEFORE the "---------- UI wiring ----------"
// marker is evaluated. Everything the Decision/Intent Layer needs (constants,
// scoring, tiering, sequencing) is defined above that line; everything below
// it is DOM event wiring the tests have no reason to touch. A small stub
// supplies just enough of `document`/`navigator` for that portion's top-level
// statements (a handful of `$('id').addEventListener(...)` calls) to run
// without throwing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const UI_WIRING_MARKER = '// ---------- UI wiring ----------';

function fakeElement(){
  return {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', disabled: false,
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, removeEventListener(){},
    appendChild(){}, closest(){ return null; }, querySelector(){ return null; },
    querySelectorAll(){ return []; }, focus(){}, blur(){}, scrollIntoView(){},
  };
}

function extractAppScript(html){
  const scriptOpenTag = '<script>';
  // The FIRST unattributed <script> tag is the app's single inline script —
  // everything before it is CDN <script src="..."> tags, which don't match
  // a bare "<script>".
  const scriptStart = html.indexOf(scriptOpenTag);
  if(scriptStart === -1) throw new Error('loadDecisionEngine: could not find the inline <script> tag in index.html');
  const bodyStart = scriptStart + scriptOpenTag.length;
  const wiringIdx = html.indexOf(UI_WIRING_MARKER, bodyStart);
  if(wiringIdx === -1) throw new Error('loadDecisionEngine: could not find the UI-wiring boundary comment in index.html — has it moved or been renamed?');
  return html.slice(bodyStart, wiringIdx);
}

function loadDecisionEngine(){
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const source = extractAppScript(html);

  const sandbox = {
    console,
    document: {
      getElementById(){ return fakeElement(); },
      querySelectorAll(){ return []; },
      addEventListener(){},
      createElement(){ return fakeElement(); },
      body: fakeElement(),
    },
    navigator: { language: 'en-US' },
    localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    URL, // real WHATWG URL, same as the browser's — used by isSafeExternalUrl
    setTimeout, clearTimeout,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'index.html (extracted app script)' });

  // `const`/`let`/`function` bindings in a vm context are NOT reflected as
  // enumerable properties of the sandbox object, so pull out what tests need
  // via a second script run in the SAME context, where those bindings are
  // still directly visible by name.
  vm.runInContext(
    `this.__exports = {
      buildDayIntentProfile, buildItinerary, scorePOI, planDayStructure,
      pickCandidatesForSlot, evaluateDayPlan, scheduleStops, estimateSlotStartTimes,
      evaluatePacing, VIBE_PROFILES, OUTDOOR, haversineKm, isLikelyOpenAt,
      buildExplanation, explainStop, explainSummary, explainTradeOff, t, STRINGS,
      formatWalkPreview, nextOpeningTimeToday, stopConfidence, discoveryScore,
      DISCOVERY_CATEGORIES, UNIVERSALLY_EXCLUDED_CATEGORIES, CATEGORY_TAGS,
      estimateDailyCost, formatCostEstimate, buildOptionalTouches, formatOptionalTouch,
      normalizeEventAsCandidate, buildEventCandidates, EVENT_MAX_DISTANCE_KM,
      isSameComplex, isSameComplexAsAnyUsed, resolveOpeningHoursConflicts,
      explainPlan, MAX_REASONABLE_SHIFT_MIN,
      parseEventStartMinute, anchorEventTimes, computeStopDuration,
      deleteFirestoreDoc, deleteAllFirestoreDocs, deleteAllUserData, isSafeExternalUrl,
    };`,
    context
  );
  return context.__exports;
}

module.exports = { loadDecisionEngine, extractAppScript, INDEX_HTML_PATH };
