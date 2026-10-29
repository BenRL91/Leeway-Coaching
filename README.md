# Leeway Coaching

**Booking and video-breakdown fulfillment for a pickleball coaching business.**

Leeway Coaching connects customer requests with the operational work behind them: availability, booking holds, payment reconciliation and review fulfillment. The repository includes the customer-facing website, owner tools and a Worker backend.

[Booking operations](BOOKING-MAINTENANCE.md) · [Breakdown workflow](BREAKDOWN-FULFILLMENT.md) · [Payment setup](STRIPE_INTEGRATION_TODO.md) · [Contributing](CONTRIBUTING.md)

## Core workflows

- Browse coaching information and request available booking slots.
- Coordinate checkout holds with booking records and calendar availability.
- Submit footage or a video link for a coaching breakdown.
- Track review progression through approval, payment and fulfillment.
- Manage setup and breakdown queues through server-protected owner tools.

## Engineering highlights

| Concern | Implementation focus |
| --- | --- |
| Booking contention | Durable slot locks and transactional collision handling |
| Payment correctness | Server-side verification, idempotent attempts and webhook reconciliation |
| Provider failures | Explicit pending/recovery states rather than treating redirects as confirmation |
| Calendar consistency | Stable event identifiers and retry-aware provider operations |
| Private uploads | Multipart upload handling and server-authorized access |
| Business rules | Domain logic separated from external provider adapters |

The stack is JavaScript, Cloudflare Workers, D1 and Drizzle, with Stripe and Google Calendar provider integrations. Integration code and mocked tests do not imply that live payments are enabled or providers are configured in a fresh checkout.

## Development

```sh
npm ci
npm test
npm run build
```

See [.env.example](.env.example) for configuration names and [payment setup](STRIPE_INTEGRATION_TODO.md) for current launch requirements. Supply secrets through the runtime configuration mechanism. Test provider operations with sandbox credentials.

## Code tour

| Path | Responsibility |
| --- | --- |
| [public/](public/) | Customer pages, booking UI and owner tools |
| [worker/domain.js](worker/domain.js) | Booking domain rules |
| [worker/providers.js](worker/providers.js) | External service adapters |
| [worker/breakdowns.js](worker/breakdowns.js) | Review intake and fulfillment |
| [worker/maintenance.js](worker/maintenance.js) | Booking recovery and maintenance |
| [db/](db/), [drizzle/](drizzle/) | Schema and migrations |
| [tests/](tests/) | Domain, provider-failure and browser-emulation checks |

## Release and verification boundaries

Live payments require separate authorization. Tests cover booking, breakdowns, forms and recovery with provider mocks; hosted Stripe/Google/R2 verification and physical-device QA remain distinct release checks.

Historical setup documents include earlier implementations. [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) supersedes the original hosted-checkout setup notes. This branch documents the currently checked-in source while deployed-source synchronization proceeds separately.

Coaching owns its booking, pricing, payment and fulfillment records. Other suite apps must use reviewed APIs and must not write its database directly. See [suite change process](docs/SUITE-CHANGE-PROCESS.md).

## Related projects

| Project | Responsibility |
| --- | --- |
| [PaddleLog](https://github.com/BenRL91/PaddleLog) | Equipment, maintenance and usage history |
| [Pickle Point](https://github.com/BenRL91/Pickle-Point) | Scoring, games and sessions |
| [Leeway Coaching](https://github.com/BenRL91/Leeway-Coaching) | Booking and breakdown fulfillment |
| [Leeway Replay](https://github.com/BenRL91/Leeway-Replay) | Private video reviews and discussion |
| [Leeway Common](https://github.com/BenRL91/Leeway-Common) | Shared notification components and service |

Each repository has its own release lifecycle. Shared identity does not grant access to another app's private data.
