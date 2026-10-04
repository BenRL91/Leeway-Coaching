# Leeway Pickleball website launch audit

Date: October 3, 2026. Scope: website only; mobile work excluded.
Baseline: source commit `0f7f565b5bc60eb0900800e5d56716084711199d`, hosted version 42, environment revision 26.

## Fix update — October 3, 2026

The two confirmed defects have now been addressed in source. Payment recovery uses conditional database state transitions; cancellation cannot be replaced by paid/confirmed. If calendar creation finishes after cancellation, its event is removed; cleanup failure remains visible as pending cancellation for owner retry. Per-booking reconciliation errors are isolated so other slots can load when the free/busy service is healthy. A complete Google availability outage still safely blocks booking.

The original calendar reproduction used a full OAuth outage, which necessarily blocks all free/busy checks too. The replacement regression isolates a single event-sync failure with healthy free/busy and verifies unrelated slots remain available. This clarifies the scope of the fix.

The original reproduction file has been replaced by `tests/reliability.test.mjs`, with five safety regression cases, including late calendar creation and a complete calendar outage. All five test files pass. Other audit findings remain open. No pricing, cancellation policy, access settings, payment mode, or mobile code was changed.

## Original audit verdict

Keep the website owner-only and Stripe in sandbox. The existing happy paths have useful test coverage, but payment/calendar recovery and concurrent administrative changes need hardening before public launch. This audit changed no website application code, hosted settings, bookings, payments, calendar events, or deployment.

## Evidence and limits

- Retrieved the current hosted source and read server, database, browser booking, confirmation, owner controls, and policy pages.
- Verified hosted configuration: SITE_ACCESS_MODE=owner; STRIPE_MODE=sandbox; booking enabled; buffer zero. The Sites platform audience is public to permit webhooks/public information pages, while the application enforces owner access. Do not confuse platform audience with application access.
- Built the unchanged site successfully. All four existing test files passed, covering scheduling/pricing, access restrictions, holds, signed webhooks, booking changes, browser forms, and mocked Link/card confirmation.
- Added `reproduce.test.mjs`: two deterministic failure reproductions pass because they demonstrate the defects below. These are not tests claiming the defects are fixed. They use isolated SQLite and mocked providers; no external writes.
- Prior user confirmation of real sandbox Link and regular card flows is historical evidence; neither was charged/retested against Stripe during this audit.
- Fresh rendered phone/tablet/desktop visual QA could not be completed: local browser installation failed. DOM interaction tests and source accessibility review passed where covered, but these do not establish full visual/accessibility compliance.
- No hosted authenticated customer session, actual email delivery, provider outage, provider-side concurrent webhook delivery, or live charge was tested.

## Findings, ordered by priority

### High — cancellation can be overwritten by payment recovery

`worker/index.js`: `paid()` evaluates a previously read booking object, then unconditionally updates most states to paid and subsequently confirmed. A status request or webhook already in progress can finish after an owner cancellation and restore confirmed status after reservation locks have been removed.

Reproduction: start paid recovery; interleave cancellation before Stripe retrieval returns; the final response is confirmed with zero reservation locks. This is a simulated interleaving of two requests, not a claim that a customer has encountered it.

Fix: conditional state transitions/version checks inside database transactions, a single authoritative confirmation transition, and re-read/check ownership before calendar effects. Cover cancellation versus status/webhook and reschedule versus confirmation. A calendar call must not restore a terminated booking.

### High — calendar failure blocks unrelated availability on the same date

`available()` awaits `reconcileDate()`. That calls `paid()` for unresolved payments. A calendar exception propagates out, returning 503 for the date instead of processing other slots. Payment remains paid; customer is told not to pay again, which is good, but automatic recovery depends on another request or Stripe retry.

Reproduction: a paid booking with calendar OAuth failure makes that day's availability return 503.

Fix: isolate per-booking reconciliation failures; retain paid reservations safely, record calendar error/retry state, and run durable retries independently. Do not change the existing payment/calendar confirmation policy silently; align customer copy if confirmation semantics change.

### High — sandbox/live transition lacks per-booking environment ownership

Bookings store a Stripe session ID but no explicit sandbox/live environment/account. Availability and status reconciliation use the site's currently selected mode. After a future live switch, unresolved sandbox records can be looked up with live credentials, producing errors and potentially blocking availability.

Fix: store and enforce environment per booking, isolate test data from live reservations, and explicitly reconcile/clear test holds before a future mode switch. Never silently try the other environment's keys. Do not switch now.

### Medium — hold recovery is request-triggered and bounded

No scheduled maintenance handler/job exists in this source. Expiration webhooks and date/status requests release holds; `reconcileDate()` processes only 20 records, with no ordering/pagination. A lost creation response or missed expiration delivery can leave locks until later activity or owner intervention. This is not evidence that all holds routinely get stuck.

