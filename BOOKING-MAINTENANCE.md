# Checkout recovery and unattended maintenance

October 3, 2026. Website only. Preserve SITE_ACCESS_MODE=owner and STRIPE_MODE=sandbox.

## Implemented

- New checkout attempts store a separate random 256-bit recovery secret before the checkout request. Server stores its SHA-256 hash in the existing booking payload. Recovery requires the secret and matching booking ID, plus same-origin protection. It returns the existing confirmation link, not a new payment session.
- Recent checkout links are kept on the same browser for 48 hours (up to ten attempts), without names, email, goals or payment details. The booking page offers resume/check and forget-device-links controls. Local storage failure does not fabricate recovery persistence. Existing earlier bookings still use their original private confirmation links.
- New bookings record their Stripe environment. Recognizable legacy Stripe session IDs can identify old sandbox/live records. Maintenance does not guess the environment of unknown legacy records. Manual recovery rejects known environment mismatches.
- Owner-only maintenance processes ten due records per call, prioritizing least-recently checked records. It verifies Stripe status, expires only verified-unpaid expired holds, and retries paid calendar confirmation using existing booking logic. Successful unresolved checks retry after two minutes; failures back off from five minutes up to six hours. Batch errors are isolated. No customer data or credentials appear in tool output.
- Site MCP offers read-only booking_maintenance_status and writable reconcile_sandbox_bookings. Data-bearing calls require trusted owner identity. Anonymous discovery reveals only tool descriptions. Maintenance refuses live mode; it never charges/refunds or changes access, payment mode, prices or booking policy.
- Existing expiration webhooks and date/status reconciliation remain active. Adding a maintenance endpoint alone does NOT start background scheduling.

## Activation (outstanding until verified)

1. Publish this version without changing owner-only application access or sandbox mode.
2. Obtain this Site's generated plugin connection via get_site(include_mcp_connection=true); install/connect the returned private plugin as the site owner.
3. Call booking_maintenance_status through that connection. Verify owner authorization and sandbox mode, then run reconcile_sandbox_bookings and read status again. These are authorized recovery operations, not test charges.
4. Re-read linked automations. If none covers this work, create one hourly linked task using the fresh Site-provided schedule request ID. Proposed prompt: “Maintain Leeway Pickleball's sandbox bookings using its connected maintenance tools. Check payment mode first; stop and report if it is not sandbox. Reconcile batches until fewer than ten records were checked, at most ten batches. Report unresolved failures without customer details. Do not charge/refund, change access or payment mode, edit source, or republish.”
5. Verify task enabled and report cadence. Do not claim unattended cleanup active until connection and task creation succeed.

The hourly job is fallback recovery, not a precise expiration timer. Stripe expiry notifications normally release holds promptly. No new independent booking system, external scheduler credentials, or database schema was introduced.

## Validation

All existing test files plus recovery server/browser tests pass. Tests cover secret validation; create/recover integration; same-environment requirements; reload persistence and expiry; malformed saved links; removal of saved references; publication script order; multi-batch fairness (25 records); isolated provider failure; paid versus expired handling; live-mode refusal; unknown/live record safeguards; and owner-only tool access. Existing payment/cancellation race regressions remain passing.

These tests use isolated SQLite, DOM simulation, and mocked providers. Native browser rendering, scheduled remote tool connection and unattended delivery require separate verification. No actual charges, refunds, or calendar writes were performed by the tests.
