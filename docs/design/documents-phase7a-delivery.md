# Phase 7A — Project Document Control: what was built

**Date:** 2026-09-07 · **Branch:** `feat/project-workspace-shell-overview` · **Follows:**
`documents-phase7-audit.md` (step 1) and `documents-phase7-foundation.md` (step 2).

This is the record of the delivered design, not a proposal. Where it departs from the brief, the
departure is named and argued (§11).

---

## 1. The professional rule this phase exists to encode

```
PlatformFile              storage object — bytes, checksum, lifecycle
ProjectDocument           the controlled business record
ProjectDocumentRevision   one historical or current issue of it, and the only holder of a file
*Attachment               evidence owned by some OTHER aggregate
OrganizationDocument      a separate, future, organisation-scoped register (§10 — NOT built)
```

**Controlled document ≠ attachment ≠ PlatformFile.** And within the controlled document, three
axes that were previously one and are now permanently separate:

| Axis | Question it answers | Where it lives |
|---|---|---|
| **status** | Where is the controlled record? | `ProjectDocument.status` |
| **revision** | Which issue of it is current? | `ProjectDocument.currentRevisionId` |
| **validity** | Can it be relied on today? | derived from `validFrom`/`expiresAt`, never stored |

A permit can be ISSUED, at R01, and EXPIRED simultaneously. Every earlier design collapsed at
least two of those, and each collapse loses a fact the site needs.

**Issued revisions are immutable historical records.** Their file is frozen at the storage layer,
their row is never rewritten, and new content always arrives as a new revision that supersedes
them. This is the same supersede-don't-overwrite rule the BOQ baseline, the cost budget and the
IPC already follow.

---

## 2. What the register was, and what it is now

| | Before | After |
|---|---|---|
| Identity | `title` only | `documentNumber` (unique per project, case-insensitive) + `title` |
| Status | none | `DRAFT → ISSUED → SUPERSEDED / WITHDRAWN / ARCHIVED` |
| Revisions | none — `platformFileId` sat on the row | `ProjectDocumentRevision`, append-only, one current |
| Validity | none | derived `NO_EXPIRY / NOT_YET_VALID / VALID / EXPIRING_SOON / EXPIRED` |
| Accountability | `uploadedBy` (never rendered) | `responsibleUserId`, membership-checked, surfaced |
| Issuer | none | `issuerName` |
| Categories | 10 values, incl. `PHOTO` | 11 curated controlled-document categories |
| Discipline | none | optional `DocumentDiscipline` |
| Deletion | any member with `manage:project` could hard-delete anything | drafts with no issued history only |
| Audit | generic request audit | 9 domain events through the transactional outbox |
| Permissions | `manage:project` for everything | drafting and **issuing** are separate authorities |

Replacing a drawing used to destroy the revision it replaced. That single fact is what made the
old surface a file list rather than a register.

---

## 3. The aggregate

`apps/api/prisma/schema.prisma` — `ProjectDocument` / `ProjectDocumentRevision`.

**Two database invariants, as partial unique indexes** (migration
`20260907140000_project_document_control`), because application code alone is not enforcement:

```sql
CREATE UNIQUE INDEX project_document_revisions_one_draft
    ON project_document_revisions (project_document_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX project_document_revisions_one_issued
    ON project_document_revisions (project_document_id) WHERE status = 'ISSUED';
```

The first makes "the draft" unambiguous. The second makes `currentRevisionId` unambiguous and, for
drawings, enforces *at most one current Issued-For-Construction revision* without needing a second
rule. Both were verified to reject duplicates under raw SQL, not just through the service.

Plus `UNIQUE(projectId, documentNumberNormalized)` — the normalised form is stored in its own
column so the index is a plain b-tree rather than a functional index the ORM cannot see.

---

## 4. Lifecycle

```
DRAFT ──issue──> ISSUED ──supersede──> SUPERSEDED
  │                 │
  │                 ├──withdraw──> WITHDRAWN
  └──delete         └──archive───> ARCHIVED
```

**No APPROVED.** Nothing in the platform binds an approval workflow to document issuance, and a
status that implies a control which does not run is the fake-approval defect the accounting
round-2 review spent a phase removing from journals. When a `WorkflowTriggerBinding` is wanted, it
attaches to `issue` — the act that already carries the weight.

Rules live in `documents/domain/document-lifecycle.policy.ts` as pure functions, so the service
asks them and the browser is told the answers (via capability flags) rather than re-deriving them.

**Metadata editability is status-dependent.** A DRAFT admits every field. An ISSUED document
admits only `title`, `responsibleUserId`, `issuerName`, `issuedAt`, `validFrom`, `expiresAt` —
facts about the *world*, which change without the document changing. Its number and category are
how it is cited on a print somebody is holding, so they are frozen at issue.

