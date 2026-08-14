/**
 * DEV-ONLY DoA demo seed — makes the ADR-011/015 approval gate fire on a real document.
 *
 * The shared `acco-workflows.seed.ts` seeds every chain and binding **inactive** on purpose:
 * no governance rule may take effect until ACCO records the formal policy effective date. That
 * is correct for any real environment, and it also means that out of the box every governed
 * command sails straight through — there is nothing to *see*.
 *
 * This script wires the smallest possible live gate so a developer can watch the whole loop:
 *
 *     submit bill → 409 (gated) → approve the one step → "Complete" re-drives → SUBMITTED
 *
 * It activates ONE binding: SupplierBill DRAFT → SUBMITTED, backed by a single-step chain the
 * seeded ADMIN can approve. Nothing else is touched. It is idempotent, and never registered in
 * any automatic seed path — run it by hand, only against a dev tenant DB:
 *
 *     npx tsx prisma/seeds/dev-doa-demo.seed.ts            # enable the demo gate
 *     npx tsx prisma/seeds/dev-doa-demo.seed.ts --off      # deactivate it again
 *
 * Requires DATABASE_URL pointing at the dev tenant database, and ACCO_ORG_SLUG (default "acco").
 */

import { PrismaClient, WorkflowTransactionType, WorkflowTriggerKind } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';
const DISABLE = process.argv.includes('--off');

const DEFINITION_NAME = 'DEV — Supplier Bill Approval (demo)';
const ENTITY_TYPE = 'SupplierBill';
const FROM_STATE = 'DRAFT';
const TO_STATE = 'SUBMITTED';
/** The seeded tenant admin holds ADMIN, so it can act on this step from the approval panel. */
const STEP_ROLE = 'ADMIN';

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Organization "${ORG_SLUG}" not found. Provision the tenant first.`);
  }
  console.log(`DoA demo gate for org: ${org.name} (${org.id})`);

  // ── The single-step definition the gate opens an approval against ─────────────
  const existingDef = await prisma.workflowDefinition.findFirst({
    where: { organizationId: org.id, name: DEFINITION_NAME },
  });

  const definition =
    existingDef ??
    (await prisma.workflowDefinition.create({
      data: {
        organizationId: org.id,
        transactionType: WorkflowTransactionType.SUPPLIER_BILL,
        name: DEFINITION_NAME,
        nameAr: 'موافقة فاتورة المورد (تجريبي)',
        // Deliberately not requiresCeoConfirmation — that flag is what the shared seed uses to
        // force chains inactive, and this one must stay active for the demo.
        isActive: true,
        requiresCeoConfirmation: false,
        steps: {
          create: [
            { stepOrder: 1, roleRequired: STEP_ROLE, isOptional: false, notifyRoles: [] },
          ],
        },
      },
    }));

  if (!existingDef) {
    console.log(`  ✓ Created definition ${definition.id} (1 step, ${STEP_ROLE})`);
  }

  // ── The binding that turns bill submission into a gated transition ────────────
  const existingBinding = await prisma.workflowTriggerBinding.findFirst({
    where: {
      organizationId: org.id,
      triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
      entityType: ENTITY_TYPE,
      fromState: FROM_STATE,
      toState: TO_STATE,
    },
  });

  const isActive = !DISABLE;

  if (existingBinding) {
    await prisma.workflowTriggerBinding.update({
      where: { id: existingBinding.id },
      data: { isActive, workflowDefinitionId: definition.id },
    });
  } else {
    await prisma.workflowTriggerBinding.create({
      data: {
        organizationId: org.id,
        triggerKind: WorkflowTriggerKind.STATE_TRANSITION,
        entityType: ENTITY_TYPE,
        transactionType: WorkflowTransactionType.SUPPLIER_BILL,
        fromState: FROM_STATE,
        toState: TO_STATE,
        workflowDefinitionId: definition.id,
        priority: 100,
        isActive,
      },
    });
  }

  console.log(
    `  ✓ Binding ${ENTITY_TYPE} ${FROM_STATE} → ${TO_STATE} is now ${isActive ? 'ACTIVE' : 'INACTIVE'}`,
  );
  console.log(
    isActive
      ? '\nSubmit a DRAFT supplier bill to see it gate (409 + approvalInstanceId), then approve and Complete.'
      : '\nDemo gate deactivated — supplier bill submission proceeds ungated again.',
  );
}

main()
  .catch((err) => {
    console.error('DoA demo seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
