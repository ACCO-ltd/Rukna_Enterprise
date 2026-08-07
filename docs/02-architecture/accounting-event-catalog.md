# Accounting Event Catalog

**Version:** 1.2 — Integrity addendum: allocation events, naming normalization, P&L filters, opening-balance protocol
**Owner:** AccountingCoreModule
**Audience:** Backend engineers, QA, Finance, Auditors

This catalog is the single source of truth for every accounting event in the Rukna platform.
It defines: the business trigger, the posting rule applied, the journal lines produced,
the accounts affected, the subledger impact, the reports updated, error conditions,
numeric test fixtures, and the reversal event that undoes each entry.

Engineers implement posting rules from this catalog.
Finance validates UAT against this catalog.
Auditors trace any posted journal back to an entry here.
QA writes integration test cases directly from the numeric fixtures below.

**No posting engine change may introduce an event type not documented and approved here.**

---

## How to Read This Catalog

Each entry carries:

| Field | Meaning |
|---|---|
| `EVENT ID` | String stored in `PostingRuleVersion.eventType`; also used in `JournalEntry.sourceDocumentType` resolution |
| `eventVersion` | The version of this event's posting definition. Increments when the journal structure changes (new lines, different resolution strategy). Old `PostingRuleVersion` records referencing the prior version remain valid for their posted journals. |
| `reversedBy` | Which EVENT ID undoes this entry. Reversals negate all lines and set `entryPurpose = REVERSAL`. |
| `Fixture` | A concrete numeric example QA can use verbatim in integration tests. All amounts in USD. |

**Amount notation:**
- `NET` = subtotal before VAT
- `VAT` = 5% × NET
- `GROSS` = NET + VAT (total on document)
- ACCO input VAT is NON_RECOVERABLE — supplier expense/inventory posts GROSS; no separate VAT debit line.

**Enum values used in this catalog (must match schema exactly):**

| Field | Valid values |
|---|---|
| `journalCategory` | `GENERAL`, `ACCOUNTS_RECEIVABLE`, `ACCOUNTS_PAYABLE`, `CASH_AND_BANK`, `OPENING_BALANCE`, `CLOSING_ADJUSTMENT`, `YEAR_END_CLOSE`, `REVERSAL`, `REPLACEMENT` |
| `entryPurpose` | `NORMAL`, `REVERSAL`, `REPLACEMENT`, `CLOSING`, `OPENING_BALANCE` |
| `postingOrigin` | `SYSTEM_AR`, `SYSTEM_AP`, `SYSTEM_CASH`, `SYSTEM_OPENING`, `SYSTEM_YEAR_END`, `MANUAL` |
| `sourceDocType` | `CLIENT_INVOICE`, `PAYMENT_RECEIPT`, `SUPPLIER_BILL`, `SUPPLIER_PAYMENT`, `MANUAL_JOURNAL`, `OPENING_BALANCE`, `YEAR_END_CLOSE` |

**P&L report filter rule (ADR-006 §17.3):**
P&L queries must always add `AND entry.entryPurpose != 'CLOSING'` to exclude the year-end zeroing entry.
December closing adjustments (`journalCategory = CLOSING_ADJUSTMENT`, `entryPurpose = NORMAL`) ARE included — they are real period expenses.

---

## Sprint 4 Events

---

### EVT-AR-001 — Client Invoice Posted

```
EVENT ID:     CLIENT_INVOICE.POSTED
eventVersion: 1
reversedBy:   CLIENT_INVOICE.REVERSED  (EVT-AR-002)

Trigger:
  Finance executes POST /ar/client-invoices/:id/post
  Requires: documentStatus = APPROVED, postingStatus = NOT_POSTED
  ClientInvoice generated when IPC.isEffective becomes true (not merely approved)

Pre-conditions:
  AccountingPeriod covering accountingDate is OPEN or REOPENED
  PostingRuleVersion for CLIENT_INVOICE.POSTED v1 is ACTIVE for accountingDate
  PostingProfile PROJECT_REVENUE v1 resolves accountId for accountingDate
  Lines balance: totalAmount (DR) = subtotal (CR) + vatAmount (CR)
```

```
JOURNAL LINES

Dr  Accounts Receivable   totalAmount   ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE
                                         dim: clientId, projectId, contractId
Cr  Project Revenue        subtotal      POSTING_PROFILE: PROJECT_REVENUE → accountId @ accountingDate
                                         dim: projectId, departmentId
Cr  Output VAT Payable     vatAmount     TAX_CODE: VAT_5_OUTPUT → outputTaxAccountId
                                         dim: taxCodeId

journalCategory  = ACCOUNTS_RECEIVABLE
entryPurpose     = NORMAL
sourceDocType    = CLIENT_INVOICE
postingOrigin    = SYSTEM_AR
```

```
NUMERIC FIXTURE — "INV-004282, Contract ACME-01, December 2026"

  Input:
    subtotal    = 240,000.00 USD
    vatAmount   =  12,000.00 USD   (5% × 240,000)
    totalAmount = 252,000.00 USD

  Generated journal (journalNumber = SJ-000001):
    Dr  11000 Accounts Receivable   252,000.00
    Cr  42600 Project Income        240,000.00
    Cr  [VAT Payable account]        12,000.00
    ─────────────────────────────────────────
    ∑ Dr = ∑ Cr = 252,000.00  ✓

  DocumentNumberSequence consumed: nextNumber 4282 → 4283
  ClientInvoice.invoiceNumber assigned: "INV-004282"

ERROR CODES
  POSTING_CONFIGURATION_MISSING       — no active PostingRuleVersion for this event + date
  POSTING_PROFILE_VERSION_NOT_FOUND   — PROJECT_REVENUE has no version covering accountingDate
  PERIOD_CLOSED                       — period status is LOCKED or CLOSED
  ALREADY_POSTED                      — postingStatus is already POSTED
  NOT_APPROVED                        — documentStatus ≠ APPROVED
  OPTIMISTIC_CONCURRENCY_CONFLICT     — revision mismatch
  IMBALANCED_JOURNAL                  — lines do not balance (platform bug; must never reach Finance)

SUBLEDGER AFTER POST
  ClientInvoice.postingStatus        = POSTED
  ClientInvoice.invoiceNumber        = "INV-004282"
  ClientInvoice.postedJournalEntryId = <JournalEntry.id>
  ClientInvoice.postedAt             = <timestamp>
  ClientInvoice.outstandingAmount    = 252,000.00 (no allocations yet)

GL IMPACT
  Trial Balance  → AR debit +252k; Revenue credit +240k; VAT Payable credit +12k
  Balance Sheet  → AR (ASSET) +252k; VAT Payable (LIABILITY) +12k
  Profit & Loss  → Revenue +240k for the period
  AR Control     → glBalance +252k = subledgerBalance +252k; variance = 0
```

