# Phase 7 — Documents: grounded codebase audit

**Date:** 2026-09-06 · **Branch:** `feat/project-workspace-shell-overview` · **Method:** read of the
actual schema, controllers, services, repositories, deployment config and frontend. **No code was
changed.** Where a prior design document or the capability matrix disagrees with the code, the code
is reported as the truth and the contradiction is named (§7).

Scope: step 1 of the Phase 7 sequence — audit the current document model and backend — plus step 2
(the project-vs-global boundary) and step 3 (real vs aspirational). IA is **not** locked here; §8
lists the decisions that must be taken before it can be.

---

## 1. Executive verdict

**Documents is not thin. It is broken in production and unsafe in principle.** The register itself
is small but honest; the layer beneath it — `PlatformFile` — is where the problems are, and they are
not proportional to how little the feature does.

Three findings dominate, and all three are P0:

1. **`/files/*` has no authorization beyond "authenticated somewhere in this organisation."** Any
   signed-in user can obtain a download URL for *any* file in the org — a document on a project they
   were never added to, a contract attachment, an IPC certificate, a journal attachment — and can
   delete it. The document *register* checks project membership correctly; the *bytes* do not.
2. **No file is ever immutable.** The rule exists, is documented in ADR-014, is enforced in
   `delete()` — and `markImmutable()` has no caller and no route. Every file in the system is
   deletable, which is what makes finding 1 destructive rather than merely a disclosure.
3. **Upload and download cannot work in the deployed environment at all.** MinIO is deliberately
   not exposed and `storage.rukna.site` is deliberately not routed. `deploy/Caddyfile` says so in
   its own comments. The Documents tab is deployed, reachable, and every upload and every download
   fails.

Below that: five of the six `*Attachment` tables are dead code, deleting a document leaks its file
forever, abandoned uploads leak rows, and nothing in the model can express the two things a
construction document register exists to do — **which revision is current**, and **when this permit
expires.**

The good news, and it is real: `PlatformFile` itself is a sound design. Two-step presigned upload,
bytes never through the API, tenant-partitioned keys, checksum capture, a storage port with a MinIO
adapter behind it. The bones are right. What is missing is authorization, lifecycle, and the
document-control semantics on top.

---

## 2. What actually exists

### 2.1 Schema

| Model | Fields | State |
|---|---|---|
| `PlatformFile` | `originalName · mimeType · sizeBytes · checksumSha256 · storageBucket · storageKey · status(PENDING\|READY) · immutable · uploadedBy · createdAt · confirmedAt` | Live, org-scoped |
| `ProjectDocument` | `projectId · platformFileId · category · title · uploadedBy · createdAt` | Live, project-scoped |
| `DocumentCategory` | `PERMIT LICENSE DRAWING CONTRACT CERTIFICATE INSURANCE GUARANTEE CORRESPONDENCE PHOTO OTHER` | Fixed enum, 10 values, not configurable |
| `DprAttachment` | `dprId · platformFileId · createdBy` | Live — the only attachment table with code behind it |
| `ContractAttachment` | `contractId · platformFileId` | **Dead** — zero reads, zero writes |
| `GuaranteeAttachment` | `guaranteeId · platformFileId` | **Dead** |
| `IpaAttachment` | `ipaId · platformFileId` | **Dead** |
| `IpcAttachment` | `ipcId · platformFileId` | **Dead** |
| `JournalEntryAttachment` | `journalEntryId · platformFileId` | **Dead** |

`ProjectDocument` has **no** date field other than `createdAt`, **no** status, **no** revision or
supersede link, **no** issuer, **no** expiry, and **no** reference number.

### 2.2 Endpoints

```text
POST   /files                    presign an upload            JWT only
POST   /files/:id/confirm        mark READY                   JWT only
GET    /files/:id/download       signed GET URL               JWT only
DELETE /files/:id                delete bytes + metadata      JWT only

POST   /projects/:id/documents   attach a READY file          projects:manage + assertMember
GET    /projects/:id/documents   list the register            projects:view  + assertMember
DELETE /projects/:id/documents/:docId                         projects:manage + assertMember

POST   /progress/dprs/:dprId/attachments   DPR evidence       (progress permissions)
```

The asymmetry in the middle of that table is finding P0-1.

### 2.3 Frontend

One component, `documents-tab.tsx` (316 lines): an upload form (file, title, category), a table
(title + original name, category badge, size, uploaded-at, download, delete), a confirm dialog for
delete, loading/error/empty states. `use-file-upload` chains presign → PUT → confirm.

**Zero tests.** No filter, no search, no pagination, no uploader column, no linked-documents
section.

---

## 3. P0 findings

### P0-1 — `/files/*` is authenticated but not authorized

`FilesController` declares `@UseGuards(JwtAuthGuard)` and **no `@RequirePermissions`**.
`PermissionsGuard` returns `true` when no permission is declared:

