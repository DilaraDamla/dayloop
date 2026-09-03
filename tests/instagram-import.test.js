'use strict';
// Regression tests for the "import a place from Instagram" feature (share
// sheet + Wish List panel's paste field) — see extractPlaceCandidatesFromShare/
// extractInstagramUrlHints/humanizeSlug in index.html.
//
// Real-world finding: a user reported "it doesn't see the Instagram link"
// after pasting ONLY a bare post link (no caption) into the Wish List
// import field. Root cause: the old extractor stripped every URL
// unconditionally before looking for a place name, so a bare link left
// nothing to guess from at all — confirmed the user's exact input was just
// a plain https://instagram.com/p/... link, no caption.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisionEngine } = require('./loadDecisionEngine.js');

const eng = loadDecisionEngine();

// ---------------------------------------------------------------------------
// The real-world bug: a bare post/reel link alone still can't produce a
// name (nothing readable exists in a shortcode) — this must stay true, it's
// not fixable without a backend — but it must fail in a way the caller can
// detect and explain clearly, never crash, and never invent a name.
// ---------------------------------------------------------------------------

// Note: results from inside the vm sandbox are cross-realm Array objects, so
// comparisons below use .length/index checks rather than assert.deepEqual
// against a literal [] (which fails strict's realm/prototype check on an
// otherwise-identical empty array — not a real behavioral difference).
test('a bare Instagram post link with no caption yields NO candidates — there is genuinely nothing to read', () => {
  assert.equal(eng.extractPlaceCandidatesFromShare('https://www.instagram.com/p/C1a2B3d4E5f/', '').length, 0);
});

test('a bare Instagram reel link with no caption also yields no candidates', () => {
  assert.equal(eng.extractPlaceCandidatesFromShare('https://instagram.com/reel/C1a2B3d4E5f/', '').length, 0);
});

test('extractPlaceCandidatesFromShare never throws on a bare link, empty string, or garbage input', () => {
  assert.doesNotThrow(() => eng.extractPlaceCandidatesFromShare('https://www.instagram.com/p/xyz/', ''));
  assert.doesNotThrow(() => eng.extractPlaceCandidatesFromShare('', ''));
  assert.doesNotThrow(() => eng.extractPlaceCandidatesFromShare('   ', ''));
});

// ---------------------------------------------------------------------------
// The fix: two link shapes DO carry a real, literal signal and are now used
// ---------------------------------------------------------------------------

test('a location-tag link\'s slug becomes a real candidate (a genuine signal, not invented)', () => {
  const candidates = eng.extractPlaceCandidatesFromShare('https://www.instagram.com/explore/locations/213732610/karakoy-lokantasi/', '');
  assert.ok(candidates.includes('karakoy lokantasi'), `expected the humanized slug among candidates, got: ${JSON.stringify(candidates)}`);
});

test('a bare profile link\'s handle becomes a (weaker, but real) candidate', () => {
  const candidates = eng.extractPlaceCandidatesFromShare('https://www.instagram.com/karakoylokantasi/', '');
  assert.ok(candidates.includes('karakoylokantasi'));
});

test('a post link (not a bare profile link) never contributes its shortcode as a candidate — a shortcode is not a name', () => {
  const candidates = eng.extractPlaceCandidatesFromShare('Great food https://www.instagram.com/p/C1a2B3d4E5f/', '');
  assert.ok(!candidates.some(c => c.includes('C1a2B3d4E5f')), 'an opaque post shortcode must never be treated as a place-name guess');
});

test('reserved path segments (p, reel, tv, explore, stories, accounts, direct) are never mistaken for a profile handle', () => {
  for(const seg of ['p','reel','tv','explore','stories','accounts','direct']){
    const hints = eng.extractInstagramUrlHints(`https://www.instagram.com/${seg}/`);
    assert.equal(hints.length, 0, `"${seg}" is a reserved Instagram path, not a username, and must not be extracted`);
  }
});

test('URL-derived hints are tried before caption-text guesses', () => {
  const candidates = eng.extractPlaceCandidatesFromShare(
    'What a beautiful evening out\nhttps://www.instagram.com/explore/locations/1/nice-cafe/',
    ''
  );
  assert.equal(candidates[0], 'nice cafe', 'the location-tag slug is a more literal signal and should be tried first');
});

// ---------------------------------------------------------------------------
// humanizeSlug
// ---------------------------------------------------------------------------

test('humanizeSlug turns URL-slug punctuation into spaces', () => {
  assert.equal(eng.humanizeSlug('karakoy-lokantasi'), 'karakoy lokantasi');
  assert.equal(eng.humanizeSlug('cafe_del.mar'), 'cafe del mar');
});

// ---------------------------------------------------------------------------
// Existing caption-based extraction must be unaffected (regression guard)
// ---------------------------------------------------------------------------

test('a real caption with emoji, hashtags, and a trailing link still extracts the short name line first', () => {
  const caption = '📍 Karaköy Lokantası\nBest Turkish food in Istanbul, a must-visit 😍\nhttps://www.instagram.com/p/C1a2B3d4E5f/\n#istanbul #food #karakoy';
  const candidates = eng.extractPlaceCandidatesFromShare(caption, '');
  assert.equal(candidates[0], 'Karaköy Lokantası');
});

test('falls back to the title when no text/caption is provided at all', () => {
  const candidates = eng.extractPlaceCandidatesFromShare('', 'Some Place Name');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], 'Some Place Name');
});

test('every language defines the new bare-link guidance string', () => {
  for(const lang of Object.keys(eng.STRINGS)){
    assert.ok(eng.STRINGS[lang].share_import_bare_link, `share_import_bare_link missing for "${lang}"`);
  }
});
