import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { AccountWithCurrentVersion } from '../../accounting-core/infrastructure/account.repository.js';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import {
  PostingAccountResolver,
  type ResolvedAccount,
} from '../../accounting-core/application/posting-account-resolver.service.js';
import { ClientInvoiceRepository } from '../infrastructure/client-invoice.repository.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { InvoiceDocumentService } from './invoice-document.service.js';

/** `billingAddressSnapshot.org` — see {@link ClientInvoiceService.snapshotOrgBranding}. */
interface OrgBrandingSnapshot {
  name: string;
  logoFileId: string | null;
  legalAddress: string | null;
  taxRegistrationNumber: string | null;
  brandColorHex: string | null;
  invoiceFooterNote: string | null;
  invoiceTemplate: string;
}

export interface GenerateInvoiceFromIpcDto {
  ipcId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export interface GenerateInvoiceFromInstallmentDto {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
  /**
   * ADR-030 CONST-COM-029 (Commercial redesign P1) — a signed money-string adjustment applied to the
   * stage subtotal BEFORE tax, used to net an omission variation (STAGE_REDUCTION) into a stage that
   * has NOT yet been invoiced. Defaults to `'0'` (no adjustment; the legacy path is unchanged). Must
   * be ≤ 0 in practice (an omission reduces the stage); a value that would drive the subtotal below
   * zero is refused. Additions are billed as their own invoice, never through this field.
   */
  subtotalAdjustment?: string;
}

/**
 * ADR-030 CONST-COM-028 (Commercial redesign P1) — the primitive-driven DTO for a variation's OWN
 * standalone invoice, composed by the commercial bill-stage orchestrator (never idempotent, never
 * controller-exposed: the orchestrator owns the exactly-once guard through the allocation ledger).
 */
export interface GenerateStandaloneChargeDto {
  clientId: string;
  projectId: string;
  contractId: string;
  currencyCode: string;
  /** The positive ex-tax charge (2dp money string). */
  subtotal: string;
  /** Human label snapshotted onto the invoice (`VO-001 — Extra scope`). */
  label: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export interface GenerateInvoiceFromSeparateChargeDto {
  boqNodeId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export interface ApproveInvoiceDto {
  invoiceId: string;
}

export interface PostInvoiceDto {
  invoiceId: string;
  /** Optional override for the AR control account. Resolved server-side by role when absent (ACC-POST-001). */
  arAccountCode?: string;
  /** Optional override for the Revenue account. Resolved server-side by role when absent. */
  revenueAccountCode?: string;
  /** Optional override for the Output VAT account. Resolved server-side by role when vatAmount > 0. */
  vatAccountCode?: string;
}

@Injectable()
export class ClientInvoiceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientInvoiceRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
    private readonly documentService: InvoiceDocumentService,
    private readonly files: PlatformFileService,
  ) {}

