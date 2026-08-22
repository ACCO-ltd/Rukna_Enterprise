import {
  Prisma,
  PrismaClient,
  WorkflowPolicyRuleStatus,
  WorkflowTransactionType,
  WorkflowTriggerKind,
} from '@prisma/client';

import {
  accoPurchaseOrderBands,
  accoSupplierPaymentBands,
  type ValueBand,
} from './acco-value-bands.js';

/**
 * Seeds all ACCO workflow chains + project lifecycle trigger bindings for a given organization.
 * All chains seeded with is_active=false and requires_ceo_confirmation=true.
 * Amount thresholds are PLACEHOLDER values — must be confirmed by Eng Ahmed Shirie before activation.
 */
export async function seedAccoWorkflows(prisma: PrismaClient, organizationId: string): Promise<void> {
  await seedAccoGovernancePolicy(prisma, organizationId);
  await seedWorkflowRequirementPolicies(prisma);
  await seedDocumentWorkflows(prisma, organizationId);
  await seedProjectLifecycleBindings(prisma, organizationId);
  await seedProcurementValueBands(prisma, organizationId);
}

/**
 * Authoritative ACCO governance configuration.
 *
 * ADR-022 (ACCO Authority Matrix) was domain-approved by Eng Ahmed Shirie on 2026-08-17 — that
 * sign-off IS the formal policy effective date the version was waiting for. The version is now
 * ACTIVE as of that date so the mandatory Segregation-of-Duties rules (CONST-DOA-003) take effect.
 * The value-threshold WorkflowPolicyRules stay `PENDING` until ACCO confirms the numbers (item D),
 * so activating the version does not switch on threshold routing — only the SoD rules wired below.
 */
const ACCO_GOVERNANCE_EFFECTIVE_FROM = new Date('2026-08-17T00:00:00.000Z');

// ADR-022 Phase 1: the SoD rules wired into services and therefore activated. The remaining two
// (VENDOR_MAINTAINER_*, SYSTEM_ADMIN_*) stay inactive until their enforcement is built (Phase 1b).
const ACTIVE_SOD_CODES = new Set<string>([
  'REQUESTER_CANNOT_APPROVE_OWN_REQUEST',
  'PO_CREATOR_CANNOT_RECEIVE_GOODS',
  'GOODS_RECEIVER_CANNOT_APPROVE_BILL',
  'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT',
  'JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL',
]);

