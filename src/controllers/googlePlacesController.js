import mongoose from 'mongoose';
import { Business } from '../models/Business.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { safeGooglePlacesError } from '../services/googlePlaces.js';

const isSafeGoogleUrl = value => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'google.com' || url.hostname.endsWith('.google.com') || url.hostname === 'google.co.in' || url.hostname.endsWith('.google.co.in'));
  } catch {
    return false;
  }
};

const mapsUrl = (placeId, providerUri) => isSafeGoogleUrl(providerUri)
  ? providerUri
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`place_id:${placeId}`)}`;

const emptyResult = (status, mode) => ({
  source: 'google',
  mode,
  status,
  reviewsStatus: mode === 'rating' ? 'not_requested' : 'unavailable',
  available: false,
  rating: null,
  ratingCount: 0,
  reviews: [],
  mapsUri: null,
  attribution: 'Google',
});

export function createGoogleReviewsController(placesService, findBusiness = id => Business.findOne({ _id: id, listingStatus: 'published', deletedAt: null }).select('googlePlaceId googlePlaceVerificationStatus')) {
  return async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Invalid business ID', 400);
      const business = await findBusiness(req.params.id);
      if (!business) throw new AppError('Business not found', 404);
      const configuredMode = placesService.reviewMode || 'rating';
      if (!business.googlePlaceId) return sendSuccess(res, 'Google reviews are not available for this business', { google: emptyResult('no_place_id', configuredMode) });
      if (business.googlePlaceVerificationStatus !== 'verified') {
        const status = business.googlePlaceVerificationStatus === 'mismatch' ? 'mismatch' : 'unverified';
        return sendSuccess(res, 'Google reviews are not available for this business', { google: emptyResult(status, configuredMode) });
      }

      const { place, mode } = await placesService.getReviewDetails(business.googlePlaceId);
      const reviews = mode === 'reviews'
        ? (place.reviews || []).slice(0, 5).map(review => ({
          rating: Number.isFinite(review.rating) ? review.rating : null,
          text: typeof review.text?.text === 'string' ? review.text.text : '',
          relativePublishTimeDescription: typeof review.relativePublishTimeDescription === 'string' ? review.relativePublishTimeDescription : '',
          author: {
            displayName: typeof review.authorAttribution?.displayName === 'string' ? review.authorAttribution.displayName : '',
            uri: isSafeGoogleUrl(review.authorAttribution?.uri) ? review.authorAttribution.uri : null,
            photoUri: isSafeGoogleUrl(review.authorAttribution?.photoUri) ? review.authorAttribution.photoUri : null,
          },
        }))
        : [];
      const rating = Number.isFinite(place.rating) ? place.rating : null;
      const ratingCount = Number.isInteger(place.userRatingCount) ? place.userRatingCount : 0;
      const available = rating !== null || ratingCount > 0 || reviews.length > 0;
      const google = {
        source: 'google',
        mode,
        status: available ? 'available' : 'no_data',
        reviewsStatus: mode === 'rating' ? 'not_requested' : reviews.length ? 'available' : 'no_reviews',
        available,
        rating,
        ratingCount,
        reviews,
        reviewsStatus: mode === 'rating' ? 'not_requested' : reviews.length ? 'available' : 'no_reviews',
        mapsUri: mapsUrl(business.googlePlaceId, place.googleMapsUri),
        attribution: 'Google',
      };
      return sendSuccess(res, available ? 'Google review information retrieved' : 'Google review information is not available', { google });
    } catch (error) {
      if (error?.name === 'GooglePlacesError') {
        const [status, message] = safeGooglePlacesError(error);
        return next(new AppError(message, status));
      }
      return next(error);
    }
  };
}
