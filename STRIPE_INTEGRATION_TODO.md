# Stripe integration: remaining setup

This is the single source of truth for remaining Stripe and calendar launch steps. The embedded integration is implemented, but live payments remain disabled. No real Stripe charge or Google Calendar booking has been tested.

## Values to Replace

No placeholder `mode` or `line_items` were introduced. Scenario A applies: the existing `payment` mode and server-calculated coaching prices are preserved. Inline Stripe `price_data` is intentional; Dashboard Price IDs are not required.

**Files containing configuration placeholders:**
- [.env.example](.env.example) — template only; production uses Sites runtime environment settings, not this file.

| Field | Current Value | What to Set |
|---|---|---|
| STRIPE_PUBLISHABLE_KEY | Empty | Matching Stripe `pk_test_…` during testing, then `pk_live_…`. This public key is exposed through `/api/booking/config`. |
| STRIPE_SECRET_KEY | Empty | Matching Stripe secret key, stored as a runtime secret. Never put it in browser code or chat. |
| STRIPE_WEBHOOK_SECRET | Empty | Signing secret for this environment's webhook endpoint. |
| GOOGLE_CLIENT_ID | Empty | Google OAuth client ID for the Calendar integration. |
| GOOGLE_CLIENT_SECRET | Empty | Google OAuth client secret, stored as a runtime secret. |
| GOOGLE_REFRESH_TOKEN | Empty | Offline OAuth refresh token authorized by `leewaypb@gmail.com` for Calendar read/write access. |
| COURT_LOCATION | Empty in template; configured in production | `Centennial Lakes courts, Acworth, GA`. |
| BUFFER_MINUTES | Empty in template; configured in production | `0`, allowing back-to-back sessions. |
| GROUP_RATES_JSON | Empty in template; configured in production | `{"3":3900,"4":3700,"5":3400,"6":3100,"7":2800,"8":2500}` (cents per player/hour). |
| BOOKING_ENABLED | `false` | Keep false until ready for supervised test mode. Enable for testing only in a controlled environment; enable public live booking only after all launch checks below. |

`SITE_ORIGIN` already matches `https://leeway-pickleball.leeohsunshine.chatgpt.site`. Update it if the canonical website address changes. This project is a plain JavaScript Worker, not Vite; no `VITE_` variables are used.

## Configured Parameters

**Files containing these parameters:**
- [worker/index.js](worker/index.js): sole Checkout Session creation call, JSON response and CSP.
- [worker/providers.js](worker/providers.js): Stripe REST API version header.
- [public/booking-confirmation.html](public/booking-confirmation.html): Stripe-hosted script and iframe container.
- [public/confirmation.js](public/confirmation.js): Checkout Form SDK, appearance and confirmation handler.
- [public/index.html](public/index.html): Stripe-hosted script in the head.

| Parameter | Value |
|---|---|
| ui_mode | `form` |
| mode | `payment` — existing one-time coaching charges |
| billing_address_collection | `auto` |
| phone_number_collection.enabled | `false` |
| automatic_tax.enabled | `false` |
| submit_type | `auto` |
| integration_identifier | `custom_embedded_web_0001` |
| payment_method_collection | Omitted: the requested subscription-only rule applies; this is one-time payment. |
| line_items | Existing server-calculated USD coaching amount, quantity 1 |
| metadata.booking_id | Existing booking ID, retained with user authorization for verified fulfillment |
| expires_at | Existing approximately 31-minute session expiry, retained with user authorization for slot holds |
| Stripe-Version | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| Stripe.js | `https://js.stripe.com/dahlia/stripe.js`, loaded directly |
| Client beta | `custom_checkout_payment_form_1` |
| Form layout | `expanded` |
| Appearance | Exact Checkout Studio theme, labels, inputs and variables supplied in the integration request |

There is no installed Stripe server SDK: requests use the existing REST helper. `form` follows the requested fallback for an undetermined SDK version. If introducing an SDK later, use `form` for SDK 21+ and `custom` below 21 per the supplied version rule. Confirm this preview and `integration_identifier` are enabled for your Stripe account before launch; they have not been verified against a real account.

