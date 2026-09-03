'use strict';
// Sprint 1 security hardening — regression tests. Run with: node --test tests/
//
// Covers the honest-cloud-deletion helpers (deleteFirestoreDoc /
// deleteAllFirestoreDocs) and the URL-scheme allowlist used to sanitize every
// externally-sourced href before it's rendered. Auth-flow and DOM/rendering
// changes are UI-wiring code (defined after the boundary this harness stops
// at by design — see loadDecisionEngine.js) and are covered by manual
// testing instead; see the final report for what was verified there.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();

// ---------------------------------------------------------------------------
// deleteFirestoreDoc / deleteAllFirestoreDocs
// ---------------------------------------------------------------------------

function makeFakeDb({ failDocIds = [], seedDocs = {} } = {}){
  const calls = [];
  return {
    calls,
    collection(name){
      return {
        doc(uid){
          calls.push({ level:'user', collection:name, uid });
          return {
            collection(sub){
              return {
                doc(docId){
                  calls.push({ level:'doc', sub, docId });
                  return {
                    delete(){
                      if(failDocIds.includes(docId)) return Promise.reject(new Error('permission-denied'));
                      return Promise.resolve();
                    },
                  };
                },
                get(){
                  calls.push({ level:'query', sub });
                  const ids = seedDocs[sub] || [];
                  return Promise.resolve({ docs: ids.map(id => ({ id })) });
                },
              };
            },
          };
        },
      };
    },
  };
}

test('deleteFirestoreDoc is a safe no-op when signed out (no db) — never throws, never claims a cloud delete happened', async () => {
  const result = await eng.deleteFirestoreDoc(null, null, 'wishlist', 'some-key');
  assert.equal(result.attempted, false);
  assert.equal(result.ok, true);
});

test('deleteFirestoreDoc is a safe no-op when db exists but uid is missing (signed-out edge case)', async () => {
  const db = makeFakeDb();
  const result = await eng.deleteFirestoreDoc(db, null, 'wishlist', 'some-key');
  assert.equal(result.attempted, false);
  assert.equal(db.calls.length, 0, 'no Firestore call should be made without a real uid');
});

test('deleteFirestoreDoc scopes strictly to the uid it was given — never a different user', async () => {
  const db = makeFakeDb();
  await eng.deleteFirestoreDoc(db, 'user-A-uid', 'plans', '12345');
  const userCall = db.calls.find(c => c.level === 'user');
  assert.equal(userCall.uid, 'user-A-uid', 'the Firestore path must be scoped to exactly the uid passed in');
  assert.notEqual(userCall.uid, 'user-B-uid');
});

test('deleteFirestoreDoc reports ok:true after a genuine successful delete', async () => {
  const db = makeFakeDb();
  const result = await eng.deleteFirestoreDoc(db, 'user-A-uid', 'wishlist', 'key-1');
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
});

test('deleteFirestoreDoc reports ok:false (never ok:true) when the cloud delete actually fails', async () => {
  const db = makeFakeDb({ failDocIds: ['key-1'] });
  const result = await eng.deleteFirestoreDoc(db, 'user-A-uid', 'wishlist', 'key-1');
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false, 'a failed cloud delete must never be reported as ok — the caller must not tell the user it succeeded');
});

test('deleteAllFirestoreDocs deletes every id and reports ok:true when all succeed', async () => {
  const db = makeFakeDb();
  const result = await eng.deleteAllFirestoreDocs(db, 'user-A-uid', 'plans', ['1','2','3']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failedIds, []);
  const docCalls = db.calls.filter(c => c.level === 'doc').map(c => c.docId);
  assert.deepEqual(docCalls.sort(), ['1','2','3']);
});

test('deleteAllFirestoreDocs still attempts every id even if one fails, and reports exactly which ones failed', async () => {
  const db = makeFakeDb({ failDocIds: ['2'] });
  const result = await eng.deleteAllFirestoreDocs(db, 'user-A-uid', 'plans', ['1','2','3']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedIds, ['2']);
  const docCalls = db.calls.filter(c => c.level === 'doc').map(c => c.docId);
  assert.deepEqual(docCalls.sort(), ['1','2','3'], 'a failure on one id must not stop the others from being attempted');
});

test('deleteAllFirestoreDocs is a safe no-op when signed out, regardless of how many local ids exist', async () => {
  const result = await eng.deleteAllFirestoreDocs(null, null, 'plans', ['1','2','3']);
  assert.equal(result.attempted, false);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// deleteAllUserData (account-deletion data cleanup)
// ---------------------------------------------------------------------------

test('deleteAllUserData queries and deletes BOTH plans and wishlist from Firestore directly, not from a locally-cached list', async () => {
  const db = makeFakeDb({ seedDocs: { plans: ['p1','p2'], wishlist: ['w1'] } });
  const result = await eng.deleteAllUserData(db, 'user-A-uid');
  assert.equal(result.ok, true);
  const queried = db.calls.filter(c => c.level === 'query').map(c => c.sub).sort();
  assert.deepEqual(queried, ['plans','wishlist']);
  const deleted = db.calls.filter(c => c.level === 'doc').map(c => c.docId).sort();
  assert.deepEqual(deleted, ['p1','p2','w1']);
});

test('deleteAllUserData reports ok:false (never ok:true) if any document anywhere fails to delete', async () => {
  const db = makeFakeDb({ seedDocs: { plans: ['p1'], wishlist: ['w1'] }, failDocIds: ['w1'] });
  const result = await eng.deleteAllUserData(db, 'user-A-uid');
  assert.equal(result.ok, false, 'a partial failure must never be reported as a clean success');
});

test('deleteAllUserData is a safe no-op when signed out', async () => {
  const result = await eng.deleteAllUserData(null, null);
  assert.equal(result.attempted, false);
  assert.equal(result.ok, true);
});

test('deleteAllUserData never queries or deletes anything outside the uid it was given', async () => {
  const db = makeFakeDb({ seedDocs: { plans: ['p1'], wishlist: [] } });
  await eng.deleteAllUserData(db, 'user-A-uid');
  const userCalls = db.calls.filter(c => c.level === 'user');
  assert.ok(userCalls.every(c => c.uid === 'user-A-uid'), 'every Firestore path touched must be scoped to exactly the uid passed in');
});

// ---------------------------------------------------------------------------
// External link scheme allowlist (see isSafeExternalUrl in index.html)
// ---------------------------------------------------------------------------

test('isSafeExternalUrl accepts ordinary https and http URLs', () => {
  assert.equal(eng.isSafeExternalUrl('https://example.com/tickets'), true);
  assert.equal(eng.isSafeExternalUrl('http://example.com'), true);
});

test('isSafeExternalUrl rejects javascript: URLs, including whitespace/case obfuscation attempts', () => {
  assert.equal(eng.isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(eng.isSafeExternalUrl('JavaScript:alert(1)'), false);
  assert.equal(eng.isSafeExternalUrl(' \n\tjavascript:alert(1)'), false);
});

test('isSafeExternalUrl rejects data:, vbscript:, and other non-http(s) schemes', () => {
  assert.equal(eng.isSafeExternalUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(eng.isSafeExternalUrl('vbscript:msgbox(1)'), false);
  assert.equal(eng.isSafeExternalUrl('file:///etc/passwd'), false);
});

test('isSafeExternalUrl rejects missing, empty, or unparseable values without throwing', () => {
  assert.equal(eng.isSafeExternalUrl(null), false);
  assert.equal(eng.isSafeExternalUrl(''), false);
  assert.equal(eng.isSafeExternalUrl('not a url at all'), false);
});