---

## 5. Issuance — the transaction

`ProjectDocumentService.issueRevision`. Five things commit together or not at all:

1. the outgoing issued revision becomes `SUPERSEDED` (**first**, or the partial index rejects the promote)
2. the draft revision becomes `ISSUED`, stamped with who and when
3. the document repoints `currentRevisionId`
4. the document itself becomes `ISSUED`, if this is its first issue
5. the audit event is written into the same transaction

Then, outside the transaction, the new revision's file becomes `IMMUTABLE`. The ordering is
deliberate: the freeze is idempotent and re-runnable, whereas a half-applied supersession would
leave two revisions claiming to be current — and the partial index is the backstop that makes that
impossible rather than merely unlikely.

The document's own `issuedAt` is its **first** issue and does not move with later revisions; each
revision carries its own date.

---

## 6. Validity — derived, never stored

`documents/domain/document-validity.policy.ts`.

| State | Condition |
|---|---|
| `NOT_YET_VALID` | `validFrom > today` (checked first) |
| `NO_EXPIRY` | no `expiresAt` |
| `EXPIRED` | `expiresAt < today` |
| `EXPIRING_SOON` | `expiresAt <= today + threshold` — **includes the expiry date itself** |
| `VALID` | otherwise |

- A persisted `EXPIRED` becomes a lie the moment the clock passes it without a job running. There
  is no job. So validity is a function, computed where it is read.
- **Threshold: 30 days**, server-owned, overridable with `DOCUMENT_EXPIRY_WARNING_DAYS`, and
  reported back on every summary as `expiringSoonDays` so the screen can say *why* something is
  flagged. A threshold written into a React component is a product policy nobody agreed to.
- Everything compares at **UTC midnight** on both sides. The columns are `@db.Date`; comparing
  against a timestamp would expire a document at midnight UTC, a day early for Mogadishu.
- The last day of validity is a valid day: `expiresAt === today` is EXPIRING_SOON, not EXPIRED.

**Expiry drives visibility and attention only.** No cross-domain blocker was introduced — no
expired guarantee blocking an IPC, no expired permit blocking progress. That needs Eng Ahmed's
ruling, and inventing one would be a control nobody authorised.

`NOT_YET_VALID` is a deliberate fifth state; see §11.

---

## 7. File lifecycle integration

| Event | File lifecycle |
|---|---|
| Register a document | `TEMPORARY → BOUND` |
| Replace a **draft** revision's file | new file `BOUND`; the replaced one **discarded**, not orphaned |
| **Issue** a revision | `BOUND → IMMUTABLE` |
| Supersede a revision | stays `IMMUTABLE` — history keeps its file |
| Withdraw an issued document | stays `IMMUTABLE` |
| Discard an unissued draft | files discarded with it |

Replacing an issued file is refused in three independent places: the lifecycle policy (with a
sentence a person can act on), `FileAuthorizationService` (403 on an IMMUTABLE file), and the
storage lifecycle itself. A rule that lives only in the layer called first is not enforced.

`PlatformFileService.discardIfUnreferenced` now counts **every** owner kind, not two of six. It
previously knew only about `projectDocuments` and `dprAttachments`, which after this phase would
have been a delete waiting to destroy a contract attachment.

---

## 8. Attachment paths — wired, and their real freeze points

`platform/files/application/record-attachment.service.ts` — one shared policy over four separate
aggregates, which is the spec's "shared service, separate aggregates" rather than a generic table.

| Owner | Frozen when | Why that point and not an earlier one |
|---|---|---|
| **Contract** | status reaches `ACTIVE` | `execute()` is the real signature event |
| **Guarantee** | status **leaves** `ACTIVE` | A guarantee is *created* ACTIVE — there is no draft period and no "accepted" transition to hook. Leaving ACTIVE (discharged / expired / called) is the only real finalisation the aggregate has |
| **IPA** | status reaches `SUBMITTED` | Submission is what puts the evidence in front of the client |
| **IPC · issued certificate** | on attach | `issue()` creates a certificate that is *already effective*; there is no later event to wait for |
| **IPC · supporting** | when the certificate is superseded | Its content becomes history at that moment |
| **JournalEntry** | **not wired** | Deferred per the brief; source-generated journals reference their source evidence, and direct journal evidence matters only for manual journals |

The guarantee and issued-certificate rows look odd because the domain is odd, not because the rule
was chosen carelessly. Inventing a "guarantee accepted" transition to make the table tidy would be
a fabricated control.

