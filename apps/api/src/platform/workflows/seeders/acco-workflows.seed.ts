import { PrismaClient, WorkflowTransactionType, WorkflowTriggerKind } from '@prisma/client';

/**
 * Seeds all ACCO workflow chains + project lifecycle trigger bindings for a given organization.
 * All chains seeded with is_active=false and requires_ceo_confirmation=true.
 * Amount thresholds are PLACEHOLDER values — must be confirmed by Eng Ahmed Shirie before activation.
 */
export async function seedAccoWorkflows(prisma: PrismaClient, organizationId: string): Promise<void> {
  await seedWorkflowRequirementPolicies(prisma);
  await seedDocumentWorkflows(prisma, organizationId);
  await seedProjectLifecycleBindings(prisma, organizationId);
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
        nameAr: chain.nameAr,
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
        nameAr: 'موافقة دورة حياة المشروع',
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
    { fromState: 'DRAFT',                toState: 'APPROVED',              priority: 10 },
    { fromState: 'APPROVED',             toState: 'MOBILIZING',            priority: 10 },
    { fromState: 'MOBILIZING',           toState: 'ACTIVE',                priority: 10 },
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
  nameAr: string;
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
      nameAr: 'موافقة طلب المواد',
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
      nameAr: 'موافقة أمر الشراء',
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
      nameAr: 'موافقة دفع المورد',
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
      nameAr: 'موافقة تحويل المخزون',
      steps: [
        { stepOrder: 1, roleRequired: 'STOREKEEPER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.MATERIAL_ISSUE,
      name: 'Material Issue Approval',
      nameAr: 'موافقة صرف المواد',
      steps: [
        { stepOrder: 1, roleRequired: 'PROJECT_MANAGER', isOptional: false, notifyRoles: [] },
        { stepOrder: 2, roleRequired: 'STOREKEEPER', isOptional: false, notifyRoles: [] },
      ],
    },
    {
      organizationId,
      transactionType: WorkflowTransactionType.SUBCONTRACT_CERTIFICATE,
      name: 'Subcontract Payment Certificate Approval',
      nameAr: 'موافقة شهادة دفع المقاول من الباطن',
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
      nameAr: 'موافقة شهادة الدفع المؤقت',
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
