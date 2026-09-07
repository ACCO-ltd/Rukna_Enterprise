# Phase 7 Step 2 — Document security, storage foundation, and attachment classification

**Date:** 2026-09-07 · **Branch:** `feat/project-workspace-shell-overview` · **Scope:** the three
P0 defects from `documents-phase7-audit.md`, plus the classification and design work that has to
precede an IA lock. **No Documents UI was designed or built.**

---

## 1. The three concepts this phase separates

These do not collapse into one "document" model, and every decision below follows from keeping them
apart.

| | What it is | Identity | Lifecycle owner |
|---|---|---|---|
| **`PlatformFile`** | Storage infrastructure. Blob metadata: bytes, size, mime, checksum, key. | A storage key | Itself — the `PlatformFileLifecycle` below |
| **`DocumentRecord`** | A controlled business document tracked in its own right: title, category, issuer, validity, revision, owner, status. Today the thin form of this is `ProjectDocument`. | A business identity that survives its file being replaced | The register |
| **Attachment** | Evidence bound to another record and meaningless apart from it — the scan of *this* IPC, the photo on *this* report. | Its parent's identity | The parent aggregate |

A file's *permissions* come from whatever owns it. A register document's *lifecycle* is its own. An
attachment has no lifecycle of its own at all. That is the whole model.

---

## 2. P0-1 — file authorization

### What was wrong

`FilesController` declared no `@RequirePermissions`. `PermissionsGuard` returns `true` when none is
declared (`permissions.guard.ts:24`). `PlatformFileRepository.findById` scopes by `organizationId`
alone. So any authenticated user could `GET /files/:id/download` or `DELETE /files/:id` for any file
in the organisation — a document on a project they were never added to, site evidence, anything.
The register endpoint checked project membership correctly; **the access control was on the index,
not on the content.** File ids are not secret: every list response hands them out, so this was
lateral movement rather than a guessing game.

### The model

`FileAuthorizationService` (`apps/api/src/platform/files/application/file-authorization.service.ts`).
One resolver, three assertions:

```
resolveOwnership(identity, fileId)   →  every business record that claims this file
assertCanRead(identity, fileId)      →  may the bytes be served?
assertCanWrite(identity, fileId)     →  may the file's own metadata change?
assertCanDelete(identity, fileId)    →  may the bytes be destroyed?
```

**Ownership resolution** walks from the file to its owning aggregate and asks that aggregate's own
rule — the same `ProjectAccessService` the rest of construction uses:

| Owner | Resolution | Rule |
|---|---|---|
| `ProjectDocument` | → `projectId` | `view:project` **and** project membership |
| `DprAttachment` | → DPR → `projectId` | `view:project` **and** project membership |
| *nothing yet* | — | the uploader alone, plus the roles that already bypass project membership |

The two current owners resolve identically and are still written as separate cases, because they
will not stay identical: a DPR will gain its own visibility rule long before the register does.

**Read is a union, delete is not.** One owner granting access is enough to read — a file
legitimately attached to two records is readable by anyone who can read either. Deletion is the
opposite: it is refused whenever *anything* owns the file, so there is exactly one deletion path per
file and it runs through the aggregate that knows the rules.

**An unowned file is private to its uploader**, not org-readable. Between presign and attach there
is no business record to speak for it, and that window is where the old defect was widest.

**Cross-organisation is `404`, not `403`.** Confirming that an id exists in another tenant is itself
a disclosure.

### Routes covered

| Route | Assertion |
|---|---|
| `POST /files` | none needed — creates a new file owned by the caller |
| `POST /files/:id/confirm` | `assertCanWrite` |
| `GET /files/:id/download` | `assertCanRead` |
| `DELETE /files/:id` | `assertCanDelete` |

The controller still declares no blanket permission, and that is now deliberate rather than an
omission — documented in the controller itself. A blanket permission would be wrong in both
directions: too weak, because holding it says nothing about the specific project the file belongs
to; and too strong, because the permission that should govern a drawing is the one that governs its
project, which differs per file. The decision cannot be made before the id is resolved, so it is
made in the service, on every route. **Do not add a route that reaches a file without going through
`FileAuthorizationService`.**

---

## 3. P0-2 — file lifecycle

### What was wrong

`markImmutable()` had exactly one reference in the repository: its own definition. No caller, no
route, no test. `immutable` defaulted to `false` and nothing ever wrote `true`, so the guard in
`delete()` never fired and every file in the system was deletable.

### The lifecycle

