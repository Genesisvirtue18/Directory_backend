const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/;
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const VALIDATION_FIELDS = 'displayName,formattedAddress';
const RATING_FIELDS = 'rating,userRatingCount,googleMapsUri';
const REVIEWS_FIELDS = `${RATING_FIELDS},reviews`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;

const normalizePlaceId = value => typeof value === 'string' ? value.trim().replace(/\s+/g, '') : '';

function providerReason(body) {
  const error = body?.error || {};
  const metadata = error.details?.find(detail => detail?.metadata?.reason)?.metadata?.reason;
  return error.errors?.[0]?.reason || metadata || error.status || error.code;
}

function providerMessage(body) {
  const message = body?.error?.message;
  return typeof message === 'string' ? message.slice(0, 300) : '';
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(/\s+/).filter(token => token.length > 1));
}

function overlapScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  if (normalizeText(left).includes(normalizeText(right)) || normalizeText(right).includes(normalizeText(left))) return 1;
  let matches = 0;
  for (const token of a) if (b.has(token)) matches += 1;
  return matches / Math.min(a.size, b.size);
}

export function placeMatchesBusiness(place, business) {
  const displayName = place?.displayName?.text;
  const formattedAddress = place?.formattedAddress;
  const address = business?.address || {};
  const businessName = business?.name;
  const businessAddress = [
    address.addressLine1,
    address.addressLine2,
    address.landmark,
    address.locality,
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean).join(' ');
  if (!displayName || !formattedAddress || !businessName || !businessAddress) return false;
  return overlapScore(businessName, displayName) >= 0.6
    && overlapScore(businessAddress, formattedAddress) >= 0.25;
}

export class GooglePlacesError extends Error {
  constructor(code, status, reason) {
    super(code);
    this.name = 'GooglePlacesError';
    this.code = code;
    this.status = status;
    this.providerReason = reason;
  }
}

export function safeGooglePlacesError(error) {
  if (error?.code === 'PLACES_NOT_CONFIGURED') {
    return [503, 'Google Places is not configured. Please contact the site administrator.'];
  }
  if (error?.code === 'PLACES_INVALID_ID') {
    return [422, 'This Google Place ID is invalid or unavailable. Check that you entered the Place ID, not a Google Maps URL.'];
  }
  if (error?.code === 'PLACES_RATE_LIMITED') {
    return [503, 'Google Places request limit reached. Please try again later.'];
  }
  if (error?.code === 'PLACES_BILLING_DISABLED') {
    return [503, 'Google Places billing is not enabled for this project. The site administrator must configure billing in Google Cloud.'];
  }
  if (error?.code === 'PLACES_FORBIDDEN') {
    return [503, 'Google Places access was denied. Check the API key restrictions and Places API (New) access.'];
  }
  if (error?.code === 'PLACES_NETWORK') {
    return [503, 'Google Places is temporarily unreachable. Please try again later.'];
  }
  if (error?.code === 'PLACES_UNAVAILABLE') {
    return [503, 'Google Places is temporarily unavailable. Please try again later.'];
  }
  return [503, 'Google review information is temporarily unavailable. Please try again later.'];
}

export function createGooglePlacesService(config, {
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = CACHE_TTL_MS,
  cacheMaxEntries = CACHE_MAX_ENTRIES,
  logger = console,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function getDetails(placeId, fields, operation, forceRefresh = false) {
    const normalizedId = normalizePlaceId(placeId);
    if (!PLACE_ID_PATTERN.test(normalizedId)) throw new GooglePlacesError('PLACES_INVALID_ID', 422);
    if (!config.GOOGLE_PLACES_API_KEY) throw new GooglePlacesError('PLACES_NOT_CONFIGURED', 503);

    const cacheKey = `${normalizedId}:${fields}`;
    const cached = cache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > now()) return cached.value;
    if (cached && cached.expiresAt <= now()) cache.delete(cacheKey);
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const request = (async () => {
      const startedAt = now();
      let response;
      try {
        response = await fetchImpl(`${PLACE_DETAILS_URL}${encodeURIComponent(normalizedId)}`, {
          headers: {
            'X-Goog-Api-Key': config.GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': fields,
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        logger.info('[Google Places] Request failed', { operation, status: undefined, reason: 'NETWORK_ERROR' });
        throw new GooglePlacesError('PLACES_NETWORK', 503);
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const reason = providerReason(body);
        const message = providerMessage(body).toLowerCase();
        const code = response.status === 429 || reason === 'RATE_LIMIT_EXCEEDED' || reason === 'RESOURCE_EXHAUSTED'
          ? 'PLACES_RATE_LIMITED'
          : response.status === 404 || response.status === 400 && /place.?id|not found|invalid argument/.test(message)
            ? 'PLACES_INVALID_ID'
            : response.status === 403 && /billing|billingaccount|billing account/.test(`${reason || ''} ${message}`.toLowerCase())
              ? 'PLACES_BILLING_DISABLED'
              : response.status === 403
                ? 'PLACES_FORBIDDEN'
                : 'PLACES_UNAVAILABLE';
        logger.info('[Google Places] Request failed', {
          operation,
          status: response.status,
          reason: typeof reason === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(reason) ? reason : undefined,
          durationMs: Math.max(0, now() - startedAt),
        });
        throw new GooglePlacesError(code, response.status, reason);
      }

      let value;
      try {
        value = await response.json();
      } catch {
        logger.info('[Google Places] Request failed', {
          operation,
          status: response.status,
          reason: 'INVALID_RESPONSE',
          durationMs: Math.max(0, now() - startedAt),
        });
        throw new GooglePlacesError('PLACES_UNAVAILABLE', 503);
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        logger.info('[Google Places] Request failed', {
          operation,
          status: response.status,
          reason: 'INVALID_RESPONSE',
          durationMs: Math.max(0, now() - startedAt),
        });
        throw new GooglePlacesError('PLACES_UNAVAILABLE', 503);
      }
      logger.info('[Google Places] Request completed', {
        operation,
        status: response.status,
        durationMs: Math.max(0, now() - startedAt),
      });
      if (cache.size >= cacheMaxEntries) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { value, expiresAt: now() + cacheTtlMs });
      return value;
    })();

    inFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return {
    reviewMode: config.GOOGLE_PLACES_REVIEW_MODE || 'rating',
    getValidationDetails(placeId, { forceRefresh = false } = {}) {
      return getDetails(placeId, VALIDATION_FIELDS, 'place-id-validation', forceRefresh);
    },
    getReviewDetails(placeId) {
      const mode = config.GOOGLE_PLACES_REVIEW_MODE || 'rating';
      return getDetails(placeId, mode === 'reviews' ? REVIEWS_FIELDS : RATING_FIELDS, 'public-reviews')
        .then(place => ({ place, mode }));
    },
    async verifyPlaceId(placeId, business) {
      const place = await this.getValidationDetails(placeId, { forceRefresh: true });
      if (!place?.displayName?.text || !place?.formattedAddress) return 'unverified';
      return placeMatchesBusiness(place, business) ? 'verified' : 'mismatch';
    },
  };
}