async function seedAccoGovernancePolicy(prisma: PrismaClient, organizationId: string): Promise<void> {
  const policyKey = 'ACCO_GOVERNANCE';
  const versionData = {
    status: 'ACTIVE' as const,
    effectiveFrom: ACCO_GOVERNANCE_EFFECTIVE_FROM,
    amountBasis: 'UNSPECIFIED' as const,
    notes:
      'CEO-approved ACCO governance (ADR-022, effective 2026-08-17). Segregation-of-Duties rules ' +
      'are active. Value-threshold rules remain PENDING until ACCO confirms the numbers.',
  };
  const policy = await prisma.workflowPolicyVersion.upsert({
    where: { organizationId_policyKey_version: { organizationId, policyKey, version: 1 } },
    create: { organizationId, policyKey, version: 1, ...versionData },
    update: versionData,
  });

  const rules: Array<{
    ruleKey: string;
    transactionType?: WorkflowTransactionType;
    entityType?: string;
    status: WorkflowPolicyRuleStatus;
    priority: number;
    configuration: Prisma.InputJsonValue;
  }> = [
    {
      ruleKey: 'MR_APPROVAL_REQUIRED',
      transactionType: WorkflowTransactionType.MATERIAL_REQUEST,
      status: 'ACTIVE',
      priority: 100,
      configuration: {
        approvalRequired: true,
        amountCurrency: 'USD',
        amountSource: 'REPORTING_AMOUNT_SNAPSHOT_AT_SUBMISSION',
        baseApproverChain: 'PENDING_ACCO_CONFIRMATION',
      },
    },
    {
      ruleKey: 'MR_CFO_OVER_1000_USD',
      transactionType: WorkflowTransactionType.MATERIAL_REQUEST,
      status: 'ACTIVE',
      priority: 90,
      configuration: { operator: 'GT', amount: '1000.00', currency: 'USD', additionalApproverRole: 'CFO' },
    },
    {
      ruleKey: 'MR_GROUP_CEO_OVER_10000_USD',
      transactionType: WorkflowTransactionType.MATERIAL_REQUEST,
      status: 'ACTIVE',
      priority: 80,
      configuration: { operator: 'GT', amount: '10000.00', currency: 'USD', additionalApproverRole: 'GROUP_CEO' },
    },
    {
      ruleKey: 'PO_POLICY_PENDING_MAPPING_AND_VAT_BASIS',
      transactionType: WorkflowTransactionType.PURCHASE_ORDER,
      status: 'PENDING',
      priority: 100,
      configuration: {
        amountSource: 'REPORTING_AMOUNT_SNAPSHOT_AT_SUBMISSION',
        pending: ['10,000–50,000 USD authority mapping', 'above 50,000 USD authority mapping', 'NET_OR_GROSS_VAT_BASIS'],
      },
    },
    {
      ruleKey: 'SUPPLIER_PAYMENT_POLICY_PENDING_DETAIL',
      transactionType: WorkflowTransactionType.SUPPLIER_PAYMENT,
      status: 'PENDING',
      priority: 100,
      configuration: { pending: ['APPROVER_CHAIN', 'THRESHOLDS', 'CONTROLS'] },
    },
    {
      ruleKey: 'PROJECT_LIFECYCLE_BINDINGS_PENDING_DETAIL',
      entityType: 'Project',
      status: 'PENDING',
      priority: 100,
      configuration: { lifecycle: 'LOCKED', approverMappings: 'PENDING_ACCO_CONFIRMATION' },
    },
    {
      ruleKey: 'IPA_WORKFLOW_PENDING_DETAIL',
      entityType: 'InterimPaymentApplication',
      status: 'PENDING',
      priority: 100,
      configuration: { workflow: 'SEPARATE_IPA', approverChain: 'PENDING_ACCO_CONFIRMATION' },
    },
    {
      ruleKey: 'IPC_WORKFLOW_PENDING_DETAIL',
      transactionType: WorkflowTransactionType.IPC,
      entityType: 'InterimPaymentCertificate',
      status: 'PENDING',
      priority: 100,
      configuration: { workflow: 'SEPARATE_IPC', approverChain: 'PENDING_ACCO_CONFIRMATION' },
    },
    {
      ruleKey: 'DELEGATION_ESCALATION_EMERGENCY_EXCEPTION_BOARD_PENDING_DETAIL',
      status: 'PENDING',
      priority: 100,
      configuration: {
        emergencyRoute: 'EXPLICIT_AUDITED_ROUTE_NEVER_BYPASS',
        pending: ['DELEGATION_RULES', 'ESCALATION_RULES', 'EXCEPTION_AND_BOARD_REFERRAL_REQUIREMENTS'],
      },
    },
  ];

  for (const rule of rules) {
    await prisma.workflowPolicyRule.upsert({
      where: { workflowPolicyVersionId_ruleKey: { workflowPolicyVersionId: policy.id, ruleKey: rule.ruleKey } },
      create: { workflowPolicyVersionId: policy.id, ...rule },
      update: { status: rule.status, priority: rule.priority, configuration: rule.configuration },
    });
  }

  const sodRules = [
    ['REQUESTER_CANNOT_APPROVE_OWN_REQUEST', 'A requester cannot approve their own request.'],
    ['PO_CREATOR_CANNOT_RECEIVE_GOODS', 'A purchase-order creator cannot receive goods against that order.'],
    ['GOODS_RECEIVER_CANNOT_APPROVE_BILL', 'A goods receiver cannot approve the related supplier bill.'],
    ['BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT', 'A bill approver cannot approve or release the related payment.'],
    ['VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT', 'A vendor maintainer cannot create a purchase order or process a supplier payment.'],
    ['JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL', 'A journal preparer cannot approve the same journal.'],
    ['SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION', 'A system administrator cannot approve a business transaction.'],
  ] as const;

  for (const [code, description] of sodRules) {
    const isActive = ACTIVE_SOD_CODES.has(code);
    await prisma.segregationOfDutiesRule.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: { organizationId, workflowPolicyVersionId: policy.id, code, description, isActive },
      update: { description, workflowPolicyVersionId: policy.id, isActive },
    });
  }

  // Legacy placeholder chains may contain roles never confirmed by ACCO. They
  // are retained for traceability but cannot become active through this seed.
  await prisma.workflowDefinition.updateMany({
    where: { organizationId, requiresCeoConfirmation: true },
    data: { isActive: false },
  });
}