---

### EVT-AR-002 — Client Invoice Reversed

```
EVENT ID:     CLIENT_INVOICE.REVERSED
eventVersion: 1
reversedBy:   n/a — this is itself a reversal; correction follows EVT-JNL-003

Trigger:
  Finance creates a REVERSAL JournalEntry and CFO approves it
  Source document: ClientInvoice with postingStatus = POSTED
  All ClientReceiptAllocations must be reversed before the invoice can be reversed

Pre-conditions:
  AccountingPeriod for reversal accountingDate is OPEN or REOPENED
  Original JournalEntry status = POSTED
```

```
JOURNAL LINES  (exact mirror of EVT-AR-001)

Cr  Accounts Receivable   252,000.00   (same account as original)
Dr  Project Revenue        240,000.00
Dr  Output VAT Payable      12,000.00

journalCategory             = ACCOUNTS_RECEIVABLE
entryPurpose                = REVERSAL
reversalOfJournalEntryId    = <original JournalEntry.id>
```

```
NUMERIC FIXTURE — reversing INV-004282

  Dr  42600 Project Income        240,000.00
  Dr  [VAT Payable account]        12,000.00
  Cr  11000 Accounts Receivable   252,000.00
  ──────────────────────────────────────────
  ∑ Dr = ∑ Cr = 252,000.00  ✓

SUBLEDGER AFTER REVERSAL
  ClientInvoice.postingStatus          = REVERSED
  ClientInvoice.reversalJournalEntryId = <new JournalEntry.id>
  ClientInvoice.reversedAt / reversedBy set
  ClientInvoice.outstandingAmount      = 0
```

---

### EVT-AR-003 — Payment Receipt Posted

```
EVENT ID:     PAYMENT_RECEIPT.POSTED
eventVersion: 1
reversedBy:   PAYMENT_RECEIPT.REVERSED  (EVT-AR-004)

Trigger:
  Finance executes POST /ar/payment-receipts/:id/post
  Requires: documentStatus = APPROVED, postingStatus = NOT_POSTED, bankAccountId set

Pre-conditions:
  AccountingPeriod for accountingDate is OPEN or REOPENED
  BankAccount.allowsReceipts = true
  BankAccount.status = ACTIVE
  currencyCode matches allocated ClientInvoice currency
  totalAmount = allocatedAmount + unallocatedAmount  (invariant — validated before posting)
  ∑ ClientReceiptAllocation.allocatedAmount = receipt.allocatedAmount  (invariant)
```

```
JOURNAL LINES

BRANCH A — fully allocated (unallocatedAmount = 0):

  Dr  Bank (BankAccount.glAccountId)       totalAmount    TRANSACTION_ACCOUNT: bankAccount.glAccountId
  For each ClientReceiptAllocation[i]:
  Cr  Accounts Receivable (invoice[i])     allocatedAmount[i]   ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE
                                                                 dim: clientId, clientInvoiceId

BRANCH B — partially allocated (unallocatedAmount > 0):

  Dr  Bank (BankAccount.glAccountId)       totalAmount    TRANSACTION_ACCOUNT: bankAccount.glAccountId
  For each ClientReceiptAllocation[i]:
  Cr  Accounts Receivable (invoice[i])     allocatedAmount[i]   ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE
                                                                 dim: clientId, clientInvoiceId
  Cr  Unapplied Client Receipts            unallocatedAmount    ACCOUNT_SUBTYPE: UNAPPLIED_CLIENT_RECEIPTS
                                                                 dim: clientId

  Unallocated portion later applied via CLIENT_RECEIPT_ALLOCATED (EVT-AR-005).

Invariant checked: ∑ Cr lines = totalAmount = Dr Bank line

journalCategory = CASH_AND_BANK
entryPurpose    = NORMAL
sourceDocType   = PAYMENT_RECEIPT
postingOrigin   = SYSTEM_AR
```

```
NUMERIC FIXTURE A — "REC-000001, client pays INV-004282 in full"

  Input:
    totalAmount       = 252,000.00 USD
    allocatedAmount   = 252,000.00 (fully allocated to INV-004282)
    unallocatedAmount = 0.00
    bankAccountId     = <Salaam Bank — glAccountId = Account(code="10100").id>

  Generated journal (journalNumber = RJ-000001):
    Dr  10100 Salaam Bank           252,000.00
    Cr  11000 Accounts Receivable   252,000.00   [INV-004282]
    ─────────────────────────────────────────
    ∑ Dr = ∑ Cr = 252,000.00  ✓

  ClientReceiptAllocation: allocatedAmount=252,000, postingStatus=POSTED
  ClientInvoice.outstandingAmount → 0.00

NUMERIC FIXTURE B — "REC-000002, client pays 10,000; only 7,000 applied to INV-004283"

  Input:
    totalAmount       = 10,000.00 USD
    allocatedAmount   =  7,000.00 (to INV-004283)
    unallocatedAmount =  3,000.00

  Generated journal (journalNumber = RJ-000002):
    Dr  10100 Salaam Bank              10,000.00
    Cr  11000 Accounts Receivable       7,000.00   [INV-004283]
    Cr  [Unapplied Client Receipts]     3,000.00
    ─────────────────────────────────────────────
    ∑ Dr = ∑ Cr = 10,000.00  ✓

  ClientReceiptAllocation (INV-004283): allocatedAmount=7,000, postingStatus=POSTED
  PaymentReceipt.unallocatedAmount = 3,000.00 (pending EVT-AR-005)

ERROR CODES
  BANK_ACCOUNT_NOT_CONFIGURED               — bankAccountId is null (migration exception)
  BANK_ACCOUNT_INACTIVE                     — BankAccount.status ≠ ACTIVE
  RECEIPTS_NOT_ALLOWED                      — BankAccount.allowsReceipts = false
  CROSS_CURRENCY_SETTLEMENT_NOT_SUPPORTED   — receipt currency ≠ invoice currency
  ALLOCATION_INVARIANT_VIOLATION            — totalAmount ≠ allocatedAmount + unallocatedAmount

SUBLEDGER AFTER POST
  PaymentReceipt.postingStatus        = POSTED
  PaymentReceipt.postedJournalEntryId = <JournalEntry.id>
  PaymentReceipt.unallocatedAmount    = totalAmount − allocatedAmount

GL IMPACT (Fixture A)
  Trial Balance  → Bank DR +252k; AR CR +252k (reduces AR balance)
  Balance Sheet  → Bank (ASSET) +252k; AR (ASSET) −252k; net assets unchanged
  AR Control     → glBalance −252k = subledgerBalance −252k; variance = 0
```