`immutable BOOLEAN` was a two-state field for a three-state problem. It is replaced by
`PlatformFileLifecycle`:

```
TEMPORARY  uploaded, owned by nothing. Private to the uploader. Reaped after the retention window.
BOUND      attached to a record whose workflow may still legitimately replace it.
IMMUTABLE  the owning record finalised. No hard delete, ever. Corrections append.
```

### Transitions actually wired

| Event | Transition | Where |
|---|---|---|
| `POST /files` | → `TEMPORARY` | `PlatformFileService.initiateUpload` |
| Attach a project document | `TEMPORARY` → `BOUND` | `ProjectDocumentService.attach` |
| Attach DPR evidence | `TEMPORARY` → `BOUND` | `ProgressService.attachEvidence` |
| **DPR approved** | `BOUND` → `IMMUTABLE` | `ProgressService.approve` |
| Detach a project document | file discarded | `ProjectDocumentService.remove` |

**Project documents deliberately stop at `BOUND`.** The register has no finalisation event — a
`ProjectDocument` has no status, no issue, no revision — so freezing its files would assert a
control the model cannot express. That is the honest position and it changes when the register's
own lifecycle lands (§7). Marking every bound file immutable would have been the easy answer and
the wrong one: it makes a draft workflow lie.

**DPR evidence does freeze**, because CONST-PROG-008 makes approval the point at which measurements
become verified, so the evidence behind them is part of the record from then on. A `REOPENED`
correction appends new evidence; it never releases the old — the same supersede-don't-overwrite rule
the BOQ and the programme already follow.

### Delete semantics

| State | `DELETE /files/:id` | Through the owning record |
|---|---|---|
| `TEMPORARY` | uploader, or a bypass role | n/a |
| `BOUND` | **refused** — "remove it from that record instead" | permitted while the parent's workflow permits it; discards the file too |
| `IMMUTABLE` | **refused**, for everyone including an administrator | **refused** — attach a replacement |

The immutability check is enforced in two places on purpose: in the file authorization service and
again in `ProjectDocumentService.remove`. A register that could delete its own row while the file
API refused the file would leave orphaned bytes and a missing record.

For controlled records the eventual verbs are **archive / withdraw / supersede**, not delete — but
those need the register's lifecycle first, so nothing pretends to offer them yet.

### The leak this also fixed (audit P1-2)

Removing a document used to delete only its own row, leaving the file and the bytes behind forever.
`ProjectDocumentService.remove` now calls `PlatformFileService.discardIfUnreferenced`, which
re-reads the bindings itself rather than trusting the caller, refuses to touch an `IMMUTABLE` file,
and removes the object before the row.

---

## 4. P1-3 — abandoned upload cleanup

`POST /files` creates a row before the bytes exist, and two ordinary paths leave one behind: a user
who picks a file and changes their mind, and an upload that succeeds while the attach that should
follow it fails. Nothing reaped them.

**Eligibility is `TEMPORARY` *and* older than the retention window** — lifecycle first, age second.
Nothing ever bound the file, so no business record can be harmed. `BOUND` and `IMMUTABLE` are never
considered at any age; a test asserts the query itself, because a cleanup that widened its filter
would be catastrophic and silent.

**Retention:** `FILE_TEMPORARY_RETENTION_HOURS`, default **24 hours**. Long enough that no plausible
upload-then-attach session is caught by it, short enough that abandoned bytes do not accumulate.

**Mechanism.** There is no scheduler in this codebase (`@nestjs/schedule` is not installed) and
inventing one for a single daily sweep would be a background system nobody can test. The logic lives
in `PlatformFileService.cleanupAbandonedUploads()`, which is unit-tested, and is invoked by
`apps/api/scripts/cleanup-abandoned-files.ts` — the same shape as `migrate-deploy.ts` and the seeds
beside it. It iterates the tenant registry, supports `--dry-run`, `--hours` and `--tenant`, and is
idempotent and restartable: each file is removed storage-first and independently, one failure is
logged and skipped, and re-running finishes the job.

```
17 3 * * *  docker exec rukna_api node dist/scripts/cleanup-abandoned-files.js >> /var/log/rukna-file-cleanup.log 2>&1
```

---

## 5. Checksum

### What was wrong

`checksumSha256` was **null on every upload the platform has ever done**. The browser called
`confirmUpload(fileId)` with no body, and the MinIO adapter's `statObject` returned only
`{ exists, sizeBytes }`, so `dto.checksumSha256 ?? stat.checksumSha256 ?? null` always resolved to
null. A column claiming integrity metadata, never populated.

