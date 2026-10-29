# Google Places API (New)

Lokal Lens uses Places API (New) Place Details from the server to show Google ratings and, when explicitly enabled, a limited selection of Google reviews on a published business profile. Google data stays separate from Lokal Lens customer reviews. A Place ID is not proof of ownership and does not by itself mark a directory listing verified.

## Google Cloud setup

1. Select the Google Cloud project that will own production usage. Enable **Places API (New)** and attach an active billing account. A trial or free usage cap does not remove the billing-account requirement.
2. Create a dedicated API key for the Render server. Restrict its allowed API to Places API. Apply an application restriction to the server's outbound IP addresses. If the Render service does not have static outbound addresses, configure a supported static egress option or proxy before applying the IP restriction. Do not use a browser HTTP-referrer key for server requests.
3. Configure the key only in the Render service's environment:

   | Variable | Required | Default | Description |
   | --- | --- | --- | --- |
   | `GOOGLE_PLACES_API_KEY` | For Google details | unset | Server-only API key; never add a `NEXT_PUBLIC_` prefix or Vercel frontend variable. |
   | `GOOGLE_PLACES_REVIEW_MODE` | No | `rating` | `rating` requests rating/count; `reviews` also requests review text and may cost more. |
   | `GOOGLE_PLACES_RATE_LIMIT_MAX` | No | `20` | Requests per client IP per 15 minutes on the public Google reviews endpoint (1–1000). |

4. Configure the Vercel frontend with its existing `NEXT_PUBLIC_API_URL` pointing to the Render API. **Do not configure the Places key in Vercel.** Redeploy the server after changing Render variables.
5. In Google Cloud, set per-SKU quotas appropriate for expected traffic and configure budgets and billing alerts. Alerts are notifications, not a hard spending cap. Quotas can limit usage, but can also make the feature unavailable after the limit is reached.

Use separate, restricted development and production keys. Do not commit keys or paste them into client-side environment variables, logs, issue reports, or responses.

## Pricing and request modes

