# Google Business Profile reviews setup

The integration is optional. Leave all four `GOOGLE_*` variables blank to keep the existing directory behavior. Once configured, restart the API.

## Google Cloud setup

1. Create or select the Google Cloud project that will own this integration. Configure the OAuth consent screen with your application name, support email, developer contact, and the public privacy policy / terms URLs. Add `https://www.googleapis.com/auth/business.manage` as the requested OAuth scope. This scope requires Google's OAuth verification for public use; until verified, users may see an unverified-app warning and the project may have an unverified user cap.
2. Request Google Business Profile API access for the project using the Business Profile API access form. Access is not automatic. Google's published prerequisites include managing an active, verified Business Profile for at least 60 days and having a website representing that business. Google reviews access requests and enables the APIs for eligible projects. Enable Business Profile Account Management API, Business Profile Business Information API and Google My Business API after approval.
3. Create a Web application OAuth client. Add this exact server callback to its authorized redirect URIs: `https://YOUR_API_HOST/api/v1/google-business-profile/callback` (local: `http://localhost:5000/api/v1/google-business-profile/callback`). Add the frontend origins to the consent screen's authorized domains as required.
4. Set the backend environment variables (never put these in the client environment):

   - `GOOGLE_CLIENT_ID`: OAuth web client ID.
   - `GOOGLE_CLIENT_SECRET`: OAuth web client secret.
   - `GOOGLE_REDIRECT_URI`: exact callback URL registered above.
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`: 32 random bytes, hex encoded; generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep this stable and back it up securely; rotating it requires reconnecting accounts unless tokens are migrated.

5. Ensure `CLIENT_URL` points to the frontend origin. The OAuth callback returns to `/business-owner?googleBusinessProfile=connected` or `...=error`.

## Product behavior and data handling

Owners connect Google and select one account location for each directory listing. The API rechecks that the authenticated owner owns that listing for every management request. Google authorization state is random, single-use and expires after 10 minutes. Refresh tokens are stored encrypted with AES-256-GCM. Disconnect deletes the stored token and selection immediately.

Google review contents and location metadata are fetched when requested, never saved as directory review data. The selection metadata expires after 30 days. Public review pages request up to 10 reviews per page; API requests cap pages at 50 and follow Google's `nextPageToken`. Google reviews remain separate from directory reviews and are attributed to Google. The displayed Google Maps link uses the selected GBP Maps URI when available and falls back to a Google Maps search.

## Access blockers and official references

The code is ready to use after Google approves and enables project access. This implementation cannot submit that application on your behalf. Google can reject or delay access, and `business.manage` OAuth verification is a separate requirement for public production use.

- [GBP API prerequisites and access request](https://developers.google.com/my-business/content/prereqs)
- [API setup](https://developers.google.com/my-business/content/basic-setup)
- [OAuth scopes](https://developers.google.com/my-business/content/oauth-setup)
- [Accounts list](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list)
- [Locations](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)
- [Reviews list and pagination](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)
- [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)
- [OAuth app verification](https://support.google.com/cloud/answer/13463073)