Unlisted customer email, client reference, PaymentIntent metadata, card-only method restriction and hosted success/cancel URLs were removed. The booking contact remains stored in the booking record for calendar invitations. Checkout may collect a different payment email. The confirm action supplies the same booking confirmation URL for any required authentication redirect.

## Setup and Next Steps

1. **Stripe account and preview access:** finish Stripe business verification, payout details and live-payment activation. Confirm the specified Checkout Form preview is available for this account with Stripe support. Register the website/payment method domains where required by enabled payment methods.
2. **Runtime configuration:** securely configure the keys above. Use test publishable and secret keys from the same account while testing. Production environment currently has `BOOKING_ENABLED=false`; keep the email request fallback until setup is complete. Install existing dependencies with `npm ci`; no new Stripe package is needed. Run `npm run build` then `npm test` before deployment.
3. **Webhook:** sandbox endpoint registered at `https://leewaypb.com/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.expired` and `checkout.session.async_payment_succeeded`. Store its signing secret. Use the appropriate test/live endpoint configuration. The handler verifies signatures, retrieves the authoritative session, and checks amount, currency and booking ID before fulfillment.
4. **Google Calendar:** enable the Google Calendar API, create OAuth credentials, authorize `leewaypb@gmail.com` with offline access and Calendar access sufficient for free/busy and event creation, then securely store the refresh token. A ChatGPT Calendar connection does not automatically supply these runtime credentials. Make the OAuth consent configuration suitable for long-term use (test-mode authorizations can expire).
5. **Controlled testing:** test with Stripe test keys only. Use `4242 4242 4242 4242` for success, `4000 0025 0000 3155` for authentication, and `4000 0000 0000 9995` for insufficient funds; use a future expiry and any valid CVC. Never use real card details in test mode. Test one-player, exact two-player and 3–8-player bookings, 60/90/120-minute totals, duplicate submissions, abandoned/expired sessions, reload/resume, declines, 3DS, webhook retries and Google failures. Calendar writes are real even with Stripe test payments: use clearly labelled test bookings and clean them up afterward.
6. **Payment methods:** removing the old card-only restriction allows Dashboard-controlled methods. Start with immediate payment methods for time-sensitive coaching; explicitly test any delayed methods before enabling them. The calendar is only written after payment is verified as paid. Review the Dashboard payment methods before launch.
7. **Go live:** after a real end-to-end test confirms payment, one calendar event and invitation delivery, switch to matching live keys and the live webhook secret. Enable public booking only then. Confirm lead time (currently one hour) and booking horizon (60 days) before opening availability.
8. **Fulfillment and tracking:** existing D1 booking records track session ID, amount, payment state and calendar event ID. Paid bookings remain pending if Calendar fails and retry through webhook/status checks. Monitor Stripe webhook failures and unresolved paid bookings. Configure operational rate limiting before broad promotion. Cancellations, refunds, rescheduling, reminders and abandoned-hold recovery are still manual; no administrative UI is included. Game breakdowns remain email requests. Stripe payment receipts can be configured in the Dashboard.

### Flow overview

The booking form posts validated session details to `/api/checkout`. The server calculates the price, checks Google availability, atomically holds the slot and creates/reuses a Checkout Session. JSON includes `client_secret` and the private booking confirmation URL. The browser opens that same-site page; a token-protected status request retrieves the existing session's client secret and mounts the Stripe-hosted form. Reloads reuse the session. Payment errors appear on the page. Only verified server payment plus successful calendar insertion displays a confirmed booking; browser success alone is insufficient.

### Files created

- [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) — this checklist.
- [tests/checkout-form.test.mjs](tests/checkout-form.test.mjs) — simulated decline/retry/server-confirmation test.

Existing server/client/config files were updated in place; there are no new API routes, database migrations, SDK packages or webhook handlers. Generated `dist/server` files come from the existing build.

### Verification completed

Local build and automated mocked-provider tests cover price integrity, atomic holds, duplicate requests, signature verification, single calendar fulfillment, expiry release, embedded-form decline/retry, and setup-mode fallback. These do not establish Stripe preview access, real iframe rendering, 3DS behavior, account activation or real Google credentials; those require the controlled provider test above.

### Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
- https://docs.stripe.com/testing
- https://docs.stripe.com/security/guide
- https://github.com/stripe/stripe-js/blob/master/types/stripe-js/checkout.d.ts