---

### EVT-AR-004 — Payment Receipt Reversed

```
EVENT ID:     PAYMENT_RECEIPT.REVERSED
eventVersion: 1
reversedBy:   n/a

Pre-conditions:
  All ClientReceiptAllocations (including subsequent) must be reversed first
  CFO approval required

JOURNAL LINES  (exact mirror of EVT-AR-003 — all lines negated)

  If original was fully allocated:
  Cr  Bank (BankAccount.glAccountId)   totalAmount
  Dr  Accounts Receivable              totalAmount

  If original had unallocated amount:
  Cr  Bank                             totalAmount
  Dr  Accounts Receivable              originalAllocatedAmount
  Dr  Unapplied Client Receipts        originalUnallocatedAmount

NUMERIC FIXTURE — reversing REC-000001 (fully allocated, 252,000)
  Cr  10100 Salaam Bank           252,000.00
  Dr  11000 Accounts Receivable   252,000.00
  ∑ Dr = ∑ Cr = 252,000.00  ✓
```

---

### EVT-AR-005 — Client Receipt Allocated (Subsequent)

```
EVENT ID:     CLIENT_RECEIPT_ALLOCATED
eventVersion: 1
reversedBy:   CLIENT_RECEIPT_ALLOCATED.REVERSED  (EVT-AR-006)

Trigger:
  Finance applies previously unallocated receipt amount to a specific invoice
  POST /ar/payment-receipts/:id/allocate
  A new ClientReceiptAllocation is created for a specific ClientInvoice

Pre-conditions:
  PaymentReceipt.postingStatus = POSTED
  PaymentReceipt.unallocatedAmount >= allocationAmount
  ClientInvoice.postingStatus IN (POSTED, OPENING_BALANCE)
  ClientInvoice.outstandingAmount >= allocationAmount
  AccountingPeriod for allocationDate is OPEN or REOPENED
  allocationAmount > 0

  This event is ONLY for post-payment allocations. Allocations at payment posting time are
  part of EVT-AR-003 and do not produce a separate journal.
```

```
JOURNAL LINES

Dr  Unapplied Client Receipts   allocationAmount   ACCOUNT_SUBTYPE: UNAPPLIED_CLIENT_RECEIPTS
                                                    dim: clientId
Cr  Accounts Receivable         allocationAmount   ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE
                                                    dim: clientId, clientInvoiceId

journalCategory = ACCOUNTS_RECEIVABLE
entryPurpose    = NORMAL
sourceDocType   = PAYMENT_RECEIPT
postingOrigin   = SYSTEM_AR
```

```
NUMERIC FIXTURE — applying REC-000002's 3,000 unallocated amount to INV-004290

  Context: REC-000002 posted with unallocatedAmount = 3,000 (see EVT-AR-003 Fixture B)

  allocationAmount = 3,000.00

  Generated journal (journalNumber = RJ-000003):
    Dr  [Unapplied Client Receipts]   3,000.00
    Cr  11000 Accounts Receivable     3,000.00   [INV-004290]
    ─────────────────────────────────────────
    ∑ Dr = ∑ Cr = 3,000.00  ✓

SUBLEDGER AFTER POST
  PaymentReceipt.allocatedAmount   += 3,000 → 10,000
  PaymentReceipt.unallocatedAmount -= 3,000 → 0
  ClientInvoice.outstandingAmount  -= 3,000
  ClientReceiptAllocation (new): allocatedAmount=3,000, postingStatus=POSTED,
                                  journalEntryId = <RJ-000003.id>  ← different from payment journal

  Invariant check after post:
    receipt.totalAmount = 10,000 = 10,000 (allocatedAmount) + 0 (unallocatedAmount)  ✓
    ∑ POSTED allocation amounts = 7,000 + 3,000 = 10,000 = receipt.allocatedAmount   ✓

ERROR CODES
  RECEIPT_NOT_POSTED                  — PaymentReceipt.postingStatus ≠ POSTED
  INSUFFICIENT_UNALLOCATED            — allocationAmount > PaymentReceipt.unallocatedAmount
  INVOICE_FULLY_PAID                  — ClientInvoice.outstandingAmount = 0
  OVER_ALLOCATION_ON_INVOICE          — allocationAmount > invoice.outstandingAmount
  ALLOCATION_INVARIANT_VIOLATION      — post-commit invariant would be violated

GL IMPACT
  Trial Balance  → Unapplied DR (reduces liability); AR CR (reduces asset)
  Balance Sheet  → Unapplied (LIABILITY) −3k; AR (ASSET) −3k
  AR Control     → AR glBalance −3k = subledger (outstanding) −3k; variance = 0
```

---

### EVT-AR-006 — Client Receipt Allocation Reversed

```
EVENT ID:     CLIENT_RECEIPT_ALLOCATED.REVERSED
eventVersion: 1
reversedBy:   n/a

Trigger:
  Finance reverses a SUBSEQUENT ClientReceiptAllocation (EVT-AR-005 only)
  Initial allocations (journalEntryId = paymentReceipt.postedJournalEntryId) cannot be
  individually reversed — reverse the payment itself (EVT-AR-004) instead.

Pre-conditions:
  ClientReceiptAllocation.postingStatus = POSTED
  ClientReceiptAllocation is a subsequent allocation (not an initial allocation)
  AccountingPeriod for reversalDate is OPEN or REOPENED
  CFO approval required

JOURNAL LINES (exact mirror of EVT-AR-005)

  Dr  Accounts Receivable         allocationAmount   (restores invoice outstanding)
  Cr  Unapplied Client Receipts   allocationAmount   (restores unallocated balance)

NUMERIC FIXTURE — reversing the 3,000 allocation (RJ-000003)

  Dr  11000 Accounts Receivable     3,000.00   [INV-004290]
  Cr  [Unapplied Client Receipts]   3,000.00
  ∑ Dr = ∑ Cr = 3,000.00  ✓

SUBLEDGER AFTER REVERSAL
  PaymentReceipt.allocatedAmount   -= 3,000 → 7,000
  PaymentReceipt.unallocatedAmount += 3,000 → 3,000
  ClientInvoice.outstandingAmount  += 3,000
  ClientReceiptAllocation.postingStatus = REVERSED
```