/**
 * Seeds tenant-wide WorkflowRequirementPolicy records (organizationId = null).
 * These are platform defaults — REQUIRED means no active binding = transition blocked.
 * Idempotent: skips existing records for the same entityType + transition.
 */
async function seedWorkflowRequirementPolicies(prisma: PrismaClient): Promise<void> {
  const required: Array<{ entityType: string; fromState: string | null; toState: string }> = [
    // Project lifecycle — controlled transitions
    { entityType: 'Project', fromState: 'DRAFT',                toState: 'APPROVED' },
    { entityType: 'Project', fromState: null,                   toState: 'CANCELLED' },
    { entityType: 'Project', fromState: 'CLOSEOUT',             toState: 'CLOSED' },
    { entityType: 'Project', fromState: 'PRACTICAL_COMPLETION', toState: 'ACTIVE' },    // reopen
    { entityType: 'Project', fromState: 'CLOSEOUT',             toState: 'PRACTICAL_COMPLETION' }, // reopen
    // IPA — all paths into PENDING_INTERNAL_APPROVAL
    { entityType: 'InterimPaymentApplication', fromState: 'DRAFT',                toState: 'PENDING_INTERNAL_APPROVAL' },
    { entityType: 'InterimPaymentApplication', fromState: 'RETURNED_FOR_REVISION', toState: 'PENDING_INTERNAL_APPROVAL' },
  ];

  for (const policy of required) {
    const existing = await prisma.workflowRequirementPolicy.findFirst({
      where: {
        organizationId: null,
        entityType: policy.entityType,
        fromState: policy.fromState,
        toState: policy.toState,
      },
    });
    if (existing) continue;

    await prisma.workflowRequirementPolicy.create({
      data: {
        organizationId: null,
        entityType: policy.entityType,
        fromState: policy.fromState,
        toState: policy.toState,
        requirement: 'REQUIRED',
      },
    });
    console.log(`  ✓ Seeded policy REQUIRED: ${policy.entityType} ${policy.fromState ?? '*'} → ${policy.toState}`);
  }
}

async function seedDocumentWorkflows(prisma: PrismaClient, organizationId: string): Promise<void> {
  const chains = buildAccoChains(organizationId);

  for (const chain of chains) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { organizationId, transactionType: chain.transactionType as WorkflowTransactionType },
    });
    if (existing) continue;

    const definition = await prisma.workflowDefinition.create({
      data: {
        organizationId,
        transactionType: chain.transactionType,
        name: chain.name,
        isActive: false,
        requiresCeoConfirmation: true,
        conditions: chain.conditions ? { create: chain.conditions } : undefined,
        steps: { create: chain.steps },
      },
    });

    console.log(`  ✓ Seeded workflow: ${definition.name} (${definition.id})`);
  }
}

/**
 * Seeds a generic "Project Lifecycle Approval" definition and trigger bindings for each
 * project state transition. All seeded with is_active=false — ACCO must activate and
 * configure before going live. Steps are PLACEHOLDER — to be confirmed by Eng Ahmed Shirie.
 */