### What it is now

The checksum is taken **before** the upload, not after, because that is what makes it a control
rather than a claim:

1. the browser hashes the file with `crypto.subtle.digest('SHA-256', …)`;
2. `POST /files` requires the digest (64 hex characters, validated at the DTO *and* in the service)
   and persists it;
3. the presigned PUT is signed **with** that checksum, so **object storage itself rejects a body
   that does not hash to it**;
4. `confirm` re-reads the object with `ChecksumMode: ENABLED` and compares. A client may restate the
   checksum but cannot change it — a disagreement is a `400`, not an overwrite.

Verified against a real MinIO (`scripts/verify-platformfile.ts`): a tampered body is rejected with
`400` and **nothing is stored**.

Rows that predate this keep a null checksum; the column stays nullable for them, and that is
recorded rather than backfilled with a value nobody computed.

---

## 6. P0-3 — production storage topology

### What was wrong

`deploy/Caddyfile` said it outright: MinIO was kept internal, `storage.rukna.site` deliberately not
routed, *"everything except the Documents/file feature works."* Presigned URLs are followed by the
**browser**, not the API, so an unreachable storage host breaks both the upload and the download.

There was a second, subtler defect underneath it. The adapter had **one** endpoint for two jobs. A
presigned URL's signature covers the host, so a URL signed against the internal address does not
validate at the public one — whichever single value was configured, one of the two roles was broken.

### The topology

```
browser ──HTTPS──> api.rukna.site ──> rukna_api        authenticates, resolves ownership,
                                                        authorizes, then signs a URL
        <───────── { url, expires in 15 min } ─────────
        ──HTTPS──> storage.rukna.site ──> rukna_minio:9000   PUT/GET with the signature
                   (shared Caddy, TLS)

rukna_api ──rukna_internal──> minio:9000               stat, delete, bucket checks
```

| Concern | Decision |
|---|---|
| Hostname | `storage.rukna.site`, A record → the VPS, DNS-only |
| Reverse proxy | Shared Caddy site block → `rukna_minio:9000` — the **S3 API port only**. The console (`:9001`) is on no proxied path and stays unreachable from outside the box |
| TLS | Terminated by the shared Caddy, like the other two sites |
| Bucket access | Private. `mc anonymous set none` is explicit in `minio-init`. No public object URLs, no anonymous listing — an unsigned request gets `AccessDenied` |
| Authorization | Always in the API, **before** a URL is signed. Storage never authorizes anyone |
| URL lifetime | 15 minutes (`URL_TTL_SECONDS`), for both PUT and GET |
| CORS | `MINIO_API_CORS_ALLOW_ORIGIN`, defaulting to `https://acco.rukna.site`. The browser PUT carries `Content-Type` and `x-amz-checksum-sha256`, which makes it a preflight — without this the upload fails in the browser and nowhere else |

### Env changes

| Variable | Value | Why |
|---|---|---|
| `MINIO_ENDPOINT` | `http://minio:9000` | server-to-server, private network |
| `MINIO_PUBLIC_ENDPOINT` | `https://storage.rukna.site` | **new** — what presigned URLs are signed against |
| `MINIO_CORS_ALLOW_ORIGIN` | `https://acco.rukna.site` | **new**, compose-level |
| `FILE_TEMPORARY_RETENTION_HOURS` | `24` | **new** — cleanup window |

When `MINIO_PUBLIC_ENDPOINT` is unset the adapter signs against the internal endpoint and **logs a
warning at boot**: correct for local development, where they are the same address, and broken
anywhere the browser cannot resolve it. Silence there is what produced this defect.

### Deployment changes

- `deploy/docker-compose.prod.yml` — `minio` joins `deploy_internal` as a secondary network so the
  shared Caddy can reach its S3 port; `MINIO_API_CORS_ALLOW_ORIGIN` added; `minio-init` now sets the
  anonymous policy to `none` explicitly.
- `deploy/Caddyfile` — a `storage.rukna.site` block, with the comment explaining what is and is not
  exposed.

**Operator steps:** add the DNS A record, append the new site block to the shared Caddyfile,
`caddy validate` then `caddy reload`, set the two new variables in `apps/api/.env`, and redeploy.

---

## 7. Step F — attachment classification

`grep` over `apps/api/src`, current as of this commit. "Parent UI/API exists" means a real user
workflow, not a Prisma model.