---

### EVT-AP-001 — Supplier Bill Posted

```
EVENT ID:     SUPPLIER_BILL.POSTED
eventVersion: 1
reversedBy:   SUPPLIER_BILL.REVERSED  (EVT-AP-002)

Trigger:
  Finance executes POST /ap/supplier-bills/:id/post
  Requires: documentStatus = APPROVED, postingStatus = NOT_POSTED

Pre-conditions:
  AccountingPeriod for accountingDate is OPEN or REOPENED
  PostingProfile active for each SupplierBillLine.expenseProfileCode at accountingDate
  CostCenter.departmentId = JournalLine.departmentId for each dimensioned line
  ∑ SupplierBillLine.grossAmount = SupplierBill.totalAmount

ACCO VAT NOTE
  Input VAT is NON_RECOVERABLE (ACC-TAX-001). grossAmount = netAmount + vatAmount posts to expense.
  vatAmount is retained on SupplierBillLine for audit and VAT-return reporting only.
  No separate VAT debit line is generated.
```

```
JOURNAL LINES  (one debit per SupplierBillLine, one AP credit)

For each SupplierBillLine[i]:
  Dr  Expense/Inventory[i]   grossAmount[i]   POSTING_PROFILE: expenseProfileCode → accountId @ date
                                               dim: projectId, departmentId, costCenterId

Cr  Accounts Payable         totalAmount      ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE
                                               dim: supplierId

Invariant: ∑ debit gross amounts = Cr totalAmount

journalCategory = ACCOUNTS_PAYABLE
entryPurpose    = NORMAL
sourceDocType   = SUPPLIER_BILL
postingOrigin   = SYSTEM_AP
```

```
NUMERIC FIXTURE — "PJ-000001, cement delivery, 2 lines"

  Input:
    Line 1: description="Cement bags", net=8,000.00, vat=400.00, gross=8,400.00
             expenseProfileCode = MATERIAL_PURCHASE → account 50303 Cement Cost
             project = PROJ-001, dept = CONST, costCenter = SITE-A

    Line 2: description="Transport", net=1,000.00, vat=50.00, gross=1,050.00
             expenseProfileCode = OFFICE_EXPENSE → account 60100 Transport Expense
             dept = CONST

    totalAmount = 9,450.00 USD

  Generated journal (journalNumber = PJ-000001):
    Dr  50303 Cement Cost         8,400.00   [PROJ-001 / CONST / SITE-A]
    Dr  60100 Transport Expense   1,050.00   [CONST]
    Cr  20000 Accounts Payable    9,450.00
    ─────────────────────────────────────
    ∑ Dr = ∑ Cr = 9,450.00  ✓

    SupplierBill.billNumber = "PJ-000001"
    SupplierBill.outstandingAmount = 9,450.00

ERROR CODES
  COST_CENTER_DEPARTMENT_MISMATCH   — costCenterId does not belong to departmentId on the line
  POSTING_PROFILE_VERSION_NOT_FOUND — no active version for expenseProfileCode at accountingDate
  POSTING_CONFIGURATION_MISSING     — no active PostingRuleVersion

GL IMPACT
  Trial Balance  → Expense DR; AP CR
  Balance Sheet  → AP (LIABILITY) +9,450
  P&L            → Expense charges by project and department
  AP Control     → glBalance +9,450 = subledgerBalance +9,450; variance = 0
```

---

### EVT-AP-002 — Supplier Bill Reversed

```
EVENT ID:     SUPPLIER_BILL.REVERSED
eventVersion: 1
reversedBy:   n/a

Pre-conditions:
  All SupplierPaymentAllocations on this bill must be reversed first
  CFO approval required

JOURNAL LINES  (mirror of EVT-AP-001)

For each original expense line:
  Cr  Expense/Inventory[i]   grossAmount[i]
Dr  Accounts Payable         totalAmount

NUMERIC FIXTURE — reversing PJ-000001
  Cr  50303 Cement Cost         8,400.00
  Cr  60100 Transport Expense   1,050.00
  Dr  20000 Accounts Payable    9,450.00
  ∑ Dr = ∑ Cr = 9,450.00  ✓
```

---

### EVT-AP-003 — Supplier Payment Posted

```
EVENT ID:     SUPPLIER_PAYMENT.POSTED
eventVersion: 1
reversedBy:   SUPPLIER_PAYMENT.REVERSED  (EVT-AP-004)

Trigger:
  Finance executes POST /ap/supplier-payments/:id/post
  Requires: documentStatus = APPROVED, postingStatus = NOT_POSTED

Pre-conditions:
  AccountingPeriod for accountingDate is OPEN or REOPENED
  BankAccount.allowsPayments = true
  BankAccount.status = ACTIVE
  Each SupplierPaymentAllocation.allocatedAmount ≤ SupplierBill.outstandingAmount
  totalAmount = allocatedAmount + unallocatedAmount  (invariant — validated before posting)
  ∑ SupplierPaymentAllocation.allocatedAmount = payment.allocatedAmount  (invariant)
  currencyCode matches allocated bills
```

```
JOURNAL LINES

BRANCH A — fully allocated (unallocatedAmount = 0):

  For each SupplierPaymentAllocation[i]:
  Dr  Accounts Payable (bill[i])     allocatedAmount[i]   ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE
                                                            dim: supplierId, supplierBillId

  Cr  Bank (BankAccount.glAccountId)   totalAmount         TRANSACTION_ACCOUNT: bankAccount.glAccountId

BRANCH B — partially allocated (unallocatedAmount > 0):

  For each SupplierPaymentAllocation[i]:
  Dr  Accounts Payable (bill[i])     allocatedAmount[i]   ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE
                                                            dim: supplierId, supplierBillId

  Dr  Supplier Advance               unallocatedAmount    ACCOUNT_SUBTYPE: SUPPLIER_ADVANCE
                                                            dim: supplierId

  Cr  Bank (BankAccount.glAccountId)   totalAmount

  Advance portion later applied to a bill via SUPPLIER_ADVANCE_ALLOCATED (EVT-AP-005).

Invariant checked: ∑ Dr lines = totalAmount = Cr Bank line

journalCategory = CASH_AND_BANK
entryPurpose    = NORMAL
sourceDocType   = SUPPLIER_PAYMENT
postingOrigin   = SYSTEM_AP
```