Google Places is not unconditionally free. Prices, free usage caps, and SKU classifications vary by region and can change. Verify the current official [India pricing schedule](https://developers.google.com/maps/billing-and-pricing/pricing-india) and [Place Details field/SKU documentation](https://developers.google.com/maps/documentation/places/web-service/place-details) before deployment and after Google pricing changes.

The current India schedule consulted for this implementation lists these reference figures; they are not permanent guarantees:

| Request/field set | Highest applicable SKU | Reference monthly free cap | Reference first paid tier |
| --- | --- | ---: | ---: |
| Owner name/address matching: `displayName,formattedAddress` | Place Details Pro | 35,000 | $5.10 per 1,000 |
| Rating mode: `rating,userRatingCount,googleMapsUri` | Place Details Enterprise | 7,000 | $6.00 per 1,000 |
| Reviews mode adds `reviews` to rating fields | Place Details Enterprise + Atmosphere | 7,000 | $7.50 per 1,000 |

Prices shown are India-region reference tiers and can vary with billing region, volume, policy, and Google's current pricing. The highest-priced field in a request determines its SKU. Rating-only is the default. Review text is requested only when the server explicitly sets `GOOGLE_PLACES_REVIEW_MODE=reviews`; that mode may have additional cost. No price or free allowance is hardcoded in application logic.

## Owner Place ID and matching

The owner form accepts an optional Place ID. Use Google's [Place ID instructions](https://developers.google.com/maps/documentation/places/web-service/place-id) to find it; submit the ID itself, not a Maps URL. The server removes whitespace and requests only `displayName,formattedAddress` to compare the Google listing with the submitted business name and address.

Each business has a separate Google Place state: `unverified`, `verified`, or `mismatch`. Owners can change or remove their Place ID when the listing is editable; a changed ID is checked again. A mismatch remains visible to admins and blocks approval until the owner corrects it or an admin clears the mismatched ID. Clearing it only unlinks Google data; it does not mark the Google listing or business as verified. Admin listing verification is a distinct workflow and never follows merely from a Place ID being present. Existing documents without these fields continue to work as `unverified`.

Admins can clear a mismatch with `PATCH /api/v1/admin/businesses/{businessId}/google-place`. This removes only the Place ID and resets its Google state to `unverified`; it does not change the business listing's publication or verification state.

Place IDs are retained on the business record. Google rating/review response content is not persisted to MongoDB; the server uses a bounded in-memory cache for up to five minutes and coalesces identical in-flight requests. Cache state is per server process and lost on restart. The request has an eight-second timeout, no automatic retry, and a per-IP rate limit. Public directory search does not call Places; the browser requests Google data only when a visitor scrolls to the Google Reviews section. Google Place IDs are excluded from public business listing/detail payloads.

## API

`GET /api/v1/businesses/{businessId}/google-reviews` is public and rate-limited. `{businessId}` must be a MongoDB ObjectId for a published business. It never accepts a Place ID from the caller; the server uses the saved, matched Place ID.

Rating-mode example:

```json
{
  "success": true,
  "message": "Google review information retrieved",
  "data": {
    "google": {
      "source": "google",
      "mode": "rating",
      "status": "available",
      "reviewsStatus": "not_requested",
      "available": true,
      "rating": 4.6,
      "ratingCount": 123,
      "reviews": [],
      "mapsUri": "https://maps.google.com/...",
      "attribution": "Google"
    }
  }
}
```

Non-error states include `no_place_id`, `unverified`, `mismatch`, and `no_data`. In reviews mode, `reviewsStatus` is `available` or `no_reviews`; no reviews are fabricated. Google may return only a limited selection (up to five) in its supplied order. Provider/network failures use a standard error response and do not expose the API key or provider response body.

## Google attribution and display

- Keep the Google section visibly separate from Lokal Lens native reviews and identify the source as Google.
- Preserve the review order returned by Google. Do not imply that the limited set is all reviews.
- Display the author name and link to Google's author URI when Google provides it. Include the provided relative date when available.
- Keep the Google Maps business link and its attribution with the Google rating/reviews.
- Do not fabricate missing rating, count, text, author, or date values, and do not store returned review content in MongoDB.
- Follow Google's current [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) and branding/attribution requirements before changing the display or cache behavior.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `PLACES_NOT_CONFIGURED` | Set `GOOGLE_PLACES_API_KEY` on Render, then redeploy. |
| 403 / access denied | Confirm Places API (New) is enabled, the key allows Places API, the application restriction matches Render server egress, and the correct project/key is in use. |
| Billing disabled | Attach an active billing account to the API key's Google Cloud project. Free usage caps still require billing configuration. |
| 429 / quota exceeded | Review Places API per-minute quotas and current project usage. Increase a quota only after reviewing budget and abuse risk. The application does not retry quota errors. |
| Invalid Place ID | Check that the owner entered a Place ID (not a Maps URL), and that the place is still available in Places API. |
| Mismatch | Compare the Google listing's business name/address to the owner listing. The admin cannot approve a mismatch; reject it so the owner can correct the Place ID or listing data. |
| Reviews unavailable but rating visible | The server may be in `rating` mode, Google may return no review text, or the field may not be available under Google policy. |

## Deployment and legacy data

- **Render:** set the restricted key, mode, and rate-limit variables in the backend service; attach billing in Google Cloud; configure API and outbound-IP restrictions; deploy the backend.
- **Vercel:** set only the API base URL and deploy the frontend. The browser never receives the Google key.
- Verify the live endpoint using a test business only after confirming the budget, quotas, field mask, and expected SKU. Automated tests mock Google responses and make no billable requests.
- The previous OAuth controllers, routes, token model, service, UI, environment-variable validation, and tests are removed. This code change does not automatically delete old OAuth-only MongoDB collections. After deployment validation and a database backup, an operator may remove the obsolete `googlebusinessconnections`, `googlebusinessselections`, and `googlebusinessoauthstates` collections; do not remove Business or User records.
