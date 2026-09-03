#!/usr/bin/env node
'use strict';
// Sprint 7 real-world acceptance pass. Runs the ACTUAL DayLoop pipeline
// (geocoding/reverse-geocoding, weather, Overpass, routing, events — the real
// public APIs, not offline fixtures) for five real-world scenarios, using the
// real, unmodified index.html logic. Analysis tooling only — it does not
// alter index.html; it extends the existing vm-based test harness with real
// network access (fetch/AbortController) instead of the offline stubs the
// rest of the suite intentionally uses.
//
// Run with: node tests/liveAcceptancePass.js
// Writes to: docs/product/sprint7-live-acceptance.md

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractAppScript, INDEX_HTML_PATH } = require('./loadDecisionEngine.js');

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'product', 'sprint7-live-acceptance.md');

function fakeElement(){
  return {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', disabled: false,
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, removeEventListener(){},
    appendChild(){}, closest(){ return null; }, querySelector(){ return null; },
    querySelectorAll(){ return []; }, focus(){}, blur(){}, scrollIntoView(){},
  };
}

function loadLiveEngine(){
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
    setTimeout, clearTimeout, fetch, AbortController,
    setStatus(){}, // generatePlanCore reports progress via this UI hook — a no-op here
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'index.html (live acceptance pass)' });
  vm.runInContext(
    `this.__exports = {
      generatePlanCore, buildFullPlan, buildExplanation, estimateDailyCost,
      formatCostEstimate, buildOptionalTouches, formatOptionalTouch, stopConfidence, t,
      reverseGeocodeCountry, explainPlan, eventsProxyConfigured,
    };`,
    context
  );
  return context.__exports;
}