## Current coaching prices

Individual: $99/hour; doubles: $59/player/hour for exactly two players. Group rates for 3–8 players: $39/$37/$34/$31/$28/$25 per player/hour. Session prices multiply hourly rates by duration, then round to the nearest whole dollar per player (half dollars round up); multiply the rounded per-player price by the player count. Individual 90 minutes: $149. Doubles 90 minutes: $89/player, $178 total. Game breakdown: $99; optional 30-minute call: $49; combined: $148. Pickleball 101: $29/player for a 90-minute class with 4–8 players; class arrangements remain by email. Paddle fitting is not offered on the site.

## Current availability
Tuesday–Friday 5–8 p.m. and Saturday–Sunday 8 a.m.–5 p.m., America/New_York. Monday closed; sessions must finish before closing; no buffer between sessions. 30 available court hours per week. Online payments remain disabled pending setup.

## Sandbox mode (current)
`STRIPE_MODE=sandbox` selects only `STRIPE_SANDBOX_PUBLISHABLE_KEY` and `STRIPE_SANDBOX_SECRET_KEY`. Both sandbox keys have been populated in Sites Settings. Secret key is protected. The original STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY are reserved for live mode and are never used as fallback. The dedicated Leeway Pickleball sandbox webhook is registered at https://leewaypb.com/api/stripe/webhook and its STRIPE_SANDBOX_WEBHOOK_SECRET is saved securely. Keep BOOKING_ENABLED=false until calendar, webhook and payment tests are complete. Both modes share the current booking database and calendar configuration; sandbox selection alone is not full data/calendar isolation.

## Owner protection and webhook activation

The Worker checks Sites-provided signed-in identity and the configured owner email before serving pages, assets or booking APIs. `SITE_ACCESS_MODE=owner` and `SITE_OWNER_EMAIL` are configured. Only exact POST `/api/stripe/webhook` bypasses identity; it still requires a valid Stripe signature. Protected responses are not cached. Tests cover anonymous/non-owner rejection, owner access, missing owner configuration and signed/unsigned webhook requests.

The Sites audience remains owner-private for now. Before changing platform access, verify the owner can open the deployed page while signed in. Then make the platform audience public while retaining the server owner gate, and verify anonymous visitors cannot retrieve content and Stripe deliveries succeed. Until then, platform privacy blocks Stripe delivery. Do not switch `SITE_ACCESS_MODE` to public until the owner asks to launch the website.

Sandbox endpoint: `we_1UMGQG0mRtrmiZBMoqounJjT`, account `acct_1UKUIU0mRtrmiZBM`, API version `2026-03-25.dahlia`. Events: completed, expired and async_payment_succeeded Checkout Sessions. No live endpoint or charge was created. Google runtime credentials and a real sandbox checkout test remain outstanding.

## Latest setup status — October 2, 2026
The owner reports a successful full sandbox payment, calendar event, invitation and blocked availability. Google OAuth credentials are populated; production-mode reauthorization is still pending. Live Stripe charges and payouts are enabled with no outstanding account requirements. Live webhook we_1UMHVJ19LNJrqieLa3y3zEQx is registered and its signing secret is saved; runtime remains sandbox. Live connection verification and test-booking/slot cleanup remain outstanding.

Sites audience is public with server-enforced owner-only access. Anonymous and forged-owner requests were rejected in deployed checks. A harmless signed sandbox webhook returned 200. Owner explicitly approved public GET/HEAD information pages only: /booking-info, /privacy, /terms (and their .html aliases). Coaching pages, booking APIs and confirmation pages remain owner-only. These URLs can now be used for Google branding. Public coaching launch still requires the owner's explicit instruction.

## Calendar connection diagnosis — October 2, 2026

Availability currently fails during the Google OAuth refresh-token exchange. Added allowlisted error codes and HTTP status to server logs, without credentials or raw provider responses. Credential values are trimmed before exchange. Retry availability to capture the specific error. Owner-only booking access and Stripe sandbox mode remain enabled.

## Prelaunch preparation — October 2, 2026, 10:33 p.m. Eastern