Fix: durable periodic reconciliation with pagination, safe payment verification before releasing capacity, bounded backoff, and owner visibility. Test more than 20 unresolved records and delayed/missing expiration delivery.

### Medium — checkout retry identity is lost when the page reloads

`public/online-booking.js` holds requestId only in memory and redirects only after receiving the server result. If a hold/session is created but the response is lost, a page reload creates a new attempt and loses the customer's recovery link. Existing same-page retries reuse the ID correctly.

Fix: persist a minimal, scoped pending-attempt reference and support safe recovery; do not store card data. Provide a durable confirmation/recovery delivery path. Test refresh, lost response, closed tab, and return after payment.

### Medium — overlapping same-booking reschedules are not serialized

The server protects target capacity with unique locks, but simultaneous owner actions for the same booking have no state version/compare-and-swap. Separate browser tabs could update Calendar and database in different orders. This was identified by source review; only the cancellation/payment race was reproduced.

Also, availability and freeBusy include the booking's existing reservation/event. A shift that overlaps its own old time is rejected. This is safe against double booking, but unnecessarily limits rescheduling.

Fix: serialize transitions per booking; explicitly exclude only the current booking when evaluating its replacement time, preserving protection from all other bookings.

### Medium — confirmation delivery depends on Calendar

Calendar invitations use sendUpdates=all. There is no independent transactional-email sender, delivery status, failed-delivery alert, or reminder job in the source. Current copy accurately says an invitation was requested, not guaranteed delivered. The private booking link is not included in the event description.

Fix: decide whether calendar invitations plus manual email support are sufficient for initial launch. If not, add confirmed-booking/change/cancellation email delivery with retries and secure recovery links. Avoid promising reminders before they exist.

### Low — admin listing is limited to the latest 100 records

The owner list selects by creation date with LIMIT 100 before applying UI filters. Over time, an older-created upcoming booking can disappear from the interface. Add server-side filters/pagination before volume grows.

### Low — launch copy and metadata cleanup

Terms and booking information still describe prelaunch/testing access. Update only when actually launching. Sites metadata still describes “conversations with Ben”; customer-facing website text uses Coach Lee. Browser date pickers use 59 days while server accepts up to 60 days; align the documented horizon and date UI.

## Checks that passed or are present

- Server recomputes prices; submitted amount is ignored. Current connected group quotes match server rounding across party sizes/durations.
- Duo exactly two; groups three through eight; one-hour lead time; half-hour starts; full session fits opening hours; Eastern timezone/DST covered.
- Transactional unique slot locks protect conflicting holds; Stripe session creation has a booking-specific idempotency key.
- Payment confirmation requires server retrieval/validation, not browser redirect success.
- Webhooks verify raw-body signatures and timestamp; mismatched metadata/amount/currency rejected. Deterministic calendar IDs limit duplicate creation.
- Owner routes remain protected in public application mode; booking status requires its secret token; owner listing omits those tokens. Hosting must continue to supply trusted authenticated headers.
- Sandbox credentials never fall back to live keys. Cancellation does not automatically issue a refund; UI explains separate Stripe refund handling.
- Link/card mocked tests cover the return_url conflict fix, declines, and successful confirmation. Hold timer test verifies no polling remount or blanking. Check Status button is absent.
- Court name, written address, meeting instruction, Google Maps and Apple Maps links are present on confirmation and in calendar event creation.
- Forms have labels, status announcements, visible focus rules, native validation, and bounded player counts. Social icon links have accessible labels. Actual VoiceOver/TalkBack, large text, touch-target and viewport inspection remain pending.

## Recommended website-only work order

1. Fix concurrent booking transitions and isolate calendar failures; add regression tests asserting safe final state.
2. Add environment-aware booking recovery and durable hold/calendar reconciliation.
3. Add reload-safe checkout recovery and improve owner pagination/rescheduling.
4. Verify customer notifications and choose whether independent email is required for launch.
5. Perform rendered mobile/desktop, keyboard, large-text and assistive-technology checks; repeat sandbox customer/owner boundary tests and both payment methods.
6. Review launch copy and deliberate launch checklist. Public access/live payments remain a separate explicit authorization.

## Retest gates

Concurrent checkout attempts; payment recovery versus cancellation; duplicate/late webhooks; hold expiry without browser activity; lost creation response; app/tab closure; declined payment; slow network; calendar failure and retry; reschedule conflict and overlapping self-reschedule; cancellation/refund-status behavior; customer token boundaries; owner access; sandbox records during a simulated live-mode transition. Run these with mocked providers or isolated sandbox data, never an unapproved live charge.
