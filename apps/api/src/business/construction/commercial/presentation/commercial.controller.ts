import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { CommercialService } from '../application/commercial.service.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';
import { CommercialWorkspaceService } from '../application/commercial-workspace.service.js';
import { PreparePackageDto } from './dto/prepare-package.dto.js';
import { CollectionEventsService } from '../../../accounting/accounts-receivable/application/collection-events.service.js';
import { CreditNoteService } from '../../../accounting/accounts-receivable/application/credit-note.service.js';
import { IssuePackageDto } from './dto/issue-package.dto.js';
import { MarkReadyToBillDto } from './dto/mark-ready-to-bill.dto.js';
import { RevokeReadyToBillDto } from './dto/revoke-ready-to-bill.dto.js';
import { RecordDeliveryDto } from './dto/record-delivery.dto.js';
import { PatchDraftInvoiceDto } from './dto/patch-draft-invoice.dto.js';
import { RecordProjectPaymentDto } from './dto/record-project-payment.dto.js';
import { RecordFollowUpDto } from './dto/record-followup.dto.js';
import { RecordPromiseDto } from './dto/record-promise.dto.js';
import { OpenDisputeDto } from './dto/open-dispute.dto.js';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto.js';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto.js';
import { PostCreditNoteDto } from './dto/post-credit-note.dto.js';

@ApiTags('Commercial')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.contractsView)
@ProjectScoped('projectId')
@Controller('projects/:projectId/commercial')
export class CommercialController {
  constructor(
    private readonly commercialService: CommercialService,
    private readonly commercialBillingService: CommercialBillingService,
    private readonly collectionEventsService: CollectionEventsService,
    private readonly creditNoteService: CreditNoteService,
    private readonly workspaceService: CommercialWorkspaceService,
  ) {}

  // ─── Commercial tab redesign (2026-09-28) — read models ──────────────────────────