- User confirmed availability and the full sandbox booking flow work after applying environment revision 22.
- Live webhook `we_1UMHVJ19LNJrqieLa3y3zEQx` is enabled at `/api/stripe/webhook`, with the three required Checkout events and API version `2026-03-25.dahlia`.
- [Owner setup](public/owner-setup.html) now provides owner-authenticated POST actions for live-key read checks and cleanup of the three identified sandbox bookings. Open `https://leewaypb.com/owner-setup.html` as the owner. These actions require the actual owner's authenticated browser session; preparation alone does not mean they have run.
- [Setup server](worker/setup.js) checks the saved live key's account, charge/payout readiness, and Checkout read access without switching the site's payment mode. Successful read checks do not prove Checkout write permission or live webhook delivery. Those remain launch gates.
- Cleanup verifies each Stripe session is sandbox-only and belongs to the booking, expires open sessions, marks records to suppress delayed webhooks, deletes matching calendar events without attendee notifications, and releases database locks only after successful calendar cleanup. Records remain for audit. Retry safely after partial failure.
- Draft cancellation, refund, weather, lateness, and group-change terms appear only on the owner setup page. Owner approval is still needed before publishing them as customer policies or requiring acceptance at checkout.
- `SITE_ACCESS_MODE=owner` and `STRIPE_MODE=sandbox` remain in force. No live charge or public launch is authorized by these preparation steps.

## Approved policy and live key correction — October 2, 2026

The owner approved the cancellation/refund draft. It is now in the terms, booking form, and payment page. New online checkout requests require explicit acceptance of policy version `2026-10-02`; the booking payload records the version and server acceptance time. Refunds and changes remain manual.

The owner live-key check rejected the saved key format before contacting Stripe. `STRIPE_PUBLISHABLE_KEY` has the correct live prefix. Replace `STRIPE_SECRET_KEY` in protected Site settings with the intended live server key (`sk_live_` or `rk_live_`) if the check still fails after whitespace trimming. Never paste that key into chat or source. Sandbox fields are separate. Redeploy after changing runtime secrets, then rerun the owner check. Successful reads still do not prove write permissions or live webhook delivery.

Live-key troubleshooting: owner readiness check now classifies the runtime value (missing, sandbox, publishable, webhook, quoted, assignment, masked, or unrecognized) without returning or logging secrets. A regression test verifies that live checks use the separate live key while booking mode remains sandbox. Runtime diagnosis remains pending the next owner check.

## No-charge live probe

Owner live account/read readiness passed with environment revision 25. The owner setup page now creates and immediately expires an isolated unpaid live Checkout Session using the actual saved live server key and configured form parameters. No client secret or payment link is exposed. A narrow live-signed expiration handler independently retrieves that tagged session before marking webhook verification in Stripe metadata. It does not fulfill bookings and works while normal booking payments remain sandbox-only. Run the owner button, then repeat after delivery to check verification. This proves session creation, expiration and signed expiration delivery—not successful live payment processing.

## Final booking experience pass

Owner confirmed no-charge live Checkout creation/expiration and live signed expiration webhook verification. Actual live payment has not been tested. Updated online booking instructions, retained email handling for game breakdowns, added cancellation instructions to confirmations, and made live-readiness status reflect verified probe metadata. Corrected connected group quotes to round each per-player session price to whole dollars before multiplying by roster size, matching server billing across 60/90/120-minute sessions and 3–8 players. Owner-only access and sandbox payment mode remain required until explicit launch approval.

## Launch readiness pass — October 3, 2026
- Keep SITE_ACCESS_MODE=owner and STRIPE_MODE=sandbox until Ben authorizes launch.
- Added interrupted Checkout recovery, owner booking list, retry/cancel/reschedule controls and Stripe refund-status lookup. Cancellation does not automatically refund. Refund manually in Stripe, then refresh the recorded status. Owner list shows the latest 100 bookings; paid/creating/change-in-progress bookings need attention. This is an on-demand dashboard, not a background alert system.
- Added canonical-host redirects, reservation creation volume limit, consolidated booking form, collapsed rate tables, checkout summary/hold timer, clearer fallback, footer legal links, optimized logo and mobile styling.
- Verified automated recovery, cancellation retry, rescheduling, canonical-host and owner-protection tests plus existing pricing/payment tests. No real customer bookings changed by this update.
- Remaining: full owner mobile walkthrough of booking plus new management controls; external alerts/reconciliation scheduling if desired; actual live payment and refund verification when authorized; confirm all required restricted-key permissions for payment-intent/refund status reads.
- Ben to supply precise court address/parking/access instructions and any approved testimonial/sample breakdown. Do not invent these.
- At launch, update public booking wording in terms/info pages and authorize the explicit owner/sandbox configuration transition. No launch performed by this pass.

