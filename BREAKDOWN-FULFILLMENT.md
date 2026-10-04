# Breakdown fulfillment

Sandbox-only implementation; existing site owner gate is preserved.

- Customer intake/tracker: `/breakdown.html`; private capability in URL fragment.
- Coach queue: `/owner-breakdowns.html`, server-authorized owner only.
- $99 review; optional $49 call, one $148 payment. Up to 25 minutes of source footage, one player.
- MP4/MOV/WebM uploads up to 1 GB use private R2 multipart uploads in 8 MB chunks. Video links also supported; server never fetches arbitrary submitted URLs.
- Approval precedes payment. Stripe session is idempotent per order/attempt and verified server-side; webhook and status retrieval can reconcile payment.
- Deadline: three weekdays after payment, Eastern calendar, Monday–Friday; no holiday calendar.
- Coach marks started and completed. Delivery requires a YouTube link and priorities/drills. Coach must upload the final video as unlisted; URL alone cannot verify YouTube visibility.
- Call scheduling requires completed + paid + add-on on the server. Calls use the existing coaching hours, shared slot locks and Google Calendar. Availability checks use the 30-minute call duration.
- Calendar request creates Google Meet conference data. If Google has not returned a joining link, tracker must be refreshed; Google account must support Meet conferencing.
- Copy customer tracker link to notify approval/delivery manually. No automatic email sender has been configured.
- File upload may be retried on the open intake page; interrupted upload after reload can be replaced with a link. Unfinished multipart upload retention/cleanup is not automated yet.
- Policy decision before live launch: breakdown cancellation/refund terms and source-footage retention period. Live checkout is hard-blocked in this module.

Validation: automated intake, access denial, upload completion, payment/state progression, deadline, add-on gates, shared slot collision and calendar idempotency. Physical browser/device and hosted R2/Stripe/Google end-to-end verification remain required.
