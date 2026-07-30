# Construction Domain Model

Version: 1.0.0
Status: Active
Last Updated: 2026-07-30

---

## Core Entity Map

```
Organization (tenant)
│
├── Users, Roles, Permissions
├── WorkflowDefinition (DOA approval chains per transaction type)
├── ExchangeRate (currency × date → rate)
│
└── Project  ◄── ROOT ENTITY
    │
    ├── Contract (optional — client projects only)
    │   ├── Milestone
    │   ├── RetentionTerms
    │   ├── AdvanceTerm
    │   ├── Guarantee
    │   └── Variation / ChangeOrder
    │
    ├── Subcontract (many per project)
    │   ├── SubcontractScope (BOQ lines awarded to sub)
    │   └── SubcontractCertificate (frozen on approval)
    │
    ├── BOQNode (tree — Division → Section → Item)
    │   └── BOQCostBudget (budget per Cost Category per Item)
    │
    ├── Site Documents (feed IPC generation)
    │   ├── DailyProgressReport (DPR)
    │   │   └── ProgressEntry (BOQNode + qty/% /milestone)
    │   ├── InspectionTestReport (ITR)
    │   │   └── ITRLine (BOQNode + pass/fail)
    │   ├── MeasurementSheet
    │   │   └── MeasurementLine (BOQNode + certified qty)
    │   └── WorkCompletionRecord
    │       └── WCRLine (BOQNode + confirmed complete)
    │
    ├── IPC — Interim Payment Certificate (frozen chain)
    │   └── IPCLine (BOQNode + cumulative + this cert amounts)
    │
    ├── Procurement Chain
    │   ├── MaterialRequest (MR)
    │   ├── PurchaseRequisition (PR)
    │   ├── RFQ + SupplierQuotation
    │   ├── PurchaseOrder (PO)  → posts COMMITTED to CostLedger
    │   │   └── POLine (material + qty + rate + BOQNode + CostCategory)
    │   └── GoodsReceiptNote (GRN) → closes COMMITTED, posts ACCRUED
    │       └── GRNLine
    │
    ├── Inventory (Stock)
    │   ├── StoreLocation (warehouse or site store)
    │   ├── MaterialCatalogue (item master)
    │   ├── StockLedger (immutable journal — every movement)
    │   └── StockTransfer (inter-location movement)
    │
    ├── Labour & Equipment
    │   ├── LabourAttendance (employee + site + date + hours)
    │   ├── Timesheet (approved allocation to BOQNode + CostCategory)
    │   └── EquipmentLog (unit + project + hours + fuel + maintenance)
    │
    ├── Supplier Invoices
    │   └── SupplierInvoice → closes ACCRUED, posts ACTUAL to CostLedger
    │
    ├── CostLedger (three-stage: COMMITTED / ACCRUED / ACTUAL)
    │   Every entry: project + BOQNode + CostCategory + stage + amount
    │
    ├── Client Receipts
    │   └── PaymentReceipt (matched to IPC / retention / advance)
    │
    ├── ProjectDocument (drawings, specs, photos — file attachments)
    │
    └── AuditLog (every state change on every entity)
```

---

## Key Entity Descriptions

### Project
The root entity. Every cost, document, progress record, and financial transaction belongs to a Project.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organization_id | cuid | tenant |
| name / name_ar | string | bilingual |
| code | string | unique within org |
| type | enum | CLIENT, INTERNAL, JOINT_VENTURE |
| status | enum | TENDER, AWARDED, ACTIVE, SUSPENDED, COMPLETED, CLOSED |
| location | string | |
| start_date / planned_end_date / actual_end_date | date | |
| project_manager_id | cuid | User |
| created_at / updated_at | timestamp | |

---

### Contract
Optional. Attached to a Project when there is a formal client agreement.