> #### Open for Eng Ahmed — the guarantee freeze point is late
>
> **Technically grounded, business semantics unverified.** Flagged in review 2026-09-07 and
> deliberately left as built.
>
> `GuaranteeStatus` is `ACTIVE | DISCHARGED | EXPIRED | CALLED`, defaulting to `ACTIVE` at
> creation. There is no earlier transition to hook, so the implementation freezes on **leaving**
> ACTIVE. That is safe — nothing can be lost — but it is *late*:
>
> ```text
> ACTIVE      = the guarantee is in force  → attachment stays replaceable
> DISCHARGED / EXPIRED / CALLED            → attachment freezes
> ```
>
> The commercial reality is probably the opposite. A bank guarantee instrument is normally final
> **the moment the guarantee record becomes effective** — the bank issued it, ACCO holds it, and
> nobody should be swapping the PDF while the instrument is in force. On that reading the freeze
> belongs immediately after bind, and the current rule leaves the whole in-force life of the
> instrument replaceable.
>
> The reason it was not built that way: freezing on attach would make a mis-uploaded scan
> permanent from the first second, with no draft period at all, and asserting that ACCO never
> re-scans a guarantee is a claim about their practice that nobody has made.
>
> **The question for Eng Ahmed:** *is the uploaded guarantee the final instrument at the point the
> guarantee record is created, or is there a period during which the scan is legitimately
> replaced?* If the former, move the freeze to immediately after bind — a one-line change in
> `RecordAttachmentService.isFinalised`, plus a backfill for guarantees still ACTIVE.
>
> Do not change it on inference. The current behaviour is defensible and reversible; guessing is
> neither.

`IpcAttachment.purpose` (`SUPPORTING` / `ISSUED_CERTIFICATE`) was added because the two have
different freeze rules and therefore cannot share a state. **The platform is itself the
authoritative certificate** — an uploaded PDF is never required, only recorded when an external
signed copy exists.

`FileAuthorizationService` resolves all six owner kinds and gates every one on project membership.
Each reaches its project by a different join, and the browser gate covers all four commercial
kinds in both directions (readable by a member, denied to a non-member, never deletable through
`/files/:id`).

---

## 9. Linked Attachments

`GET /projects/:id/documents/attachments` — a **read-only** aggregation over five parents.

It is not a second owner. No attach, no replace, no delete, and there never should be: each file
belongs to an aggregate with its own rules about when its evidence may change, and a delete here
would route around all of them. The Source column is the affordance — it takes the reader to the
record that can actually change what they are looking at.

Authorization is *structural*: every query joins through its parent to the project, so a
non-member receives no rows at all, and the bytes are then independently gated when a download URL
is requested. The index and the content are protected separately.

`uploadedAt` is the **file's** `createdAt`, uniformly. `DprAttachment` has no `createdAt` column,
and back-filling one would have every historical row claim it was attached at migration time — a
fabricated timestamp on an evidence trail.

**Known limit, stated rather than hidden:** the five sources are merged and paged in memory. Five
heterogeneous parents cannot be ordered and paged as one relation without a database view, and a
project's attachment count is in the hundreds. If it reaches the thousands this becomes a
materialised read model; the response shape would not change.

---

## 10. Organisation documents — architecture only, deliberately not built

**Nothing organisation-scoped ships in Phase 7A.** No schema, no migration, no route, no
navigation entry. The plan below exists so the project model does not paint the org model into a
corner, and it costs nothing to defer.

```
OrganizationDocument          id · organizationId · documentNumber · title · category
                              responsibleUserId? · issuerName?
                              issuedAt? · validFrom? · expiresAt?
                              status · currentRevisionId? · createdBy · createdAt · archivedAt?

OrganizationDocumentRevision  id · organizationId · organizationDocumentId · fileId
                              revisionNumber · revisionCode? · status
                              issuedAt? · supersededAt? · createdBy · createdAt
```

**Separate aggregates, not `Document(scopeType, projectId nullable)`.** The reason is
authorization, not tidiness: a project document is gated by *project membership*, an organisation
document by an *organisation permission*. A shared table forces
`FileAuthorizationService.canReachOwner` to guess which rule applies from a nullable column, and
the one place in the system where that guess is wrong is a cross-tenant disclosure.

`canReachOwner` is already shaped for it — six explicit cases, each free to answer differently. An
`ORGANIZATION_DOCUMENT_REVISION` case slots in as the first whose answer is an organisation
permission rather than project membership, with no restructuring.

**Shared when it lands:** revision transition rules, file binding and freezing, checksum, validity
derivation, document-number normalisation. `document-validity.policy.ts` and
`document-number.policy.ts` are already pure functions over values with no project coupling —
they lift as they are.

