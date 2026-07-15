// DayLoop events proxy — Cloudflare Worker.
//
// Holds the Ticketmaster Discovery API key server-side (as the
// TICKETMASTER_API_KEY secret) and exposes a narrow, validated GET /events
// endpoint that the public index.html client can call safely. The key is
// never returned to the client, logged, or embedded in any response.

const ALLOWED_ORIGINS = new Set([
  'https://dilaradamla.github.io',
]);

// Local development origins (any port) — Vite/serve/http-server etc.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Search radius escalates automatically — no client-supplied radius, and no
// per-market/per-country hardcoding: every request searches from the exact
// lat/lon the client sends, starting narrow and widening only if that returns
// nothing, so results stay close to the destination whenever possible.
const RADIUS_TIERS_KM = [40, 80, 150];
const RESULT_SIZE = 20; // fixed server-side; not client-controlled
const CACHE_TTL_SECONDS = 300;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(origin) {
  const headers = { Vary: 'Origin' };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function parseLat(v) {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -90 || n > 90) return null;
  return n;
}

function parseLon(v) {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n;
}

// Great-circle distance in km — used to sort results and to show "X km away"
// on each event card, since a wide fallback radius can legitimately surface
// events in a neighboring city that a user needs to be able to judge at a glance.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ticketmaster expects e.g. "2024-01-01T00:00:00Z" — reject anything else
// rather than forwarding unvalidated input upstream.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function parseDateTime(v) {
  if (!v) return null;
  return DATETIME_RE.test(v) ? v : undefined; // undefined = invalid
}

const LOCALE_RE = /^([a-zA-Z]{2}(-[a-zA-Z]{2})?|\*)$/;
function parseLocale(v) {
  if (!v) return null;
  return LOCALE_RE.test(v) ? v.toLowerCase() : undefined; // undefined = invalid
}

function sanitizeKeyword(v) {
  if (!v) return null;
  const cleaned = v.replace(/[^\p{L}\p{N}\s\-'&.]/gu, '').trim().slice(0, 80);
  return cleaned || null;
}

function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const mid = images.find((i) => i.width >= 300 && i.width <= 700);
  return (mid || images[0]).url || null;
}

function normalizeEvent(ev, searchLat, searchLon) {
  const venue = ev._embedded && ev._embedded.venues && ev._embedded.venues[0];
  const addressParts = [];
  if (venue?.address?.line1) addressParts.push(venue.address.line1);
  if (venue?.city?.name) addressParts.push(venue.city.name);
  if (venue?.country?.name) addressParts.push(venue.country.name);
  const price = Array.isArray(ev.priceRanges) ? ev.priceRanges[0] : null;
  const classification = Array.isArray(ev.classifications) ? ev.classifications[0] : null;
  const venueLat = venue?.location?.latitude ? Number(venue.location.latitude) : null;
  const venueLon = venue?.location?.longitude ? Number(venue.location.longitude) : null;
  const distanceKm =
    Number.isFinite(venueLat) && Number.isFinite(venueLon)
      ? Math.round(haversineKm(searchLat, searchLon, venueLat, venueLon) * 10) / 10
      : null;

  return {
    id: ev.id || null,
    name: ev.name || '',
    startDate: ev.dates?.start?.localDate || null,
    startTime: ev.dates?.start?.localTime || null,
    venueName: venue?.name || null,
    venueCity: venue?.city?.name || null,
    address: addressParts.join(', ') || null,
    lat: venueLat,
    lon: venueLon,
    distanceKm,
    image: pickImage(ev.images),
    url: ev.url || null,
    category: classification?.segment?.name || classification?.genre?.name || null,
    priceMin: price && typeof price.min === 'number' ? price.min : null,
    priceMax: price && typeof price.max === 'number' ? price.max : null,
    priceCurrency: price?.currency || null,
  };
}

// One Discovery API call at a single radius tier. Returns either the raw event
// list (possibly empty — the caller decides whether to widen the radius) or a
// hard failure that should stop the tier loop and be reported as-is, since a
// bigger radius won't fix an auth/rate-limit/network problem.
async function searchTicketmasterOnce(lat, lon, radiusKm, params, env) {
  const { startDateTime, endDateTime, locale, keyword } = params;
  const upstream = new URL(TICKETMASTER_BASE);
  upstream.searchParams.set('apikey', env.TICKETMASTER_API_KEY);
  upstream.searchParams.set('latlong', `${lat},${lon}`);
  upstream.searchParams.set('radius', String(radiusKm));
  upstream.searchParams.set('unit', 'km');
  upstream.searchParams.set('sort', 'date,asc');
  upstream.searchParams.set('size', String(RESULT_SIZE));
  if (startDateTime) upstream.searchParams.set('startDateTime', startDateTime);
  if (endDateTime) upstream.searchParams.set('endDateTime', endDateTime);
  if (locale) upstream.searchParams.set('locale', locale);
  if (keyword) upstream.searchParams.set('keyword', keyword);

  let tmResponse;
  try {
    tmResponse = await fetch(upstream.toString());
  } catch (e) {
    return { ok: false, status: 502, error: 'upstream_unreachable', message: 'Could not reach the events provider.' };
  }

  if (tmResponse.status === 401 || tmResponse.status === 403) {
    return { ok: false, status: 502, error: 'upstream_auth_failed', message: 'Events provider rejected the request.' };
  }
  if (tmResponse.status === 429) {
    return {
      ok: false,
      status: 429,
      error: 'rate_limited',
      message: 'Events provider rate limit reached, try again shortly.',
    };
  }
  if (!tmResponse.ok) {
    return { ok: false, status: 502, error: 'upstream_error', message: 'Events provider returned an error.' };
  }

  let data;
  try {
    data = await tmResponse.json();
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: 'upstream_bad_response',
      message: 'Events provider returned an unexpected response.',
    };
  }

  return { ok: true, rawEvents: (data._embedded && data._embedded.events) || [] };
}

