/**
 * DEV-ONLY DoA demo seed — makes the ADR-011/015 approval gate fire on real documents.
 *
 * The shared `acco-workflows.seed.ts` seeds every chain and binding **inactive** on purpose:
 * no governance rule may take effect until ACCO records the formal policy effective date. That
 * is correct for any real environment, and it also means that out of the box every governed
 * command sails straight through — there is nothing to *see*.
 *
 * This script wires the smallest possible live gate on each of the three governed commands so a
 * developer can watch the whole loop:
 *
 *     submit/approve → 409 (gated) → approve the one step → "Complete" re-drives → transitioned
 *
 * It activates one binding per governed transition, each backed by a single-step chain the
 * seeded ADMIN can approve:
 *
 *     SupplierBill    DRAFT → SUBMITTED   (bill submit)
 *     PurchaseOrder   DRAFT → SUBMITTED   (PO submit)
 *     SupplierPayment DRAFT → APPROVED    (payment approve — no separate submit)
 *
 * Nothing else is touched. It is idempotent, and never registered in any automatic seed path —
 * run it by hand, only against a dev tenant DB:
 *
 *     npx tsx prisma/seeds/dev-doa-demo.seed.ts            # enable the demo gates
 *     npx tsx prisma/seeds/dev-doa-demo.seed.ts --off      # deactivate them again
 *
 * Requires DATABASE_URL pointing at the dev tenant database, and ACCO_ORG_SLUG (default "acco").
 */

import { PrismaClient, WorkflowTransactionType, WorkflowTriggerKind } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';
const DISABLE = process.argv.includes('--off');

/** The seeded tenant admin holds ADMIN, so it can act on these steps from the approval panel. */
const STEP_ROLE = 'ADMIN';

/** One live gate per governed transition (the three call sites wired for ADR-011). */
const GATES: Array<{
  label: string;
  nameAr: string;
  transactionType: WorkflowTransactionType;
  entityType: string;
  fromState: string;
  toState: string;
}> = [
  {
    label: 'DEV — Supplier Bill Approval (demo)',
    nameAr: 'موافقة فاتورة المورد (تجريبي)',
    transactionType: WorkflowTransactionType.SUPPLIER_BILL,
    entityType: 'SupplierBill',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
  },
  {
    label: 'DEV — Purchase Order Approval (demo)',
    nameAr: 'موافقة أمر الشراء (تجريبي)',
    transactionType: WorkflowTransactionType.PURCHASE_ORDER,
    entityType: 'PurchaseOrder',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
  },
  {
    label: 'DEV — Supplier Payment Approval (demo)',
    nameAr: 'موافقة دفع المورد (تجريبي)',
    transactionType: WorkflowTransactionType.SUPPLIER_PAYMENT,
    entityType: 'SupplierPayment',
    fromState: 'DRAFT',
    toState: 'APPROVED',
  },
];

async function seedGate(orgId: string, gate: (typeof GATES)[number], isActive: boolean) {
  // ── A single-step definition the gate opens an approval against ───────────────
  const existingDef = await prisma.workflowDefinition.findFirst({
    where: { organizationId: orgId, name: gate.label },
  });

  const definition =
    existingDef ??
    (await prisma.workflowDefinition.create({
      data: {
        organizationId: orgId,
        transactionType: gate.transactionType,
        name: gate.label,
        nameAr: gate.nameAr,
        // Deliberately not requiresCeoConfirmation — that flag is what the shared seed uses to
        // force chains inactive, and these must stay active for the demo.
        isActive: true,
        requiresCeoConfirmation: false,
        steps: {
          create: [{ stepOrder: 1, roleRequired: STEP_ROLE, isOptional: false, notifyRoles: [] }],
        },
      },
    }));

  // ── The binding that turns the transition into a gated one ────────────────────
  const existingBinding = await prisma.workflowTriggerBinding.findFirst({
    where: {
      organizationId: orgId,
      triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
      entityType: gate.entityType,
      fromState: gate.fromState,
      toState: gate.toState,
    },
  });

  if (existingBinding) {
    await prisma.workflowTriggerBinding.update({
      where: { id: existingBinding.id },
      data: { isActive, workflowDefinitionId: definition.id },
    });
  } else {
    await prisma.workflowTriggerBinding.create({
      data: {
        organizationId: orgId,
        triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
        entityType: gate.entityType,
        transactionType: gate.transactionType,
        fromState: gate.fromState,
        toState: gate.toState,
        workflowDefinitionId: definition.id,
        priority: 100,
        isActive,
      },
    });
  }

  console.log(
    `  ✓ ${gate.entityType} ${gate.fromState} → ${gate.toState} is now ${isActive ? 'ACTIVE' : 'INACTIVE'}`,
  );
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Organization "${ORG_SLUG}" not found. Provision the tenant first.`);
  }
  console.log(`DoA demo gates for org: ${org.name} (${org.id})`);

  const isActive = !DISABLE;
  for (const gate of GATES) {
    await seedGate(org.id, gate, isActive);
  }

  console.log(
    isActive
      ? '\nSubmit a DRAFT bill or PO, or approve a DRAFT payment, to see it gate (409 + ' +
          'approvalInstanceId), then approve the step and Complete.'
      : '\nDemo gates deactivated — these transitions proceed ungated again.',
  );
}

main()
  .catch((err) => {
    console.error('DoA demo seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