| Attachment model | Parent aggregate | Parent UI? | Parent API? | Upload needed now? | Permission basis | Finalisation event | Recommendation |
|---|---|---|---|---|---|---|---|
| `DprAttachment` | `DailyProgressReport` | ✅ Progress → Record | ✅ `POST /progress/reports/:id/evidence` | **Already wired** | `manage:project` + membership | DPR `APPROVED` | **WIRED — now also freezes on approval** |
| `ProjectDocument` *(register, not an attachment)* | `Project` | ✅ Documents tab | ✅ `/projects/:id/documents` | Already wired | `view/manage:project` + membership | **none yet** | **WIRE NOW → needs the register lifecycle (§8/§9)** |
| `ContractAttachment` | `Contract` | ✅ Commercial → Contract & Terms | ✅ full lifecycle | **Yes — real need** | `manage:contract` | `execute` → `ACTIVE` (already freezes client details) | **DEFER to Step 3** — smallest real gap, one upload path, clear finalisation |
| `GuaranteeAttachment` | `ContractGuarantee` | ✅ Contract & Terms | ✅ CRUD + status | **Yes — real need** | `manage:contract` | Issue; `expiryDate`/`status` already modelled | **DEFER to Step 3** — the instrument already has issuer, dates and status; only the scan is missing |
| `IpaAttachment` | `InterimPaymentApplication` | ✅ Applications | ✅ full lifecycle | Probably — backup for a claim | `manage:ipa` | `SUBMITTED` (IPA is immutable after) | **NEEDS BUSINESS DECISION** — is claim backup a required attachment or a courtesy? |
| `IpcAttachment` | `InterimPaymentCertificate` | ✅ Certificates | ✅ issue/supersede | Probably — the signed certificate | `issue:ipc` | Issue / `isEffective` | **NEEDS BUSINESS DECISION** — is the signed PDF the record, or is the system the record? |
| `JournalEntryAttachment` | `JournalEntry` | ✅ Journals | ✅ full lifecycle | Unclear | `manage:journal` | `POSTED` | **NEEDS BUSINESS DECISION** — see the correction below |

### A correction to the Step 1 audit

The audit reported `JournalEntryAttachment` as having zero references. That was measured with specs
excluded, and it is wrong in a way worth stating: `att.spec.ts` (ATT-01…ATT-05) exercises the table
directly, and migration `20260806042100` installs
`trg_journal_entry_attachments_immutable` — **a database trigger that already blocks deleting an
attachment on a POSTED journal.** So this one is not undesigned; it has a finalisation rule enforced
at the lowest level available and no way for a user to create a row. The other four have neither.

Nothing on this list is being wired in this step. **Dead Prisma schema is not a product
requirement**, and the two that are genuinely ready (`ContractAttachment`, `GuaranteeAttachment`)
still need the register lifecycle decided first, or they will be built twice.

**None recommended for REMOVE.** All five have an active parent workflow and a plausible need; the
question is sequencing, not existence.

---

## 8. Step G — organisation document register

### The gap

Everything is project-scoped today. There is no organisation-level register, and several document
classes ACCO holds are unambiguously company documents: trade licence, tax registration, corporate
insurance policies, ISO/prequalification certificates, standard terms, supplier trade licences and
insurance. **They must not be forced into a fake project.**

### Recommendation: **B — separate aggregates over a shared file layer**

Two aggregates, `ProjectDocument` and `OrganizationDocument`, sharing `PlatformFile`, the lifecycle
and `FileAuthorizationService` — *not* one `DocumentRecord` with a `scope` discriminator.

The reason is authorization shape, not tidiness. Every rule in this codebase that governs a project
document is a **project membership** rule; every rule that would govern a company licence is an
**organisation permission** rule. A single aggregate with a nullable `projectId` makes the
authorization of every read conditional on a column value, which is exactly the shape that produced
P0-1 — a check that is easy to write and easy to forget. Two aggregates make each one's rule
unconditional and total, and the resolver gains one more case rather than one more branch.

The costs of B are real and small: a second table with similar columns, and a union read if a
"documents across the company" view is ever wanted. The cost of A is a permission model with an
`if` in it, on the exact surface that just had a security defect.

**No migration is needed now.** `ProjectDocument` does not have to change shape for
`OrganizationDocument` to be added later, so nothing here forces schema work ahead of the IA lock.

---

## 9. Step H — revision and expiry design

Designed, **not implemented.** Both depend on decisions that are not ours to make (§10).