```
NUMERIC FIXTURE A — "PAY-000001, pays PJ-000001 in full"

  Input:
    totalAmount       = 9,450.00 USD
    allocatedAmount   = 9,450.00 (all to PJ-000001)
    unallocatedAmount = 0.00

  Generated journal (journalNumber = PY-000001):
    Dr  20000 Accounts Payable   9,450.00   [PJ-000001]
    Cr  10100 Salaam Bank        9,450.00
    ──────────────────────────────────────
    ∑ Dr = ∑ Cr = 9,450.00  ✓

  SupplierBill PJ-000001.outstandingAmount → 0.00
  SupplierPayment.paymentNumber = "PAY-000001"

NUMERIC FIXTURE B — "PAY-000002, 9,950 payment; 9,450 to PJ-000001, 500 unallocated advance"

  Input:
    totalAmount       = 9,950.00 USD
    allocatedAmount   = 9,450.00 (to PJ-000001)
    unallocatedAmount =   500.00

  Generated journal (journalNumber = PY-000002):
    Dr  20000 Accounts Payable   9,450.00   [PJ-000001]
    Dr  [Supplier Advance]         500.00
    Cr  10100 Salaam Bank        9,950.00
    ──────────────────────────────────────
    ∑ Dr = ∑ Cr = 9,950.00  ✓

  SupplierBill PJ-000001.outstandingAmount → 0.00
  SupplierPayment.unallocatedAmount = 500.00 (pending EVT-AP-005)

NUMERIC FIXTURE C — two bills, fully allocated (multi-bill)

  totalAmount = 15,000.00
  Alloc[1]: PJ-000001 = 9,450.00
  Alloc[2]: PJ-000002 = 5,550.00
  unallocated = 0.00

  Dr  20000 AP (PJ-000001)   9,450.00
  Dr  20000 AP (PJ-000002)   5,550.00
  Cr  10100 Salaam Bank     15,000.00
  ∑ Dr = ∑ Cr = 15,000.00  ✓

ERROR CODES
  BILL_ALREADY_PAID                — SupplierBill.outstandingAmount = 0
  OVER_ALLOCATION                  — allocatedAmount > SupplierBill.outstandingAmount
  BANK_ACCOUNT_INACTIVE            — BankAccount.status ≠ ACTIVE
  PAYMENTS_NOT_ALLOWED             — BankAccount.allowsPayments = false
  ALLOCATION_INVARIANT_VIOLATION   — totalAmount ≠ allocatedAmount + unallocatedAmount

GL IMPACT (Fixture A)
  Trial Balance  → AP DR reduces liability; Bank CR reduces asset
  Balance Sheet  → AP (LIABILITY) −9,450; Bank (ASSET) −9,450
  AP Control     → glBalance −9,450 = subledgerBalance −9,450; variance = 0
```

---

### EVT-AP-004 — Supplier Payment Reversed

```
EVENT ID:     SUPPLIER_PAYMENT.REVERSED
eventVersion: 1
reversedBy:   n/a

Pre-conditions:
  All SupplierPaymentAllocations (including subsequent SUPPLIER_ADVANCE_ALLOCATED) reversed first
  CFO approval required

JOURNAL LINES  (exact mirror of EVT-AP-003 — all lines negated)

  If original was fully allocated:
  Cr  Accounts Payable (each bill[i])   allocatedAmount[i]
  Dr  Bank                              totalAmount

  If original had unallocated amount:
  Cr  Accounts Payable (each bill[i])   allocatedAmount[i]
  Cr  Supplier Advance                  unallocatedAmount
  Dr  Bank                              totalAmount

NUMERIC FIXTURE — reversing PAY-000001 (fully allocated, 9,450)
  Cr  20000 Accounts Payable   9,450.00
  Dr  10100 Salaam Bank        9,450.00
  ∑ Dr = ∑ Cr = 9,450.00  ✓

  SupplierBill.outstandingAmount restored to 9,450.00
```

---

### EVT-AP-005 — Supplier Advance Allocated

```
EVENT ID:     SUPPLIER_ADVANCE_ALLOCATED
eventVersion: 1
reversedBy:   SUPPLIER_ADVANCE_ALLOCATED.REVERSED  (EVT-AP-006)

Trigger:
  Finance applies a previously unallocated supplier payment (advance) to a specific bill
  POST /ap/supplier-payments/:id/allocate-advance

Pre-conditions:
  SupplierPayment.postingStatus = POSTED
  SupplierPayment.unallocatedAmount >= allocationAmount
  SupplierBill.postingStatus IN (POSTED, OPENING_BALANCE)
  SupplierBill.outstandingAmount >= allocationAmount
  AccountingPeriod for allocationDate is OPEN or REOPENED
  allocationAmount > 0

  This event is ONLY for post-payment allocations of unallocated (advance) amounts.
  Allocations posted at payment time are part of EVT-AP-003 and produce no separate journal.
```

```
JOURNAL LINES

Dr  Accounts Payable     allocationAmount   ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE
                                             dim: supplierId, supplierBillId
Cr  Supplier Advance     allocationAmount   ACCOUNT_SUBTYPE: SUPPLIER_ADVANCE
                                             dim: supplierId

journalCategory = ACCOUNTS_PAYABLE
entryPurpose    = NORMAL
sourceDocType   = SUPPLIER_PAYMENT
postingOrigin   = SYSTEM_AP
```