  @Get('workspace')
  @ApiOperation({ summary: 'Commercial workspace: bar facts, ranked To do, capabilities (redesign D5)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getWorkspace(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.workspaceService.getWorkspace(identity, projectId);
  }

  @Get('statement')
  @ApiOperation({ summary: "Client statement for the project's contract, oldest first (redesign D6)" })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getStatement(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.workspaceService.getStatement(identity, projectId);
  }

  @Get('installments/:installmentId/billing-eligibility')
  @ApiOperation({
    summary:
      'Why the stage can or cannot be prepared / issued: steps with owners (ADR-043). Same rules as the prepare and issue commands.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  getBillingEligibility(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('installmentId') installmentId: string,
  ) {
    return this.commercialBillingService.getStageBillingEligibility(identity, projectId, installmentId);
  }

  @Get('installments/:installmentId/prepare-preview')
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Prepare-invoice dialog preview: stage amount, variations, server tax rate' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  @ApiResponse({ status: 400, description: 'STAGE_ALREADY_INVOICED' })
  getPreparePreview(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('installmentId') installmentId: string,
  ) {
    return this.workspaceService.getPreparePreview(identity, projectId, installmentId);
  }

  @Get('invoices/:invoiceId')
  @ApiOperation({ summary: 'The invoice as a document (issuer, bill-to, lines, lifecycle, capabilities)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  getInvoiceDocument(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.workspaceService.getInvoiceDocument(identity, projectId, invoiceId);
  }

  // ─── Commercial tab redesign D1 — prepare / issue / delete ──────────────────────

  @Post('installments/:installmentId/prepare-package')
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Prepare a stage invoice package as DRAFTS (stage + selected variation lines); nothing is posted',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  @ApiResponse({
    status: 400,
    description:
      'CONTRACT_NOT_ACTIVE | MILESTONE_NOT_LINKED | MILESTONE_NOT_VERIFIED | STAGE_ALREADY_INVOICED | VARIATION_NOT_BILLABLE | INVALID_DUE_DATE',
  })
  preparePackage(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('installmentId') installmentId: string,
    @Body() dto: PreparePackageDto,
  ) {
    return this.commercialBillingService.preparePackage(identity, projectId, installmentId, dto);
  }

  @Post('invoices/:invoiceId/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Issue a draft: approve + number + post it and every draft of its stage package in one transaction',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiResponse({ status: 400, description: 'INVOICE_CANCELLED, or the posting gate refused' })
  issueInvoice(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commercialBillingService.issueInvoice(identity, projectId, invoiceId);
  }

  @Delete('invoices/:invoiceId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Delete a draft: cancel it and its package drafts, releasing variation allocations',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiResponse({ status: 400, description: 'INVOICE_ALREADY_ISSUED | INVOICE_CANCELLED' })
  deleteDraftInvoice(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commercialBillingService.deleteDraftInvoice(identity, projectId, invoiceId);
  }

  // Slice 7 — must be declared before ':projectId/commercial/:anything' catch-all routes
  @Get('overview')
  @ApiOperation({
    summary: 'Authoritative Commercial Overview read model for a project (Slice 7)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getOverview(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getOverview(identity, projectId);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Permission-aware commercial summary for a project (ADR-017 §B2)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getSummary(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getSummary(identity, projectId);
  }

  @Get('applications')
  @ApiOperation({
    summary: 'Consolidated IPA → IPC → invoice → settlement chain for a project (ADR-017 §B3)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getApplications(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getApplications(identity, projectId);
  }

  @Get('billing')
  @ApiOperation({
    summary:
      "The project's billing position, invoices, receipts and ageing — invoice-total basis",
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getBilling(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getBilling(identity, projectId);
  }

  @Get('current-cycle')
  @ApiOperation({ summary: 'Authoritative current commercial cycle and next action' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getCurrentCycle(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getCurrentCycle(identity, projectId);
  }

  // ─── ADR-030 CONST-COM-028 (Commercial redesign P1): variation billing ────────────

  @Get('billing-packages')
  @ApiOperation({
    summary: 'ADR-030 S-VB-7: Billing Packages for a contract (milestone invoice + VO lines grouped)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({ name: 'contractId', description: 'Contract ID' })
  getBillingPackages(
    @CurrentUser() identity: RequestIdentity,
    @Query('contractId') contractId: string,
  ) {
    return this.commercialBillingService.getBillingPackages(identity, contractId);
  }

  // ─── Slice 3B — Commercial readiness commands ────────────────────────────────────

  @Post('installments/:installmentId/ready-to-bill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 3B: mark a payment installment as commercially ready to bill' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  markReadyToBill(
    @CurrentUser() identity: RequestIdentity,
    @Param('installmentId') installmentId: string,
    @Body() dto: MarkReadyToBillDto,
  ) {
    return this.commercialBillingService.markReadyToBill(identity, installmentId, dto.note);
  }

  @Delete('installments/:installmentId/ready-to-bill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 3B: revoke ready-to-bill status before an invoice is created' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  revokeReadyToBill(
    @CurrentUser() identity: RequestIdentity,
    @Param('installmentId') installmentId: string,
    @Body() dto: RevokeReadyToBillDto,
  ) {
    return this.commercialBillingService.revokeReadyToBill(identity, installmentId, dto.reason);
  }

  // ─── Slice 4B — Issue billing package ────────────────────────────────────────────

  @Post('installments/:installmentId/issue-package')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary:
      'DEPRECATED (redesign D1): use prepare-package + invoices/:invoiceId/issue. Issues the stage package atomically.',
    deprecated: true,
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  @ApiResponse({ status: 400, description: 'Installment not ready to bill' })
  @ApiResponse({ status: 404, description: 'Installment not found' })
  issuePackage(
    @CurrentUser() identity: RequestIdentity,
    @Param('installmentId') installmentId: string,
    @Body() dto: IssuePackageDto,
  ) {
    return this.commercialBillingService.issuePackage(identity, installmentId, {
      invoiceDate: dto.invoiceDate,
      dueDate: dto.dueDate,
      paymentTerms: dto.paymentTerms,
      notes: dto.notes,
      selectedVariationIds: dto.selectedVariationIds,
    });
  }

  // ─── Slice 4B — Package delivery ─────────────────────────────────────────────────

  @Post('installments/:installmentId/package-deliveries')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Slice 4B: record a send-to-client delivery event for every invoice in the billing package',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'installmentId', description: 'Payment installment ID' })
  @ApiResponse({ status: 400, description: 'No invoices in this package yet' })
  recordPackageDelivery(
    @CurrentUser() identity: RequestIdentity,
    @Param('installmentId') installmentId: string,
    @Body() dto: RecordDeliveryDto,
  ) {
    return this.commercialBillingService.sendPackage(identity, installmentId, {
      method: dto.method,
      sentAt: dto.sentAt,
      recipient: dto.recipient,
      note: dto.note,
    });
  }

  // ─── Slice 4B — Patch DRAFT invoice metadata ─────────────────────────────────────

  // ─── Slice 5B — Record project-level payment + deposit account selector ─────────

  @Post('billing/payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Slice 5B: record a customer payment against project invoices (create receipt + post GL + allocate atomically)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 400, description: 'Validation failure (currency mismatch, allocation > outstanding, etc.)' })
  @ApiResponse({ status: 404, description: 'Bank account or invoice not found' })
  recordProjectPayment(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: RecordProjectPaymentDto,
  ) {
    return this.commercialBillingService.recordProjectPayment(identity, projectId, {
      bankAccountId: dto.bankAccountId,
      receiptDate: dto.receiptDate,
      amount: dto.amount,
      currency: dto.currency,
      paymentMethod: dto.paymentMethod,
      reference: dto.reference,
      notes: dto.notes,
      allocations: dto.allocations,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get('deposit-accounts')
  @ApiOperation({
    summary: 'Slice 5B: list ACTIVE deposit accounts available to receive client payments',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getDepositAccounts(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.commercialBillingService.getDepositAccounts(identity, projectId);
  }

  @Patch('invoices/:invoiceId')
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary: 'Slice 4B: update dueDate / paymentTerms / notes on a NOT_POSTED (DRAFT) invoice',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiResponse({ status: 400, description: 'Invoice is not in DRAFT state' })
  patchDraftInvoice(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: PatchDraftInvoiceDto,
  ) {
    return this.commercialBillingService.patchDraftInvoice(identity, projectId, invoiceId, dto);
  }

  // ─── Slice 6B — Collection Events ────────────────────────────────────────────

  @Post('invoices/:invoiceId/follow-ups')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: record a follow-up event against an invoice' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  recordFollowUp(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: RecordFollowUpDto,
  ) {
    return this.collectionEventsService.recordFollowUp(identity, {
      invoiceId,
      method: dto.method,
      contactPerson: dto.contactPerson,
      note: dto.note,
      occurredAt: dto.occurredAt,
    });
  }

  @Post('invoices/:invoiceId/promises')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: record a payment promise against an invoice' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  recordPromise(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: RecordPromiseDto,
  ) {
    return this.collectionEventsService.recordPromise(identity, {
      invoiceId,
      promisedDate: dto.promisedDate,
      promisedAmount: dto.promisedAmount,
      note: dto.note,
    });
  }

  @Post('invoices/:invoiceId/disputes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: open a dispute on an invoice' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiResponse({ status: 409, description: 'Invoice already has an open dispute' })
  openDispute(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.collectionEventsService.openDispute(identity, {
      invoiceId,
      disputedAmount: dto.disputedAmount,
      reason: dto.reason,
      note: dto.note,
    });
  }

  @Patch('invoices/:invoiceId/disputes/:disputeId/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: resolve an open dispute' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  @ApiResponse({ status: 409, description: 'Dispute is already resolved' })
  resolveDispute(
    @CurrentUser() identity: RequestIdentity,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.collectionEventsService.resolveDispute(identity, {
      disputeId,
      resolutionNote: dto.resolutionNote,
    });
  }

  // ─── Slice 6B — Credit Notes ──────────────────────────────────────────────────

  @Post('invoices/:invoiceId/credit-notes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: create a credit note against a POSTED invoice' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiResponse({ status: 400, description: 'Invoice not POSTED or credit exceeds outstanding' })
  createCreditNote(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.creditNoteService.createCreditNote(identity, {
      invoiceId,
      reason: dto.reason,
      netAmount: dto.netAmount,
      accountingDate: dto.accountingDate,
      note: dto.note,
      sourceVariationId: dto.sourceVariationId,
    });
  }

  @Post('invoices/:invoiceId/credit-notes/:creditNoteId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.receivablesManage)
  @ApiOperation({ summary: 'Slice 6B: post a credit note — creates EVT-AR-007 journal and reduces AR' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invoiceId', description: 'Client invoice ID' })
  @ApiParam({ name: 'creditNoteId', description: 'Credit note ID' })
  @ApiResponse({ status: 409, description: 'Credit note already posted' })
  postCreditNote(
    @CurrentUser() identity: RequestIdentity,
    @Param('creditNoteId') creditNoteId: string,
    @Body() dto: PostCreditNoteDto,
  ) {
    return this.creditNoteService.postCreditNote(identity, {
      creditNoteId,
      arAccountCode: dto.arAccountCode,
      revenueAccountCode: dto.revenueAccountCode,
      vatAccountCode: dto.vatAccountCode,
    });
  }

  // ─── B11 — Separate charges list (ADR-029 R-4) ───────────────────────────────

  @Get('separate-charges')
  @ApiOperation({
    summary: 'ADR-029 R-4: list SEPARATE_CHARGE BOQ leaves and their one-off invoices',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getSeparateCharges(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.commercialService.getSeparateCharges(identity, projectId);
  }
}
