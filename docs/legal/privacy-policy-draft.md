# DayLoop Privacy Policy (DRAFT)

**Status: DRAFT — not reviewed by a lawyer, not yet published anywhere in
the app.** This document describes, as accurately as possible, what the
DayLoop codebase actually does today (as of Sprint 1 security hardening). It
is a starting point for the site owner to review, edit, and get legal
confirmation on before publishing — not a finished legal document. Every
place marked **[OWNER/LEGAL TO CONFIRM]** needs a real decision from the
person who runs DayLoop, not an assumption made here.

This document makes **no claim of GDPR, CCPA, or any other legal compliance
regime** — that determination has not been made and requires actual legal
review, not a description of code behavior.

---

## What DayLoop is

DayLoop is a day-planning web app: you describe a city, date, and time
window, and it builds a walking itinerary using real map, weather, and
(optionally) live event data. It's a single static web page — there is no
DayLoop-operated backend server; where an account exists, it's provided by
Google's Firebase platform.

## Information DayLoop collects

### Account information (only if you choose to sign in)
Signing in is entirely optional — DayLoop works fully without an account,
saving plans and wish-listed places only in your browser's local storage.

If you do create an account:
- **Email/password sign-in**: your email address and password are sent
  directly to Firebase Authentication (a Google service) to create and
  verify your account. **DayLoop's own code never receives, stores, or logs
  your password anywhere** — not in its data, not in any file, not in
  browser storage. Firebase handles password storage and hashing entirely on
  its own infrastructure.
- **Google sign-in**: if you sign in with Google instead, DayLoop receives
  your Google account's email address and display name (via Firebase
  Authentication) but never your Google password.
- **Display name** (optional, email/password sign-up only): if you type a
  name when creating an account, it's stored as your Firebase Auth profile
  name and shown back to you in the app.

### Plan history (if signed in)
Each itinerary you generate is saved — locally always, and additionally
synced to a private, per-account Firestore database location if you're
signed in. A saved plan includes: the date and time window you requested,
your selected vibe/group/budget, the resolved city/coordinates, that day's
weather summary, every stop in the itinerary (name, category, coordinates,
scheduled time), total walking distance/time, and the walking route
geometry. Deleting a saved plan (individually or via "Clear all") removes it
from both local storage and, if signed in, your Firestore data — DayLoop
does not keep a copy anywhere else.

### Wish list (if signed in)
Places you save to your Wish List (from a generated itinerary, or imported
by pasting an Instagram caption/link) are stored the same way: locally
always, synced to your private Firestore location if signed in. Each entry
includes the place's name, category, city, address (if known), and
coordinates. Deletion works the same as plan history — local and cloud
copies are both removed.