Future permissions: `view:organization-document`, `manage:organization-document`,
`issue:organization-document`. Future categories are corporate (company licence, tax registration,
ISO certification, corporate guarantee, policy, supplier qualification) and must not inherit the
project taxonomy.

**No migration now.** Nothing in the project register benefits from sharing a table today, and an
unused table is the dead scaffolding this codebase keeps deleting (`PostingRuleVersion`,
`SubledgerControlReconciliation`).

---

## 11. Where this departs from the brief, and why

**1. `NOT_YET_VALID` is a fifth validity state.** The brief named four. `validFrom` exists in the
model, so a permit that starts next month is not `VALID` today, and reporting it as such would be
the register's first falsehood — the exact class of defect the Finance phase spent its length
removing. It is also excluded from the expiring-soon attention queue, because no action can clear
it yet.

**2. `DocumentCategory` was migrated, not extended.** `PERMIT` and `LICENSE` were two values for
one instrument class, and `PHOTO` was never a controlled document — it is DPR evidence, which now
reads under Linked Attachments where it belongs. Keeping both taxonomies would have given the
platform two answers to "what kind of document is this". Existing rows are mapped in the migration;
`PHOTO` becomes `OTHER_CONTROLLED` and keeps its file rather than being deleted.

**3. Reading reuses `view:project`.** The brief asked not to over-granulate, and a third *view*
permission would have taken the Documents tab away from every role that can open it today, until
someone remembered to re-seed. Writing is split the way BOQ splits it, because drafting a drawing
and telling a site to build from it are different authorities.

**4. Document-level `SUPERSEDED` is backed by a real link.** The brief listed the status; a status
with no target is a dead end the reader cannot follow. `supersededByDocumentId` and a supersede
action make it a fact rather than a label.

**5. Legacy rows migrate to `DRAFT`, not `ISSUED`.** Nothing ever issued them — the old register
had no issuance event — so calling them issued would fabricate a control that never ran and freeze
their files as evidence of a decision nobody took. Their numbers are filled as `DOC-0001…` per
project in creation order: a real, editable, unique identity rather than a guess.

---

## 12. Verification

| Gate | Result |
|---|---|
| API typecheck · lint | PASS |
| API tests | **1105 passing**, 109 suites (incl. the DI graph) |
| Web typecheck · lint | PASS (0 errors) |
| Web tests | **1789 passing** (30 new for Documents) |
| Migration against a live DB with legacy rows | PASS — 3 rows → 3 documents + 3 revisions, per-project numbering, category mapping verified |
| Partial unique indexes | PASS — both reject duplicates under **raw SQL**, not only through the service |
| Browser QA | **23 cases green** at 1440-light, 1440-dark, 375-light, 375-dark |
| Real presigned upload → issue → revise → issue | PASS — files `READY` with real checksums, R00 `SUPERSEDED` + still `IMMUTABLE`, R01 current |
| Server-side refusal of replacing an issued file | PASS — 403, asserted against the API, not the UI |
| 375px: no page overflow, all controls ≥44px | PASS |
| Console errors / 4xx / 5xx | none |

Spec: `apps/web/e2e/project-documents-qa.spec.ts`.

```
cd apps/web && E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=<admin pw> \
  QA_DOCUMENTS_PROJECT_ID=<project id> QA_DOCUMENTS_WRITE=1 \
  npx playwright test project-documents-qa --project=desktop --reporter=list
```

**Two defects the browser gate found that no other suite could:** every interactive control in the
workspace was `size="sm"` (36px) against a 44px touch minimum, and the register's row identity
link came to ~40px — the latter invisible until the register had real rows in it, because an empty
table has no links to measure.

---

## 13. Not built, and owed

- **Production storage deployment is NOT verified — this is the only true blocker.** Diagnosed
  2026-09-07 rather than merely observed:

  ```text
  api.rukna.site       → 169.58.180.80   TLS OK, Caddy serves it (404 from the API)
  acco.rukna.site      → 169.58.180.80   TLS OK (307)
  storage.rukna.site   → 169.58.180.80   TLS handshake ABORTED by the server, even with -k
  ```

  All three are the same A record and therefore the same Caddy. DNS is correct. A fatal TLS alert
  on one SNI while another succeeds is what Caddy does when it holds **no site block and no
  certificate** for that host — so `deploy/Caddyfile` (which contains a correct
  `storage.rukna.site` block) has not been loaded on the running instance, or ACME issuance for
  that host failed after a reload.

  **It is a deployment step, not a code change.** Nothing in this branch fixes it.

  ```bash
  # on the VPS
  docker exec deploy-caddy-1 caddy validate --config /etc/caddy/Caddyfile
  docker exec deploy-caddy-1 caddy reload   --config /etc/caddy/Caddyfile
  docker logs deploy-caddy-1 2>&1 | grep -i "storage.rukna.site"   # ACME result
  ```

  Then, and only then, prove the four things the phase actually depends on — **all four before
  the permission seed runs**, because none of them needs a Documents grant and proving them first
  is what keeps an infrastructure failure distinguishable from an RBAC one (§14):

  ```text
  browser presigned PUT succeeds
  browser presigned GET succeeds
  anonymous object access is DENIED (no bucket policy, no listing)
  project access is enforced on the download URL (a non-member gets 403 before any signature)
  ```

