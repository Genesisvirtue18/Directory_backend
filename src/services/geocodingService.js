const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const resultCache = new Map();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function normalize(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function uniqueAddressParts(parts) {
  const known = new Set([
    parts.locality,
    parts.city,
    parts.state,
    parts.postalCode,
    parts.country,
    parts.country?.toUpperCase() === 'IN' ? 'India' : '',
  ].filter(Boolean).map(normalize));
  const seen = new Set();
  return [parts.addressLine1, parts.addressLine2, parts.landmark]
    .filter(Boolean)
    .flatMap(value => value.split(/[,;]/))
    .map(value => value.trim())
    .filter(value => {
      const key = normalize(value);
      if (!key || known.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cacheKey(parts) {
  return Object.values(parts).map(value => normalize(String(value || ''))).join('|');
}

function matchesSubmittedAddress(result, parts) {
  const address = result.address || {};
  const actualCity = address.city || address.town || address.village || address.municipality;
  const actualState = address.state || address.state_district;
  const actualPostalCode = address.postcode;
  if (parts.city && actualCity && normalize(parts.city) !== normalize(actualCity)) return false;
  if (parts.state && actualState && normalize(parts.state) !== normalize(actualState)) return false;
  if (parts.postalCode && actualPostalCode && normalize(parts.postalCode) !== normalize(actualPostalCode)) return false;
  return true;
}

export async function geocodeAddress(parts) {
  const key = cacheKey(parts);
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.point;

  const lookup = requestQueue.then(async () => {
    const queuedCache = resultCache.get(key);
    if (queuedCache && queuedCache.expiresAt > Date.now()) return queuedCache.point;
    const streetParts = uniqueAddressParts(parts);
    const baseParams = {
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
    };
    if (parts.country) baseParams.countrycodes = parts.country.toLowerCase();

    const queries = [];
    if (streetParts.length) {
      const structured = new URLSearchParams({
        ...baseParams,
        street: streetParts.join(', '),
        city: parts.city,
        state: parts.state,
        postalcode: parts.postalCode || '',
        country: parts.country?.toUpperCase() === 'IN' ? 'India' : parts.country || '',
      });
      queries.push(structured);
    }
    // Nominatim can miss Indian addresses when submitted as structured fields. Retry
    // using a single deduplicated free-form query, while retaining country filtering.
    const freeForm = [
      ...streetParts,
      parts.locality,
      parts.city,
      parts.state,
      parts.postalCode,
      parts.country?.toUpperCase() === 'IN' ? 'India' : parts.country,
    ].filter(Boolean);
    const fallback = new URLSearchParams({ ...baseParams, q: [...new Set(freeForm)].join(', ') });
    queries.push(fallback);
    const localityQuery = [
      parts.locality,
      parts.city,
      parts.state,
      parts.postalCode,
      parts.country?.toUpperCase() === 'IN' ? 'India' : parts.country,
    ].filter(Boolean);
    if (localityQuery.length > 1) {
      queries.push(new URLSearchParams({ ...baseParams, q: [...new Set(localityQuery)].join(', ') }));
    }

    let result = null;
    for (const params of queries) {
      const waitMs = Math.max(0, 1000 - (Date.now() - lastRequestAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LokalLens/1.0 (+https://business-directory-one-theta.vercel.app)',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
      const results = await response.json();
      result = Array.isArray(results) ? results.find(item => matchesSubmittedAddress(item, parts)) : null;
      if (result) break;
    }
    const point = result ? { lat: Number(result.lat), lng: Number(result.lon), label: result.display_name || '' } : null;
    if (point && (!Number.isFinite(point.lat) || !Number.isFinite(point.lng))) throw new Error('Geocoder returned invalid coordinates');
    if (point) resultCache.set(key, { point, expiresAt: Date.now() + CACHE_TTL_MS });
    return point;
  });

  requestQueue = lookup.then(() => undefined, () => undefined);
  return lookup;
}
