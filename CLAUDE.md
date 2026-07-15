# CLAUDE.md — DayLoop

Persistent guidance for anyone (human or Claude) working in this repo. Read
this before making changes.

## Product

DayLoop is an international AI-powered day/date planner. A user describes
the day they want (city, time window, mood/budget); the app returns a
practical itinerary — timed stops, walking routes, costs where available,
weather-aware reasoning, a map, and share/save controls. Promise: "Describe
your perfect day. We'll build it." It should feel like a real planning tool,
not a chatbot transcript.

## Architecture (as of this writing)

- **Single file**: everything (HTML, inline `<style>`, inline `<script>`)
  lives in `dayloop.html`. No build step, no bundler, no package.json.
- **No backend.** All data comes from client-side calls to third-party
  public APIs: Nominatim (geocoding), Open-Meteo (weather), Overpass
  (OSM places), a public OSRM instance (foot routing), Leaflet (map
  tiles), and optionally Ticketmaster (events) and Firebase (accounts +
  Firestore sync).
- Accounts and events are **optional/degradable**: the app is designed to
  work with zero configuration (no keys), falling back to search links or
  local-only history when a key/config isn't present. Preserve this
  fallback behavior in any change you make to those areas.
- i18n: all user-facing strings go through the `STRINGS` object (`en`/`tr`)
  and the `t(key, vars)` helper — do not hardcode new UI copy inline.
- DOM access goes through the `$('id')` helper, not raw
  `document.getElementById`.
- User-supplied or OSM-sourced text (place names, addresses) must go
  through `escapeHtml()` before being inserted into innerHTML — this was a
  deliberate XSS fix; don't reintroduce raw interpolation.

## Security rules (non-negotiable)

- **Never commit API keys, tokens, or secrets** — client-side JS is public
  by construction, but keys must not live in source at all if avoidable
  (env/build-time injection, or a tiny backend proxy) once the project
  grows beyond a prototype.
- This repo currently has two secrets committed and deployed:
  `TICKETMASTER_API_KEY` and a Firebase `apiKey` in `dayloop.html`. The
  Ticketmaster key is a genuine secret and must be **rotated** (Ticketmaster
  dashboard) — do not treat "add `.gitignore` entry" as a fix, it's already
  public in git history and on the live GitHub Pages deployment. The
  Firebase web `apiKey` is not secret by Firebase's design (access is
  controlled by Firestore/Auth security rules), but Firestore rules should
  be verified to restrict `users/{uid}/plans` to that user only.
- Do not rewrite published git history to scrub secrets without explicit
  user approval — rotating the key matters more than hiding old commits.

## Design & responsive principles (inferred from current CSS)

- Dark theme via CSS custom properties in `:root` (`--bg`, `--panel`,
  `--accent` red / `--accent2` teal, etc.) — reuse these tokens, don't
  hardcode new colors.
- Mobile-first touch targets, `env(safe-area-inset-*)` padding for iOS,
  16px form font-size (prevents iOS input zoom) — preserve these when
  touching forms.
- Card-based layout (`.card`, `.stop`, `.history-item`), pill/chip controls,
  slide-in `.panel` for side content (history/auth), `prefers-reduced-motion`
  respected on interactive transforms.
- Existing breakpoints are `max-width:480px` and `max-width:640px` — match
  that pattern rather than inventing new ones.

## Repository rules

- Do not push directly to `master`/`main`. Work on feature/chore branches.
- Do not force-push or rewrite published history.
- Never commit `.env` files, credentials, or secrets (see above).
- Keep changes scoped to what was asked — no unrelated refactors, redesigns,
  or dependency additions bundled into an unrelated task.
- **Inspect existing code before implementing a feature.** This file is a
  single 1900+ line HTML file — search for existing helpers, CSS variables,
  i18n keys, and category/vibe logic before adding new ones; duplication is
  easy to introduce by accident here.

## Testing expectations

There is no automated test suite. Before calling a change done:
- Open `dayloop.html` in a browser (or serve it locally) and manually
  exercise the flow you touched, including both language settings if you
  touched `STRINGS`/`t()`.
- Check mobile width (~375px) for any UI change.
- Check the zero-config path still works (no Ticketmaster/Firebase keys) if
  you touch those integrations, since they must degrade gracefully.