```
NUMERIC FIXTURE — applying PAY-000002's 500 advance to bill PJ-000003

  Context: PAY-000002 posted with unallocatedAmount = 500 (see EVT-AP-003 Fixture B)

  allocationAmount = 500.00

  Generated journal (journalNumber = PJ-000002-ADV):
    Dr  20000 Accounts Payable   500.00   [PJ-000003]
    Cr  [Supplier Advance]       500.00
    ──────────────────────────────────
    ∑ Dr = ∑ Cr = 500.00  ✓

SUBLEDGER AFTER POST
  SupplierPayment.allocatedAmount   += 500 → 9,950
  SupplierPayment.unallocatedAmount -= 500 → 0
  SupplierBill PJ-000003.outstandingAmount -= 500
  SupplierPaymentAllocation (new): allocatedAmount=500, postingStatus=POSTED,
                                    journalEntryId = <PJ-000002-ADV.id>

  Invariant check:
    payment.totalAmount = 9,950 = 9,950 (allocated) + 0 (unallocated)  ✓
    ∑ POSTED allocation amounts = 9,450 + 500 = 9,950 = payment.allocatedAmount  ✓

ERROR CODES
  PAYMENT_NOT_POSTED             — SupplierPayment.postingStatus ≠ POSTED
  INSUFFICIENT_ADVANCE           — allocationAmount > payment.unallocatedAmount
  BILL_ALREADY_PAID              — SupplierBill.outstandingAmount = 0
  OVER_ALLOCATION_ON_BILL        — allocationAmount > bill.outstandingAmount
  ALLOCATION_INVARIANT_VIOLATION — invariant would be violated after commit

GL IMPACT
  Trial Balance  → AP DR (reduces liability); Supplier Advance CR (reduces asset)
  Balance Sheet  → AP (LIABILITY) −500; Supplier Advance (ASSET) −500
  AP Control     → AP glBalance −500 = subledger −500; variance = 0
```

---

### EVT-AP-006 — Supplier Advance Allocation Reversed

```
EVENT ID:     SUPPLIER_ADVANCE_ALLOCATED.REVERSED
eventVersion: 1
reversedBy:   n/a

Trigger:
  Finance reverses a SUBSEQUENT SupplierPaymentAllocation (EVT-AP-005 only)
  Initial allocations cannot be individually reversed — reverse the payment (EVT-AP-004) instead.

Pre-conditions:
  SupplierPaymentAllocation.postingStatus = POSTED
  Allocation is a subsequent allocation (not an initial allocation at payment post time)
  AccountingPeriod for reversalDate is OPEN or REOPENED
  CFO approval required

JOURNAL LINES (exact mirror of EVT-AP-005)

  Dr  Supplier Advance     allocationAmount   (restores advance balance)
  Cr  Accounts Payable     allocationAmount   (restores bill outstanding)

NUMERIC FIXTURE — reversing the 500 advance allocation

  Dr  [Supplier Advance]       500.00
  Cr  20000 Accounts Payable   500.00   [PJ-000003]
  ∑ Dr = ∑ Cr = 500.00  ✓

SUBLEDGER AFTER REVERSAL
  SupplierPayment.allocatedAmount   -= 500 → 9,450
  SupplierPayment.unallocatedAmount += 500 → 500
  SupplierBill PJ-000003.outstandingAmount += 500
  SupplierPaymentAllocation.postingStatus = REVERSED
```

---

### EVT-JNL-001 — Manual Journal Posted

```
EVENT ID:     MANUAL_JOURNAL.POSTED
eventVersion: 1
reversedBy:   JOURNAL.REVERSAL  (EVT-JNL-002)

Trigger:
  Finance creates a JournalEntry manually and CFO approves it
  Requires: status = APPROVED, entryPurpose = NORMAL
  journalCategory = GENERAL | CLOSING_ADJUSTMENT (other categories reserved for system events)

Pre-conditions:
  If journalCategory = GENERAL or REVERSAL or REPLACEMENT:
    AccountingPeriod for accountingDate must be OPEN or REOPENED
  If journalCategory = CLOSING_ADJUSTMENT:
    AccountingPeriod may be OPEN, LOCKED, or REOPENED
    (LOCKED periods accept only CLOSING_ADJUSTMENT journals)
  ∑ debitAmount = ∑ creditAmount
  No line targets a SYSTEM_ONLY control account (postingOrigin = MANUAL)
  Four-eyes: approvedBy ≠ createdBy (ACC-017)
  At least one JournalEntryAttachment uploaded (recommended; not hard-enforced in Sprint 4)
```

```
JOURNAL LINES
  User-defined; no template
  postingOrigin = MANUAL

NUMERIC FIXTURE — "GJ-000001, accrued expense reclassification"

  Dr  60200 Accrued Expense   3,000.00   [dept: ADMIN]
  Cr  60100 Prepaid Expense   3,000.00
  ──────────────────────────────────────
  ∑ Dr = ∑ Cr = 3,000.00  ✓

NUMERIC FIXTURE — "GJ-000002, December depreciation (CLOSING_ADJUSTMENT to LOCKED period)"

  Dr  65000 Depreciation Expense   4,200.00   [dept: ADMIN]
  Cr  15500 Accum. Depreciation    4,200.00
  ──────────────────────────────────────────
  ∑ Dr = ∑ Cr = 4,200.00  ✓
  journalCategory = CLOSING_ADJUSTMENT
  Period 12 status = LOCKED — this posting is accepted  ✓

ERROR CODES
  CONTROL_ACCOUNT_DIRECT_POSTING_PROHIBITED — line targets SYSTEM_ONLY account (trigger fires)
  IMBALANCED_JOURNAL                        — debits ≠ credits
  SELF_APPROVAL_PROHIBITED                  — approvedBy = createdBy
  PERIOD_LOCKED_REQUIRES_CLOSING_ADJUSTMENT — journalCategory ≠ CLOSING_ADJUSTMENT but period is LOCKED
  PERIOD_CLOSED                             — period status is CLOSED

GL IMPACT (GJ-000002)
  Trial Balance  → Depreciation DR; Accum. Depreciation CR
  P&L            → Depreciation Expense +4,200 (entryPurpose=NORMAL; included in P&L  ✓)
  Balance Sheet  → Fixed Assets reduced net by 4,200
```

---

### EVT-JNL-002 — Journal Reversal

```
EVENT ID:     JOURNAL.REVERSAL
eventVersion: 1
reversedBy:   n/a (correctional replacement follows as EVT-JNL-003)

Trigger:
  Finance creates a REVERSAL JournalEntry referencing the original, CFO approves

JOURNAL LINES
  Exact negation of every line in the original JournalEntry.
  All dimensions preserved.
  reversalOfJournalEntryId = original JournalEntry.id
  entryPurpose = REVERSAL

NUMERIC FIXTURE — reversing GJ-000001

  Cr  60200 Accrued Expense   3,000.00
  Dr  60100 Prepaid Expense   3,000.00
  ∑ Dr = ∑ Cr = 3,000.00  ✓

POST-EFFECTS
  Original JournalEntry.status → REVERSED
  Original JournalEntry.reversedAt / reversedBy set
  For system-generated originals: source document postingStatus → REVERSED
```