async function handleEvents(request, env, ctx, origin) {
  const params = new URL(request.url).searchParams;

  const lat = parseLat(params.get('lat'));
  const lon = parseLon(params.get('lon'));
  if (lat === null || lon === null) {
    return jsonResponse(
      { error: 'invalid_location', message: 'lat and lon must be valid coordinates.' },
      400,
      origin
    );
  }

  const startDateTime = parseDateTime(params.get('startDateTime'));
  if (startDateTime === undefined) {
    return jsonResponse(
      { error: 'invalid_start_date', message: 'startDateTime must look like YYYY-MM-DDTHH:mm:ssZ.' },
      400,
      origin
    );
  }
  const endDateTime = parseDateTime(params.get('endDateTime'));
  if (endDateTime === undefined) {
    return jsonResponse(
      { error: 'invalid_end_date', message: 'endDateTime must look like YYYY-MM-DDTHH:mm:ssZ.' },
      400,
      origin
    );
  }

  const locale = parseLocale(params.get('locale'));
  if (locale === undefined) {
    return jsonResponse({ error: 'invalid_locale', message: 'locale must look like en-us.' }, 400, origin);
  }

  const keyword = sanitizeKeyword(params.get('keyword'));

  if (!env.TICKETMASTER_API_KEY) {
    return jsonResponse({ error: 'not_configured', message: 'Events service is not configured.' }, 503, origin);
  }

  // Cache on a normalized param set (rounded coordinates) so nearby, equivalent
  // requests can share a cache entry and cut down on upstream API usage. Radius
  // isn't part of the key — it's not client-controlled anymore (see the tier
  // loop below), and the cached body already records whichever tier was used.
  const cacheParams = new URLSearchParams();
  cacheParams.set('lat', lat.toFixed(3));
  cacheParams.set('lon', lon.toFixed(3));
  if (startDateTime) cacheParams.set('startDateTime', startDateTime);
  if (endDateTime) cacheParams.set('endDateTime', endDateTime);
  if (locale) cacheParams.set('locale', locale);
  if (keyword) cacheParams.set('keyword', keyword);
  const cacheKey = new Request(`https://dayloop-events-cache.internal/events?${cacheParams.toString()}`, {
    method: 'GET',
  });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    return jsonResponse(await cached.json(), 200, origin);
  }

  // Start at the narrowest radius and widen only on zero results — keeps
  // results close to the destination whenever coverage allows it, but still
  // finds something for smaller cities/towns Ticketmaster covers thinly. A
  // hard failure (network/auth/rate-limit/bad response) stops the loop
  // immediately, since a bigger radius won't fix any of those.
  const searchParams = { startDateTime, endDateTime, locale, keyword };
  let rawEvents = [];
  let radiusUsedKm = null;
  for (const radiusKm of RADIUS_TIERS_KM) {
    const result = await searchTicketmasterOnce(lat, lon, radiusKm, searchParams, env);
    if (!result.ok) {
      return jsonResponse({ error: result.error, message: result.message }, result.status, origin);
    }
    radiusUsedKm = radiusKm;
    if (result.rawEvents.length > 0) {
      rawEvents = result.rawEvents;
      break;
    }
  }

  // Sort by distance from the searched city first (so a wide fallback radius
  // still leads with the closest matches), then by date/time.
  const events = rawEvents.map((ev) => normalizeEvent(ev, lat, lon)).sort((a, b) => {
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    if (da !== db) return da - db;
    const ta = `${a.startDate || ''}T${a.startTime || '00:00:00'}`;
    const tb = `${b.startDate || ''}T${b.startTime || '00:00:00'}`;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const body = { events, radiusKm: radiusUsedKm };

  const cacheResponse = new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));

  return jsonResponse(body, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/events') {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, origin);
      }
      try {
        return await handleEvents(request, env, ctx, origin);
      } catch (e) {
        // Never include e.message here in case it echoes back request internals;
        // detailed errors belong in `wrangler tail`, not the client response.
        return jsonResponse({ error: 'internal_error', message: 'Something went wrong.' }, 500, origin);
      }
    }

    return jsonResponse({ error: 'not_found' }, 404, origin);
  },
};