| Field | Type | Notes |
|---|---|---|
| project_id | cuid | |
| client_id | cuid | Client master |
| contract_number | string | |
| type | enum | FIXED_PRICE, UNIT_PRICE, COST_PLUS, MILESTONE, TIME_AND_MATERIAL |
| value / currency_code | decimal + string | |
| retention_percentage | decimal | e.g. 5.00 |
| retention_cap_percentage | decimal | |
| advance_amount | decimal | |
| advance_recovery_percentage | decimal | recovered per IPC |
| revenue_recognition_method | enum | POC, BILLING_BASIS |
| status | enum | DRAFT, ACTIVE, COMPLETED, DISPUTED, CLOSED |

---

### BOQNode
Self-referential tree. Stores both folder nodes (GROUP) and line items (ITEM).

| Field | Type | Notes |
|---|---|---|
| parent_id | cuid? | null = root node |
| project_id | cuid | |
| type | enum | GROUP, ITEM |
| code | string | e.g. "01.02.003" |
| name / name_ar | string | bilingual |
| unit | string | m³, m², tonne, etc. (ITEM only) |
| quantity | decimal | total BOQ quantity (ITEM only) |
| unit_rate / total_amount | decimal | (ITEM only) |
| measurement_method | enum | QUANTITY, PERCENTAGE, MILESTONE (ITEM only) |
| depth | int | computed |
| path | string | "001.002.003" — computed |
| sort_order | int | |

---

### StockLedger
Immutable. One row per movement. Never updated after insert.

| Field | Type | Notes |
|---|---|---|
| posted_at | timestamp | |
| location_id | cuid | warehouse or site store |
| material_id | cuid | |
| transaction_type | enum | RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN, RETURN_TO_STORE, RETURN_TO_VENDOR, WASTAGE, THEFT_LOSS, SCRAP, ADJUSTMENT |
| quantity | decimal | negative for outflows |
| unit_cost / total_value | decimal | |
| currency_code | string | |
| reference_doc_type | string | PO, MIR, TRANSFER, etc. |
| reference_doc_id | cuid | |
| project_id | cuid | |
| boq_node_id | cuid | |
| cost_category | enum | |
| posted_by / approved_by | cuid | User |

---

### CostLedger
Three-stage commitment accounting. One row per stage transition.

| Field | Type | Notes |
|---|---|---|
| project_id | cuid | |
| boq_node_id | cuid | |
| cost_category | enum | |
| stage | enum | COMMITTED, ACCRUED, ACTUAL |
| amount / currency_code | decimal + string | |
| reference_doc_type | string | PO, GRN, INVOICE, etc. |
| reference_doc_id | cuid | |
| posted_at | timestamp | |
| posted_by | cuid | |

---

### IPC (Interim Payment Certificate)
Auto-generated from approved site documents. Immutable once FROZEN.

| Field | Type | Notes |
|---|---|---|
| project_id / contract_id | cuid | |
| ipc_number | int | sequential per contract |
| period_from / period_to | date | |
| status | enum | DRAFT, SUBMITTED, APPROVED, FROZEN |
| total_gross / retention / advance_recovery / tax / net_payable | decimal | |
| currency_code | string | |
| frozen_at / frozen_by | timestamp + cuid | set when FROZEN |

---

## Glossary

| Term | Definition |
|---|---|
| BOQ | Bill of Quantities — the priced schedule of work items forming the basis of a construction contract |
| IPC | Interim Payment Certificate — a periodic billing document certifying completed work for client payment |
| DPR | Daily Progress Report — site record of work completed, labour, materials, and equipment for one day |
| ITR | Inspection and Test Report — QA/QC document confirming work meets specification before billing |
| DOA | Delegation of Authority — the framework defining who can approve what, up to what amount |
| POC | Percentage of Completion — the IFRS 15 revenue recognition method for long-term construction contracts |
| WIP | Work in Progress — the balance sheet asset representing revenue earned but not yet billed |
| GRN | Goods Receipt Note — the document confirming materials have been received and inspected |
| MIR | Material Issue Request — the authorised request for materials to be issued from a store to a work area |
| PO | Purchase Order — a committed obligation to purchase from a supplier at agreed terms |
| Variation | A formal change to the contracted scope, price, or schedule — also called a Change Order |
| Retention | A percentage of certified work withheld from each IPC as security until project completion |
| Advance | A mobilization payment made to the contractor/subcontractor before work begins, recovered from subsequent IPCs |
