-- ADR-026 CONST-VAR-009 (Variations Phase 4) — the Extension-of-Time command.
-- An audited history of every change to a Contract's contractual completion date
-- (contracts.expected_end_date). Moving the date is a DISTINCT, EXPLICIT, human-invoked command,
-- never automatic on VariationOrder approval. Each row records the date before and after, the derived
-- granted days, the actor/reason/time, and the VOs cited as justification (a many-to-many; citation
-- is justification, not effect). No other table is touched; contracts.expected_end_date already
-- exists and is updated by the command at runtime, not by this migration.

-- CreateTable
CREATE TABLE "extensions_of_time" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "previous_end_date" DATE,
    "new_end_date" DATE NOT NULL,
    "granted_days" INTEGER,
    "reason" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "extensions_of_time_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extensions_of_time_organization_id_idx" ON "extensions_of_time"("organization_id");

-- CreateIndex
CREATE INDEX "extensions_of_time_contract_id_idx" ON "extensions_of_time"("contract_id");

-- CreateTable (implicit many-to-many: ExtensionOfTime ↔ VariationOrder, relation "ExtensionOfTimeVariationOrders")
CREATE TABLE "_ExtensionOfTimeVariationOrders" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ExtensionOfTimeVariationOrders_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ExtensionOfTimeVariationOrders_B_index" ON "_ExtensionOfTimeVariationOrders"("B");

-- AddForeignKey
ALTER TABLE "extensions_of_time" ADD CONSTRAINT "extensions_of_time_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExtensionOfTimeVariationOrders" ADD CONSTRAINT "_ExtensionOfTimeVariationOrders_A_fkey" FOREIGN KEY ("A") REFERENCES "extensions_of_time"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExtensionOfTimeVariationOrders" ADD CONSTRAINT "_ExtensionOfTimeVariationOrders_B_fkey" FOREIGN KEY ("B") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