  /**
   * The org's invoice branding, captured at invoice-creation time and frozen into
   * `billingAddressSnapshot.org`. Never re-read live once the invoice exists — that is the whole
   * point: editing the org's logo next month must never change an already-issued invoice.
   */
  private async snapshotOrgBranding(
    prisma: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<OrgBrandingSnapshot | null> {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        logoFileId: true,
        legalAddress: true,
        taxRegistrationNumber: true,
        brandColorHex: true,
        invoiceFooterNote: true,
        invoiceTemplate: true,
      },
    });
  }

  /**
   * Generate a draft ClientInvoice from an effective IPC.
   *
   * CONST-COM-006 — idempotent: one effective IPC maps to at most one ClientInvoice.
   * Repeating the command returns the existing invoice rather than creating a second AR
   * receivable. Concurrency is closed by the unique index on ClientInvoice.sourceIpcId:
   * a racing insert fails with P2002 and we return the invoice the winner created.
   */
  async generateFromIpc(identity: RequestIdentity, dto: GenerateInvoiceFromIpcDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByIpc(prisma, orgId, dto.ipcId);
    if (existing) return existing;

    const ipc = await prisma.interimPaymentCertificate.findFirst({
      where: { id: dto.ipcId, organizationId: orgId },
      include: {
        application: { include: { contract: { include: { client: true } } } },
      },
    });
    if (!ipc) throw new NotFoundException(`IPC ${dto.ipcId} not found`);
    if (!ipc.isEffective) throw new BadRequestException(`IPC ${dto.ipcId} is not effective yet`);

    const contract = ipc.application.contract;
    const subtotal = new Decimal(ipc.certifiedTotal.toString());
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);
    const org = await this.snapshotOrgBranding(prisma, orgId);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        clientId: contract.clientId,
        sourceIpcId: dto.ipcId,
        projectId: contract.projectId,
        contractId: contract.id,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: ipc.currency,
        subtotal,
        vatAmount,
        totalAmount,
        paymentTerms: dto.paymentTerms,
        billingAddressSnapshot: {
          client: {
            name: contract.client.name,
            address: contract.client.address,
            taxNumber: contract.client.taxNumber,
          },
          description: `Interim Certificate ${ipc.certificateRef ?? `#${ipc.certificateNumber}`}`,
          org,
        },
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent generation lost the race on the unique(source_ipc_id) index.
      // Return the invoice the winning request created — still exactly one receivable.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findByIpc(prisma, orgId, dto.ipcId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * ADR-023: generate a draft ClientInvoice from a payment-schedule installment (MILESTONE contract).
   *
   * Idempotent, exactly like generateFromIpc: one installment maps to at most one invoice, enforced by
   * the unique index on ClientInvoice.sourceInstallmentId. The amount is derived from
   * base contract value × installment percentage — never re-keyed, so the invoice cannot drift from
   * the plan. This is ADR-023's BillableEntitlement → guarded invoice for the payment-schedule model.
   *
   * ADR-029 CONST-BOQ-032 / T-6 — the schedule derives from the **frozen** `baseContractValue`, so a
   * variation that raises the current `contractValue` (R6) never re-spreads the milestone amounts. A
   * legacy contract with a null base (M-4) falls back to `contractValue`.
   */
  async generateFromInstallment(
    identity: RequestIdentity,
    dto: GenerateInvoiceFromInstallmentDto,
    // ADR-030 P1 — when the commercial bill-stage orchestrator passes its own transaction client, the
    // idempotency read AND the create run inside it, so the milestone invoice + its VO
    // invoices/allocations commit atomically. Absent, the legacy standalone path is unchanged.
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByInstallment(prisma, orgId, dto.installmentId);
    if (existing) return existing;

    const installment = await this.repo.findInstallmentForBilling(prisma, orgId, dto.installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${dto.installmentId} not found`);
    }

    const contract = installment.contract;
    if (contract.billingModel !== 'MILESTONE') {
      throw new BadRequestException(
        'Installment invoicing applies only to MILESTONE (payment-schedule) contracts.',
      );
    }
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Contract ${contract.contractNumber} must be ACTIVE to bill an installment (currently ${contract.status}).`,
      );
    }
    // ADR-023 CONST-COM-011 (soft gate): when an installment is linked to a programme milestone, the
    // milestone is its billing evidence — it must be VERIFIED before the invoice can be raised.
    // Unlinked installments bill on their label as before.
    if (installment.programmeMilestoneId && installment.programmeMilestone?.status !== 'VERIFIED') {
      throw new BadRequestException(
        'The linked programme milestone is not yet verified; this installment cannot be billed.',
      );
    }

    const scheduleBase = contract.baseContractValue ?? contract.contractValue;
    // ADR-030 CONST-COM-029 — the stage entitlement (pct × frozen base), then a signed adjustment for
    // omission variations netted into this un-invoiced stage. GUARD: never produce a negative subtotal.
    const stageBase = new Decimal(scheduleBase.toString())
      .mul(new Decimal(installment.percentage.toString()))
      .toDecimalPlaces(2);
    const adjustment = new Decimal(dto.subtotalAdjustment ?? '0').toDecimalPlaces(2);
    const subtotal = stageBase.plus(adjustment).toDecimalPlaces(2);
    if (subtotal.lessThan(0)) {
      throw new BadRequestException(
        `The stage subtotal after adjustment is negative (${subtotal.toFixed(2)}); an omission cannot ` +
          'exceed the stage value. Reduce the omission or bill it as a credit note.',
      );
    }
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);
    const org = await this.snapshotOrgBranding(prisma, orgId);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        clientId: contract.clientId,
        sourceInstallmentId: dto.installmentId,
        projectId: contract.projectId,
        contractId: contract.id,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: contract.currency,
        subtotal,
        vatAmount,
        totalAmount,
        paymentTerms: dto.paymentTerms,
        billingAddressSnapshot: {
          client: {
            name: contract.client.name,
            address: contract.client.address,
            taxNumber: contract.client.taxNumber,
          },
          description: installment.name,
          org,
        },
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent generation lost the race on unique(source_installment_id): return the winner's invoice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findByInstallment(prisma, orgId, dto.installmentId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * ADR-029 CONST-BOQ-030/033 / spec R-4 — generate a draft one-off ClientInvoice for a SEPARATE_CHARGE
   * BOQ leaf (an extra billed OUTSIDE the milestone schedule).
   *
   * Modelled analogously to {@link generateFromInstallment}: it produces the SAME billable document at
   * the SAME lifecycle stage (DRAFT / NOT_POSTED). The invoice is tagged `sourceBoqNodeId = <leaf id>`
   * with `sourceInstallmentId` and `sourceIpcId` null, so it is distinguishable from installment,
   * IPC, migration-loaded (NONE) and a future VO invoice. The subtotal is the leaf's own
   * `totalAmount` — never re-keyed, so the invoice cannot drift from the priced scope.
   *
   * Idempotent exactly like the installment path: one SEPARATE_CHARGE node maps to at most one invoice,
   * enforced by the unique index on `ClientInvoice.sourceBoqNodeId`; a racing insert fails P2002 and we
   * return the winner's invoice — still exactly one receivable.
   *
   * SCOPE (spec §"SCOPE GUARD"): this creates the billable document ONLY. It does NOT post to GL/AR
   * (no journal entries, no control accounts, no receipt allocation) — that is `approve` → `post`, the
   * same downstream path an installment invoice takes, and is out of scope for R-4. The separate charge
   * contributes to TOTAL CLIENT REVENUE (T-5), never to the contract value (CONST-BOQ-030).
   */
  async generateFromSeparateCharge(
    identity: RequestIdentity,
    dto: GenerateInvoiceFromSeparateChargeDto,
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByBoqNode(prisma, orgId, dto.boqNodeId);
    if (existing) return existing;

    const node = await this.repo.findSeparateChargeForBilling(prisma, orgId, dto.boqNodeId);
    if (!node) {
      throw new NotFoundException(
        `Separate-charge BOQ line ${dto.boqNodeId} not found (or not a billable SEPARATE_CHARGE leaf).`,
      );
    }

    const contract = node.version.boq.project.contracts[0];
    if (!contract) {
      throw new BadRequestException(
        'This project has no active client contract to bill the separate charge against.',
      );
    }
    // A separate charge is a priced leaf; an unpriced one has nothing to bill.
    if (node.totalAmount === null) {
      throw new BadRequestException(
        `Separate-charge line ${node.code} has no amount to bill.`,
      );
    }

    const subtotal = new Decimal(node.totalAmount.toString()).toDecimalPlaces(2);
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);
    const org = await this.snapshotOrgBranding(prisma, orgId);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        clientId: contract.clientId,
        sourceBoqNodeId: dto.boqNodeId,
        projectId: contract.projectId,
        contractId: contract.id,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: new Date(dto.dueDate),
        // The BOQ is single-currency (CONST-BOQ-013); a separate charge bills in that currency, which
        // matches the contract currency for the project. Prefer the contract currency for the AR
        // document, consistent with the installment path.
        currencyCode: contract.currency,
        subtotal,
        vatAmount,
        totalAmount,
        paymentTerms: dto.paymentTerms,
        billingAddressSnapshot: {
          client: {
            name: contract.client.name,
            address: contract.client.address,
            taxNumber: contract.client.taxNumber,
          },
          description: `${node.code} — ${node.description}`,
          org,
        },
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent generation lost the race on unique(source_boq_node_id): return the winner's invoice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findByBoqNode(prisma, orgId, dto.boqNodeId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * ADR-030 CONST-COM-028 (Commercial redesign P1) — compose a variation's OWN standalone DRAFT
   * ClientInvoice from primitives.
   *
   * A variation is an independently-billable unit (design §7): an approved addition is billed on its
   * own receivable, grouped into the milestone's Billing Package but individually payable. This method
   * builds that document from primitives the commercial orchestrator already holds — it does NOT read
   * the VO or the contract itself (Accounting never imports Variations; the orchestration/authorization
   * lives in Commercial). It is INTERNAL-only: NOT idempotent (a VO invoice carries no source column, so
   * there is nothing to key on) and NOT controller-exposed — the orchestrator owns the exactly-once
   * guard via the allocation ledger before it calls this. Same lifecycle as every other AR document:
   * DRAFT / NOT_POSTED, VAT at the same 5% engine, no GL posting here.
   */
  async generateStandaloneCharge(
    identity: RequestIdentity,
    dto: GenerateStandaloneChargeDto,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const subtotal = new Decimal(dto.subtotal).toDecimalPlaces(2);
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);
    // Client is looked up by id only, deliberately — this method must not read the VO or the
    // contract (Accounting never imports Variations); Client is Accounting's own domain.
    const [org, client] = await Promise.all([
      this.snapshotOrgBranding(prisma, orgId),
      prisma.client.findUnique({
        where: { id: dto.clientId },
        select: { name: true, address: true, taxNumber: true },
      }),
    ]);

    return this.repo.create(prisma, {
      organizationId: orgId,
      clientId: dto.clientId,
      // A VO invoice is neither an installment nor an IPC nor a separate-charge BOQ leaf — every source
      // tag is null. Its provenance is the VariationBillingAllocation row that links it to the VO.
      sourceIpcId: null,
      sourceInstallmentId: null,
      sourceBoqNodeId: null,
      projectId: dto.projectId,
      contractId: dto.contractId,
      invoiceDate: new Date(dto.invoiceDate),
      dueDate: new Date(dto.dueDate),
      currencyCode: dto.currencyCode,
      subtotal,
      vatAmount,
      totalAmount,
      paymentTerms: dto.paymentTerms,
      billingAddressSnapshot: {
        client: client
          ? { name: client.name, address: client.address, taxNumber: client.taxNumber }
          : null,
        description: dto.label,
        org,
      },
      createdBy: userId,
    });
  }

  async approve(identity: RequestIdentity, invoiceId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${invoiceId} not found`);
    if (invoice.documentStatus !== 'DRAFT') {
      throw new BadRequestException(`Invoice is already ${invoice.documentStatus}`);
    }

    return this.repo.approve(prisma, invoiceId, userId);
  }

  /**
   * Post the ClientInvoice to the GL.
   * EVT-AR-001: Dr AR / Cr Revenue / Cr VAT Output
   */
  async post(identity: RequestIdentity, dto: PostInvoiceDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, dto.invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);
    if (invoice.documentStatus !== 'APPROVED') {
      throw new BadRequestException(`Invoice must be APPROVED before posting`);
    }
    if (invoice.postingStatus === 'POSTED') {
      throw new ConflictException(`Invoice ${dto.invoiceId} is already posted`);
    }

    // ADR-024 ACC-POST-001: control accounts are resolved server-side by role. A code in the
    // DTO still works as an explicit override (backward-compatible) but is no longer required.
    const arAccount = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.arAccountCode, 'ACCOUNTS_RECEIVABLE',
    );
    const revAccount = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.revenueAccountCode, 'PROJECT_REVENUE',
    );

    let vatAccount: ResolvedAccount | null = null;
    if (new Decimal(invoice.vatAmount.toString()).gt(0)) {
      vatAccount = await this.resolver.resolveByCodeOrRole(
        prisma, orgId, dto.vatAccountCode, 'VAT_OUTPUT_PAYABLE',
      );
    }

    await this.sequenceRepo.ensureSequence(
      prisma as never, orgId, 'CLIENT_INVOICE', 'INV-',
    );

    try {
      const result = await prisma.$transaction(async (tx) => {
        const subtotal = new Decimal(invoice.subtotal.toString());
        const vatAmount = new Decimal(invoice.vatAmount.toString());
        const totalAmount = new Decimal(invoice.totalAmount.toString());

        const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
          {
            accountId: arAccount.id,
            debitAmount: totalAmount,
            creditAmount: new Decimal(0),
            sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const,
            clientId: invoice.clientId,
            contractId: invoice.contractId ?? undefined,
          },
          {
            accountId: revAccount.id,
            debitAmount: new Decimal(0),
            creditAmount: subtotal,
            projectId: invoice.projectId ?? undefined,
            contractId: invoice.contractId ?? undefined,
          },
        ];

        if (vatAccount && vatAmount.gt(0)) {
          lines.push({
            accountId: (vatAccount as AccountWithCurrentVersion).id,
            debitAmount: new Decimal(0),
            creditAmount: vatAmount,
          });
        }

        const postResult = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: invoice.invoiceDate,
            documentDate: invoice.invoiceDate,
            description: `Client Invoice — ${invoice.id}`,
            currencyCode: invoice.currencyCode,
            eventType: 'EVT-AR-001',
            sourceDocumentType: 'CLIENT_INVOICE',
            sourceDocumentId: invoice.id,
            journalCategory: 'ACCOUNTS_RECEIVABLE',
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_AR',
            createdBy: userId,
            lines,
          },
          tx as never,
        );

        // Claim invoice number
        const invNum = await this.sequenceRepo.claimNext(
          tx as never, orgId, 'CLIENT_INVOICE',
        );

        await this.repo.markPosted(prisma, invoice.id, postResult.journalEntryId, invNum.formattedNumber, userId);

        return { ...postResult, invoiceNumber: invNum.formattedNumber };
      });

      return result;
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message.slice(0, 50) : 'POSTING_FAILED';
      await this.repo.markPostingFailed(prisma, invoice.id, code);
      throw err;
    }
  }

  /**
   * Reverse a posted ClientInvoice.
   * EVT-AR-002: Dr Revenue + Dr VAT (if any) / Cr AR — the mirror of EVT-AR-001.
   * Guard: invoice must have zero active (POSTED) receipt allocations.
   */
  async reverse(
    identity: RequestIdentity,
    invoiceId: string,
    opts: { reversalDate: string; reason: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${invoiceId} not found`);
    if (invoice.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Only POSTED invoices can be reversed (status: ${invoice.postingStatus})`);
    }
    if (invoice.reversalJournalEntryId) {
      throw new ConflictException(`Invoice ${invoiceId} is already reversed`);
    }

    // Guard: no active receipt allocations
    const activeAllocs = await prisma.clientReceiptAllocation.count({
      where: { clientInvoiceId: invoiceId, postingStatus: 'POSTED' },
    });
    if (activeAllocs > 0) {
      throw new BadRequestException(
        `Cannot reverse invoice ${invoiceId} — it has ${activeAllocs} active receipt allocation(s). ` +
        `Reverse the receipt allocations first.`,
      );
    }

    if (!invoice.postedJournalEntryId) {
      throw new BadRequestException(`Invoice ${invoiceId} has no posted journal to reverse`);
    }

    // Load original journal lines
    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: invoice.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);

    return prisma.$transaction(async (tx) => {
      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of Invoice ${invoice.invoiceNumber ?? invoiceId}: ${opts.reason}`,
          currencyCode: invoice.currencyCode,
          eventType: 'EVT-AR-002',
          sourceDocumentType: 'CLIENT_INVOICE',
          sourceDocumentId: `reversal-${invoiceId}`,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          reversalOfJournalEntryId: invoice.postedJournalEntryId ?? undefined,
          createdBy: userId,
          lines: originalJournal.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
            contractId: l.contractId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      await tx.clientInvoice.update({
        where: { id: invoiceId },
        data: {
          postingStatus: 'REVERSED',
          reversalJournalEntryId: reversalResult.journalEntryId,
          reversedBy: userId,
          reversedAt: new Date(),
        },
      });

      return reversalResult;
    });
  }

  async findAll(identity: RequestIdentity, clientId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, clientId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const invoice = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${id} not found`);
    return invoice;
  }

  /**
   * The branded invoice PDF's signed download URL — generating it on first request, from
   * whatever the invoice already holds, rather than at each of the four creation call sites. One
   * lazy path covers IPC, installment, separate-charge and VO-standalone invoices alike, with
   * nothing to keep in sync across them (Commercial round-3).
   *
   * Once `documentFileId` is set it is never regenerated: the PDF a later view produces is still
   * the invoice as it stood at creation, because `billingAddressSnapshot` already froze the
   * client and org-branding facts then, not now.
   */
  async getOrGenerateDocument(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const invoice = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${id} not found`);

    if (invoice.documentFileId) {
      return this.files.getDownloadUrl(identity, invoice.documentFileId);
    }

    const snapshot = (invoice.billingAddressSnapshot ?? {}) as {
      client?: { name: string; address: string | null; taxNumber: string | null } | null;
      description?: string;
      org?: OrgBrandingSnapshot | null;
      // Pre-round-3 shapes (see the other billingAddressSnapshot writers) — read only as a
      // best-effort fallback for invoices generated before this feature existed.
      clientName?: string;
      installment?: string;
      separateCharge?: string;
    };

    // Old invoices never captured a client/org snapshot — fall back to a live lookup rather than
    // rendering a document with no identity at all. Not "frozen" for these, but there is nothing
    // to freeze: the feature that freezes them did not exist when they were created.
    const [fallbackClient, fallbackOrg] = await Promise.all([
      snapshot.client !== undefined
        ? null
        : prisma.client.findUnique({
            where: { id: invoice.clientId },
            select: { name: true, address: true, taxNumber: true },
          }),
      snapshot.org !== undefined ? null : this.snapshotOrgBranding(prisma, invoice.organizationId),
    ]);
    const client = snapshot.client ?? fallbackClient;
    const org = snapshot.org ?? fallbackOrg;
    const description =
      snapshot.description ??
      snapshot.installment ??
      snapshot.separateCharge ??
      `Invoice ${invoice.invoiceNumber ?? id}`;

    const logo = org ? await this.files.readBytesForRendering(org.logoFileId) : null;

    const pdf = await this.documentService.render({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      currencyCode: invoice.currencyCode,
      subtotal: invoice.subtotal.toString(),
      vatAmount: invoice.vatAmount.toString(),
      totalAmount: invoice.totalAmount.toString(),
      paymentTerms: invoice.paymentTerms,
      clientName: client?.name ?? snapshot.clientName ?? 'Client',
      clientAddress: client?.address ?? null,
      clientTaxNumber: client?.taxNumber ?? null,
      lineDescription: description,
      org: {
        name: org?.name ?? 'Invoice',
        legalAddress: org?.legalAddress ?? null,
        taxRegistrationNumber: org?.taxRegistrationNumber ?? null,
        brandColorHex: org?.brandColorHex ?? null,
        invoiceFooterNote: org?.invoiceFooterNote ?? null,
        template: org?.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
        logo,
      },
    });

    const file = await this.files.storeGenerated(identity, {
      originalName: `invoice-${invoice.invoiceNumber ?? id}.pdf`,
      mimeType: 'application/pdf',
      body: pdf,
    });

    // Compare-and-set BEFORE freezing the file. If a concurrent first-request already bound its own
    // document, this call loses: discard the freshly-generated (still TEMPORARY, unreferenced) file
    // rather than leaving it as a permanent orphan, and return the winner's document. Freezing only
    // on the win keeps the loser's file discardable.
    const won = await this.repo.bindDocumentFileIdIfUnset(prisma, id, file.id);
    if (!won) {
      await this.files.discardIfUnreferenced(file.id);
      const settled = await this.repo.findById(prisma, identity.activeOrganizationId, id);
      return this.files.getDownloadUrl(identity, settled!.documentFileId!);
    }

    await this.files.bind(file.id, `invoice document for ${id}`);
    await this.files.markImmutable(file.id, `invoice document for ${id}`);

    return this.files.getDownloadUrl(identity, file.id);
  }
}