---

### EVT-JNL-003 — Replacement / Correcting Journal

```
EVENT ID:     JOURNAL.REPLACEMENT
eventVersion: 1
reversedBy:   JOURNAL.REVERSAL  (EVT-JNL-002) — if the replacement itself needs correction

Trigger:
  Finance posts the corrected entry following a reversal (EVT-JNL-002)
  entryPurpose = REPLACEMENT
  replacedByJournalEntryId = original (pre-reversal) JournalEntry.id

NUMERIC FIXTURE — correcting GJ-000001 (wrong department on accrual)

  Before (wrong):     Dr 60200 [ADMIN]  Cr 60100 [ADMIN]
  Reversal:           Cr 60200 [ADMIN]  Dr 60100 [ADMIN]
  Replacement:        Dr 60200 [OPS]    Cr 60100 [ADMIN]  — corrected department
  ∑ Dr = ∑ Cr = 3,000.00 on each journal  ✓

  All three journals visible in the GL ledger with their linkage.
```

---

### EVT-OPB-001 — Opening Balance Journal

```
EVENT ID:     OPENING_BALANCE.POSTED
eventVersion: 1
reversedBy:   n/a — opening balances cannot be reversed; correction requires CFO-approved
              manual adjustment journal (EVT-JNL-001) after identifying the discrepancy

Trigger:
  Migration utility after AccountingMigrationBatch.status = APPROVED
  Executed once per organization go-live

CRITICAL RULE — No Double-Posting (ADR-006 §17.1):
  Open ClientInvoices and SupplierBills are loaded with postingStatus = OPENING_BALANCE.
  They receive NO individual JournalEntry at migration time.
  Their aggregate balance is represented by the AR and AP lines in this single journal.
  Individual document journals are PROHIBITED for any document with postingStatus = OPENING_BALANCE.
  After go-live, normal payment/settlement postings update the control accounts correctly.

Pre-conditions:
  All reconciliation identities satisfied (variance = $0.00 each, CFO-verified):
    GL AR account   = ∑ migrated ClientInvoice.outstandingAmount  (where postingStatus = OPENING_BALANCE)
    GL AP account   = ∑ migrated SupplierBill.outstandingAmount   (where postingStatus = OPENING_BALANCE)
    GL Bank (each)  = Finance-supplied register balance per account
  ∑ debit lines = ∑ credit lines across entire journal
```

```
JOURNAL LINES
  One line per account with a non-zero opening balance.
  Normal balance DEBIT accounts: Dr entry
  Normal balance CREDIT accounts: Cr entry
  postingOrigin = SYSTEM_OPENING

journalCategory = OPENING_BALANCE
entryPurpose    = OPENING_BALANCE
sourceDocType   = OPENING_BALANCE

NUMERIC FIXTURE — ACCO go-live opening balance (illustrative subset)

  Dr  10100 Salaam Bank              450,000.00
  Dr  10200 Dahabshiil Bank           80,000.00
  Dr  11000 Accounts Receivable      315,000.00   (= 3 open invoices: 180k + 90k + 45k)
  Dr  12100 Inventory Asset           22,000.00
  Dr  15000 Fixed Assets             350,000.00
  Dr  17000 Prepaid Expenses           5,500.00

  Cr  20000 Accounts Payable         125,000.00   (= 2 open bills: 75k + 50k)
  Cr  20200 VAT Payable               14,500.00
  Cr  30000 ASAS Group Capital       500,000.00
  Cr  31000 Retained Earnings        583,000.00
  ────────────────────────────────────────────
  ∑ Dr = ∑ Cr = 1,222,500.00  ✓

  Migrated documents (NO individual journals):
    Invoice A (180k)  → ClientInvoice postingStatus = OPENING_BALANCE
    Invoice B (90k)   → ClientInvoice postingStatus = OPENING_BALANCE
    Invoice C (45k)   → ClientInvoice postingStatus = OPENING_BALANCE
    Bill X (75k)      → SupplierBill  postingStatus = OPENING_BALANCE
    Bill Y (50k)      → SupplierBill  postingStatus = OPENING_BALANCE

RECONCILIATION GATE (all must be $0.00 before CFO approves):
  AR: GL 315,000 vs subledger (180k + 90k + 45k) = 315,000  → variance 0  ✓
  AP: GL 125,000 vs subledger (75k + 50k) = 125,000         → variance 0  ✓
  Salaam Bank: GL 450,000 vs Finance register 450,000         → variance 0  ✓
  Dahabshiil Bank: GL 80,000 vs Finance register 80,000       → variance 0  ✓
```

---

### EVT-CLO-001 — Year-End Closing Entry

```
EVENT ID:     YEAR_END_CLOSE.CLOSING_ENTRY
eventVersion: 1
reversedBy:   n/a — closing entries cannot be reversed; the fiscal year remains CLOSED.
              Correction requires reopening the fiscal year (CFO-only, extraordinary process)
              followed by a REPLACEMENT journal (EVT-JNL-003).

Trigger:
  CFO executes year-end close command
  All 12 FiscalYear periods must be CLOSED
  FiscalYear.retainedEarningsAccountId must be set and active
  Posted to Period 12 while it is in LOCKED status (CLOSING_ADJUSTMENT or YEAR_END_CLOSE category)

Pre-conditions:
  FiscalYear.status = OPEN
  All period snapshots are VALID
  No unposted approved documents in any period

P&L FILTER NOTE (ADR-006 §17.3):
  This journal has entryPurpose = CLOSING.
  P&L reports MUST exclude lines where entry.entryPurpose = 'CLOSING'.
  Post-close Trial Balance INCLUDES this entry — P&L accounts show $0 after close.
```

