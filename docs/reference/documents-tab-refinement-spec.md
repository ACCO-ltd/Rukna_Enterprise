# Documents tab — refinement spec

Status: **PARTIALLY BUILT (2026-08-19).** PlatformFile (ADR-014) + the standalone **Project documents**
register (§1) and the Documents tab UI are built and shipped. The **Linked documents** aggregation (§2)
is **DEFERRED** — its own future task (see the §2 note below). Not gated anymore; it's a scoped follow-up.
Owners: Backend — Abdulsalam · Frontend — frontend engineer · Storage decision — ADR-014.

## Purpose

ACCO needs a project **document register** — "permits, etc., doc upload with a name." Today there is
**no file storage at all**: `PlatformFile` (ADR-014) is unbuilt, and five `*Attachment` tables
(`ContractAttachment`, `GuaranteeAttachment`, `IpaAttachment`, `IpcAttachment`,
`JournalEntryAttachment`) carry a `platformFileId` that points at a **non-existent table**. So the
Documents tab cannot exist until PlatformFile lands — and PlatformFile is also the unblocker for
**Progress evidence** (ADR-021). Build it once; both light up.

## Prerequisite (ADR-014 — build first)
- **`PlatformFile`** — the shared, immutable file-metadata entity: `originalName`, `mimeType`,
  `sizeBytes`, `checksum`, `storageKey`, `uploadedBy`, `immutable`, tenant/org scope.
- **`FileStoragePort`** with a **MinIO** adapter (self-hosted; swap to managed later is an adapter change).
- **Private serving via authorization-gated, short-lived signed URLs.** No public bucket.
- **Immutable where audit-relevant** — posted/audit-relevant files can't be deleted/overwritten;
  new evidence is appended as a new `PlatformFile`.
- Resolve the five dangling `*Attachment.platformFileId` FKs to the new table.

## The Documents workspace — two kinds of document

**1. Project documents (standalone — the "permit" case).** New `ProjectDocument` aggregate:
`projectId · platformFileId · category · title · uploadedBy` (mirrors the `*Attachment` link pattern).
These are uploaded *in the Documents tab* and belong to the project, not to a specific contract/IPA.
`category ∈ PERMIT | LICENSE | DRAWING | CONTRACT | CERTIFICATE | INSURANCE | GUARANTEE |
CORRESPONDENCE | PHOTO | OTHER`.

**2. Linked documents (aggregated — read-only). — DEFERRED (2026-08-19), own future task.** The Documents
tab also **surfaces every file attached elsewhere in the project** — contract attachments, IPA/IPC
attachments, guarantee attachments, DPR evidence — each with a link back to its entity. One place to see
*all* project files; you manage the standalone ones here and jump to the entity for the rest.

> **Deferred:** this section is not built. It needs a backend read model aggregating the five
> `*Attachment` tables (`Contract`/`Guarantee`/`Ipa`/`Ipc`/`Dpr`) through their joins to the project — a
> bounded, read-only endpoint (`GET /projects/:id/linked-documents`) — plus a "Linked documents" section
> in `documents-tab.tsx`. Tracked as a scoped follow-up, not an accidental gap. The standalone register
> (§1) ships without it.

```
DOCUMENTS — Al-Baraka

PROJECT DOCUMENTS            [+ Upload]         (permits, drawings, licenses…)
  Building permit           PERMIT      12 Jun   Ahmed     [view]
  Structural drawings v2    DRAWING     10 Jun   Farah     [view]

LINKED DOCUMENTS  (attached to records — view here, manage on the record)
  Main contract PDF         → Contract CN-1
  IPC-003 certificate       → Commercial › Applications
  Performance guarantee     → Commercial › Contract & Terms
```

## Behaviour
- **Upload** → `PlatformFile` (checksum, mime/size captured) → `ProjectDocument` row with title +
  category. **View/download** → a short-lived **signed URL** (authorization-gated), never a public link.
- **Immutability:** audit-relevant files (contract/IPC/guarantee/journal attachments) cannot be
  deleted; a re-issue is a **new** file (version-by-append), consistent with ADR-014 and the
  BOQ/programme "supersede, don't overwrite" pattern.
- **Access:** upload/manage gated by project membership + permission; org authorities (ADR-022) see
  documents via their project access (ADR-009).
- **Filter/search:** by category, by linked entity, by date.

## Connections
- **Progress (ADR-021):** DPR photo/measurement evidence is `PlatformFile` too — the Documents tab and
  the DPR evidence layer share the same storage. Programme must not create separate file storage.
- **Commercial / Contracts:** the existing `*Attachment` rows become live (real files) once
  PlatformFile exists; the Documents tab reads them for the "Linked documents" list.

## Sequence
1. **PlatformFile MVP** (ADR-014) — model + `FileStoragePort` + MinIO + signed-URL serving + FK
   resolution. *Prerequisite for everything below.*
2. **`ProjectDocument`** + upload/list/serve endpoints; the Documents tab (Project + Linked sections).
3. Wire the existing `*Attachment` uploads (contract/IPA/IPC/guarantee) to real files.

## Out of scope (for now)
Document approval workflows, transmittals/registers with revisions and distribution, OCR/full-text
search, retention policies. Start with a clean upload-name-categorize-serve register; add governance
only when ACCO demonstrates the need.
