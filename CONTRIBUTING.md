# Contributing to Leeway Coaching

Leeway Coaching is independently releasable within the LeewayPB suite.

- Keep main releasable; use short-lived feat/, fix/, or arch/ branches.
- Every change goes through a pull request and CI.
- Prefer squash merge unless preserving commits has a clear reason.
- Merge to main creates a release candidate; it does not authorize production deployment or live-payment changes.

## Local verification

    npm ci
    npm test
    npm run build

## Authority boundary

Leeway Coaching alone owns services, pricing, availability, holds, bookings, payment state, cancellations, rescheduling and fulfillment. Other LeewayPB apps must use reviewed, versioned APIs/handoffs and must never write Coaching D1 directly.

Any change to identity, membership, booking/payment contracts, integration grants or cross-app projections must follow docs/SUITE-CHANGE-PROCESS.md. Live payments require separate explicit authorization.
