---
Status: accepted
---

# Files: a shared immutable `PlatformFile` entity behind a `FileStoragePort`, MinIO as the first adapter

## Context

Five attachment link tables (`ContractAttachment` and siblings, `JournalEntryAttachment`) already
carry a `platformFileId`, but **no `PlatformFile` model exists** — the columns point at a table that
was never built, and there is no storage service or upload/download endpoint anywhere. Sprint 5's
promised shared file-serving layer was never delivered; only the per-entity join tables were added.
Construction runs on signed documents, and `JournalEntryAttachment` already declares POSTED
attachments undeletable (audit evidence).

## Decision

Introduce `PlatformFile` as the shared, immutable file-metadata entity. The existing per-entity
attachment tables become relationships to `PlatformFile`. Bytes live in **S3-compatible object
storage behind a `FileStoragePort`**, with **self-hosted MinIO as the initial adapter**. Files are:

- **tenant-partitioned** (per-tenant bucket or key prefix, consistent with one-Postgres-per-tenant),
- **private**, served only through **authorization-gated, short-lived signed URLs**,
- **checksum-protected** (integrity verified on store and serve),
- **immutable where audit-relevant** — posted/audit-relevant attachments cannot be deleted or
  overwritten; later evidence is appended as a new immutable `PlatformFile`.

The storage adapter stays replaceable so a managed S3-compatible store can be adopted later without
changing any domain module.

## Consequences

- No cloud dependency for the pilot — MinIO is self-hostable on ACCO-controlled infrastructure,
  which also satisfies in-country data-residency if it is required.
- Domain modules depend on the port, not on S3/MinIO SDKs; the swap to managed storage is an adapter
  change, not a migration.
- Immutability is enforced at both the metadata layer (no delete on audit-relevant rows) and,
  preferably, the object layer (versioning / object-lock) — a mutable filesystem was rejected for
  this reason.
