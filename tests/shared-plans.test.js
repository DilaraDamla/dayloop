'use strict';
// Regression tests for the shared/collaborative plans feature (invite
// friends to a generated plan — see buildSharedPlanDoc/buildParticipantEntry/
// formatParticipantsSummary in index.html, and sharedPlans/{shareId} in
// firestore.rules). Firestore rules themselves can't be exercised here (the
// emulator needs Java 21+; only Java 8 is available in this environment —
// same documented gap as the plans/wishlist rules) so this file leans on a
// static cross-check instead: the exact field set these JS functions produce
// must match what firestore.rules' isValidSharedPlan/isValidParticipant
// actually accept, or a real write would be silently rejected in production
// with no test ever catching it.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const rulesSource = fs.readFileSync(RULES_PATH, 'utf8');

function extractHasOnlyKeys(functionName){
  const fnMatch = rulesSource.match(new RegExp(`function ${functionName}\\(data\\) \\{[\\s\\S]*?\\n    \\}`));
  if(!fnMatch) throw new Error(`could not find function ${functionName} in firestore.rules`);
  const keysMatch = fnMatch[0].match(/hasOnly\(\[([^\]]*)\]\)/);
  if(!keysMatch) throw new Error(`could not find hasOnly([...]) inside ${functionName}`);
  return keysMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
}

function samplePlan(){
  return {
    dateStr: '2026-09-05', startMin: 600, endMin: 1200,
    vibe: 'chill', group: 'solo', budget: 2,
    center: { lat: 41.0, lon: 29.0, label: 'Istanbul' },
    weather: { avgTemp: 20, codeKey: 'clear' },
    stops: [
      { poi: { lat: 41.01, lon: 29.01, category: 'cafe', tags: { name: 'Cafe A' } }, start: 600, end: 645, candidates: ['internal-ranking-state'], altIndex: 2 },
    ],
    totalWalkKm: 1.2, totalWalkMin: 15,
    routeGeometry: [[41.0,29.0],[41.01,29.01]],
  };
}

test('buildSharedPlanDoc produces exactly the field set firestore.rules\' isValidSharedPlan accepts', () => {
  const doc = eng.buildSharedPlanDoc(samplePlan(), 'owner-uid-123', 'Dilara');
  const producedKeys = Object.keys(doc).sort();
  const allowedKeys = extractHasOnlyKeys('isValidSharedPlan').sort();
  assert.deepEqual(producedKeys, allowedKeys, 'buildSharedPlanDoc must produce exactly the keys firestore.rules allows — a mismatch means a real write would be silently rejected (missing key) or the rule would need updating (extra key)');
});

test('buildSharedPlanDoc strips internal ranking state (candidates/altIndex) from every stop', () => {
  const doc = eng.buildSharedPlanDoc(samplePlan(), 'owner-uid-123', 'Dilara');
  for(const stop of doc.stops){
    assert.equal('candidates' in stop, false, 'candidates is internal scoring state and must never reach Firestore');
    assert.equal('altIndex' in stop, false, 'altIndex is internal scoring state and must never reach Firestore');
  }
  assert.equal(doc.stops[0].poi.tags.name, 'Cafe A', 'the actual stop data must survive the strip');
});

test('buildSharedPlanDoc carries the real owner identity, never a guess', () => {
  const doc = eng.buildSharedPlanDoc(samplePlan(), 'owner-uid-123', 'Dilara');
  assert.equal(doc.ownerId, 'owner-uid-123');
  assert.equal(doc.ownerName, 'Dilara');
  assert.equal(typeof doc.createdAt, 'number');
});

test('buildSharedPlanDoc falls back to an empty (never null/undefined) ownerName when none is available', () => {
  const doc = eng.buildSharedPlanDoc(samplePlan(), 'owner-uid-123', undefined);
  assert.equal(doc.ownerName, '', 'must stay a string — firestore.rules requires ownerName is string');
});

test('buildParticipantEntry produces exactly the field set firestore.rules\' isValidParticipant accepts', () => {
  const entry = eng.buildParticipantEntry('uid-1', 'Ada');
  const producedKeys = Object.keys(entry).sort();
  const allowedKeys = extractHasOnlyKeys('isValidParticipant').sort();
  assert.deepEqual(producedKeys, allowedKeys);
  assert.equal(entry.uid, 'uid-1');
  assert.equal(entry.displayName, 'Ada');
  assert.equal(typeof entry.joinedAt, 'number');
});

test('buildParticipantEntry never lets displayName be anything but a string (firestore.rules requires it)', () => {
  const entry = eng.buildParticipantEntry('uid-1', undefined);
  assert.equal(entry.displayName, '');
});

test('formatParticipantsSummary always lists the owner first, regardless of join order', () => {
  const participants = [
    { uid: 'friend-a', displayName: 'Friend A', joinedAt: 1000 },
    { uid: 'owner-uid', displayName: 'Owner', joinedAt: 5000 }, // joined last, must still be listed first
    { uid: 'friend-b', displayName: 'Friend B', joinedAt: 2000 },
  ];
  const names = eng.formatParticipantsSummary(participants, 'owner-uid');
  assert.deepEqual(names, ['Owner', 'Friend A', 'Friend B']);
});

test('formatParticipantsSummary orders non-owner participants by real join time, earliest first', () => {
  const participants = [
    { uid: 'owner-uid', displayName: 'Owner', joinedAt: 100 },
    { uid: 'friend-later', displayName: 'Later Friend', joinedAt: 9000 },
    { uid: 'friend-earlier', displayName: 'Earlier Friend', joinedAt: 500 },
  ];
  const names = eng.formatParticipantsSummary(participants, 'owner-uid');
  assert.deepEqual(names, ['Owner', 'Earlier Friend', 'Later Friend']);
});

test('formatParticipantsSummary returns null (not a guessed name) for a participant with no display name on file', () => {
  const participants = [{ uid: 'owner-uid', displayName: '', joinedAt: 100 }];
  const names = eng.formatParticipantsSummary(participants, 'owner-uid');
  assert.deepEqual(names, [null], 'the UI layer decides the "anonymous" fallback text — this function must never invent a name');
});

test('formatParticipantsSummary does not mutate the array it was given', () => {
  const participants = [
    { uid: 'b', displayName: 'B', joinedAt: 2 },
    { uid: 'a', displayName: 'A', joinedAt: 1 },
  ];
  const original = participants.map(p => p.uid);
  eng.formatParticipantsSummary(participants, 'owner-uid');
  assert.deepEqual(participants.map(p => p.uid), original);
});

test('every language defines the shared-plan UI strings used by render()', () => {
  const requiredKeys = [
    'invite_friends_btn', 'invite_link_copied', 'invite_signin_required', 'invite_create_failed',
    'shared_plan_view_note', 'shared_plan_not_found', 'shared_plan_load_failed',
    'who_is_coming_title', 'participant_anonymous',
    'join_plan_btn', 'joined_plan_label', 'joined_plan_toast',
    'leave_plan_btn', 'left_plan_toast', 'join_signin_required', 'join_failed', 'leave_failed',
  ];
  for(const lang of Object.keys(eng.STRINGS)){
    for(const key of requiredKeys){
      assert.ok(eng.STRINGS[lang][key], `${key} missing for "${lang}"`);
    }
  }
  assert.match(eng.STRINGS.en.shared_plan_view_note, /\{name\}/, 'shared_plan_view_note must interpolate the owner name');
});