## Court arrival details — October 3, 2026
Added Ben’s supplied Apple Maps pin to the confirmation page, location FAQ, and new calendar invitation descriptions. Meeting instructions: “Meet on the court or at the court gate.” Existing calendar events are not modified. No parking or gate-code instructions supplied.

## Payment readiness check — October 3
Live probe and signed webhook marker confirmed through Stripe read API. Check live Stripe now additionally checks Payment Intent, Charge, and Refund list-read access using the saved website live key. Owner must run it to obtain current results; plugin permissions are separate. No live charges or mode changes made.
Remaining Dashboard action: enable Successful payments and Refunds under https://dashboard.stripe.com/settings/emails in live account. API does not expose those toggles here. Sandbox receipt delivery requires manually sending a receipt from the sandbox payment. Calendar invitation delivery was user-verified; receipt inbox delivery remains unverified. Owner page now documents refund and paid-but-unconfirmed resolution steps.

## Owner workspace — October 3
Booking admin now defaults to upcoming sessions with search and Upcoming / Needs attention / History / All filters. Actions reflect booking state; secondary details and refund actions are collapsed. Cancellation uses an inline confirmation. Setup diagnostics and policy guidance are collapsible. Main-site Manage bookings navigation is rendered only when the server verifies the signed-in owner; page and APIs retain separate owner authorization. Automated tests cover owner-only navigation and updated management UI. Receipts toggles and all live permission checks were confirmed by Ben; actual live payment/receipt delivery remains unverified.

## Sandbox cleanup
Owner workspace → Payment setup & diagnostics → Preview test cleanup now verifies up to 100 sandbox Checkout bookings per batch. Confirm cleanup removes matching calendar events, releases reservations and marks records test_cancelled. Cleared tests are hidden from normal booking views; audit records and Stripe history remain. Unverified records and live bookings are excluded. No actual cleanup was run during deployment; owner confirmation is available on the page.

## Checkout UX follow-up — October 3
- Coach branding now uses Coach Lee throughout customer-facing content.
- Google Maps directions use the original court pin coordinates (34.085553, -84.626265); Apple Maps remains an alternative. New calendar invitations include both.
- The hold countdown renders immediately and updates from the original expiration timestamp. Automatic status checks run quietly without clearing the timer or remounting the payment form.
- Link-specific end-to-end testing remains outstanding: in sandbox, select Pay securely with Link, complete its test authentication, pay, verify exactly one confirmed booking/calendar event, then exercise cancel/back and retry without a duplicate charge. Never use a real card for sandbox tests. Existing automated tests mock the Stripe SDK and do not verify Link's hosted UI.
- Pricing uses server-calculated inline price_data and product_data. No Dashboard Product or Price per player-count/duration variant is required.
- Owner-only access and sandbox payment mode remain required until launch authorization.

## Payment return routing — October 3
- New Checkout Sessions explicitly set the customer booking-confirmation return URL. Client confirmation constructs the same fixed path, excluding unrelated query/return_to values. Initial checkout navigation rejects any other path.
- Mocked card and Link confirmation tests cover the return target, decline/retry, and verified confirmation. Public-mode tests deny admin pages/APIs to anonymous and non-owner visitors.
- The reported Link return to Booking setup was not reproduced from available logs. Repeat a fresh sandbox Link checkout after this deployment, and confirm the final page/URL. Then repeat ordinary card checkout. Hosted Stripe/Link browser behavior remains unverified by mocked tests.

### Duplicate return URL correction
The booking status response reports whether Stripe already has a Session return_url. Confirmation omits returnUrl when it does; older Sessions without one receive the fixed customer confirmation URL in confirm(). Regression coverage includes both Session generations for card and Link. Refresh the existing checkout page before retrying. Hosted Link/card walkthrough remains pending.