```
JOURNAL LINES
  Compute YTD totals for all INCOME and EXPENSE accounts from posted JournalLines
  where entryPurpose != 'CLOSING' (i.e., the year's operating activity only).

  For each INCOME account with YTD net credit balance:
    Dr  [Income account]   YTD net credit balance   (zeroing debit)

  For each EXPENSE / COST_OF_SALES account with YTD net debit balance:
    Cr  [Expense account]  YTD net debit balance    (zeroing credit)

  Net difference:
    If income > expense (net profit):  Cr  Retained Earnings  net profit
    If expense > income (net loss):    Dr  Retained Earnings  net loss

journalCategory = YEAR_END_CLOSE
entryPurpose    = CLOSING
accountingDate  = last day of December (Period 12 end date)
postingOrigin   = SYSTEM_YEAR_END

NUMERIC FIXTURE — ACCO FY2026 year-end close (profit scenario)

  YTD totals from POSTED JournalLines (entryPurpose ≠ CLOSING):
    Total Revenue (INCOME)           = 1,200,000.00
    Total Expenses (EXPENSE + COGS)  =   850,000.00
    Net Profit                       =   350,000.00

  Generated journal (journalNumber = GJ-000099):
    Dr  42600 Project Income        1,200,000.00
    Cr  50000–65000 Expense accts     850,000.00   (one Cr line per expense account)
    Cr  31000 Retained Earnings       350,000.00
    ─────────────────────────────────────────────
    ∑ Dr = ∑ Cr = 1,200,000.00  ✓

  Net-loss fixture:
    Dr  42600 Project Income          800,000.00
    Cr  50000–65000 Expense accts     900,000.00
    Dr  31000 Retained Earnings       100,000.00
    ─────────────────────────────────────────────
    ∑ Dr = ∑ Cr = 900,000.00  ✓

POST-EFFECTS
  FiscalYear.status → CLOSED
  INCOME and EXPENSE account balances = 0 in post-close Trial Balance
  ASSET, LIABILITY, EQUITY accounts carry closing balances forward unchanged
  Balance Sheet: Retained Earnings increased by 350,000 (profit scenario)

  P&L for December (pre-close): shows 1,200k revenue / 850k expense
    query filter: entry.entryPurpose != 'CLOSING'  ← YEAR_END_CLOSE journal excluded  ✓

  Post-close Trial Balance: includes all entries
    Revenue accounts show $0; Retained Earnings shows go-forward balance  ✓
```

---

## Event Version History

| Event ID | eventVersion | Change Summary | Effective From |
|---|---|---|---|
| CLIENT_INVOICE.POSTED | 1 | Initial definition | Sprint 4 |
| CLIENT_INVOICE.REVERSED | 1 | Initial definition | Sprint 4 |
| PAYMENT_RECEIPT.POSTED | 1 | v1.2: branch A (full alloc) + branch B (partial alloc); invariant checks | Sprint 4 |
| PAYMENT_RECEIPT.REVERSED | 1 | v1.2: mirror both branches | Sprint 4 |
| CLIENT_RECEIPT_ALLOCATED | 1 | New in v1.2: post-payment allocation of unallocated receipt amount | Sprint 4 |
| CLIENT_RECEIPT_ALLOCATED.REVERSED | 1 | New in v1.2 | Sprint 4 |
| SUPPLIER_BILL.POSTED | 1 | Initial definition (NON_RECOVERABLE VAT) | Sprint 4 |
| SUPPLIER_BILL.REVERSED | 1 | Initial definition | Sprint 4 |
| SUPPLIER_PAYMENT.POSTED | 1 | v1.2: branch A (full) + branch B (partial with Supplier Advance) | Sprint 4 |
| SUPPLIER_PAYMENT.REVERSED | 1 | v1.2: mirror both branches | Sprint 4 |
| SUPPLIER_ADVANCE_ALLOCATED | 1 | New in v1.2: post-payment allocation of supplier advance | Sprint 4 |
| SUPPLIER_ADVANCE_ALLOCATED.REVERSED | 1 | New in v1.2 | Sprint 4 |
| MANUAL_JOURNAL.POSTED | 1 | v1.2: CLOSING_ADJUSTMENT accepted in LOCKED period; period error codes updated | Sprint 4 |
| JOURNAL.REVERSAL | 1 | Initial definition | Sprint 4 |
| JOURNAL.REPLACEMENT | 1 | Initial definition | Sprint 4 |
| OPENING_BALANCE.POSTED | 1 | v1.2: OPENING_BALANCE postingStatus protocol; no-double-posting rule | Sprint 4 |
| YEAR_END_CLOSE.CLOSING_ENTRY | 1 | v1.2: P&L filter note; journalCategory = YEAR_END_CLOSE | Sprint 4 |

An `eventVersion` increment requires: (a) a new `PostingRuleVersion` with updated line templates, (b) an updated catalog entry, (c) CFO approval of the new rule, (d) impact preview on any in-flight documents.

---

## Reversal Map

| Posted Event | Reversed By |
|---|---|
| CLIENT_INVOICE.POSTED | CLIENT_INVOICE.REVERSED (EVT-AR-002) |
| PAYMENT_RECEIPT.POSTED | PAYMENT_RECEIPT.REVERSED (EVT-AR-004) |
| CLIENT_RECEIPT_ALLOCATED | CLIENT_RECEIPT_ALLOCATED.REVERSED (EVT-AR-006) — subsequent allocations only |
| SUPPLIER_BILL.POSTED | SUPPLIER_BILL.REVERSED (EVT-AP-002) |
| SUPPLIER_PAYMENT.POSTED | SUPPLIER_PAYMENT.REVERSED (EVT-AP-004) |
| SUPPLIER_ADVANCE_ALLOCATED | SUPPLIER_ADVANCE_ALLOCATED.REVERSED (EVT-AP-006) — subsequent only |
| MANUAL_JOURNAL.POSTED | JOURNAL.REVERSAL (EVT-JNL-002) |
| JOURNAL.REPLACEMENT | JOURNAL.REVERSAL (EVT-JNL-002) |
| OPENING_BALANCE.POSTED | No reversal — CFO-approved manual adjustment journal (EVT-JNL-001) |
| YEAR_END_CLOSE.CLOSING_ENTRY | No reversal — extraordinary CFO fiscal-year reopen + replacement |

---

## Reserved Event Slots (Sprint 5–9)

| ID Range | Module |
|---|---|
| EVT-INV-001–010 | Inventory |
| EVT-PO-001–010 | Procurement |
| EVT-PR-001–010 | Payroll |
| EVT-FA-001–010 | Fixed Assets |
| EVT-BNK-001–010 | Bank Reconciliation |
| EVT-CLO-002–010 | Period and Year-end Close extensions |
