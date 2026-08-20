# Domain — Client Commercial (revenue side, Flow A)

The client-facing spine: what we promised, what we can claim, and collection. Distinct from
Accounting — a certified IPC is a commercial fact; revenue exists only once an AR invoice is
posted (see `docs/02-domain-boundaries.md`).

```
Contract ──┬── Scope (BOQ)
           ├── Terms (retention / advance)
           └── Security (guarantees)
   → Valuation → IPA → IPC → AR Invoice → Collection
```

| Capability | Code | ADR | Endpoints | Frontend | Status |
|---|---|---|---|---|---|
| Contracts | `construction/contracts` | ADR-005 | `contracts` | `/contracts`, `/projects/[id]/commercial/main-contract` | INTEGRATED |
| Retention / advances / guarantees / milestones | (in contracts) | ADR-005 | `contracts/...` | commercial tabs | INTEGRATED |
| IPA | `construction/ipa` | ADR-005 | `ipa` | `/contracts/[id]/applications/...` | INTEGRATED |
| IPC | `construction/ipc` | ADR-005 | `ipc` | `.../certificates/...`, `/projects/[id]/ipc` | INTEGRATED |
| Commercial workspace (4-section) | `construction/commercial` | ADR-017 | `projects/:projectId/commercial` | `/projects/[id]/commercial/*` | INTEGRATED |

**Workspace sections:** Overview · Contract & Security · Applications & Certificates ·
Billing & Collection. The server-owned current cycle guides Contract → IPA → IPC → AR Invoice.
Posted AR settlement is read-only here; canonical CustomerReceipt creation/allocation remains
blocked on A12 and is never routed through the legacy receipt ledger. en/ar with RTL, dark,
and mobile.

**Frozen baseline:** after a contract leaves DRAFT, material change should flow through a
**Variation** rather than editing the executed contract. Variations are **not built** —
`BoqNode` provenance fields are prepared; ChangeOrder aggregate is BLOCKED on #51.

**Not built:** milestone certification + automatic invoice generation.
