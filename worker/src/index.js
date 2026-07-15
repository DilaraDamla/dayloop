// DayLoop events proxy — Cloudflare Worker.
//
// Holds the Ticketmaster Discovery API key server-side (as the
// TICKETMASTER_API_KEY secret) and exposes a narrow, validated GET /events
// endpoint that the public dayloop.html client can call safely. The key is
// never returned to the client, logged, or embedded in any response.

const ALLOWED_ORIGINS = new Set([
  'https://dilaradamla.github.io',
]);

// Local development origins (any port) — Vite/serve/http-server etc.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

const RADIUS_MIN = 1;
const RADIUS_MAX = 100;
const RADIUS_DEFAULT = 25;
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

function parseRadius(v) {
  if (v === null || v === '') return RADIUS_DEFAULT;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return RADIUS_DEFAULT;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, n));
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

function normalizeEvent(ev) {
  const venue = ev._embedded && ev._embedded.venues && ev._embedded.venues[0];
  const addressParts = [];
  if (venue?.address?.line1) addressParts.push(venue.address.line1);
  if (venue?.city?.name) addressParts.push(venue.city.name);
  if (venue?.country?.name) addressParts.push(venue.country.name);
  const price = Array.isArray(ev.priceRanges) ? ev.priceRanges[0] : null;
  const classification = Array.isArray(ev.classifications) ? ev.classifications[0] : null;

  return {
    id: ev.id || null,
    name: ev.name || '',
    startDate: ev.dates?.start?.localDate || null,
    startTime: ev.dates?.start?.localTime || null,
    venueName: venue?.name || null,
    address: addressParts.join(', ') || null,
    lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    lon: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    image: pickImage(ev.images),
    url: ev.url || null,
    category: classification?.segment?.name || classification?.genre?.name || null,
    priceMin: price && typeof price.min === 'number' ? price.min : null,
    priceMax: price && typeof price.max === 'number' ? price.max : null,
    priceCurrency: price?.currency || null,
  };
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

  const radius = parseRadius(params.get('radius'));

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
  // requests can share a cache entry and cut down on upstream API usage.
  const cacheParams = new URLSearchParams();
  cacheParams.set('lat', lat.toFixed(3));
  cacheParams.set('lon', lon.toFixed(3));
  cacheParams.set('radius', String(radius));
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

  const upstream = new URL(TICKETMASTER_BASE);
  upstream.searchParams.set('apikey', env.TICKETMASTER_API_KEY);
  upstream.searchParams.set('latlong', `${lat},${lon}`);
  upstream.searchParams.set('radius', String(radius));
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
    return jsonResponse(
      { error: 'upstream_unreachable', message: 'Could not reach the events provider.' },
      502,
      origin
    );
  }

  if (tmResponse.status === 401 || tmResponse.status === 403) {
    return jsonResponse(
      { error: 'upstream_auth_failed', message: 'Events provider rejected the request.' },
      502,
      origin
    );
  }
  if (tmResponse.status === 429) {
    return jsonResponse(
      { error: 'rate_limited', message: 'Events provider rate limit reached, try again shortly.' },
      429,
      origin
    );
  }
  if (!tmResponse.ok) {
    return jsonResponse({ error: 'upstream_error', message: 'Events provider returned an error.' }, 502, origin);
  }

  let data;
  try {
    data = await tmResponse.json();
  } catch (e) {
    return jsonResponse(
      { error: 'upstream_bad_response', message: 'Events provider returned an unexpected response.' },
      502,
      origin
    );
  }

  const rawEvents = (data._embedded && data._embedded.events) || [];
  const body = { events: rawEvents.map(normalizeEvent) };

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