- **The two new permissions are not seeded in production.** `manage:project-document` and
  `issue:project-document` were granted to the local ACCO `ADMIN` role via
  `prisma/seeds/refresh-admin-permissions.seed.ts`. Until that runs against the production tenant,
  **every write route returns 403 there** while reads keep working — which looks like a UI bug and
  is not one.
- **`JournalEntryAttachment`** stays unwired (§8).
- **Transmittals / distribution records** (audit D7) — out of scope, still unanswered.
- **Organisation Documents** — architecture only (§10). Do not start the UI before project
  Documents is frozen.
- **App-shell touch targets.** The skip link, sidebar toggles and breadcrumb links are all under
  44px. Found by this phase's gate, recorded here, deliberately not fixed inside a Documents
  branch — it is shell debt shared by every screen.
- **Cross-domain expiry blockers** — needs Eng Ahmed.

---

## 14. Phase 7A status

Reviewed and locked 2026-09-07. **The model and the IA are not reopened by anything below.**

| | |
|---|---|
| Project document model | **COMPLETE** |
| Revision model | **COMPLETE** |
| Lifecycle | **COMPLETE** |
| Validity | **COMPLETE** |
| Project-scoped numbering | **COMPLETE** |
| Attachments (contract · guarantee · IPA · IPC) | **COMPLETE** |
| Linked Attachments | **COMPLETE** |
| RBAC | **COMPLETE** |
| File authorization | **PASS** |
| File immutability | **PASS** |
| Runtime MinIO (local) | **PASS** |
| Browser QA | **PASS** |
| Responsive QA | **PASS** |
| Dark mode QA | **PASS** |
| Production storage TLS | **OWED** |
| Production permission seed | **OWED** |

**Frozen means frozen.** The document model, the three-axis separation, the issuance transaction,
the attachment freeze points and the two-view IA are settled. Reopen them only if an implementation
proves an actual defect — not to accommodate a later preference.

**Not production-ready until both OWED rows pass.** See §13.

### Production sequence

Ordered so that **a failure at any step names its own cause.** The ordering is the point, not the
list: storage is proved to the end *before* the permission seed, so an infrastructure failure and
an RBAC failure can never present as the same symptom. Corrected in review 2026-09-07 — the first
draft ran the seed second, which would have left a 403 ambiguous between "Caddy is not routing" and
"the role has no grant".

```text
INFRASTRUCTURE — no Documents permission is involved in any of these
 1. validate the DEPLOYED Caddyfile          caddy validate --config /etc/caddy/Caddyfile
 2. reload Caddy                             caddy reload   --config /etc/caddy/Caddyfile
 3. inspect Caddy / ACME logs                docker logs deploy-caddy-1 | grep storage.rukna.site
 4. verify certificate issuance
 5. verify storage.rukna.site TLS externally
 6. verify anonymous S3 access is DENIED     no bucket policy, no listing, no public object URL
 7. verify authenticated presigned PUT from the browser
 8. verify authenticated presigned GET from the browser

AUTHORIZATION
 9. run refresh-admin-permissions.seed.ts against the PRODUCTION tenant

APPLICATION
10. verify Documents end to end as a real production user

11. freeze Phase 7A
12. THEN Phase 7B — Organisation Documents
```

**Steps 7 and 8 genuinely do not need the seed.** The presign comes from `POST /files`, which is
gated by JWT authentication alone — no document permission — so the whole storage path can be
proved while the new grants are still absent. That is what makes the separation real rather than
cosmetic: if 7–8 pass and 10 fails, the cause is step 9, and nothing else.

Step 9 is a **real authorization change on a production tenant** and is for the platform owner or
an authorised operator to run. It is not automation.

Organisation Documents is architecture only (§10) and stays that way. Building it before the
project register has run in production would abstract two scopes at once from one worked example —
which is the mistake §10 exists to prevent.
