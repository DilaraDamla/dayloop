'use strict';
// Regression coverage for the 2026-09-23 security review: link spoofing via
// Instagram tags, malformed shared-plan tags, shared plans left behind after
// account deletion, and the third-party CORS proxy on the real site.
// Run with: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();
// Objects built inside the vm sandbox have that realm's prototypes; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('an "Instagram" link only ever points at instagram.com', () => {
  assert.equal(eng.placeInstagram({ 'contact:instagram': 'https://evil.example/login' }), null);
  assert.equal(eng.placeInstagram({ 'contact:instagram': 'https://instagram.com.evil.example/x' }), null);
  assert.equal(eng.placeInstagram({ 'contact:instagram': 'javascript:alert(1)' }), null);
  assert.equal(eng.placeInstagram({ 'contact:instagram': 'https://www.instagram.com/mobydick/' }), 'https://www.instagram.com/mobydick/');
  assert.equal(eng.placeInstagram({ instagram: '@moby.dick_kitap' }), 'https://instagram.com/moby.dick_kitap');
  assert.equal(eng.placeInstagram({ instagram: 'evil.example/phish?x=' }), null, 'a handle can never smuggle a path');
  assert.equal(eng.placeInstagram({ instagram: { toString(){ return 'x'; } } }), null, 'non-string tag values are ignored');
});

test('shared-plan tags keep only short string values', () => {
  const tags = eng.sanitizeSharedPlanTags({ name: 'Cafe', opening_hours: { evil: true }, website: ['a'], note: 'x'.repeat(2000) });
  assert.deepEqual(Object.keys(tags).sort(), ['name', 'note']);
  assert.equal(tags.note.length, 500);
  assert.deepEqual(plain(eng.sanitizeSharedPlanTags(['a'])), {});
  assert.deepEqual(plain(eng.sanitizeSharedPlanTags(null)), {});
  const stop = eng.sanitizeSharedPlanStop({ poi: { lat: 1, lon: 2, category: 'cafe', tags: { name: 'A', opening_hours: 42 } } });
  assert.deepEqual(plain(stop.poi.tags), { name: 'A' });
});

function makeSharedDb({ owned = [], failIds = [] } = {}){
  const calls = [];
  const docRef = (id) => ({
    id,
    collection: (sub) => ({ doc: (pid) => ({ delete: async () => { calls.push(['delete', `${id}/${sub}/${pid}`]); } }) }),
    delete: async () => { if(failIds.includes(id)) throw new Error('denied'); calls.push(['delete', id]); },
  });
  return {
    calls,
    collection: (name) => ({
      where: (field, op, value) => ({
        get: async () => { calls.push(['query', name, field, op, value]); return { docs: owned.map(id => ({ ref: docRef(id) })) }; },
      }),
    }),
  };
}

test('account deletion removes the shared plans the user owns, via an ownerId-scoped query', async () => {
  const db = makeSharedDb({ owned: ['s1', 's2'] });
  const result = await eng.deleteOwnedSharedPlans(db, 'user-A');
  assert.deepEqual(plain(result), { attempted: true, ok: true });
  assert.deepEqual(db.calls[0], ['query', 'sharedPlans', 'ownerId', '==', 'user-A']);
  const deleted = db.calls.filter(c => c[0] === 'delete').map(c => c[1]).sort();
  assert.deepEqual(deleted, ['s1', 's1/participants/user-A', 's2', 's2/participants/user-A']);
});

test('shared-plan cleanup never reports success when a delete fails', async () => {
  const db = makeSharedDb({ owned: ['s1', 's2'], failIds: ['s2'] });
  const result = await eng.deleteOwnedSharedPlans(db, 'user-A');
  assert.equal(result.ok, false);
});

test('shared-plan cleanup is a no-op when signed out', async () => {
  assert.deepEqual(plain(await eng.deleteOwnedSharedPlans(null, null)), { attempted: false, ok: true });
});

test('on the real site, a total Overpass outage never falls back to the third-party CORS proxy', async () => {
  const ctx = eng.__context;
  const urls = [];
  const prevFetch = ctx.fetch, prevLocation = ctx.location;
  ctx.fetch = async (url) => { urls.push(String(url)); throw new TypeError('network down'); };
  ctx.location = { protocol: 'https:' };
  try{
    await assert.rejects(eng.queryOverpass('[out:json];node(1);out;', () => {}), /Places lookup failed/);
  } finally {
    ctx.fetch = prevFetch; ctx.location = prevLocation;
  }
  assert.ok(urls.length > 0, 'the mirrors were tried');
  assert.ok(!urls.some(u => u.includes('allorigins')), 'no request may reach the CORS proxy');
});
