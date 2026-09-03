# Manual owner actions — Sprint 1 security hardening

This checklist covers everything from Sprint 1 that **cannot be done from
code in this repository** — dashboard configuration, credential rotation, and
account-level settings. Nothing in this document was applied automatically.
No actual secret values are included anywhere below.

Work through these roughly in order — A/B/C are the highest priority.

---

## A. Verify/rotate the historically exposed Ticketmaster Consumer Key

A real Ticketmaster Consumer Key was committed in cleartext to this
**public** repository (commit `9c1cdf3`, 2026-07-14; removed in `98cbc78`,
2026-07-15). Because the repo is public, that key is permanently visible in
git history regardless of the fact that it's gone from the current file.

1. Log in to <https://developer.ticketmaster.com>.
2. Open the app/key that was used for DayLoop.
3. **Regenerate/rotate the Consumer Key** (or delete the old app and create a
   new one, if regeneration isn't offered).
4. Put the **new** key into the Worker as a secret — never into any file in
   this repo:
   ```sh
   cd worker
   npx wrangler secret put TICKETMASTER_API_KEY
   ```
   (paste the new key when prompted; it's stored by Cloudflare, not written
   to any local file).
5. Confirm the old key no longer works (a request using it should now fail).

---

## B. Investigate the unidentified historical Google API key

GitHub's own Secret Scanning has an **open** alert for a Google API key
value that is **different from** the current `firebaseConfig.apiKey` in
`index.html` — found only at the old `dayloop.html:1389` in history, not in
any currently tracked file.

1. Go to **github.com/DilaraDamla/dayloop → Security → Secret scanning
   alerts** and open alert #1 to see the exact value and commit.
2. Identify which Google Cloud project/API this key belongs to (Google Cloud
   Console → APIs & Services → Credentials, search by key prefix).
3. If it's still active:
   - If it's unrelated to DayLoop or no longer needed, **delete** it.
   - If it's still needed for something, **regenerate** it and apply the
     restrictions in section E below.
4. Once resolved, mark the GitHub Secret Scanning alert as resolved with an
   accurate reason (Security → Secret scanning alerts → alert → Resolve).

---

## C. Verify Firebase/Firestore rules in the Firebase Console

`firestore.rules` in this repo was hardened in Sprint 1 (per-user isolation
preserved, plus field/type/size validation added), but **rules in this repo
are never live until manually deployed.**

**First, check what's actually live right now** (before deploying anything):
1. Firebase Console → your project → Firestore Database → **Rules** tab.
2. Read what's currently deployed. If it's the default "test mode" rule
   (`allow read, write: if true` with an expiry) or a locked default-deny
   rule, real user data may currently be either fully exposed or the app may
   currently be failing to save anything — worth knowing either way before
   changing anything.

**To deploy the hardened rules from this repo:**

Option 1 — Firebase CLI (repeatable, reviewable):
```sh
npm install -g firebase-tools    # if not already installed
firebase login
firebase use <your-project-id>   # e.g. dayloop-v2
firebase deploy --only firestore:rules
```
The CLI validates the rules file before applying — a syntax error is
reported and nothing is changed. (I could not fully exercise this exact
command in this sandboxed environment — the Firestore emulator's dependency
requires Java 21+, and only Java 8 is available here — so please treat this
deploy step itself as the real first syntax check, and watch the CLI output
for errors.)

Option 2 — Console (no CLI needed):
1. Firebase Console → Firestore Database → Rules tab.
2. Paste the full contents of `firestore.rules` from this repo.
3. Use the **Rules Playground** (button near the editor) to simulate a few
   requests before publishing:
   - A user reading `users/{their-own-uid}/plans/{id}` while authenticated
     as that uid → should **allow**.
   - The same request authenticated as a **different** uid → should **deny**.
   - The same request **unauthenticated** → should **deny**.
   - A write to `users/{uid}/plans/{id}` with an extra unexpected field, or
     a `stops` array of 50+ items → should **deny** (new Sprint 1 validation).
   - A shared-plan feature check (new `sharedPlans/{shareId}` collection —
     invite-friends): reading `sharedPlans/{any-id}` while authenticated as
     ANY signed-in user (not just the owner/a participant) → should
     **allow** (this collection is intentionally readable by anyone with
     the link, not just existing participants — see the comment above
     `match /sharedPlans/{shareId}` in `firestore.rules` for why). The same
     read **unauthenticated** → should **deny**. Creating
     `sharedPlans/{id}/participants/{their-own-uid}` while authenticated as
     that uid → should **allow**; the same create attempted for a
     **different** uid (impersonating another participant) → should
     **deny**. Updating an existing `sharedPlans/{id}` document while
     authenticated as a uid that is **not** that document's `ownerId` →
     should **deny**.
4. Click **Publish**.

**After deploying**, re-run the Rules Playground checks above once more
against the live rules to confirm they took effect as expected.

---

## D. Review Firebase Email Enumeration Protection

Firebase projects have a setting that changes how sign-in errors behave at
the Firebase Auth API level itself (independent of the client-side wording
fix already made in `index.html` this sprint).

1. Firebase Console → Authentication → Settings → **User account
   linking**/**Email enumeration protection** (exact location varies by
   console version — search "enumeration" in the console's settings search
   if not visible directly).
2. If it's **off**, consider turning it **on** — this makes Firebase Auth's
   own API return a single generic `auth/invalid-credential` error for both
   "wrong password" and "no such account," which is a stronger guarantee
   than the client-side message-mapping fix alone (that fix only controls
   what's *displayed*; this controls what Firebase Auth *returns* in the
   first place).
3. Note: enabling it can change error codes your client code expects —
   `AUTH_ERROR_KEYS` in `index.html` already maps `auth/invalid-credential`
   to the same generic message as `auth/wrong-password`/`auth/user-not-found`,
   so this should be compatible without further code changes, but re-test
   sign-in with a wrong password and a nonexistent email after toggling it.

---

## E. Apply Google API-key restrictions

The current `firebaseConfig.apiKey` in `index.html` is meant to be
client-visible by Firebase's own design (it identifies the project, it isn't
a secret by itself) — **do not** try to hide or remove it, that would break
the app for every visitor. The real hardening available here is *restricting
what that key can be used for*, independent of it being public:

1. Google Cloud Console → APIs & Services → Credentials.
2. Find the API key matching `firebaseConfig.apiKey` (the value currently in
   `index.html` — not printed again here).
3. Under **Application restrictions**, set **HTTP referrers** and add:
   - `https://dilaradamla.github.io/*`
   - `http://localhost/*` and `http://127.0.0.1/*` (for local dev)
4. Under **API restrictions**, restrict the key to only the APIs DayLoop
   actually uses (Identity Toolkit API, Token Service API, Cloud Firestore
   API) — not "don't restrict."
5. Save, then **immediately re-test sign-in and Firestore read/write** on
   the live site — an overly narrow restriction can break auth silently.
6. Repeat steps 2–5 for whatever key you find/rotate in section B, once you
   know what it's actually for.

---

## F. Configure GitHub security settings

None of these were changed automatically. Current status, verified via the
GitHub API in this sprint:

| Setting | Current status | Action |
|---|---|---|
| Branch protection on `master` | **Not protected** (confirmed: `404` from the branch-protection API) | Settings → Branches → Add branch protection rule → branch name pattern `master` |
| Require a pull request before merging | N/A (no protection rule exists yet) | In the same rule: check "Require a pull request before merging" |
| Block force pushes | N/A | In the same rule: check "Do not allow force pushes" (and consider "Do not allow deletions") |
| Dependabot alerts | **Disabled** (confirmed: API returned "Dependabot alerts are disabled for this repository") | Settings → Code security → enable "Dependabot alerts" and "Dependabot security updates" |
| Vulnerability alerts | **Disabled** (confirmed: API returned "Vulnerability alerts are disabled") | Same page as above — this is usually the same toggle as Dependabot alerts |
| Secret scanning | **Enabled** (confirmed via API) | No action — already on |
| Push protection (secret scanning) | **Enabled** (confirmed via API) | No action — already on; this blocks *new* secrets from being pushed, it does not retroactively fix history (see A/B above) |

Steps for the branch protection rule specifically:
1. GitHub repo → Settings → Branches.
2. **Add branch protection rule** → Branch name pattern: `master`.
3. Enable: "Require a pull request before merging", "Do not allow force
   pushes", and optionally "Require status checks to pass" once/if any CI is
   added later.
4. Save.

---

## G. Configure real Cloudflare Worker rate limiting

The Worker (`worker/src/index.js`) was hardened this sprint with strict
input validation, a fixed/non-client-controlled result size and radius
ladder, an explicit upstream fetch timeout, and its existing edge cache — but
it still has **no real per-caller rate limit**, and none was faked in code
(an in-memory counter in a Cloudflare Worker isolate is not reliable across
the edge network and would give a false sense of protection — see the
comment block at the top of `worker/src/index.js`). This requires an actual
infrastructure decision outside this repo:

**Option 1 — Cloudflare Rate Limiting Rules (recommended, no code change):**
1. This currently runs on the free `*.workers.dev` subdomain. Rate Limiting
   Rules require the Worker to be routed through a zone you control (i.e.
   a custom domain on Cloudflare, e.g. `events.dayloop.app` pointed at this
   Worker via a Worker Route).
2. Once on a zone: Cloudflare dashboard → your zone → Security → **Rate
   limiting rules** → Create rule.
3. Suggested starting point: match requests to `/events`, threshold e.g. 30
   requests per minute per IP, action: Block (or "Managed Challenge" if you
   want to allow retries rather than hard-block).
4. This requires no change to `worker/src/index.js` at all.

**Option 2 — Durable Object token bucket (code change, more control):**
- A Durable Object gives a single, consistent, strongly-consistent counter
  per key (e.g. per IP or per API key) that Option 1's dashboard rules can't
  express as precisely (e.g. different limits for different query shapes).
- This is a real code addition (a new Durable Object class, a binding in
  `wrangler.toml`, and a lookup/increment call in `handleEvents`) — sized
  right for a **follow-up** sprint, not bundled into this one to keep this
  sprint's diff to genuinely-necessary security fixes.

**Option 3 — KV-based sliding window (simpler than a Durable Object, weaker
consistency):**
- Cheaper and simpler than Option 2, but KV is eventually consistent, so a
  burst across multiple edge locations can briefly exceed the intended
  limit. Fine as a coarse guard, not a hard guarantee.

Start with Option 1 — it's a dashboard-only change, requires no code
review, and covers the realistic abuse case (a script hammering `/events`)
well enough for a pre-monetization stage.