### Shared plans (only if you use "Invite friends", requires sign-in)
This is the one place DayLoop stores data somewhere other than your own
private, per-account location. Tapping "Invite friends" on a generated plan
copies that exact itinerary (everything listed under "Plan history" above,
minus internal ranking data) into a new, separate Firestore document, along
with your display name and account ID as its owner. Anyone who is signed
into DayLoop **and has the link** — DayLoop does not publish, list, or make
shared plans discoverable any other way — can view that plan and add
themselves to its "who's coming" participant list (their display name and
account ID; that's the whole entry). Any participant, owner included, can
forward the same link to bring in further people; each of them can later
remove themselves via "Leave this plan." **[OWNER/LEGAL TO CONFIRM]** how
long a shared plan and its participant list are retained, and whether the
owner gets a way to delete a shared plan outright (today, only the owner's
Firebase Auth account is technically permitted to update/delete it in
Firestore Security Rules — no delete control exists yet in the app's UI).

### Location (only if you use "use my location")
If you tap the "use my location" control, your browser asks you for
permission (a standard browser prompt DayLoop does not control or bypass)
and, if you allow it, DayLoop receives your device's coordinates **once**,
to pre-fill the city field. This is not requested automatically, is not
tracked continuously, and is not stored separately from whatever plan you
go on to generate (see "Plan history" above).

### What DayLoop does **not** collect
DayLoop does not ask for or store: your phone number, physical mailing
address, payment information (no payment processing exists in the app
today), government ID, or any health/medical information. There is
currently no analytics or advertising tracking script of any kind in the
app.

## Third-party services DayLoop talks to

Because DayLoop has no backend server, your browser calls these services
**directly** to build a plan. Each request typically includes only the
specific coordinates/date/time you're planning for — not your account
identity (these calls happen the same way whether or not you're signed in):

| Service | What it's used for | What it receives |
|---|---|---|
| Nominatim (OpenStreetMap) | Turning a typed city name into coordinates | The text you typed |
| Overpass API (OpenStreetMap, multiple mirror servers) | Finding real nearby places (cafes, museums, parks, etc.) | Coordinates + search radius |
| Open-Meteo | Weather for your selected date | Coordinates + date |
| OSRM (routing.openstreetmap.de) | Calculating the walking route between stops | The stops' coordinates |
| Leaflet / OpenStreetMap tile servers | Drawing the map | Coordinates + zoom level (standard for any map tile request) |
| DayLoop's own Cloudflare Worker (`dayloop-events-proxy`) → Ticketmaster | Real event listings, if available for your destination | Coordinates + date/time window |
| Firebase Authentication / Firestore (Google) | Account sign-in and, if signed in, saved-plan/wish-list sync | Your account credentials (handled by Firebase, not DayLoop) and the plan/wish-list data described above |

**[OWNER/LEGAL TO CONFIRM]** Each of these third parties has its own privacy
policy governing what it does with requests it receives directly from your
browser; DayLoop does not control that and this document does not attempt
to describe those companies' own practices.

## Data deletion

- **Local data** (device-only, works whether or not you're signed in): the
  in-app "Clear all" (history) and per-item delete controls remove data
  immediately from your browser.
- **Cloud data** (signed-in users only): the same delete controls also
  remove the matching Firestore document(s). If a cloud deletion fails (for
  example, no network connection), DayLoop tells you honestly that the cloud
  copy may not have been removed — it never claims a cloud deletion
  succeeded when it didn't.
- **Account deletion**: signed-in users can delete their account from the
  account panel. This deletes all of that account's Firestore plan and
  wish-list documents, then deletes the Firebase Authentication account
  itself. Firebase may require you to re-confirm your identity (re-entering
  your password, or a fresh Google sign-in) before allowing this, which is a
  Firebase security requirement, not a DayLoop choice.

## Security limitations (stated plainly, not as marketing)

- DayLoop is a single-page static web app with no backend server of its
  own — most of its logic runs in your browser and is publicly viewable by
  design (standard for any client-side web app), the same way any website's
  HTML/CSS/JavaScript is visible to anyone who looks.
- Data you save while signed in is protected by Firestore Security Rules
  (server-side access control enforced by Google's infrastructure, scoped so
  only your own signed-in account can read or write your own data) — **this
  depends on those rules being correctly deployed**; see
  `docs/security/manual-owner-actions.md` (section C) for the owner's
  verification checklist.
- DayLoop has undergone an internal security review (Sprint 1, this
  sprint) but **has not undergone an independent third-party security audit
  or penetration test**. **[OWNER TO CONFIRM]** whether/when one is planned
  before this claim can be strengthened.

## Your rights

**[OWNER/LEGAL TO CONFIRM — this section needs real legal input before
publishing.]** Depending on where you live, you may have rights over your
personal data (for example, access, correction, deletion, or portability).
Today, DayLoop supports self-service deletion of your saved plans, wish
list, and account (see "Data deletion" above) directly in the app. For
anything else, contact: **[OWNER TO FILL IN — support/contact email]**.

## Changes to this policy

**[OWNER TO CONFIRM]** how updates to this policy will be communicated to
users (e.g., an updated date at the top of a published version, an in-app
notice, or email to account holders).

---

## Internal note: future Taste Profile / preference-learning data (not built yet)

No Taste Profile, psychological onboarding, or behavioral-profiling feature
exists in DayLoop today — this note is forward-looking guidance for
whoever builds one, not a description of current behavior, and should be
deleted from any published policy until that feature actually ships (at
which point this whole document needs a real update, not just this note).

When that feature is designed: preference learning should be built from
**non-sensitive lifestyle/experience preferences and behavioral signals**
(e.g., which vibe/category a user picks repeatedly) — never from health,
medical, or mental-health information, diagnosis, religion, political
opinion, sexual orientation, or other special-category personal data. If any
free-text preference input is ever added, it should stay scoped to concrete
facts about places/activities, not personal or psychological self-disclosure.
