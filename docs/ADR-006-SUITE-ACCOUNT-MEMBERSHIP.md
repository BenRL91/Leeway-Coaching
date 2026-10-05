# ADR-006 — Suite account resolution and application memberships

Status: **Accepted for staged implementation**

Date: 2026-10-04

Affected applications: PaddleLog, Pickle Point, Leeway Coaching

## Decision

LeewayPB uses one shared authentication provider but does **not** use authentication as authorization.

The authorization chain is:

**Supabase identity → Leeway suite account UUID → target-app membership → target-app role/permission → target-app data or action**

A successful Supabase sign-in never automatically grants another application's private data, Pro entitlement, integration scope, or Coaching administration.

## Stable account identity

Existing Leeway account UUIDs are preserved.

During Phase 1, the authoritative issuer+subject → Leeway UUID mapping remains the existing mapping currently implemented with PaddleLog's `leeway_accounts` and `leeway_identities`. This is a temporary registry location, not permission for other applications to query PaddleLog D1.

No other application may mint a competing Leeway suite UUID for an identity that can resolve through the authoritative mapping. A later extraction of the resolver into independent suite infrastructure must preserve UUIDs and mappings exactly.

## Application membership

Membership is independent from identity and entitlement.

Canonical application IDs:
- `paddlelog`
- `pickle_point`
- `leeway_coaching`

A membership is keyed by `(account_id, app_id)` and has an app-specific role and lifecycle status.

Initial roles:
- PaddleLog: `member`
- Pickle Point: `player`
- Leeway Coaching: `customer` or `coach_owner`

Roles do not transfer between applications. Entitlements such as PaddleLog Pro remain separate from membership.

## Membership creation

Existing PaddleLog accounts receive a PaddleLog membership during the additive migration.

New membership must be created through the target application's own onboarding/authorization flow. Resolving a Leeway UUID by itself is not a cross-app membership grant. Coaching `coach_owner` is never self-provisioned.

## Account and application deletion

Application-data deletion and suite-account deletion are separate operations.

PaddleLog's application deletion must remove PaddleLog-owned data and PaddleLog-specific grants/membership while preserving the Leeway suite UUID and identity mappings. It must not delete Pickle Point or Coaching membership/data.

A future suite-account deletion contract will coordinate identity/membership deletion across applications. Until that contract exists, no application may interpret its local Delete Account operation as suite-wide deletion.

## Resolver boundary

Other applications must not read PaddleLog D1 directly.

Phase 1 permits PaddleLog to remain the backing store for the existing resolver while a narrow server-side resolver contract is designed and staging-tested. The future resolver returns only the minimum stable account identity needed by a trusted target service.

Membership/role checks remain target-app authorization decisions. The resolver must authenticate the calling service/audience, must not trust email as an account key, and must not expose PaddleLog library data or entitlements.

## Cross-app integration grants

Application membership is not an integration grant.

Cross-app data/action access requires a separate owner-bound, audience-bound, scoped, revocable grant. PaddleLog usage writes and Coaching handoffs therefore remain gated by their own contracts.

## Environment boundary

Development, staging/sandbox, and production identities/memberships must not silently share private app records or credentials. No production cross-app write is authorized by this ADR.

## Phase 1 implementation

PaddleLog:
1. Add the canonical app-membership schema.
2. Seed `paddlelog/member` for existing active Leeway accounts without changing UUIDs.
3. Separate PaddleLog application-data deletion from suite identity deletion.
4. Add regression tests proving identity preservation and membership isolation.

Pickle Point:
1. Keep `local-owner` explicitly local and unauthenticated.
2. Add no cloud account minting.
3. Document that future cloud onboarding must resolve an existing Leeway UUID and then establish `pickle_point/player` membership.

Leeway Coaching:
1. Keep the current owner gate unchanged in this phase.
2. Add no Supabase authorization yet.
3. Document that future customer/owner authorization must use Leeway UUID resolution plus independent Coaching membership.
4. Preserve the existing server authority over booking/payment/fulfillment.

## Non-goals

This ADR does not provision Pickle Point cloud infrastructure, replace Coaching's current owner gate, enable cross-app writes, create suite subscription bundling, enable live payments, deploy migrations, or extract the registry into a new service yet.

## Migration / rollback

The Phase 1 membership table is additive. Rollback before production use may remove the new membership table without changing existing Leeway UUIDs, identities, PaddleLog library rows, bookings, scoring sessions, or entitlements.

Once another application depends on membership records, rollback requires a versioned migration rather than dropping the table.

## Change rule

Any change to suite account identity, resolver ownership, membership semantics, roles, deletion boundaries, or entitlement separation must update this ADR and identify all affected applications before implementation.