async function seedProjectLifecycleBindings(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { organizationId, transactionType: null, name: 'Project Lifecycle Approval' },
  });

  let defId: string;
  if (existing) {
    defId = existing.id;
  } else {
    const def = await prisma.workflowDefinition.create({
      data: {
        organizationId,
        transactionType: null,
        name: 'Project Lifecycle Approval',
        isActive: false,
        requiresCeoConfirmation: true,
        steps: {
          create: [
            { stepOrder: 1, roleRequired: 'COMMERCIAL_MANAGER', isOptional: false, notifyRoles: ['PROJECT_MANAGER'] },
            { stepOrder: 2, roleRequired: 'CEO', isOptional: false, notifyRoles: [] },
          ],
        },
      },
    });
    defId = def.id;
    console.log(`  ✓ Seeded workflow: Project Lifecycle Approval (${defId})`);
  }

  // Project lifecycle transitions — all is_active=false (PLACEHOLDER).
  // Activate via admin configuration once DOA thresholds confirmed by Eng Ahmed Shirie.
  const transitions = [
    // ADR-019 CONST-PLC-001: DRAFT → ACTIVE ("Start Project") is the single governed entry
    // into execution — it carries the approval that APPROVED/MOBILIZING used to model.
    { fromState: 'DRAFT',                toState: 'ACTIVE',                priority: 10 },
    { fromState: 'ACTIVE',               toState: 'PRACTICAL_COMPLETION',  priority: 10 },
    { fromState: 'PRACTICAL_COMPLETION', toState: 'CLOSEOUT',              priority: 10 },
    { fromState: 'CLOSEOUT',             toState: 'CLOSED',                priority: 10 },
    // Cancellation — controlled from multiple source states
    { fromState: null,                   toState: 'CANCELLED',             priority: 10 },
    // Reopen transitions
    { fromState: 'PRACTICAL_COMPLETION', toState: 'ACTIVE',                priority: 10 },
    { fromState: 'CLOSEOUT',             toState: 'PRACTICAL_COMPLETION',  priority: 10 },
  ];

  for (const t of transitions) {
    const bindingExists = await prisma.workflowTriggerBinding.findFirst({
      where: {
        organizationId,
        triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
        entityType: 'Project',
        fromState: t.fromState,
        toState: t.toState,
      },
    });
    if (bindingExists) continue;

    await prisma.workflowTriggerBinding.create({
      data: {
        organizationId,
        triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
        entityType: 'Project',
        fromState: t.fromState,
        toState: t.toState,
        workflowDefinitionId: defId,
        priority: t.priority,
        isActive: false,
      },
    });
    console.log(`  ✓ Seeded trigger binding: Project ${t.fromState} → ${t.toState}`);
  }
}

type ChainDef = {
  transactionType: WorkflowTransactionType;
  name: string;
  conditions?: Array<{ field: string; operator: string; value: string; currencyCode?: string }>;
  steps: Array<{
    stepOrder: number;
    groupOrder?: number | null;
    roleRequired: string;
    isOptional: boolean;
    notifyRoles: string[];
  }>;
};

