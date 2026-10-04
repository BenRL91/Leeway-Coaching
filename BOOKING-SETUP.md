> For the current embedded Stripe integration and all remaining launch steps, use [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md). The notes below describe the original hosted-checkout implementation and are retained for background only.

# Leeway automated booking

The website now has a Worker backend and durable D1 booking records. Online checkout is off by default. Existing email requests remain available. Calendly is not involved in this flow; its six draft events remain inactive.

## Activation requirements

Configure these values in Sites runtime settings, never in committed source or browser JavaScript:

- `SITE_ORIGIN`: https://leeway-pickleball.leeohsunshine.chatgpt.site
- `BOOKING_ENABLED`: false until the end-to-end payment and calendar checks pass.
- `STRIPE_SECRET_KEY` (secret): use a test key first, then a live key for launch.
- `STRIPE_WEBHOOK_SECRET` (secret): signing secret for the deployed `/api/stripe/webhook` endpoint. Subscribe to `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_succeeded`. The Checkout integration itself restricts payment methods to cards to avoid delayed-payment inventory races.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret), `GOOGLE_REFRESH_TOKEN` (secret): Google OAuth credentials authorized by leewaypb@gmail.com. Enable Calendar API and request Calendar event write and calendar free/busy read scopes. Use an OAuth consent configuration suitable for persistent production refresh tokens, not an expiring development test authorization. Never ask the user to post secrets in conversation.
- `COURT_LOCATION`: confirmed court name/address.
- `BUFFER_MINUTES`: owner-confirmed 0, 15, or 30. Starts use a 30-minute grid, so a 15-minute buffer removes the immediate next half-hour-grid start when necessary.
- `GROUP_RATES_JSON`: optional map of 3 through 8 players to integer US cents per player per hour. Rates must strictly decrease and stay within $25–$40. Do not populate until approved. Group checkout remains unavailable without it.

ChatGPT plugin connections do not supply unattended website credentials. Stripe and Google connections must authorize this deployed application separately. A connected Stripe plugin can help configure products and investigate transactions but is not a replacement for the backend key or webhook secret.

The owner authorized public access on September 28, 2026. Public customers and Stripe cannot use owner-only routes. Verify the public audience and reachable webhook path before live activation; do not bypass Sites access controls. Test deployment with test-mode Stripe and a dedicated test calendar/account before switching to the specified production calendar. Calendar is intentionally pinned to leewaypb@gmail.com in source; tests mock it rather than send real invitations.

## Flow and limits

- Tuesday–Friday 17:00–20:00 America/New_York; duration 60/90/120 minutes; 30-minute start increments.
- Technical booking window: at least one hour ahead and at most 60 days ahead. Confirm these operational defaults before launch.
- Server-calculated individual/doubles prices; roster constraints enforce one/two/3–8 players respectively.
- Google free/busy checked before displaying slots and before obtaining a checkout hold. D1 unique slot locks prevent overlapping purchases; transactional batch prevents partial lock creation.
- Stripe-hosted checkout holds the time for about 31 minutes (30-minute Stripe minimum plus setup margin).
- Webhook HMAC, timestamp tolerance, and authoritative Stripe lookup verify payments. Browser redirects cannot confirm a booking.
- A stable Google event ID avoids duplicate invitations on webhook retries. Confirmation is only shown after calendar creation succeeds. Google is asked to send the attendee invitation. Stripe receipt-email settings should be enabled in the merchant dashboard.
- Missed expiration webhooks can be reconciled when availability is checked. Holds are released only after Stripe confirms expiration, never just because a local timer passed.
- Google calendar changes during checkout can still conflict. Recheck before event insertion stops intentional confirmation over an observed conflict. Failed calendar writes remain `paid` and retain the lock; webhook responds with failure so Stripe retries. The booking status page says payment received but confirmation pending and asks the customer not to pay again. Owner must monitor failed Stripe webhook deliveries and resolve calendar conflicts/refunds. Google offers no cross-system atomic transaction; a manual event created in the final insert interval remains an operational risk.
- Ambiguous session-creation failures stay locked rather than expose the time for a second charge. If state remains `creating` after a provider/network outage, investigate using Stripe metadata/idempotency key `leeway-checkout-<booking ID>`. A paid session must be reconciled; an unpaid open session must be expired with Stripe before releasing its lock. Do not erase locks solely based on elapsed time. Recovery is intentionally conservative and is not yet an admin UI.
- Same-session repeated submissions reuse the Stripe idempotency key. The client retains that key for retries until form details change. Reopening/refreshing the form is a new request and may show the old hold as unavailable.
- Five attempts per email per hour is a basic guard, not a comprehensive abuse solution. Add platform-level rate limiting/Turnstile before a broadly promoted public launch.
- Cancellation, rescheduling, refunds, reminders, and online game-breakdown checkout are not automated in this release. Requests for breakdowns continue by email. Confirm policies before accepting payments.

## Validation

`npm run build` then `npm test`.

Tests cover DST, hours, durations, capacities, server price calculation, signatures, tampering, transactional collision rollback, repeated checkout and webhook deliveries, calendar creation, expired hold release, existing calendar conflicts, and setup-mode fail-closed behavior. External services are mocked; passing these tests is not evidence of a real Stripe charge or Google event.

Before launch: configure test credentials and reachable callbacks, verify successful payment and single calendar invitation, replay webhook, abandon checkout and verify release, cause calendar failure and verify retry, test mobile booking, confirm court/buffer/group rates/policies, then authorize public audience and live mode.

## Approved operating settings (September 28, 2026)
Centennial Lakes courts, Acworth, GA. Buffer: zero (back-to-back). Group hourly prices per player: 3=$40, 4=$37, 5=$34, 6=$31, 7=$28, 8=$25. Public access approved; paid checkout remains disabled pending real provider connections and live verification.