```ts
// common/guards/permissions.guard.ts:24
if (!required?.length) return true;
```

and the repository scopes by organisation only:

```ts
// platform/files/infrastructure/platform-file.repository.ts:39
return prisma.platformFile.findFirst({ where: { id, organizationId } });
```

There is no project-membership check anywhere in `PlatformFileService`. So for any file id in the
organisation, any authenticated user can:

- `GET /files/:id/download` → a valid 15-minute signed URL to the bytes;
- `DELETE /files/:id` → destroy them (subject only to `immutable`, which is never set — P0-2).

That reaches every file the platform holds: project documents on projects the caller is not a
member of, DPR site evidence, and — once anything ever writes them — contract, guarantee, IPA, IPC
and journal attachments.

`ProjectDocumentService` calls `projectAccess.assertMember` on all three of its operations. The
register is correctly gated; the payload behind it is not. **The access control is on the index, not
on the content.**

Severity is raised by the ids being cuids rather than sequential — guessing is impractical — but a
file id is not a secret: it is returned in every `ProjectDocumentResponse.platformFileId`, so any
member of *one* project holds valid ids and the org-wide grant makes lateral movement trivial.

### P0-2 — nothing is ever immutable

```ts
// platform/files/application/platform-file.service.ts:84
/** Mark a file immutable — called by an attaching module when the file becomes audit-relevant. */
async markImmutable(identity: RequestIdentity, fileId: string) { … }
```

`grep -rn "markImmutable" apps/api/src` returns exactly one line: the definition. No caller, no
controller route, no test. `immutable` defaults to `false` and nothing writes `true`.

So the guard in `delete()` — the one ADR-014 rests on, the one the spec calls "immutable where
audit-relevant" — never fires. Every file is deletable. The capability matrix records this as
"immutable-where-audit-relevant · INTEGRATED"; it is declared, not integrated.

### P0-3 — file storage is unreachable in production

`deploy/Caddyfile`, in its own words:

> `storage.rukna.site` is intentionally omitted: MinIO is kept internal (not on `deploy_internal`),
> so browser file uploads are deferred until you deliberately expose MinIO. Everything except the
> Documents/file feature works.

`MINIO_ENDPOINT=https://storage.rukna.site` is what the adapter signs URLs against
(`minio-file-storage.adapter.ts:30`), and the browser is what has to follow them — the whole point of
presigned upload is that the bytes never pass through the API. That host is not routed. Both the PUT
and the GET fail.

The Documents tab is nevertheless shipped and linked in the project shell. A user on
`acco.rukna.site` today sees an upload form that cannot succeed and a download button that cannot
resolve. This is the one finding that is not a code defect — it is a deployment decision that was
taken deliberately and never revisited, and it means **Phase 7 has an infrastructure prerequisite,
not just a product one.**

---

## 4. P1 findings

### P1-1 — five of six attachment tables are dead code

```text
contractAttachment      0 references outside the schema
guaranteeAttachment     0
ipaAttachment           0
ipcAttachment           0
journalEntryAttachment  0
dprAttachment           1  (progress.repository.ts — the only live one)
```

The existing spec defers "Linked documents" and describes the blocker as a missing aggregation
endpoint (`GET /projects/:id/linked-documents`). That is not the blocker. **The tables have no rows
and no way to get any** — step 3 of that spec's own sequence, "wire the existing `*Attachment`
uploads to real files", was never done. An aggregation endpoint built today would correctly return
an empty list forever.

This matters for scoping: "Linked documents" is not one read model. It is five upload paths in five
different modules, each with its own authorization and lifecycle question (can you attach to a
POSTED journal? to an issued IPC?), plus a read model on top.

### P1-2 — deleting a document leaks its file permanently

`ProjectDocumentService.remove()` deletes the `ProjectDocument` row and nothing else. The comment is
honest about it — *"The underlying PlatformFile is governed by its own immutability"* — but nothing
governs it: the row stays, the object stays in the bucket, and the only route that could remove it
(`DELETE /files/:id`) is never called by this flow. Every delete leaks storage and leaves an
unreferenced file that P0-1 still exposes.

### P1-3 — abandoned uploads leak rows

`initiateUpload` creates a `PENDING` row before the bytes exist. Two ordinary paths orphan it:

- the user picks a file, changes their mind, and never uploads → a permanent `PENDING` row;
- the upload succeeds but `attach` fails (validation, permission, a lost connection between the two
  mutations in `UploadForm.onSubmit`) → a permanent `READY` row referenced by nothing.

No reaper exists — no cron, no scheduled task, no `deleteMany` anywhere in `platform/files`.

### P1-4 — nothing in the model expires

