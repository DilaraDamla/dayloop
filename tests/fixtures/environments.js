'use strict';
// Sprint 3 offline environment fixtures — docs/architecture/planning-architecture.md.
//
// Each environment is a deterministic, hand-authored POI set (no network, no
// randomness) standing in for what fetchPOIs() would realistically return in
// that kind of place. They differ along every dimension the sprint asked for:
// venue density, category coverage, distances, indoor/outdoor mix,
// opening-hours tagging confidence, and "richness" of metadata.
//
// IMPORTANT HONEST LIMITATION: this app has no real price/cost data source
// anywhere in its pipeline (confirmed in earlier audits — OSM/Overpass never
// carries a price field). "Price information availability" is therefore
// modeled the only honest way available: as how much OTHER metadata
// (cuisine tags, name completeness) a place has, which is the same proxy
// scorePOI already relies on — NOT as invented price numbers. This is called
// out explicitly wherever it's relevant so a reviewer never mistakes it for
// real price data.

function metersToDeg(m){ return m / 111000; }

function place(category, center, { distM = 300, bearingDeg = 0, name, cuisine, openingHours, brand } = {}){
  const d = metersToDeg(distM);
  const rad = bearingDeg * Math.PI / 180;
  const lat = center.lat + d * Math.cos(rad);
  const lon = center.lon + d * Math.sin(rad) / Math.cos(center.lat * Math.PI / 180);
  const tags = { name: name || `${category} ${Math.round(distM)}m` };
  if(cuisine) tags.cuisine = cuisine;
  if(openingHours) tags.opening_hours = openingHours;
  if(brand) tags.brand = brand;
  return { lat, lon, tags, category };
}

// ---------------------------------------------------------------------------
// 1. Dense capital city — high density, full category coverage, compact
//    distances, well-tagged (most places have real opening_hours + cuisine).
// ---------------------------------------------------------------------------
function buildDenseCapital(){
  const center = { lat: 41.0082, lon: 28.9784 };
  const pois = [];
  const categories = ['cafe','restaurant','bar','nightclub','cinema','museum','gallery','park','viewpoint','artwork','bakery','ice_cream','shopping'];
  const cuisines = ['italian','french','seafood','turkish','wine bar',null];
  categories.forEach((cat, ci) => {
    for(let i=0;i<5;i++){
      const distM = 150 + i*180; // 150m..870m — a compact, walkable core
      const bearing = (ci*29 + i*47) % 360; // deterministic spread, not clustered on one line
      pois.push(place(cat, center, {
        distM, bearingDeg: bearing,
        name: `${cat}_capital_${i}`,
        cuisine: cat === 'restaurant' ? cuisines[i % cuisines.length] : undefined,
        // ~80% tagged with real hours — a well-mapped city core
        openingHours: (i !== 4) ? 'Mo-Su 09:00-23:00' : undefined,
      }));
    }
  });
  // Sprint 6 discovery categories — a small, realistic mix: some genuinely
  // independent-reading places, and one deliberately chain-tagged bakery
  // (a real OSM `brand` tag) so the Discovery Score's chain-penalty has
  // something real to differentiate against in this fixture.
  pois.push(place('arts_centre', center, { distM: 500, bearingDeg: 15, name: 'Kumsal Culture & Art Center', openingHours: 'Tu-Su 10:00-19:00' }));
  pois.push(place('theatre', center, { distM: 650, bearingDeg: 200, name: 'Old Quarter Independent Theatre', openingHours: 'We-Su 19:00-23:00' }));
  pois.push(place('escape_room', center, { distM: 400, bearingDeg: 100, name: 'Locked Room Escape Experience', openingHours: 'Mo-Su 11:00-22:00' }));
  pois.push(place('bookstore', center, { distM: 250, bearingDeg: 320, name: 'The Corner Secondhand Bookstore' }));
  pois.push(place('bakery', center, { distM: 300, bearingDeg: 260, name: 'Global Bakery Co.', brand: 'Global Bakery Co.', openingHours: 'Mo-Su 07:00-20:00' }));
  pois.push(place('ferry_terminal', center, { distM: 1800, bearingDeg: 45, name: 'Kumsal Pier Ferry Terminal' }));
  return {
    label: 'Dense capital city',
    center,
    weather: { clear: { indoorBias: false, avgTemp: 20, codeKey: 'clear' }, rainyOrCold: { indoorBias: true, avgTemp: 6, codeKey: 'rain' } },
    pois,
  };
}

