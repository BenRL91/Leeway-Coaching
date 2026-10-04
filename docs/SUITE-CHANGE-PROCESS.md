# LeewayPB suite change process

PaddleLog, Pickle Point, and Leeway Coaching remain separate repositories, data stores, deployment targets, and release processes.

## Authority boundaries

- Shared Supabase authentication establishes identity only.
- Each app separately owns membership, permissions, private data, and entitlements.
- PaddleLog owns physical paddle records, accepted usage, maintenance and wear.
- Pickle Point owns scoring sessions, matches, games and scoring journals.
- Leeway Coaching owns services, pricing, availability, holds, bookings, payments, cancellations, rescheduling and fulfillment.
- No application may write directly to another application's database.

## Delivery path

Development branch -> local verification -> PR -> CI/review -> merge -> isolated staging -> migrations -> contract tests -> device/provider QA -> explicit production approval -> independent production deployment -> smoke test/observation -> ADR/change-log update.

A merge is not a production deployment authorization.

## Shared-change gate

Changes to identity/account resolution, app membership, authorization, entitlements, integration grants, API/event contracts, synchronization, deletion, cross-app data ownership or environment boundaries require an ADR/change-log entry and identification of every affected app.

Production cross-app writes remain gated until the applicable suite contracts and staging tests are approved.