Four of the ten categories — `PERMIT`, `LICENSE`, `INSURANCE`, `CERTIFICATE` — describe instruments
whose entire operational significance is that they run out, and whose expiry stops work on a site.
`ProjectDocument` carries no date but `createdAt`.

The only expiry in the whole schema is `ContractGuarantee.expiryDate`, with `@@index([expiryDate,
status])` — a commercial instrument on the contract aggregate, not a document. So the platform can
already answer "which guarantees expire this quarter" and cannot answer "which permits do".

### P1-5 — no revision or version concept

ADR-014's "version-by-append" is a *storage* rule: don't overwrite bytes. It is not a product rule,
and nothing implements one. Uploading "Structural drawings" twice produces two unrelated rows with
no supersede link, no revision number, no current-version marker and no ordering beyond `createdAt`.
The register cannot answer *"which drawing is the one to build from"*, which is the question a
drawing register exists to answer.

Contrast BOQ and the programme, which both implement supersede-don't-overwrite properly.

### P1-6 — reads are not audited, and the delete audit names the wrong resource

`AuditInterceptor` skips read methods by design (`READ_METHODS` = GET/HEAD/OPTIONS). So **who
downloaded which document is not recorded anywhere.** For permits, contracts and guarantees in a
construction ERP, download traceability is frequently the point of the register.

And `resourceId()` resolves `params['id'] ?? params['projectId'] ?? …`. On
`DELETE /projects/:projectId/documents/:docId` the param is `docId`, so the audit row records the
**project** id, not the document that was deleted. The audit says a document was deleted from
project X without saying which one.

### P1-7 — `checksumSha256` is never populated

The column exists, the confirm DTO accepts one, and the integrity story in the refinement spec
depends on it — *"Upload → `PlatformFile` (checksum, mime/size captured)"*. Neither side supplies
one:

- the frontend calls `confirmUpload(fileId)` with no body (`files-api.ts:83`), so `dto` is `{}`;
- the MinIO adapter's `statObject` returns `{ exists, sizeBytes }` and nothing else
  (`minio-file-storage.adapter.ts:74`).

So `checksum = dto.checksumSha256 ?? stat.checksumSha256 ?? null` resolves to `null` on every
upload the platform has ever done. There is no integrity record, and no way to detect that stored
bytes differ from what was uploaded. The size is read back from storage, so `sizeBytes` is real; the
checksum is not.

### P1-8 — no upload constraints

No maximum size and no mime allowlist, on either side. `InitiateUploadDto` validates that
`mimeType` is a non-empty string under 255 characters and signs the URL with whatever the browser
reported. `sizeBytes` is read back from storage after the fact. Caddy caps the request body at
512MB for `api.rukna.site`, but the upload does not go through Caddy — it goes straight to object
storage.

---

## 5. P2 findings (UI and product surface)

- **No filter or search.** The existing spec promises "by category, by linked entity, by date". None
  is built. The register is an unpaginated `findMany` rendered as one table.
- **No uploader shown.** `uploadedBy` is stored and returned, and the mockup in the spec has an
  uploader column. The table does not render it — and could not usefully, because it is a raw user
  id with no name resolution.
- **No pagination.** `findByProject` returns every row. A real drawing register is hundreds.
- **Zero frontend tests.** For comparison, Finance ships 155 test files. `documents-tab.tsx` has
  none — no test asserts that the two-step upload chains correctly, that a failed attach surfaces,
  or that delete confirms.
- **Categories are a fixed enum.** Ten values, hard-coded in the schema. Project Subtype solved the
  same shape of problem with an admin-configurable seeded registry; Documents did not.
- **Backend coverage is thin.** `project-document.service.spec.ts` is 63 lines.

---

## 6. The project-vs-global boundary (step 2)

**Today: everything is project-scoped. There is no organisation-level document register.**

That is a real gap, not a simplification. Several document classes ACCO holds are unambiguously
company documents, not project documents:

| Document | Belongs to | Today |
|---|---|---|
| Company trade licence, tax registration | Organisation | Nowhere |
| Corporate insurance policies (PL, EL, plant) | Organisation | Nowhere |
| ISO / prequalification certificates | Organisation | Nowhere |
| Standard terms, template contracts | Organisation | Nowhere |
| Supplier trade licence, supplier insurance | Supplier | Nowhere |
| Building permit, site licence | Project | `ProjectDocument` |
| Drawings, method statements | Project | `ProjectDocument` |
| Contract PDF, IPC, guarantee scan | A record inside a project | Dead tables (P1-1) |
| DPR photos | A record inside a project | `DprAttachment` (live) |

The storage layer already supports the org level — `PlatformFile.organizationId` is the scope, and
`ProjectDocument` is the thing that narrows it. So an org register is an aggregate plus a screen,
not an architectural change.

**The boundary that matters is not project-vs-global; it is register-vs-attachment.**