function buildAccoChains(organizationId: string): (ChainDef & { organizationId: string })[] {
  return [
    {
      organizationId,
      transactionType: WorkflowTransactionType.MATERIAL_REQUEST,
      name: 'Material Request Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: ['PROCUREMENT_OFFICER'] },
        { stepOrder: 2, roleRequired: 'PROCUREMENT_OFFICER', isOptional: false, notifyRoles: ['FINANCE_MANAGER'] },
        { stepOrder: 3, roleRequired: 'FINANCE_MANAGER', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.PURCHASE_ORDER,
      name: 'Purchase Order Approval',
      conditions: [
        { field: 'amount', operator: 'gte', value: '0', currencyCode: 'USD' },
      ],
      steps: [
        { stepOrder: 1, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'PROCUREMENT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 3, roleRequired: 'FINANCE_MANAGER', isOptional: false, notifyRoles: [] },
        // PLACEHOLDER: CFO threshold and CEO threshold to be confirmed by Eng Ahmed Shirie
        { stepOrder: 4, roleRequired: 'CFO', isOptional: false, notifyRoles: [] },
        { stepOrder: 5, roleRequired: 'CEO', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.SUPPLIER_PAYMENT,
      name: 'Supplier Payment Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'PROCUREMENT_OFFICER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'STOREKEEPER', isOptional: false, notifyRoles: [] },
        { stepOrder: 3, roleRequired: 'AP_ACCOUNTANT', isOptional: false, notifyRoles: [] },
        { stepOrder: 4, roleRequired: 'FINANCE_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 5, roleRequired: 'CFO', isOptional: false, notifyRoles: [] },
        { stepOrder: 6, roleRequired: 'CEO', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.STOCK_TRANSFER,
      name: 'Stock Transfer Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'STOREKEEPER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.MATERIAL_ISSUE,
      name: 'Material Issue Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'STOREKEEPER', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.SUBCONTRACT_CERTIFICATE,
      name: 'Subcontract Payment Certificate Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'SITE_ENGINEER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'QUANTITY_SURVEYOR', isOptional: false, notifyRoles: [] },
        { stepOrder: 3, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 4, roleRequired: 'COMMERCIAL_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 5, roleRequired: 'FINANCE_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 6, roleRequired: 'CFO', isOptional: false, notifyRoles: [] },
        { stepOrder: 7, roleRequired: 'CEO', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.IPC,
      name: 'Interim Payment Certificate Approval',
      steps: [
        { stepOrder: 1, roleRequired: 'QUANTITY_SURVEYOR', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 3, roleRequired: 'COMMERCIAL_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 4, roleRequired: 'FINANCE_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 5, roleRequired: 'CFO', isOptional: false, notifyRoles: [] },
        { stepOrder: 6, roleRequired: 'CEO', isOptional: false, notifyRoles: [] },
      ],
    },
  ] as (ChainDef & { organizationId: string })[];
}

/**
 * ADR-022 CONST-DOA-005 — seeds ACCO's value-threshold approval bands for POs and payments.
 *
 * Each band is a WorkflowDefinition (its cumulative approver chain) plus a STATE_TRANSITION
 * binding carrying the band's amount range, so the Phase-2 resolver routes a document to the
 * band its value falls in. Everything is seeded **inactive** — the engine gates nothing until
 * a deliberate per-org activation (see scripts/activate-doa-bands.ts), which is gated on the
 * org actually having holders of the CONSTRUCTION_DIRECTOR / FINANCE_OFFICER / CFO / … roles.
 */
async function seedProcurementValueBands(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  await seedBandSet(prisma, organizationId, {
    entityType: 'PurchaseOrder',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    transactionType: WorkflowTransactionType.PURCHASE_ORDER,
    bands: accoPurchaseOrderBands(),
  });
  await seedBandSet(prisma, organizationId, {
    entityType: 'SupplierPayment',
    fromState: 'DRAFT',
    toState: 'APPROVED',
    transactionType: WorkflowTransactionType.SUPPLIER_PAYMENT,
    bands: accoSupplierPaymentBands(),
  });
}

async function seedBandSet(
  prisma: PrismaClient,
  organizationId: string,
  cfg: {
    entityType: string;
    fromState: string;
    toState: string;
    transactionType: WorkflowTransactionType;
    bands: ValueBand[];
  },
): Promise<void> {
  for (const band of cfg.bands) {
    const existingDef = await prisma.workflowDefinition.findFirst({
      where: { organizationId, name: band.name },
    });
    const definition =
      existingDef ??
      (await prisma.workflowDefinition.create({
        data: {
          organizationId,
          transactionType: cfg.transactionType,
          name: band.name,
          // Not requiresCeoConfirmation: these are real, activatable bands, not legacy placeholders
          // (the governance-policy seed forces requiresCeoConfirmation definitions permanently off).
          isActive: false,
          requiresCeoConfirmation: false,
          steps: {
            create: band.steps.map((role, i) => ({
              stepOrder: i + 1,
              roleRequired: role,
              isOptional: false,
              notifyRoles: [],
            })),
          },
        },
      }));

    const existingBinding = await prisma.workflowTriggerBinding.findFirst({
      where: {
        organizationId,
        triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
        entityType: cfg.entityType,
        fromState: cfg.fromState,
        toState: cfg.toState,
        minAmount: band.minAmount,
        maxAmount: band.maxAmount,
      },
    });
    if (!existingBinding) {
      await prisma.workflowTriggerBinding.create({
        data: {
          organizationId,
          triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
          entityType: cfg.entityType,
          transactionType: cfg.transactionType,
          fromState: cfg.fromState,
          toState: cfg.toState,
          workflowDefinitionId: definition.id,
          // Above the catch-all/project bindings (priority 10): a matching band wins over a
          // generic binding. Within a set only one band's range matches an amount anyway.
          priority: 50,
          minAmount: band.minAmount,
          maxAmount: band.maxAmount,
          isActive: false,
        },
      });
    }
    console.log(`  ✓ Seeded value band (inactive): ${band.name}`);
  }
}