function toMinutes(hhmm){ const [h,m] = hhmm.split(':').map(Number); return h*60+m; }
function localDateStr(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

const today = new Date();

// NOTE: Nominatim (geocoding) returns 403 Forbidden in this sandboxed
// environment (their usage policy requires a Referer/User-Agent a bare
// server-side script doesn't send the way a real browser does — a known
// limitation documented since CONCEPT.md and confirmed again this sprint).
// City input uses real coordinates directly — a genuine, already-supported
// production input path (generatePlanCore's coordinate-regex branch, the
// same one the UI's own placeholder text advertises). This exercises the
// real weather/Overpass/OSRM/events pipeline in full; only the forward-
// geocoding step is bypassed. `cityName` records which real city each
// coordinate is for.
const SCENARIOS = [
  { label: 'Istanbul — Romantic couple — medium budget — 15:00–23:00',
    city: '41.0082,28.9784', cityName: 'Istanbul, Turkey', vibe: 'romantic', group: 'couple', budget: 2,
    dateStr: localDateStr(today), start: '15:00', end: '23:00' },
  { label: 'London — Chill solo — low budget — 10:00–17:00',
    city: '51.5074,-0.1278', cityName: 'London, UK', vibe: 'chill', group: 'solo', budget: 1,
    dateStr: localDateStr(today), start: '10:00', end: '17:00' },
  { label: 'Paris — Creative couple — medium budget — 10:00–18:00',
    city: '48.8566,2.3522', cityName: 'Paris, France', vibe: 'creative', group: 'couple', budget: 2,
    dateStr: localDateStr(today), start: '10:00', end: '18:00' },
  { label: 'Barcelona — Adventurous friends — medium budget — 10:00–20:00',
    city: '41.3851,2.1734', cityName: 'Barcelona, Spain', vibe: 'adventurous', group: 'friends', budget: 2,
    dateStr: localDateStr(today), start: '10:00', end: '20:00' },
  { label: 'Lisbon — Budget solo — low budget — 10:00–18:00',
    city: '38.7223,-9.1393', cityName: 'Lisbon, Portugal', vibe: 'budget', group: 'solo', budget: 1,
    dateStr: localDateStr(today), start: '10:00', end: '18:00' },
];

function fmtStop(s, i){
  const dur = s.end - s.start;
  const dist = s.distFromPrev != null ? s.distFromPrev.toFixed(2)+'km' : '(first stop)';
  const h1 = String(Math.floor(s.start/60)).padStart(2,'0'), m1 = String(s.start%60).padStart(2,'0');
  const h2 = String(Math.floor(s.end/60)).padStart(2,'0'), m2 = String(s.end%60).padStart(2,'0');
  const adj = s.scheduleAdjustedForHours ? ' ⏱️shifted-for-hours' : '';
  return `${i+1}. **${s.poi.tags.name || '(unnamed)'}** (${s.poi.category}${s.poi.category==='event'?', EVENT':''}) — ${h1}:${m1}–${h2}:${m2}, tier: \`${s.tierUsed}\`, ${dur}min, ${dist} from previous${adj}`;
}

async function runScenario(eng, scenario){
  const startMin = toMinutes(scenario.start), endMin = toMinutes(scenario.end);
  const { center, weather, pois, placesDegraded } = await eng.generatePlanCore(scenario.city, scenario.dateStr, startMin, endMin);
  // Coordinate input bypasses forward geocoding entirely — generatePlanCore
  // already attempts a best-effort reverse-geocode for real country context
  // (Phase 8); re-confirm it here explicitly for the report.
  const countryCode = center.countryCode || await eng.reverseGeocodeCountry(center.lat, center.lon).catch(()=>null);
  const plan = await eng.buildFullPlan(pois, center, weather, scenario.dateStr, startMin, endMin, scenario.vibe, scenario.group, scenario.budget);
  if(!plan) return { scenario, center, weather, poisCount: pois.length, placesDegraded, countryCode, plan: null };
  const explanation = eng.buildExplanation({ stops: plan.stops, profile: plan.dayIntentProfile, dayTrace: plan.dayTrace, weather, dateStr: scenario.dateStr });
  const planReasons = eng.explainPlan(plan.dayIntentProfile, plan.dayTrace, plan.stops, weather);
  const cost = eng.estimateDailyCost(plan.stops, scenario.budget, { ...center, countryCode });
  const fmtCost = eng.formatCostEstimate(cost);
  const touches = eng.buildOptionalTouches(plan.stops, pois, center);
  const eventStops = plan.stops.filter(s => s.poi.category === 'event');
  return { scenario, center, weather, poisCount: pois.length, placesDegraded, countryCode, plan, explanation, planReasons, fmtCost, touches, eventStops, eng };
}

async function main(){
  const eng = loadLiveEngine();
  let out = `# Sprint 7 — Live Real-World Acceptance Pass\n\nGenerated by \`tests/liveAcceptancePass.js\` against the REAL public APIs (Nominatim reverse-geocode, Open-Meteo, Overpass, OSRM, and the events proxy if configured) — not offline fixtures. Events proxy configured in this run: **${eng.eventsProxyConfigured()}**.\n\n---\n\n`;

  for(const scenario of SCENARIOS){
    console.error(`Running: ${scenario.label} ...`);
    out += `## ${scenario.label}\n\n`;
    try{
      const result = await runScenario(eng, scenario);
      const { center, weather, poisCount, placesDegraded, countryCode, plan } = result;
      out += `- Resolved location: **${center.label || `${center.lat},${center.lon}`}** (${scenario.cityName})\n`;
      out += `- Country code resolved: **${countryCode || '(unknown)'}**\n`;
      out += `- Weather: ${weather.avgTemp}°C, code ${weather.code} (${weather.codeKey}), indoorBias=${weather.indoorBias}\n`;
      out += `- Places fetched nearby: ${poisCount}${placesDegraded ? ' (⚠️ degraded — reused a cached nearby fetch)' : ''}\n\n`;
      if(!plan){
        out += `**NO PLAN GENERATED** — buildFullPlan returned null (no viable stops even after every relaxation).\n\n---\n\n`;
        continue;
      }
      out += `**Stops (${plan.stops.length}):**\n${plan.stops.map(fmtStop).join('\n')}\n\n`;
      out += `**Opening-hours states:**\n${plan.stops.map((s,i)=>`${i+1}. ${eng.stopConfidence(s.poi, scenario.dateStr, s.start).label}`).join('\n')}\n\n`;
      out += `**Event(s) selected:** ${result.eventStops.length ? result.eventStops.map(s=>`${s.poi.tags.name} (${s.poi.eventMeta.startDate} ${s.poi.eventMeta.startTime||''})`).join(', ') : '(none)'}\n\n`;
      out += `**Explanations:**\n${result.explanation.stopReasons.map((r,i)=>`${i+1}. ${r}`).join('\n')}\n\n`;
      out += `**Summary:** ${result.explanation.summary}\n**Trade-off note:** ${result.explanation.tradeOffNote || '(none)'}\n\n`;
      out += `**Why this day:**\n${result.planReasons.length ? result.planReasons.map(r=>`- ${r}`).join('\n') : '(no additional whole-day facts applied)'}\n\n`;
      out += `**Cost estimate:** ${result.fmtCost.total}${result.fmtCost.food ? ` (Food: ${result.fmtCost.food}, Coffee: ${result.fmtCost.coffee}, Activities: ${result.fmtCost.activities})` : ''}${result.fmtCost.event ? ` · Event: ${result.fmtCost.event}` : ''}\n\n`;
      out += `**Optional touches:**\n${result.touches.length ? result.touches.map(t=>`- ${eng.formatOptionalTouch(t)}`).join('\n') : '(none)'}\n\n`;
      out += `**Route:** ${plan.routeGeometry ? 'live OSRM route' : 'straight-line estimate (OSRM unavailable)'}, total ${plan.totalWalkKm.toFixed(1)}km / ${Math.round(plan.totalWalkMin)}min walking\n\n`;
    }catch(e){
      out += `**FAILED:** ${e.message}\n\n`;
      console.error(`  FAILED: ${e.message}`);
    }
    out += `---\n\n`;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, out);
  console.error(`Wrote live acceptance pass to ${OUTPUT_PATH}`);
}

main().catch(e => { console.error('FATAL:', e); process.exitCode = 1; });