- A **register document** is a first-class thing the business tracks: it has a title, a category, an
  issuer, a validity period, a revision, and someone is accountable for it. Permits, licences,
  drawings, insurance.
- An **attachment** is evidence bound to a record and meaningless apart from it: the scan of *this*
  IPC, the photo on *this* DPR. Its lifecycle is the record's lifecycle.

The current model conflates them — `ProjectDocument` is the register, the `*Attachment` tables are
attachments, and the spec proposed to merge both into one tab. That is the right *view*, but they
must not become one *aggregate*: an attachment must never be deletable from the register, and a
register document must never be silently governed by a record's lifecycle.

---

## 7. Real vs aspirational (step 3)

Measured against the capability list in the Phase 7 brief:

| Capability | Status | Evidence |
|---|---|---|
| drawings | **Category label only** | An enum value. No revision, no current-version marker (P1-5) |
| permits | **Category label only** | No expiry, no issuer, no reference (P1-4) |
| contracts | **Aggregate real, file dead** | `Contract` is a full aggregate; `ContractAttachment` has no code |
| guarantees | **Instrument real, file dead** | `ContractGuarantee` has amount, issuer, beneficiary, issue/expiry dates, status, indexed. `GuaranteeAttachment` has no code |
| site records | **Real** | `DprAttachment` + `POST /progress/dprs/:id/attachments`, wired end to end |
| correspondence | **Category label only** | No sender/recipient, no date, no thread |
| commercial documents | **Dead** | IPA/IPC attachment tables unused |
| versions | **Does not exist** | P1-5 |
| status | **Does not exist** | `ProjectDocument` has no status field |
| ownership | **Stored, never surfaced** | `uploadedBy` is a raw id; the UI does not render it |
| expiry | **Guarantees only** | P1-4 |
| traceability | **Half** | Writes audited generically; reads not at all; delete names the wrong id (P1-6) |

**Contradiction with `docs/01-capability-matrix.md` line 37–38.** It records file storage as
`INTEGRATED` with "immutable-where-audit-relevant", and the document register as `PARTIAL` with only
linked-documents deferred. Per the standing rule that the code wins: immutability is **declared but
never invoked** (P0-2), and linked documents is blocked by five unwritten upload paths, not by one
missing read model (P1-1). The matrix should be corrected as part of Phase 7, not before — it is
accurate about what was *built*, and wrong about what *works*.

---

## 8. Decisions required before the IA can be locked (step 4)

These are the questions where a wrong assumption would produce the wrong screens. Grouped by who
can answer them.

### For the platform owner (Abdulsalam)

- **D1 — Is exposing MinIO in scope for Phase 7?** If not, Phase 7 is unverifiable in the deployed
  environment and can only be QA'd locally. This is the gating decision, not a detail.
- **D2 — Does the org-level register ship in Phase 7, or does Phase 7 stay project-only?** The
  boundary in §6 says it is a small addition; the IA differs substantially between the two.
- **D3 — Do the five dead attachment paths get wired in Phase 7, or does "Linked documents" stay
  deferred with the reason corrected?** Five modules' worth of upload UI is not a small slice.

### For the domain expert (Eng Ahmed Shirie)

- **D4 — Which document classes actually expire, and what happens when one does?** A warning on the
  project? A block on issuing an IPA? Nothing but a list? This determines whether expiry is a field
  or a control.
- **D5 — Do drawings need controlled revisions** (Rev A / Rev B, one current, superseded retained),
  or is "upload the new one" acceptable? This is the difference between a file list and a document
  register.
- **D6 — Who may delete a document, and may anything be deleted at all** once it is a permit or a
  contract? Today any project member with `projects:manage` can hard-delete anything.
- **D7 — Is a transmittal / distribution record needed** (who was issued which revision, when), or
  is that beyond ACCO's current practice? The existing spec puts it out of scope; that predates the
  rest of the platform maturing.

### Sequencing this audit recommends

Not a proposal to build — a proposal for what order the questions get answered in.

1. **Fix P0-1 and P0-2 first, independently of Phase 7.** They are live defects on shipped code and
   do not depend on any IA decision. `/files/:id/download` must resolve the file's owning record and
   check access through it; `markImmutable` must be called by the attaching modules or deleted.
2. **Settle D1.** Without it there is no runtime QA gate, and Phase 6's lesson was that the runtime
   gate is what makes a phase real.
3. Then D4/D5 (they decide the aggregate), then D2/D3 (they decide the IA), then screens.

---

## 9. What this audit did not examine

Named so the gaps are not mistaken for clean bills of health: MinIO bucket policy and retention
settings on the deployed box; the presigned-URL TTL in practice; virus scanning (none exists, and
nothing in the flow could host it since the bytes never reach the API); and the `RetailModule` /
`ManufacturingModule` document needs, which are outside the construction scope this audit covers.
