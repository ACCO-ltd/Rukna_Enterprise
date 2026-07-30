import { PrismaClient, WorkflowTransactionType } from '@prisma/client';

/**
 * Seeds all 7 ACCO workflow chains for a given organization.
 * All chains seeded with is_active=false and requires_ceo_confirmation=true.
 * Amount thresholds are PLACEHOLDER values — must be confirmed by Eng Ahmed Shirie before activation.
 */
export async function seedAccoWorkflows(prisma: PrismaClient, organizationId: string): Promise<void> {
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
        conditions: chain.conditions
          ? { create: chain.conditions }
          : undefined,
        steps: { create: chain.steps },
      },
    });

    console.log(`  ✓ Seeded workflow: ${definition.name} (${definition.id})`);
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