// ---------------------------------------------------------------------------
// 2. Suburban area — medium density, most categories present but thinner,
//    more spread out, roughly half the places carry real opening_hours.
// ---------------------------------------------------------------------------
function buildSuburb(){
  const center = { lat: 52.4800, lon: 13.4000 };
  const pois = [];
  const categories = ['cafe','restaurant','bar','cinema','museum','park','viewpoint','bakery','ice_cream','shopping'];
  // nightclub, gallery, artwork deliberately thin/absent — typical of a
  // residential suburb rather than a cultural core.
  categories.forEach((cat, ci) => {
    const count = ['cafe','restaurant','park'].includes(cat) ? 3 : 2;
    for(let i=0;i<count;i++){
      const distM = 400 + i*500; // 400m..2400m — genuinely suburban spacing
      const bearing = (ci*41 + i*67) % 360;
      pois.push(place(cat, center, {
        distM, bearingDeg: bearing,
        name: `${cat}_suburb_${i}`,
        cuisine: cat === 'restaurant' && i === 0 ? 'italian' : undefined,
        openingHours: (i % 2 === 0) ? 'Mo-Sa 10:00-20:00' : undefined, // ~50% tagged
      }));
    }
  });
  return {
    label: 'Suburban area',
    center,
    weather: { clear: { indoorBias: false, avgTemp: 17, codeKey: 'partly_cloudy' }, rainyOrCold: { indoorBias: true, avgTemp: 5, codeKey: 'rain' } },
    pois,
  };
}

// ---------------------------------------------------------------------------
// 3. Town of ~15,000 people — sparse category coverage (no nightlife, no
//    galleries/cinema), longer distances between what exists, mostly
//    untagged hours (~20%).
// ---------------------------------------------------------------------------
function buildSmallTown(){
  const center = { lat: 38.4237, lon: 27.1428 };
  const pois = [
    place('cafe', center, { distM: 200, bearingDeg: 10, name: 'town_cafe_main', openingHours: 'Mo-Su 08:00-19:00' }),
    place('cafe', center, { distM: 1800, bearingDeg: 200, name: 'town_cafe_edge' }),
    place('bakery', center, { distM: 350, bearingDeg: 60, name: 'town_bakery' }),
    place('restaurant', center, { distM: 900, bearingDeg: 140, name: 'town_restaurant_main', openingHours: 'Mo-Su 11:00-22:00' }),
    place('restaurant', center, { distM: 2400, bearingDeg: 300, name: 'town_restaurant_far' }),
    place('bar', center, { distM: 1500, bearingDeg: 250, name: 'town_bar' }),
    place('park', center, { distM: 700, bearingDeg: 320, name: 'town_park' }),
    place('viewpoint', center, { distM: 3000, bearingDeg: 80, name: 'town_viewpoint' }),
  ];
  // No nightclub, cinema, museum, gallery, artwork, ice_cream, or shopping at
  // all — a realistic small-town category gap, not an oversight.
  return {
    label: 'Town of ~15,000 people',
    center,
    weather: { clear: { indoorBias: false, avgTemp: 19, codeKey: 'clear' }, rainyOrCold: { indoorBias: true, avgTemp: 4, codeKey: 'rain' } },
    pois,
  };
}

// ---------------------------------------------------------------------------
// 4. Rural village — a handful of places total, one deliberately distinctive
//    "local character" venue, almost nothing tagged with real hours.
// ---------------------------------------------------------------------------
function buildRuralVillage(){
  const center = { lat: 39.9042, lon: 32.8597 };
  const pois = [
    place('cafe', center, { distM: 150, bearingDeg: 0, name: 'village_only_cafe' }),
    place('restaurant', center, { distM: 600, bearingDeg: 90, name: 'village_only_restaurant' }),
    place('bakery', center, { distM: 300, bearingDeg: 180, name: 'village_bakery' }),
    // The village's one genuinely distinctive place — deliberately named so a
    // test/reviewer can check whether it gets prioritized as the day's
    // centerpiece rather than treated like an interchangeable filler stop.
    place('viewpoint', center, { distM: 900, bearingDeg: 45, name: 'The Old Mill Viewpoint — village landmark' }),
  ];
  // No bar, nightclub, cinema, museum, gallery, artwork, ice_cream, or
  // shopping — genuinely nothing there, not a fixture oversight.
  return {
    label: 'Rural village',
    center,
    weather: { clear: { indoorBias: false, avgTemp: 18, codeKey: 'clear' }, rainyOrCold: { indoorBias: true, avgTemp: 3, codeKey: 'rain' } },
    pois,
  };
}

const ENVIRONMENTS = {
  denseCapital: buildDenseCapital(),
  suburb: buildSuburb(),
  town: buildSmallTown(),
  village: buildRuralVillage(),
};

module.exports = { ENVIRONMENTS };