### Revision

```
DocumentRecord            the business identity — survives every file replacement
  id, scope, category, title, issuer?, reference?, ownerUserId?, status
  currentRevisionId ────────────────────────────┐
                                                 │
DocumentRevision                                 │
  documentRecordId, revisionCode?  ("0", "A", "Rev 2" — free text, not every category has one)
  platformFileId          ← one file per revision, never overwritten
  issuedAt?, supersededAt?, supersededByRevisionId?
  status: CURRENT | SUPERSEDED
  createdBy, createdAt
```

This answers the four questions a drawing register exists to answer — what is current, what is
superseded, when, by whom, and which file belonged to each revision — and it answers them by
**append**, which is the pattern the BOQ and the programme already use and which
`PlatformFileLifecycle` is already built for: superseding sets `supersededAt` and marks the old
revision's file `IMMUTABLE`; it never deletes bytes.

Two deliberate constraints: `revisionCode` is **optional**, because a permit has no revision code
and forcing one would produce meaningless data; and `currentRevisionId` is denormalised onto the
record because "which one is current" is the single most-read fact and deriving it from
`supersededAt IS NULL` on every read invites exactly one bug.

### Expiry

Fields on `DocumentRecord`: `issuedAt?`, `validFrom?`, `expiresAt?`.

Derived state, computed on read, never stored:

```
No expiry       expiresAt is null            — the honest default; most categories never expire
Valid           now < expiresAt − threshold
Expiring soon   within the threshold
Expired         now ≥ expiresAt
```

**No cross-domain blocking rules.** "Expired insurance blocks an IPA" is a governance rule, and it
is not ours to invent — see D2 below. The design supports one being added later; it does not
presume one.

---

## 10. Still open — Eng Ahmed's decisions

Unchanged from the Step 1 audit, and none of them is guessed at anywhere in this work:

1. **Which document categories actually expire?**
2. **What happens when one does** — a warning only, or a block? Blocking *which* process?
3. **Do drawings require controlled revisions** (Rev A / Rev B, one current, superseded retained)?
4. **May a permit or a finalised controlled document ever be deleted?**
5. **Who holds that authority?**
6. **Are formal transmittals required** (who was issued which revision, when)?

Two more that this step surfaced, for the platform owner:

7. **Is a journal-voucher attachment wanted?** The table and its immutability trigger exist; no user
   can create a row. Accounting has not asked for it.
8. **Are IPA claim backup and the signed IPC PDF required attachments, or courtesies?** This decides
   whether they are Step 3 work or indefinite.

---

## 11. What blocks the Phase 7 IA

| Blocker | Owner | Why it blocks |
|---|---|---|
| **D4/D5 — expiry and revision semantics** | Eng Ahmed | They decide the aggregate. Screens drawn before them get redrawn |
| **Register finalisation event** | follows D4/D6 | Until a register document can *finalise*, its files stay `BOUND` and "controlled document" is a label with no control behind it |
| **Org register in or out (§8)** | Abdulsalam | The IA differs substantially between project-only and dual-scope |
| **Which attachments get wired (§7)** | Abdulsalam + Eng Ahmed | "Linked documents" is five upload paths, not one read model |

**Not blocking any more:** file authorization, the file lifecycle, deletion semantics, abandoned
uploads, checksum integrity, and production reachability. Those were the reasons the IA could not be
trusted; they are closed.

---

## 12. Verification

| Check | Result |
|---|---|
| API test suite | **1044 passed / 108 suites** |
| Web test suite | **1789 passed / 155 files** |
| API typecheck · lint | clean |
| Web typecheck · lint · build | clean |
| Migration applied to the local tenant DB | clean, with the backfill |
| Storage runtime verification vs real MinIO | **all checks passed** — round trip, tampered-body rejection, checksum read-back, idempotent delete, public-endpoint signing |

New focused tests: 25 in `file-authorization.service.spec.ts` (cross-project denial, cross-org
`404`, unowned-file privacy, bound/immutable delete refusal, multi-owner read union), 28 in
`platform-file.service.spec.ts` (checksum validation and enforcement, lifecycle transitions,
discard, cleanup safety and idempotency), plus attach/detach/bind/freeze assertions in the document
and progress specs.

**Not verified:** the production topology itself. It is a deployment change on a box this session
cannot reach, so §6 is a documented plan plus a locally-verified adapter — the signing behaviour and
the checksum enforcement are proven against real MinIO, the Caddy route and DNS are not.
