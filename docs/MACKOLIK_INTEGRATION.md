# FIRO – Mackolik fixtures integration

This branch adds a server-side Vercel Python function at `/api/fixtures/today`.

- It calls the T-OPTA Mackolik provider's `collect_upcoming(days=1)`.
- It returns raw fixture identity, kickoff, league, a complete 1X2 triplet, and the server retrieval time (`odds_captured_at`).
- It does not import or execute T-OPTA prediction, favorite-band, or coupon simulation modules.
- No service-role key or other secret is used.
- The timestamp records when FIRO retrieved the displayed prices; it does not establish when the bookmaker first published those prices.

The historical archive remains a user-owned CSV dataset imported through FIRO's existing CSV importer. This keeps the archive under the user's Supabase RLS ownership and avoids embedding a large historical file in the deployment.

## Runtime dependencies

Vercel Python function dependencies are listed in the root `requirements.txt`.
